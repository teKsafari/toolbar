// @vitest-environment happy-dom
// The injector's page bundle (D-158): its route paths match the server's route table, the
// one-minute ring keeps a replayable window, and comments and traces upload as the server expects.
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { ROUTES } from '@toolbar/shared/api';
import type { CaptureEvent } from '@toolbar/shared';
import { PAGE_ROUTES, PageHttpError, type PageClient } from '../page/upload';
import { PageSession, Ring, titleOf, uuid } from '../page/session';

const ev = (t: number, kind: CaptureEvent['kind'] = 'console'): CaptureEvent => ({ v: 1, id: `x:${t}`, ctx: 'top', seq: t, t, kind, data: {} }) as unknown as CaptureEvent;
const rr = (type: number, timestamp: number) => ({ type, timestamp, data: {} });

describe('page routes', () => {
  it('match the route table', () => {
    for (const [name, r] of Object.entries(PAGE_ROUTES)) {
      const def = ROUTES[name as keyof typeof ROUTES];
      expect(def, name).toBeDefined();
      expect(def.method, name).toBe(r.method);
      expect(def.path, name).toBe(r.path);
    }
  });
});

describe('ring', () => {
  it('keeps the last minute of events and the env', () => {
    const r = new Ring(60_000);
    r.addEvents([ev(1000, 'env'), ev(1000), ev(50_000)], 50_000);
    r.addEvents([ev(100_000)], 100_000);
    const s = r.slice(100_000);
    expect(s.events.map((e) => e.kind)).toEqual(['env', 'console', 'console']);
    expect(s.events.slice(1).map((e) => e.t)).toEqual([50_000, 100_000]);
  });
  it('cuts rrweb at full snapshots and keeps one that covers the window', () => {
    const r = new Ring(60_000);
    r.addRrweb([rr(3, 500)], false, 500); // nothing to replay it from: dropped
    r.addRrweb([rr(4, 1000), rr(2, 1000)], true, 1000);
    r.addRrweb([rr(3, 20_000)], false, 20_000);
    r.addRrweb([rr(3, 30_999), rr(4, 31_000), rr(2, 31_000)], true, 31_000);
    r.addRrweb([rr(3, 60_000)], false, 60_000);
    r.addRrweb([rr(4, 61_000), rr(2, 61_000)], true, 61_000);
    // at 92 s the window starts at 32 s: the segment from 31 s covers it, the one from 1 s goes
    const s = r.slice(92_000);
    expect(s.rrweb.map((e) => (e as { timestamp: number }).timestamp)).toEqual([31_000, 31_000, 60_000, 61_000, 61_000]);
    expect(r.segments[0]!.start).toBe(31_000);
  });
});

