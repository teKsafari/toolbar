// @vitest-environment happy-dom
// The embed's ReviewPlatform (D-212): it answers every request the reviewer toolbar makes, keeps
// the tab's notes across page loads, and sends them in the extension's order through the key's
// create route and the capture's upload token, never with the page's cookies.
import { gunzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptureEvent } from '@toolbar/shared';
import type { NewReviewItem } from '@toolbar/shared/ext';
import type { ReviewRequestType } from '@toolbar/review/platform';
import { createEmbedClient, type EmbedConfig } from '../src/client';
import { PageSession } from '../src/session';
import { createPagePlatform } from '../src/platform';
import { ITEMS_KEY, ItemStore } from '../src/store';
import { ReviewerStore } from '../src/reviewer';

const SERVER = 'https://tb.example';
const config: EmbedConfig = { project: { id: 'p1', name: 'Lab' }, workspaceId: 'ws-1', maskingPreset: 'staging', bodyAllowlist: [], traceOpenMs: 1500, brand: { name: 'Acme', accent: null } };

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  credentials: RequestCredentials | undefined;
  body: unknown;
}

function fakeServer() {
  const calls: Call[] = [];
  let assets = 0;
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
  const f = vi.fn(async (url: string, init: RequestInit) => {
    const path = url.slice(SERVER.length);
    const method = init.method ?? 'GET';
    let body: unknown = init.body;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    else if (init.body instanceof Blob && path.includes('/chunks/')) body = gunzipSync(Buffer.from(await init.body.arrayBuffer())).toString('utf8');
    else if (init.body instanceof FormData) body = Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `file:${(v as File).name}`]));
    calls.push({ method, path, headers: { ...(init.headers as Record<string, string>) }, credentials: init.credentials, body });
    if (path === '/api/v1/embed/tbk_test/recordings') return json({ id: 'rec-9', uploadToken: 'tb_upl_tok' });
    if (path === '/api/v1/assets') return json({ id: `00000000-0000-4000-8000-00000000000${++assets}`, url: '/a', kind: 'feedback' });
    if (path.endsWith('/feedback')) return json({ items: [] });
    if (path.includes('/chunks/')) return json({ seq: 0 });
    if (path.endsWith('/complete')) return json({ completed: true });
    if (path.endsWith('/finalize')) return json({ id: 'rec-9', status: 'processing' });
    return new Response('{}', { status: 404 });
  });
  return { fetch: f as unknown as typeof fetch, calls };
}

const err = (t: number, id: string): CaptureEvent => ({ v: 1, id, ctx: 'top', seq: t, t, kind: 'console', data: { level: 'error', args: ['Boom'] } }) as unknown as CaptureEvent;

function setup(now = 100_000) {
  const server = fakeServer();
  const client = createEmbedClient(server.fetch, SERVER, 'tbk_test');
  const session = new PageSession({ client, workspaceId: async () => 'ws-1', env: async () => ({ browser: 'x' }), now: () => now });
  const reviewer = new ReviewerStore({ email: 'ada@example.com' });
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
  const shoot = vi.fn(async () => ({ blob: png, width: 10, height: 10 }));
  const platform = createPagePlatform({ client, config, session, locate: async () => undefined, shoot, reviewer, env: async () => ({ browser: 'x' }), assetUrl: (f) => `${SERVER}/embed/${f}`, now: () => now });
  return { server, session, platform, reviewer, shoot };
}

const note = (over: Partial<NewReviewItem> = {}): NewReviewItem => ({ kind: 'element', comment: 'The total is wrong', shapes: [], page: { url: 'http://lab/cart', title: 'Cart', viewport: { w: 800, h: 600 }, scroll: { x: 0, y: 0 } }, intent: 'fix', severity: 'important', ...over }) as NewReviewItem;

