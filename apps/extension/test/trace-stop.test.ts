// Trace sessions (D-214) in the worker. Stop reads the trace from the ring once and queues it (the
// ring keeps only its normal window after the detach, D-190); a session holds several traces
// whose chunks number on; Send uploads what is queued, retrying from the queue when the server
// was down, and finalizes with the traces and their notes.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';

const calls: string[] = [];
let serverUp = false;
let finalized: Record<string, unknown> | null = null;

vi.mock('../lib/upload/draft', () => ({
  enqueueNdjson: vi.fn(async (_id: string, stream: string, ndjson: string, firstSeq = 0) => {
    calls.push(`enqueue:${stream}:${ndjson.split('\n').filter(Boolean).length}@${firstSeq}`);
    return { lastSeq: firstSeq + 1, totalBytes: 100 };
  }),
}));
vi.mock('../lib/upload/queue', () => ({
  drain: vi.fn(async () => {
    calls.push(`drain:${serverUp ? 'ok' : 'down'}`);
    return serverUp ? { sent: 3, failed: 0, lastError: null } : { sent: 0, failed: 3, lastError: Object.assign(new Error('bad request'), { retryable: false }) };
  }),
  dropRows: vi.fn(async () => void calls.push('drop')),
  withRetry: async <T>(f: () => Promise<T>) => f(),
}));
vi.mock('../lib/upload/client', () => ({
  HttpError: class extends Error {},
  api: {
    createCapture: vi.fn(async () => (calls.push('create'), { id: 'r1', shareUrl: 'http://localhost:3000/c/r1' })),
    completeStream: vi.fn(async (_a: unknown, _id: string, stream: string, s: { lastSeq: number; totalBytes: number }) => void calls.push(`complete:${stream}:${s.lastSeq}:${s.totalBytes}`)),
    finalize: vi.fn(async (_a: unknown, id: string, body: Record<string, unknown>) => ((finalized = body), calls.push('finalize'), { id, shareUrl: `http://localhost:3000/c/${id}` })),
    uploadAsset: vi.fn(async () => ({ id: 'a1' })),
    deleteCapture: vi.fn(async () => (calls.push('delete'), { ok: true, purged: true })),
  },
}));
vi.mock('../lib/scope', () => ({ projects: async () => [] }));

const { TraceController } = await import('../lib/bg/trace');

function fakeService(ringEvents: () => number) {
  return {
    attachTrace: vi.fn(() => void calls.push('attach')),
    detachTrace: vi.fn(() => void calls.push('detach')),
    envFor: vi.fn(async () => null),
    flushTabs: vi.fn(async () => undefined),
    cardStillOf: vi.fn(async () => null),
    onEvents: vi.fn(() => () => undefined),
    emit: vi.fn(),
    ring: {
      flush: vi.fn(async () => undefined),
      purgeTab: vi.fn(async () => undefined),
      appendEvents: vi.fn(),
      read: vi.fn(async () => {
        const n = ringEvents();
        calls.push(`read:${n}`);
        return { events: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, t: Date.now() - 100 + i, ctx: 'top', seq: i, kind: 'console', data: { level: 'log', args: ['x'] } })), rrweb: [{ type: 3, timestamp: Date.now() }] };
      }),
    },
  };
}

let tabId = 0;
beforeEach(async () => {
  fakeBrowser.reset();
  calls.length = 0;
  serverUp = false;
  finalized = null;
  Object.assign(browser, { action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}), setTitle: vi.fn(async () => {}) } });
  const tab = await fakeBrowser.tabs.create({ url: 'https://116.nuru.sh/sw', active: false });
  tabId = tab.id!;
  await browser.storage.local.set({
    'tb:auth': { serverUrl: 'http://localhost:3000', token: 'tb_dev_x', tokenId: 't', user: { id: 'u', name: 'U', email: 'u@x.test', image: null }, activeWorkspaceId: 'w', signedInAt: 1 },
  });
});

const ops = () => calls.filter((c) => !c.startsWith('drain'));

