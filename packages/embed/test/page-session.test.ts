// @vitest-environment happy-dom
// The embed's capture session (D-158, D-212): the one-minute ring keeps a replayable window, and
// traces upload as the server expects, with the capture's upload token, across page loads.
import { gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { CaptureEvent } from '@toolbar/shared';
import { EmbedHttpError, type EmbedCapture, type EmbedClient } from '../src/client';
import { PageSession, Ring, titleOf, uuid } from '../src/session';

const ev = (t: number, kind: CaptureEvent['kind'] = 'console'): CaptureEvent => ({ v: 1, id: `x:${t}`, ctx: 'top', seq: t, t, kind, data: {} }) as unknown as CaptureEvent;
const rr = (type: number, timestamp: number) => ({ type, timestamp, data: {} });

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
    createCapture: vi.fn(async (body: unknown) => {
      calls.push({ op: 'create', args: [body] });
      return { id: 'rec-1', uploadToken: 'tb_upl_abc' };
    }),
    putChunk: vi.fn(async (cap: EmbedCapture, stream: string, seq: number, gz: Blob) => {
      const rows = gunzipSync(Buffer.from(await gz.arrayBuffer()))
        .toString('utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as unknown);
      chunks.push({ stream, seq, rows });
      calls.push({ op: 'put', args: [cap.id, stream, seq, cap.uploadToken] });
      return { seq };
    }),
    completeStream: vi.fn(async (cap: EmbedCapture, ...args: unknown[]) => {
      calls.push({ op: 'complete', args: [cap.id, ...args] });
    }),
    finalize: vi.fn(async (cap: EmbedCapture, ...args: unknown[]) => {
      calls.push({ op: 'finalize', args: [cap.id, ...args] });
      return { id: 'rec-1', status: 'processing' };
    }),
  };
  return { client: client as unknown as EmbedClient, calls, chunks };
}

