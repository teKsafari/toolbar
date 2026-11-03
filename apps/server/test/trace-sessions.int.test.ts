// Trace sessions (D-214) against a throwaway Postgres database and the dev bucket under a key
// prefix of its own: a trace capture with three windows of events and replay, finalized with
// traces 1 and 3 (the reviewer removed trace 2), keeps nothing of trace 2 in events.json.gz, the
// replay or the keyframes; GET spans tags each span with its trace; the capture detail, the
// folder and MCP carry the traces with their notes. Finalize refuses traces on other kinds.
// Route handlers are called directly with the locals the hooks would set. Skips when Postgres is
// down (the bucket is the compose one, as in embed.int.test.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { RequestEvent } from '@sveltejs/kit';
import sharp from 'sharp';
import { uuidv7, type CaptureEvent } from '@toolbar/shared';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_tracesessions_${process.pid}`;
const run = Date.now().toString(36);
const SERVER = 'http://localhost:3000';

const reachable = await (async () => {
  try {
    const s = postgres(base, { max: 1, connect_timeout: 2, onnotice: () => {} });
    await s`select 1`;
    await s.end();
    return true;
  } catch {
    return false;
  }
})();

// three windows of the session; the capture starts at the first Start trace
const T0 = Date.now() - 120_000;
const W = [
  { n: 1, startedAt: T0 + 1000, endedAt: T0 + 5000, note: 'The list jumps to the top when I scroll it.' },
  { n: 2, startedAt: T0 + 10_000, endedAt: T0 + 14_000, note: 'removed' },
  { n: 3, startedAt: T0 + 20_000, endedAt: T0 + 24_000, note: '' },
];

let seq = 0;
const ev = (t: number, kind: string, data: unknown, ctx = 'top-i'): CaptureEvent => ({ v: 1, id: `${ctx}:${seq}`, ctx, seq: seq++, t, kind, data }) as CaptureEvent;
const button = (name: string) => ({ selector: `button[data-testid="${name}"]`, tag: 'button', role: 'button', name, rect: { x: 0, y: 0, w: 80, h: 24 } });
const events: CaptureEvent[] = [
  ev(T0 + 900, 'env', { ua: 'Mozilla/5.0', browser: { name: 'Chrome', version: '141' }, viewport: { w: 1280, h: 800 }, dpr: 1, maskingPreset: 'staging' }),
  // each window: a click that changes the page, and a console line naming the window
  ...W.flatMap((w) => [
    ev(w.startedAt + 500, 'user', { type: 'click', target: button(`save-${w.n}`) }),
    ev(w.startedAt + 600, 'dom', { added: 1, removed: 0, attrs: 0, text: 1, rects: [{ x: 10, y: 10, w: 100, h: 20 }], texts: [`saved ${w.n}`] }),
    ev(w.startedAt + 700, 'console', { level: 'log', args: [`window ${w.n}`] }, 'top'),
    ev(w.startedAt + 800, 'shot', { assetId: `__kf${w.n}`, reason: 'keyframe', rect: { x: 0, y: 0, w: 1280, h: 800 } }, 'top'),
  ]),
];
// rrweb: one Meta and FullSnapshot at the start, an increment in each window, a new snapshot in window 2
const rr = [
  { type: 4, timestamp: T0 + 950, data: { href: 'http://lab.test/', width: 1280, height: 800 } },
  { type: 2, timestamp: T0 + 951, data: { node: 1 } },
  { type: 3, timestamp: T0 + 2000, data: { w: 1 } },
  { type: 4, timestamp: T0 + 11_000, data: { href: 'http://lab.test/b', width: 1280, height: 800 } },
  { type: 2, timestamp: T0 + 11_001, data: { node: 2 } },
  { type: 3, timestamp: T0 + 12_000, data: { w: 2 } },
  { type: 3, timestamp: T0 + 21_000, data: { w: 3 } },
];

describe.skipIf(!reachable)('trace sessions (integration, D-214)', () => {
  let admin: postgres.Sql;
  let m: {
    db: typeof import('../src/lib/server/db/index.ts').db;
    schema: typeof import('../src/lib/server/db/schema/index.ts');
    s3: typeof import('../src/lib/server/s3.ts');
    create: typeof import('../src/routes/api/v1/recordings/+server.ts');
    chunk: typeof import('../src/routes/api/v1/recordings/[id]/streams/[stream]/chunks/[seq]/+server.ts');
    complete: typeof import('../src/routes/api/v1/recordings/[id]/streams/[stream]/complete/+server.ts');
    finalize: typeof import('../src/routes/api/v1/recordings/[id]/finalize/+server.ts');
    spans: typeof import('../src/routes/api/v1/recordings/[id]/spans/+server.ts');
    capture: typeof import('../src/routes/api/v1/recordings/[id]/+server.ts');
    handlers: typeof import('../src/lib/server/jobs/handlers.ts');
    folder: typeof import('../src/lib/server/handoff/folder.ts');
    mcp: typeof import('../src/lib/server/mcp/protocol.ts');
    tokens: typeof import('../src/lib/server/tokens.ts');
    orm: typeof import('drizzle-orm');
  };
  const env0 = { ...process.env };
  type U = { id: string; email: string; name: string };
  let owner: U;
  let ws: string;

  type Init = { method?: string; json?: unknown; raw?: Uint8Array; params?: Record<string, string>; headers?: Record<string, string> };
  function req(path: string, init: Init = {}) {
    const url = new URL(path, SERVER);
    const headers: Record<string, string> = { ...init.headers };
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers['content-type'] = 'application/json';
    } else if (init.raw) body = init.raw as Uint8Array<ArrayBuffer>;
    return {
      request: new Request(url, { method: init.method ?? 'GET', body, headers }),
      url,
      params: init.params ?? {},
      cookies: { get: () => undefined, set: () => undefined },
      locals: { user: owner, session: null, apiToken: null },
      getClientAddress: () => '127.0.0.1',
    } as unknown as RequestEvent;
  }

  async function startCapture(kind: 'trace' | 'feedback') {
    const r = await m.create.POST(req('/api/v1/recordings', { method: 'POST', json: { clientId: uuidv7(), kind, workspaceId: ws, page: { url: 'http://lab.test/', title: 'Lab' }, startedAt: W[0]!.startedAt } }) as never);
    expect(r.status).toBe(201);
    return ((await r.json()) as { id: string }).id;
  }
  async function put(id: string, stream: 'events' | 'rrweb', text: string) {
    const raw = new Uint8Array(gzipSync(text));
    const r = await m.chunk.PUT(req(`/api/v1/recordings/${id}/streams/${stream}/chunks/0`, { method: 'PUT', raw, params: { id, stream, seq: '0' }, headers: { 'content-type': 'application/x-ndjson' } }) as never);
    expect(r.status).toBeLessThan(300);
    const c = await m.complete.POST(req(`/api/v1/recordings/${id}/streams/${stream}/complete`, { method: 'POST', params: { id, stream }, json: { lastSeq: 0, totalBytes: raw.byteLength } }) as never);
    expect(c.status).toBeLessThan(300);
  }
  const finalize = (id: string, json: unknown) => m.finalize.POST(req(`/api/v1/recordings/${id}/finalize`, { method: 'POST', params: { id }, json }) as never);
  const recOf = async (id: string) => (await m.db.select().from(m.schema.recording).where(m.orm.eq(m.schema.recording.id, id)))[0]!;

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.S3_KEY_PREFIX = `tracesessions-${run}/`;
    process.env.PUBLIC_URL = SERVER;
    process.env.TRANSCRIBE_PROVIDER = 'none';
    execFileSync('node', ['scripts/migrate.ts'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    m = {
      db: (await import('../src/lib/server/db/index.ts')).db,
      schema: await import('../src/lib/server/db/schema/index.ts'),
      s3: await import('../src/lib/server/s3.ts'),
      create: await import('../src/routes/api/v1/recordings/+server.ts'),
      chunk: await import('../src/routes/api/v1/recordings/[id]/streams/[stream]/chunks/[seq]/+server.ts'),
      complete: await import('../src/routes/api/v1/recordings/[id]/streams/[stream]/complete/+server.ts'),
      finalize: await import('../src/routes/api/v1/recordings/[id]/finalize/+server.ts'),
      spans: await import('../src/routes/api/v1/recordings/[id]/spans/+server.ts'),
      capture: await import('../src/routes/api/v1/recordings/[id]/+server.ts'),
      handlers: await import('../src/lib/server/jobs/handlers.ts'),
      folder: await import('../src/lib/server/handoff/folder.ts'),
      mcp: await import('../src/lib/server/mcp/protocol.ts'),
      tokens: await import('../src/lib/server/tokens.ts'),
      orm: await import('drizzle-orm'),
    };
    const ws_ = await import('../src/lib/server/auth/workspaces.ts');
    owner = (await m.db.insert(m.schema.user).values({ name: 'Tina', email: `tina-${run}@traces.test`, emailVerified: true }).returning())[0]! as U;
    ws = (await ws_.createWorkspace(m.db, { userId: owner.id, email: owner.email, name: 'Traces', domainJoin: false })).id;
  }, 120_000);

  afterAll(async () => {
    process.env = env0;
    await m?.s3.deletePrefix(`tracesessions-${run}/`).catch(() => 0);
    await (await import('../src/lib/server/db/index.ts')).sqlClient.end().catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('finalize with traces 1 and 3 drops trace 2 from the events, the replay and the keyframes; spans carry their trace', async () => {
    const id = await startCapture('trace');
    // one keyframe per window, named in the shot events
    const kf: string[] = [];
    const png = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer();
    for (let i = 0; i < W.length; i++) {
      const [a] = await m.db.insert(m.schema.asset).values({ recordingId: id, kind: 'keyframe', s3Key: '', contentType: 'image/png', bytes: 1, width: 1280, height: 800 }).returning();
      const key = m.s3.keys.asset(id, a!.id);
      await m.s3.putObjectWith(key, png, { contentType: 'image/png' });
      await m.db.update(m.schema.asset).set({ s3Key: key }).where(m.orm.eq(m.schema.asset.id, a!.id));
      kf.push(a!.id);
    }
    const evs = events.map((e) => (e.kind === 'shot' ? { ...e, data: { ...(e.data as object), assetId: kf[Number(String((e.data as { assetId: string }).assetId).slice(4)) - 1] } } : e));
    await put(id, 'events', evs.map((e) => JSON.stringify(e)).join('\n') + '\n');
    await put(id, 'rrweb', rr.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const kept = [W[0]!, W[2]!];
    const done = await finalize(id, { title: 'Two traces', description: 'Context for the whole session', durationMs: 23_000, traces: kept });
    expect(done.status).toBe(200);
    expect((await recOf(id)).traces).toEqual(kept);
    await m.handlers.finalizeRecording({ recordingId: id }, { attempts: 1, max_attempts: 12 });
    const rec = await recOf(id);
    expect(rec.status).toBe('ready');
    expect(rec.startedAt!.getTime()).toBe(W[0]!.startedAt);
    expect(rec.durationMs).toBe(W[2]!.endedAt - W[0]!.startedAt);

    // events.json.gz: nothing from window 2; env kept
    const stored = JSON.parse(gunzipSync(await m.s3.getBytes(m.s3.keys.final(id, 'events.json.gz'))).toString('utf8')) as CaptureEvent[];
    expect(stored.some((e) => e.kind === 'env')).toBe(true);
    expect(stored.filter((e) => e.t >= W[1]!.startedAt - 250 && e.t <= W[1]!.endedAt)).toEqual([]);
    expect(stored.filter((e) => e.kind === 'console').map((e) => (e.data as { args: string[] }).args[0])).toEqual(['window 1', 'window 3']);

    // the replay: window 3 starts from window 2's snapshot, moved to its start; window 2's own time is gone
    const chunks = await m.db.select().from(m.schema.recordingChunk).where(m.orm.and(m.orm.eq(m.schema.recordingChunk.recordingId, id), m.orm.eq(m.schema.recordingChunk.stream, 'rrweb')));
    const replay: { type: number; timestamp: number; data: unknown }[] = [];
    for (const c of chunks) replay.push(...gunzipSync(await m.s3.getBytes(c.s3Key)).toString('utf8').trim().split('\n').map((l) => JSON.parse(l)));
    expect(replay.filter((e) => e.timestamp > W[1]!.startedAt - 250 && e.timestamp <= W[1]!.endedAt)).toEqual([]);
    const from3 = W[2]!.startedAt - 250;
    expect(replay.filter((e) => e.timestamp === from3).map((e) => e.type)).toEqual([4, 2, 3]);
    expect(replay.find((e) => e.type === 2 && e.timestamp === from3)!.data).toEqual({ node: 2 });

    // window 2's keyframe is gone
    const assets = await m.db.select({ id: m.schema.asset.id }).from(m.schema.asset).where(m.orm.and(m.orm.eq(m.schema.asset.recordingId, id), m.orm.eq(m.schema.asset.kind, 'keyframe')));
    expect(assets.map((a) => a.id).sort()).toEqual([kf[0]!, kf[2]!].sort());

    // GET spans: trace 1 and trace 3, no span from window 2
    const sp = await m.spans.GET(req(`/api/v1/recordings/${id}/spans`, { params: { id } }) as never);
    expect(sp.status).toBe(200);
    const body = (await sp.json()) as { items: { id: string; trace?: number; action: { label: string } }[] };
    expect(body.items.map((s) => [s.trace, s.action.label])).toEqual([
      [1, expect.stringContaining('save-1')],
      [3, expect.stringContaining('save-3')],
    ]);

    // the detail returns the traces; the folder lists them with the note; MCP carries them
    const detail = (await (await m.capture.GET(req(`/api/v1/recordings/${id}`, { params: { id } }) as never)).json()) as { traces: unknown; description: string };
    expect(detail.traces).toEqual(kept);
    expect(detail.description).toBe('Context for the whole session');
    const f = await m.folder.folderOf(m.db, rec);
    expect(f.folder.readme).toContain('### Trace 1: 0.0s to 4.0s (4.0s)');
    expect(f.folder.readme).toContain('### Trace 3: 19.0s to 23.0s (4.0s)');
    expect(f.folder.readme).toContain('The list jumps to the top when I scroll it.');
    const fb = JSON.parse(String(f.folder.files.find((x) => x.path === 'feedback.json')!.data));
    expect(fb.traces.map((t: { n: number; startMs: number; endMs: number }) => [t.n, t.startMs, t.endMs])).toEqual([
      [1, 0, 4000],
      [3, 19_000, 23_000],
    ]);
    const spansJsonl = String(f.folder.files.find((x) => x.path === 'spans.jsonl')!.data).trim().split('\n').map((l) => JSON.parse(l));
    expect(spansJsonl.map((s: { trace: number }) => s.trace)).toEqual([1, 3]);
    const tok = await m.tokens.createApiToken(m.db, { userId: owner.id, kind: 'personal', name: 'mcp', scopes: ['mcp:read'] });
    const res = await m.mcp.handleMcpPost(
      m.db,
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${tok.secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_capture', arguments: { capture: id } } }),
      }),
    );
    const out = (await res.json()) as { result: { content: { text: string }[] } };
    const cap = JSON.parse(out.result.content[0]!.text);
    expect(cap.traces.map((t: { n: number; note: string | null }) => [t.n, t.note])).toEqual([
      [1, 'The list jumps to the top when I scroll it.'],
      [3, null],
    ]);
  });

  it('finalize refuses traces on a capture of another kind, and a trace capture without traces keeps every event', async () => {
    const fb = await startCapture('feedback');
    const r = await finalize(fb, { traces: [W[0]] });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { error: string }).error).toBe('invalid_body');

    // the CLI's single window: no traces, nothing cut, spans without a trace
    const id = await startCapture('trace');
    await put(id, 'events', events.filter((e) => e.kind !== 'shot').map((e) => JSON.stringify(e)).join('\n') + '\n');
    expect((await finalize(id, { durationMs: 23_000 })).status).toBe(200);
    await m.handlers.finalizeRecording({ recordingId: id }, { attempts: 1, max_attempts: 12 });
    const stored = JSON.parse(gunzipSync(await m.s3.getBytes(m.s3.keys.final(id, 'events.json.gz'))).toString('utf8')) as CaptureEvent[];
    expect(stored.filter((e) => e.kind === 'console')).toHaveLength(3);
    const sp = (await (await m.spans.GET(req(`/api/v1/recordings/${id}/spans`, { params: { id } }) as never)).json()) as { items: { trace?: number }[] };
    expect(sp.items).toHaveLength(3);
    expect(sp.items.every((s) => s.trace === undefined)).toBe(true);
    const detail = (await (await m.capture.GET(req(`/api/v1/recordings/${id}`, { params: { id } }) as never)).json()) as { traces: unknown };
    expect(detail.traces).toEqual([]);
  });
});