describe('trace sessions', () => {
  it('Stop keeps the trace; a second trace continues the chunk numbers; Send finalizes both with their notes', async () => {
    serverUp = true;
    const tc = new TraceController(fakeService(() => 4) as never);
    await tc.loaded;
    await tc.start(tabId);
    const one = await tc.stop();
    expect(ops()).toEqual(['create', 'attach', 'detach', 'read:4', 'enqueue:events:4@0', 'enqueue:rrweb:1@0']);
    expect(one.takes).toMatchObject([{ n: 1, endedAt: expect.any(Number) }]);
    expect(finalized).toBeNull();
    await tc.note(1, 'The nav bar hides on scroll up');
    calls.length = 0;
    await tc.start(tabId);
    await tc.stop();
    expect(ops()).toEqual(['attach', 'detach', 'read:4', 'enqueue:events:4@2', 'enqueue:rrweb:1@2']);
    calls.length = 0;
    const sent = await tc.send(tabId, { title: 'Nav', description: 'Scrolling the lesson page' });
    expect(sent).toMatchObject({ recordingId: 'r1', traces: 2 });
    expect(ops()).toEqual(['complete:events:3:200', 'complete:rrweb:3:200', 'finalize']);
    expect(finalized).toMatchObject({ title: 'Nav', description: 'Scrolling the lesson page', traces: [{ n: 1, note: 'The nav bar hides on scroll up' }, { n: 2, note: '' }] });
    expect(tc.state()).toBeNull();
    expect((await browser.storage.local.get('tb:trace'))['tb:trace'] ?? null).toBeNull();
  });

  it('a failed Send keeps the session and retries from the queue, without reading the pruned ring again', async () => {
    let reads = 0;
    const tc = new TraceController(fakeService(() => (reads++ === 0 ? 500 : 5)) as never);
    await tc.loaded;
    await tc.start(tabId);
    await tc.stop();
    await expect(tc.send(tabId, { title: 't', description: '' })).rejects.toThrow('bad request');
    expect(tc.state(tabId)?.takes).toHaveLength(1);
    calls.length = 0;
    serverUp = true;
    await tc.send(tabId, { title: 't', description: '' });
    expect(calls).toEqual(['drain:ok', 'complete:events:1:100', 'complete:rrweb:1:100', 'finalize']);
  });

  it('a worker restart re-attaches only a running trace', async () => {
    const svc = fakeService(() => 3);
    const first = new TraceController(svc as never);
    await first.loaded;
    await first.start(tabId);
    await first.stop();
    const again = new TraceController(svc as never);
    await again.loaded;
    expect(svc.attachTrace).toHaveBeenCalledTimes(1);
    expect(again.state(tabId)?.takes).toHaveLength(1);
    await again.start(tabId);
    const third = new TraceController(svc as never);
    await third.loaded;
    expect(svc.attachTrace).toHaveBeenCalledTimes(3);
  });

  it('removing a running trace only detaches it; removing the last one discards the session and the server draft', async () => {
    const tc = new TraceController(fakeService(() => 3) as never);
    await tc.loaded;
    await tc.start(tabId);
    await tc.stop();
    await tc.start(tabId);
    calls.length = 0;
    const left = await tc.remove(2);
    expect(ops()).toEqual(['detach']);
    expect(left?.takes.map((t) => t.n)).toEqual([1]);
    calls.length = 0;
    expect(await tc.remove(1)).toBeNull();
    expect(ops()).toEqual(['drop', 'delete']);
    expect(tc.state()).toBeNull();
  });

  it('one session at a time, in the tab it started in', async () => {
    const tc = new TraceController(fakeService(() => 3) as never);
    await tc.loaded;
    await tc.start(tabId);
    await tc.stop();
    const other = await fakeBrowser.tabs.create({ url: 'https://116.nuru.sh/en', active: false });
    await expect(tc.start(other.id)).rejects.toThrow(/another tab/);
    expect(tc.state(other.id)).toBeNull();
    expect(tc.state(tabId)).not.toBeNull();
  });
});
