import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureEvent } from '@toolbar/shared';
import { cropRect, outputSize, CaptureQueue } from '../lib/crop';
import { Ring } from '../lib/ring';
import { idbGetAll } from '../lib/idb';
import { backoffMs, drain, enqueueChunk, pendingRows, reconcile, rekey, withRetry } from '../lib/upload/queue';
import { HttpError } from '../lib/upload/client';
import { enqueueNdjson, NDJSON_CHUNK_RAW } from '../lib/upload/draft';
import { installWebRequest, isCorsBlocked } from '../lib/capture/webrequest';
import { isRestrictedUrl } from '../lib/capture/service';

const ev = (t: number, id: string): CaptureEvent => ({ v: 1, id, ctx: 'top', seq: 0, t, kind: 'console', data: { level: 'log', args: [id] } });

describe('crop (spike S5 rules)', () => {
  it('takes the scale from the bitmap, floors the start and ceils the end', () => {
    // DPR 2: viewport 712 CSS px wide, bitmap 1424
    expect(cropRect({ x: 10.4, y: 20.6, w: 227, h: 38.4 }, { width: 1424, height: 718 }, 712)).toEqual({ sx: 20, sy: 41, sw: 455, sh: 77, scale: 2 });
    // DPR 1 with page zoom 1.5: the bitmap ratio covers both
    expect(cropRect({ x: 100, y: 50, w: 227.3, h: 39 }, { width: 1272, height: 709 }, 848).scale).toBe(1.5);
  });
  it('clamps to the bitmap and outputs 1x CSS pixels on request', () => {
    const p = cropRect({ x: 700, y: 0, w: 100, h: 10 }, { width: 1424, height: 718 }, 712);
    expect(p.sx + p.sw).toBe(1424);
    expect(outputSize(p, true)).toEqual({ w: 12, h: 10 });
    expect(outputSize(p, false)).toEqual({ w: 24, h: 20 });
  });
  it('queues captureVisibleTab calls at most two per second', async () => {
    const q = new CaptureQueue(500);
    const at: number[] = [];
    await Promise.all([1, 2, 3].map(() => q.run(async () => at.push(Date.now()))));
    expect(at[1]! - at[0]!).toBeGreaterThanOrEqual(480);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(480);
  });
});

describe('ring buffer', () => {
  it('slices from the newest full snapshot at or before the cut and prunes the rest', async () => {
    const r = new Ring(5);
    const rr = (type: number, timestamp: number) => ({ type, timestamp, data: {} });
    r.appendRrweb(7, [rr(4, 999), rr(2, 1000), rr(3, 5000), rr(4, 30_999), rr(2, 31_000), rr(3, 40_000), rr(4, 60_999), rr(2, 61_000), rr(3, 65_000)]);
    r.appendEvents(7, [ev(2000, 'a'), ev(45_000, 'b'), ev(66_000, 'c')]);
    r.appendEvents(8, [ev(66_000, 'other-tab')]);
    let s = await r.read(7, 40_000);
    expect(s.rrwebStart).toBe(31_000);
    expect((s.rrweb[0] as { type: number }).type).toBe(4);
    expect(s.events.map((e) => e.id)).toEqual(['b', 'c']);
    expect(await r.prune(7, 62_000)).toBeGreaterThan(0);
    s = await r.read(7, 0);
    expect(s.events.map((e) => e.id)).toEqual(['c']);
    expect((s.rrweb as { timestamp: number }[]).map((x) => x.timestamp)).toEqual([60_999, 61_000, 65_000]);
    expect((await r.read(8, 0)).events.map((e) => e.id)).toEqual(['other-tab']);
    expect((await r.tabs()).sort()).toEqual([7, 8]);
    await r.purgeTab(7);
    expect((await r.read(7, 0)).events).toEqual([]);
  });
});