describe('page platform', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('answers every request the toolbar makes', () => {
    const { platform } = setup();
    const types: ReviewRequestType[] = ['review.get', 'review.context', 'review.shot', 'review.add', 'review.update', 'review.remove', 'review.clear', 'review.voice', 'review.submit', 'locator.capture', 'mic.request', 'trace.get', 'trace.start', 'trace.stop', 'trace.note', 'trace.remove'];
    expect(Object.keys(platform.handlers).sort()).toEqual([...types].sort());
    expect(platform.caps.canScreenshot).toBe(true);
    expect(platform.openCapture).toBeUndefined();
    expect(platform.assetUrl('inter.woff2')).toBe(`${SERVER}/embed/inter.woff2`);
  });

  it('sends in the extension order: create by key, then the upload token for assets, items, events, complete, finalize', async () => {
    const { platform, session, server } = setup();
    session.send([err(90_000, 'e1')]);
    const shot = await platform.request('review.shot', { rect: { x: 0, y: 0, w: 10, h: 10 }, vw: 800 });
    expect(shot.ok).toBe(true);
    const blobId = shot.ok ? shot.blobId : '';
    const added = await platform.request('review.add', { item: note({ cropBlobId: blobId, cropRect: { x: 0, y: 0, w: 10, h: 10 } }) });
    expect(added.ok && added.item.context.errors).toHaveLength(1);
    await platform.request('review.add', { item: note({ kind: 'text', comment: 'Typo', quote: 'Totl' }) });
    const r = await platform.request('review.submit', { title: 'Cart problems' });
    expect(r).toEqual({ ok: true, result: { recordingId: 'rec-9', url: '', count: 2, traces: 0 } });

    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/v1/embed/tbk_test/recordings',
      'POST /api/v1/assets',
      'POST /api/v1/recordings/rec-9/feedback',
      'PUT /api/v1/recordings/rec-9/streams/events/chunks/0',
      'POST /api/v1/recordings/rec-9/streams/events/complete',
      'POST /api/v1/recordings/rec-9/finalize',
    ]);
    expect(server.calls.every((c) => c.credentials === 'omit')).toBe(true);
    expect(server.calls[0]!.headers.authorization).toBeUndefined();
    for (const c of server.calls.slice(1)) expect(c.headers.authorization).toBe('Bearer tb_upl_tok');

    const create = server.calls[0]!.body as Record<string, unknown>;
    expect(create).toMatchObject({ kind: 'feedback', source: 'embed', workspaceId: 'ws-1', page: { url: 'http://lab/cart', title: 'Cart' }, startedAt: 90_000, reviewer: { email: 'ada@example.com' } });
    expect((create.reviewer as { id: string }).id).toMatch(/^r_[0-9a-f]{32}$/);
    expect(server.calls[1]!.body).toMatchObject({ kind: 'feedback', recordingId: 'rec-9', file: expect.stringMatching(/^file:/) });
    const items = (server.calls[2]!.body as { items: Record<string, unknown>[] }).items;
    expect(items.map((i) => [i.n, i.kind, i.comment, !!i.cropAssetId])).toEqual([
      [1, 'element', 'The total is wrong', true],
      [2, 'text', 'Typo', false],
    ]);
    expect(String(server.calls[3]!.body).trim().split('\n').map((l) => (JSON.parse(l) as { id: string }).id)).toEqual(['e1']);
    expect(server.calls[3]!.headers['x-t0']).toBe('90000');
    expect(server.calls[5]!.body).toMatchObject({ title: 'Cart problems', description: '', annotations: [] });

    const after = await platform.request('review.get', {});
    expect(after.ok && after.items).toEqual([]);
  });

  it('a failed send keeps the notes; a 429 reads as a rate limit', async () => {
    const { platform, server } = setup();
    (server.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'content-type': 'application/json' } }));
    await platform.request('review.add', { item: note() });
    const r = await platform.request('review.submit', {});
    expect(r).toMatchObject({ ok: false, error: 'server', message: expect.stringMatching(/Too many notes/) });
    const left = await platform.request('review.get', {});
    expect(left.ok && left.items).toHaveLength(1);
  });

  it('a trace session: notes made during a trace become its actions; Stop keeps it; Send sends traces and notes as one capture', async () => {
    const { platform, session, server } = setup();
    (server.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => new Response(JSON.stringify({ id: 'tr-1', uploadToken: 'tb_upl_trace' }), { headers: { 'content-type': 'application/json' } }));
    const started = await platform.request('trace.start', {});
    expect(started).toMatchObject({ ok: true, trace: { recordingId: 'tr-1', takes: [{ n: 1, endedAt: null }] } });
    expect(await platform.request('trace.get', {})).toMatchObject({ ok: true, trace: { recordingId: 'tr-1' } });
    const spy = vi.spyOn(session, 'annotate');
    const added = await platform.request('review.add', { item: note() });
    expect(spy).toHaveBeenCalledWith(added.ok ? added.item.id : '');
    const stopped = await platform.request('trace.stop', {});
    expect(stopped).toMatchObject({ ok: true, trace: { takes: [{ n: 1, endedAt: expect.any(Number) }] } });
    expect(server.calls.some((c) => c.path.endsWith('/finalize'))).toBe(false);
    // a note made after the stop is not an action of the trace
    spy.mockClear();
    await platform.request('review.add', { item: note() });
    expect(spy).not.toHaveBeenCalled();
    expect(await platform.request('trace.note', { n: 1, note: 'The total jumps after Save' })).toMatchObject({ ok: true, trace: { takes: [{ note: 'The total jumps after Save' }] } });
    server.calls.length = 0;
    const r = await platform.request('review.submit', { description: 'Checking out as a guest' });
    expect(r).toMatchObject({ ok: true, result: { recordingId: 'tr-1', traces: 1, count: 2 } });
    // the trace's events (its one action) went up at Stop: Send completes the stream and finalizes
    expect(server.calls.map((c) => `${c.method} ${c.path} ${c.headers.authorization}`)).toEqual([
      'POST /api/v1/recordings/tr-1/feedback Bearer tb_upl_trace',
      'POST /api/v1/recordings/tr-1/streams/events/complete Bearer tb_upl_trace',
      'POST /api/v1/recordings/tr-1/finalize Bearer tb_upl_trace',
    ]);
    const fin = server.calls.at(-1)!.body as { title: string; description: string; traces: { n: number; note: string }[] };
    expect(fin).toMatchObject({ title: 'The total jumps after Save', description: 'Checking out as a guest', traces: [{ n: 1, note: 'The total jumps after Save' }] });
    expect(await platform.request('trace.get', {})).toMatchObject({ ok: true, trace: null });
  });

  it('Discard all drops the trace session and its server draft', async () => {
    const { platform, server } = setup();
    (server.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => new Response(JSON.stringify({ id: 'tr-2', uploadToken: 'tb_upl_trace' }), { headers: { 'content-type': 'application/json' } }));
    await platform.request('trace.start', {});
    await platform.request('trace.stop', {});
    server.calls.length = 0;
    await platform.request('review.clear', {});
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['DELETE /api/v1/recordings/tr-2']);
    expect(await platform.request('trace.get', {})).toMatchObject({ ok: true, trace: null });
  });

  it('keeps the notes for the next page of the tab', async () => {
    const a = setup();
    await a.platform.request('review.add', { item: note() });
    expect(JSON.parse(sessionStorage.getItem(ITEMS_KEY)!).items).toHaveLength(1);
    const b = setup();
    const got = await b.platform.request('review.get', {});
    expect(got.ok && got.items.map((i) => [i.n, i.comment])).toEqual([[1, 'The total is wrong']]);
    expect(new ItemStore().state.nextN).toBe(2);
    await b.platform.request('review.clear', {});
    expect(JSON.parse(sessionStorage.getItem(ITEMS_KEY)!)).toEqual({ items: [], nextN: 1 });
  });

  it('a crop that fails gives an error the toolbar shows, never a thrown request', async () => {
    const { platform, shoot } = setup();
    shoot.mockResolvedValueOnce(null as never);
    const r = await platform.request('review.shot', { rect: { x: 0, y: 0, w: 10, h: 10 }, vw: 800 });
    expect(r).toMatchObject({ ok: false, error: 'server' });
  });

  it('settings live in localStorage and another tab changes arrive as storage events', async () => {
    const { platform } = setup();
    await platform.storage.set('tb:review-pos', { a: 1 });
    expect(await platform.storage.get('tb:review-pos')).toEqual({ a: 1 });
    const seen: unknown[] = [];
    const off = platform.storage.onChange('tb:closed', (v) => seen.push(v));
    dispatchEvent(new StorageEvent('storage', { key: 'tb:closed', newValue: JSON.stringify({ 'http://lab': 1 }) }));
    dispatchEvent(new StorageEvent('storage', { key: 'other', newValue: '1' }));
    off();
    dispatchEvent(new StorageEvent('storage', { key: 'tb:closed', newValue: '{}' }));
    expect(seen).toEqual([{ 'http://lab': 1 }]);
  });
});
