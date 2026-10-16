// Stop trace when the server is down (D-190): the first stop detaches the tab and queues the
// trace; a retried stop must upload those queued chunks and not read the ring again, which by
// then keeps only its normal window.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';

const calls: string[] = [];
let serverUp = false;

vi.mock('../lib/upload/draft', () => ({
  enqueueNdjson: vi.fn(async (_id: string, stream: string, ndjson: string) => {
    calls.push(`enqueue:${stream}:${ndjson.split('\n').filter(Boolean).length}`);
    return { lastSeq: 2, totalBytes: 300 };
  }),
}));
vi.mock('../lib/upload/queue', () => ({
  drain: vi.fn(async () => {
    calls.push(`drain:${serverUp ? 'ok' : 'down'}`);
    return serverUp ? { sent: 3, failed: 0, lastError: null } : { sent: 0, failed: 3, lastError: Object.assign(new Error('bad request'), { retryable: false }) };
  }),
  withRetry: async <T>(f: () => Promise<T>) => f(),
}));
vi.mock('../lib/upload/client', () => ({
  HttpError: class extends Error {},
  api: {
    completeStream: vi.fn(async (_a: unknown, _id: string, stream: string, s: { lastSeq: number }) => void calls.push(`complete:${stream}:${s.lastSeq}`)),
    finalize: vi.fn(async (_a: unknown, id: string) => (calls.push('finalize'), { id, shareUrl: `http://localhost:3000/c/${id}` })),
    uploadAsset: vi.fn(async () => ({ id: 'a1' })),
  },
}));

const { TraceController } = await import('../lib/bg/trace');

function fakeService(ringEvents: () => number) {
  return {
    attachTrace: vi.fn(),
    detachTrace: vi.fn(() => void calls.push('detach')),
    flushTabs: vi.fn(async () => undefined),
    cardStillOf: vi.fn(async () => null),
    onEvents: vi.fn(() => () => undefined),
    emit: vi.fn(),
    ring: {
      flush: vi.fn(async () => undefined),
      purgeTab: vi.fn(async () => undefined),
      read: vi.fn(async () => {
        const n = ringEvents();
        calls.push(`read:${n}`);
        return { events: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, t: 2000 + i, ctx: 'top', seq: i, kind: 'console', data: { level: 'log', args: ['x'] } })), rrweb: [{ type: 3, timestamp: 2000 }] };
      }),
    },
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  calls.length = 0;
  serverUp = false;
  Object.assign(browser, { action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}), setTitle: vi.fn(async () => {}) } });
  const tab = await fakeBrowser.tabs.create({ url: 'https://116.nuru.sh/sw', active: false });
  await browser.storage.local.set({
    'tb:auth': { serverUrl: 'http://localhost:3000', token: 'tb_dev_x', tokenId: 't', user: { id: 'u', name: 'U', email: 'u@x.test', image: null }, activeWorkspaceId: 'w', signedInAt: 1 },
    'tb:trace': { recordingId: 'r1', tabId: tab.id, windowId: tab.windowId, startedAt: 1000, url: 'https://116.nuru.sh/sw', title: 'Nuru' },
  });
});

describe('trace stop retry', () => {
  it('uploads the chunks the failed stop queued, without reading the pruned ring again', async () => {
    // the ring holds the whole trace while it is attached, its last minute after the detach
    let reads = 0;
    const svc = fakeService(() => (reads++ === 0 ? 500 : 5));
    const tc = new TraceController(svc as never);
    await tc.loaded;
    await expect(tc.stop({ open: false })).rejects.toThrow('bad request');
    expect(calls).toEqual(['detach', 'read:500', 'enqueue:events:500', 'enqueue:rrweb:1', 'drain:down']);
    expect(tc.state()).not.toBeNull();
    calls.length = 0;
    serverUp = true;
    const r = await tc.stop({ open: false });
    expect(calls).toEqual(['drain:ok', 'complete:events:2', 'complete:rrweb:2', 'finalize']);
    expect(r.recordingId).toBe('r1');
    expect(tc.state()).toBeNull();
    expect((await browser.storage.local.get('tb:trace'))['tb:trace'] ?? null).toBeNull();
  });

  it('retries from the queue after a worker restart', async () => {
    const svc = fakeService(() => 500);
    const first = new TraceController(svc as never);
    await first.loaded;
    await expect(first.stop({ open: false })).rejects.toThrow();
    calls.length = 0;
    serverUp = true;
    const again = new TraceController(svc as never);
    await again.loaded;
    expect(svc.attachTrace).toHaveBeenCalledTimes(1); // the first controller's restore only
    await again.stop({ open: false });
    expect(calls).toEqual(['drain:ok', 'complete:events:2', 'complete:rrweb:2', 'finalize']);
  });
});