describe('page session', () => {
  it('streams a trace in numbered chunks with its upload token and finalizes it', async () => {
    sessionStorage.clear();
    const { client, calls, chunks } = fakeClient();
    let now = 1_000;
    const s = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}), reviewer: () => ({ id: 'r_1', name: 'Ada' }), now: () => now });
    await s.startTrace();
    expect(JSON.parse(sessionStorage.getItem('tb:page-trace')!)).toMatchObject({ id: 'rec-1', uploadToken: 'tb_upl_abc' });
    expect(calls[0]!.args[0]).toMatchObject({ kind: 'trace', source: 'embed', startedAt: 1_000, workspaceId: 'ws-1', reviewer: { id: 'r_1', name: 'Ada' } });
    s.send([ev(1_100)]);
    s.sendRrweb([rr(4, 1_100), rr(2, 1_100)], true);
    await s.flushTrace(false);
    now = 3_000;
    s.send([ev(2_900)]);
    await s.flushTrace(false);
    // a note made during the trace becomes one of its actions
    s.annotate('note-1');
    now = 5_000;
    const r = await s.stopTrace('Checking the lesson page');
    expect(r.recordingId).toBe('rec-1');
    expect(chunks.map((c) => `${c.stream}:${c.seq}`)).toEqual(['events:0', 'rrweb:0', 'events:1', 'events:2']);
    expect(chunks[3]!.rows).toMatchObject([{ kind: 'annotation', data: { annotationId: 'note-1', op: 'create' } }]);
    expect(calls.filter((c) => c.op === 'put').every((c) => c.args[3] === 'tb_upl_abc')).toBe(true);
    const completes = calls.filter((c) => c.op === 'complete').map((c) => c.args.slice(1, 3));
    expect(completes).toEqual([
      ['events', 2],
      ['rrweb', 0],
    ]);
    const fin = calls.find((c) => c.op === 'finalize')!.args[1] as { title: string; description: string; durationMs: number; annotations: unknown[] };
    expect(fin).toMatchObject({ title: 'Checking the lesson page', description: 'Checking the lesson page', durationMs: 4_000, annotations: [] });
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
    (client as unknown as { completeStream: unknown }).completeStream = vi.fn(async (cap: EmbedCapture, stream: string, lastSeq: number, totalBytes: number) => {
      calls.push({ op: 'complete', args: [cap.id, stream, lastSeq, totalBytes] });
      if (stream !== 'events') return;
      completes++;
      if (completes === 1) throw new EmbedHttpError(409, 'stream_incomplete', { error: 'stream_incomplete', stream, completed: false, missing: [1], issues: { missing: [1] } });
      if (completes === 2) throw new EmbedHttpError(409, 'stream_incomplete', { error: 'stream_incomplete', stream, completed: false, missing: [], issues: { total: 123 } });
    });
    const s = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    await s.startTrace();
    s.trace!.seq.events = 3;
    s.trace!.bytes.events = 90;
    const r = await s.stopTrace('gap');
    expect(r.recordingId).toBe('rec-1');
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
      throw new EmbedHttpError(403, 'forbidden', { error: 'forbidden' });
    });
    const s = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    await s.startTrace();
    s.trace!.seq.events = 1;
    await expect(s.stopTrace('x')).rejects.toThrow('forbidden');
  });

  it('sends the reviewer name known when the trace stops with its finalize', async () => {
    sessionStorage.clear();
    const { client, calls } = fakeClient();
    let who: { id: string; name?: string } = { id: 'r_1' };
    const s = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}), reviewer: () => who });
    await s.startTrace();
    expect(calls[0]!.args[0]).toMatchObject({ reviewer: { id: 'r_1' } });
    // the composer asked for the name after the trace had started
    who = { id: 'r_1', name: 'Ada' };
    await s.stopTrace('x');
    expect(calls.find((c) => c.op === 'finalize')!.args[1]).toMatchObject({ reviewer: { name: 'Ada' } });
    // no name known: no reviewer field
    who = { id: 'r_1' };
    await s.startTrace();
    await s.stopTrace('y');
    expect(calls.filter((c) => c.op === 'finalize')[1]!.args[1]).not.toHaveProperty('reviewer');
  });

  it('two live pages of one trace never take the same chunk number', async () => {
    sessionStorage.clear();
    const { client, chunks } = fakeClient();
    const a = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    await a.startTrace();
    // b is the page the tab went to while a sat in the back-forward cache
    const b = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    b.send([ev(1_000)]);
    await b.flushTrace(false);
    b.send([ev(2_000)]);
    await b.flushTrace(false);
    a.send([ev(3_000)]);
    await a.flushTrace(false);
    expect(chunks.map((c) => `${c.stream}:${c.seq}`)).toEqual(['events:0', 'events:1', 'events:2']);
    expect(JSON.parse(sessionStorage.getItem('tb:page-trace')!).seq.events).toBe(3);
    // the byte counts of both pages add up in the stored trace
    const bytes = JSON.parse(sessionStorage.getItem('tb:page-trace')!).bytes.events as number;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBe(a.trace!.bytes.events);
    expect(a.trace!.bytes.events).toBeGreaterThan(b.trace!.bytes.events);
  });

  it('back from the back-forward cache, takes the stored trace and attaches again', async () => {
    sessionStorage.clear();
    const { client, chunks } = fakeClient();
    const a = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    await a.startTrace();
    const cmds: string[] = [];
    a.onCommand((c) => cmds.push(c.type));
    // a goes into the cache with a row it stashed; the next page sends chunks 0 and 1
    a.send([ev(1_000)]);
    await a.flushTrace(true);
    const b = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    b.boot();
    b.send([ev(2_000)]);
    await b.flushTrace(false);
    b.send([ev(2_500)]);
    await b.flushTrace(false);
    expect(chunks.map((c) => c.rows.map((r) => (r as { t: number }).t))).toEqual([[1_000, 2_000], [2_500]]);
    // the reviewer goes back to a; b went away with a row of its own
    b.send([ev(2_800)]);
    await b.flushTrace(true);
    cmds.length = 0;
    a.resume();
    expect(a.trace!.seq.events).toBe(2);
    expect(cmds).toEqual(['attach', 'checkout']);
    a.send([ev(3_000)]);
    await a.flushTrace(false);
    expect(chunks.slice(2).map((c) => [c.seq, c.rows.map((r) => (r as { t: number }).t)])).toEqual([[2, [2_800, 3_000]]]);
  });

  it('back from the back-forward cache, lets go of a trace another page stopped', async () => {
    sessionStorage.clear();
    const { client, chunks } = fakeClient();
    const a = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    const changed = vi.fn();
    a.subscribe(changed);
    await a.startTrace();
    const cmds: { type: string; recordingId?: string }[] = [];
    a.onCommand((c) => cmds.push(c as { type: string; recordingId?: string }));
    const b = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({}) });
    await b.stopTrace('done');
    changed.mockClear();
    a.resume();
    expect(a.trace).toBeNull();
    expect(cmds).toEqual([{ type: 'detach', recordingId: 'rec-1' }]);
    expect(changed).toHaveBeenCalled();
    a.send([ev(5_000)]);
    await a.flushTrace(false);
    expect(chunks).toEqual([]);
    expect(sessionStorage.getItem('tb:page-trace')).toBeNull();
  });

  it('titles and ids', () => {
    expect(titleOf('\n  first line  \nsecond')).toBe('first line');
    expect(titleOf('x'.repeat(100))).toHaveLength(80);
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