function fakeClient() {
  const calls: { op: string; args: unknown[] }[] = [];
  const chunks: { stream: string; seq: number; rows: unknown[] }[] = [];
  const client = {
    bootstrap: vi.fn(),
    createCapture: vi.fn(async (body: unknown) => {
      calls.push({ op: 'create', args: [body] });
      return { id: 'rec-1', shareUrl: 'https://tb.example/s/abc' };
    }),
    putChunk: vi.fn(async (id: string, stream: string, seq: number, gz: Blob) => {
      const rows = gunzipSync(Buffer.from(await gz.arrayBuffer()))
        .toString('utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as unknown);
      chunks.push({ stream, seq, rows });
      calls.push({ op: 'put', args: [id, stream, seq] });
      return { seq };
    }),
    completeStream: vi.fn(async (...args: unknown[]) => {
      calls.push({ op: 'complete', args });
    }),
    finalize: vi.fn(async (...args: unknown[]) => {
      calls.push({ op: 'finalize', args });
      return { id: 'rec-1', shareUrl: 'https://tb.example/s/abc', status: 'processing' };
    }),
  };
  return { client: client as unknown as PageClient, calls, chunks };
}

describe('page session', () => {
  it('sends a comment with the last minute as a replay capture', async () => {
    const { client, calls, chunks } = fakeClient();
    const now = 200_000;
    const s = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({ browser: 'x' }), now: () => now });
    s.send([ev(100_000), ev(150_000)]);
    s.sendRrweb([rr(4, 145_000), rr(2, 145_000)], true);
    s.sendRrweb([rr(3, 190_000)], false);
    const r = await s.comment({ comment: 'Button does nothing\nmore detail', t: 199_000, url: 'http://lab/' });
    expect(r).toEqual({ shareUrl: 'https://tb.example/s/abc' });
    const create = calls[0]!.args[0] as Record<string, unknown>;
    expect(create).toMatchObject({ kind: 'replay', workspaceId: 'ws-1', source: 'injector', startedAt: 145_000 });
    expect(chunks.map((c) => [c.stream, c.seq, c.rows.length])).toEqual([
      ['events', 0, 1],
      ['rrweb', 0, 3],
    ]);
    const fin = calls.find((c) => c.op === 'finalize')!.args[1] as { title: string; annotations: { t: number; comment: string }[] };
    expect(fin.title).toBe('Button does nothing');
    expect(fin.annotations[0]).toMatchObject({ t: 54_000, comment: 'Button does nothing\nmore detail' });
  });

  it('streams a trace in numbered chunks and finalizes it with its comments', async () => {
    sessionStorage.clear();
    const { client, calls, chunks } = fakeClient();
    let now = 1_000;
    const s = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}), now: () => now });
    await s.startTrace();
    expect(JSON.parse(sessionStorage.getItem('tb:page-trace')!).id).toBe('rec-1');
    expect(calls[0]!.args[0]).toMatchObject({ kind: 'trace', source: 'injector', startedAt: 1_000 });
    s.send([ev(1_100)]);
    s.sendRrweb([rr(4, 1_100), rr(2, 1_100)], true);
    await s.flushTrace(false);
    now = 3_000;
    s.send([ev(2_900)]);
    await s.flushTrace(false);
    await s.comment({ comment: 'Odd spacing', t: 2_950, url: 'http://lab/' });
    now = 5_000;
    const r = await s.stopTrace('Checking the lesson page');
    expect(r.shareUrl).toBe('https://tb.example/s/abc');
    expect(chunks.map((c) => `${c.stream}:${c.seq}`)).toEqual(['events:0', 'rrweb:0', 'events:1']);
    const completes = calls.filter((c) => c.op === 'complete').map((c) => c.args.slice(1, 3));
    expect(completes).toEqual([
      ['events', 1],
      ['rrweb', 0],
    ]);
    const fin = calls.find((c) => c.op === 'finalize')!.args[1] as { title: string; description: string; durationMs: number; annotations: unknown[] };
    expect(fin).toMatchObject({ title: 'Checking the lesson page', description: 'Checking the lesson page\n\nOdd spacing', durationMs: 4_000 });
    expect(fin.annotations).toHaveLength(1);
    expect(sessionStorage.getItem('tb:page-trace')).toBeNull();
    expect(s.trace).toBeNull();
  });

  it('picks the trace up again on the next page of the tab, with the rows the last page could not send', async () => {
    sessionStorage.clear();
    const { client, chunks } = fakeClient();
    const a = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    await a.startTrace();
    a.send([ev(1_000)]);
    await a.flushTrace(false);
    // the page goes away with a row it has not sent: no chunk number is spent on it
    a.send([ev(2_000)]);
    await a.flushTrace(true);
    expect(chunks.map((c) => `${c.stream}:${c.seq}`)).toEqual(['events:0']);
    const b = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    expect(b.trace?.id).toBe('rec-1');
    expect(b.trace?.seq.events).toBe(1);
    const cmds: string[] = [];
    b.onCommand((c) => cmds.push(c.type));
    b.boot();
    expect(cmds).toEqual(['ring', 'attach', 'checkout']);
    b.send([ev(3_000)]);
    await b.flushTrace(false);
    expect(chunks.map((c) => `${c.stream}:${c.seq}`)).toEqual(['events:0', 'events:1']);
    expect(chunks[1]!.rows.map((r) => (r as { t: number }).t)).toEqual([2_000, 3_000]);
    expect(sessionStorage.getItem('tb:page-trace-pending')).toBeNull();
  });

  it('fills a chunk the server never got with an empty one, so the trace still completes', async () => {
    sessionStorage.clear();
    const { client, calls, chunks } = fakeClient();
    // the server holds events 0 and 2 (1 went missing with a closed tab) and counts bytes itself
    let completes = 0;
    (client as unknown as { completeStream: unknown }).completeStream = vi.fn(async (_id: string, stream: string, lastSeq: number, totalBytes: number) => {
      calls.push({ op: 'complete', args: [_id, stream, lastSeq, totalBytes] });
      if (stream !== 'events') return;
      completes++;
      if (completes === 1) throw new PageHttpError(409, 'stream_incomplete', { error: 'stream_incomplete', stream, completed: false, missing: [1], issues: { missing: [1] } });
      if (completes === 2) throw new PageHttpError(409, 'stream_incomplete', { error: 'stream_incomplete', stream, completed: false, missing: [], issues: { total: 123 } });
    });
    const s = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    await s.startTrace();
    s.trace!.seq.events = 3;
    s.trace!.bytes.events = 90;
    const r = await s.stopTrace('gap');
    expect(r.shareUrl).toBe('https://tb.example/s/abc');
    expect(chunks.filter((c) => c.stream === 'events').map((c) => [c.seq, c.rows.length])).toEqual([[1, 0]]);
    const ev = calls.filter((c) => c.op === 'complete' && c.args[1] === 'events').map((c) => c.args.slice(2));
    expect(ev[0]).toEqual([2, 90]);
    expect(ev[2]).toEqual([2, 123]);
    expect(calls.some((c) => c.op === 'finalize')).toBe(true);
  });

  it('gives up on other completion errors', async () => {
    sessionStorage.clear();
    const { client } = fakeClient();
    (client as unknown as { completeStream: unknown }).completeStream = vi.fn(async () => {
      throw new PageHttpError(403, 'forbidden', { error: 'forbidden' });
    });
    const s = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    await s.startTrace();
    s.trace!.seq.events = 1;
    await expect(s.stopTrace('x')).rejects.toThrow('forbidden');
  });

  it('titles and ids', () => {
    expect(titleOf('\n  first line  \nsecond')).toBe('first line');
    expect(titleOf('x'.repeat(100))).toHaveLength(80);
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