describe('upload queue', () => {
  afterEach(() => vi.unstubAllGlobals());
  const auth = { serverUrl: 'http://srv', token: 'tb_dev_x' };

  it('retries failed chunks, deletes sent rows, keeps order per stream', async () => {
    for (let seq = 0; seq < 3; seq++) await enqueueChunk({ recordingId: 'loc1', stream: 'video', seq, body: new Blob([`v${seq}`]), t0: 0, t1: 1, contentType: 'video/webm', contentEncoding: null });
    expect(await rekey('loc1', 'srv1')).toBe(3);
    const calls: string[] = [];
    let fail = 1;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      if (fail-- > 0) return new Response('{"error":"unavailable"}', { status: 503, headers: { 'content-type': 'application/json' } });
      expect(new Headers(init.headers).get('x-sha256')).toMatch(/^[0-9a-f]{64}$/);
      return new Response('{"seq":0,"stored":"new"}', { status: 201, headers: { 'content-type': 'application/json' } });
    }));
    const r1 = await drain(auth, 'srv1', 'srv1', { parallel: 1 });
    expect(r1).toMatchObject({ sent: 2, failed: 1 });
    expect(r1.lastError?.retryable).toBe(true);
    expect((await pendingRows('srv1')).map((r) => [r.seq, r.attempts])).toEqual([[0, 1]]);
    expect(await drain(auth, 'srv1', 'srv1')).toMatchObject({ sent: 1, failed: 0 });
    expect(calls[0]).toBe('PUT http://srv/api/v1/recordings/srv1/streams/video/chunks/0');
    expect(await pendingRows('srv1')).toEqual([]);
  });

  it('drops rows the server already holds after a restart (resume)', async () => {
    const row = await enqueueChunk({ recordingId: 'srv2', stream: 'events', seq: 0, body: new Blob(['x']), t0: 0, t1: 1, contentType: 'application/x-ndjson', contentEncoding: 'gzip' });
    await enqueueChunk({ recordingId: 'srv2', stream: 'events', seq: 1, body: new Blob(['y']), t0: 0, t1: 1, contentType: 'application/x-ndjson', contentEncoding: 'gzip' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ stream: 'events', chunks: [{ seq: 0, bytes: 1, sha256: row.sha256 }], lastSeq: 0, completed: false }), { status: 200, headers: { 'content-type': 'application/json' } })));
    expect(await reconcile(auth, 'srv2', 'srv2', 'events')).toBe(1);
    expect((await pendingRows('srv2')).map((r) => r.seq)).toEqual([1]);
  });

  it('backs off from 1 s to 60 s and retries only retryable errors', async () => {
    expect([1, 2, 3, 7, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 60_000, 60_000]);
    const sleeps: number[] = [];
    let n = 0;
    const v = await withRetry(async () => {
      if (n++ < 2) throw new HttpError(0, 'network', 'down');
      return 'ok';
    }, { sleep: async (ms) => void sleeps.push(ms) });
    expect(v).toBe('ok');
    expect(sleeps).toEqual([1000, 2000]);
    await expect(withRetry(async () => { throw new HttpError(403, 'forbidden', 'no'); }, { sleep: async () => {} })).rejects.toThrow('no');
  });

  it('splits NDJSON into gzip chunks with times from the lines', async () => {
    const line = JSON.stringify({ t: 5, pad: 'x'.repeat(1000) });
    const n = Math.ceil((NDJSON_CHUNK_RAW * 1.5) / line.length);
    const s = await enqueueNdjson('srv3', 'events', Array.from({ length: n }, () => line).join('\n'));
    expect(s!.lastSeq).toBe(1);
    const rows = await idbGetAll<{ seq: number; contentEncoding: string; t0: number }>('uploads');
    const mine = rows.filter((r) => (r as unknown as { recordingId: string }).recordingId === 'srv3');
    expect(mine.map((r) => [r.seq, r.contentEncoding, r.t0])).toEqual([[0, 'gzip', 5], [1, 'gzip', 5]]);
  });
});

describe('webRequest helpers', () => {
  it('records only the requests the sink wants, and tells it the page of a main_frame (D-202)', () => {
    const listeners: Record<string, (d: unknown) => void> = {};
    const ev = (name: string) => ({ addListener: (f: (d: unknown) => void) => (listeners[name] = f), removeListener: () => undefined });
    const wr = { onSendHeaders: ev('send'), onHeadersReceived: ev('headers'), onResponseStarted: ev('started'), onCompleted: ev('completed'), onErrorOccurred: ev('error') };
    const asked: { tabId: number; url: string; type: string }[] = [];
    const emitted: string[] = [];
    const undo = installWebRequest(wr as never, {
      wants: (tabId, req) => {
        asked.push({ tabId, ...req });
        return req.url.startsWith('http://localhost:5173/');
      },
      emit: (_tabId, e) => emitted.push((e.data as { url?: string }).url ?? e.kind),
      ownPrefixes: () => [],
    });
    const req = (id: string, url: string, type: string) => ({ requestId: id, url, method: 'GET', tabId: 4, frameId: 0, type, timeStamp: 1 });
    listeners.send!(req('1', 'http://localhost:5173/', 'main_frame'));
    listeners.send!(req('2', 'http://127.0.0.1:5173/', 'main_frame'));
    expect(asked.map((a) => [a.url, a.type])).toEqual([
      ['http://localhost:5173/', 'main_frame'],
      ['http://127.0.0.1:5173/', 'main_frame'],
    ]);
    expect(emitted).toEqual(['http://localhost:5173/']);
    undo();
  });
  it('calls out CORS blocks', () => {
    const base = { type: 'xmlhttprequest', url: 'http://localhost:5174/api', initiator: 'http://localhost:5173' };
    expect(isCorsBlocked({ ...base, responseHeaders: [] })).toBe(true);
    expect(isCorsBlocked({ ...base, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }] })).toBe(false);
    expect(isCorsBlocked({ ...base, responseHeaders: [{ name: 'access-control-allow-origin', value: 'http://localhost:5173' }] })).toBe(false);
    expect(isCorsBlocked({ ...base, url: 'http://localhost:5173/api' })).toBe(false);
    expect(isCorsBlocked({ ...base, type: 'image' })).toBe(false);
  });
  it('knows pages where capture cannot run', () => {
    expect(isRestrictedUrl('chrome://extensions')).toBe(true);
    expect(isRestrictedUrl('https://chromewebstore.google.com/detail/x')).toBe(true);
    expect(isRestrictedUrl('http://localhost:5173/')).toBe(false);
    expect(isRestrictedUrl('file:///tmp/x.html')).toBe(false);
  });
});
