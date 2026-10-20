// The embed (D-210, D-211) against a throwaway Postgres database and the dev Garage bucket under a
// key prefix of its own: the admin key routes, the public config and create routes with their
// origin checks and rate limit, the capture they make (source, author, access, no share link),
// feedback items and an asset through the capture's upload token, CORS, and key rotation. D-213:
// what the token may still write (asset caps, a window after finalize, a per-address limit with
// separate buckets per address), its revocation by rotation or turn-off, the reviewer name at
// finalize, and the unverified marker on embed authors in summaries, MCP and the hand-off. Route
// handlers are called directly with the locals and headers the hooks and server.js would set.
// Skips when Postgres is down.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import type { RequestEvent } from '@sveltejs/kit';
import { LIMITS, uuidv7 } from '@toolbar/shared';
import { EMBED_KEY_RE, REQUEST_ORIGIN_HEADER, feedbackFiltersSchema } from '@toolbar/shared/api';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_embedtest_${process.pid}`;
const run = Date.now().toString(36);

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

const SITE = 'http://localhost:5173';
const SERVER = 'http://localhost:3000';

describe.skipIf(!reachable)('embed (integration, D-211)', () => {
  let admin: postgres.Sql;
  let m: {
    db: typeof import('../src/lib/server/db/index.ts').db;
    schema: typeof import('../src/lib/server/db/schema/index.ts');
    settings: typeof import('../src/lib/server/settings/index.ts');
    s3: typeof import('../src/lib/server/s3.ts');
    key: typeof import('../src/routes/api/v1/projects/[id]/embed-key/+server.ts');
    config: typeof import('../src/routes/api/v1/embed/[key]/config/+server.ts');
    create: typeof import('../src/routes/api/v1/embed/[key]/recordings/+server.ts');
    feedback: typeof import('../src/routes/api/v1/recordings/[id]/feedback/+server.ts');
    assets: typeof import('../src/routes/api/v1/assets/+server.ts');
    finalize: typeof import('../src/routes/api/v1/recordings/[id]/finalize/+server.ts');
    chunk: typeof import('../src/routes/api/v1/recordings/[id]/streams/[stream]/chunks/[seq]/+server.ts');
    complete: typeof import('../src/routes/api/v1/recordings/[id]/streams/[stream]/complete/+server.ts');
    capture: typeof import('../src/routes/api/v1/recordings/[id]/+server.ts');
    token: typeof import('../src/lib/server/upload/token.ts');
    core: typeof import('../src/lib/server/dashboard/core.ts');
    mcp: typeof import('../src/lib/server/mcp/data.ts');
    exp: typeof import('../src/lib/server/handoff/export.ts');
    cors: typeof import('../src/lib/server/embed/cors.ts');
    orm: typeof import('drizzle-orm');
  };
  const env0 = { ...process.env };
  type U = { id: string; email: string; name: string };
  let owner: U;
  let maker: U;
  let projectId: string;
  let ws: string;
  let key: string;

  type Init = { method?: string; json?: unknown; form?: FormData; params?: Record<string, string>; headers?: Record<string, string>; ip?: string };
  function ev(user: U | null, path: string, init: Init = {}) {
    const url = new URL(path, SERVER);
    const headers: Record<string, string> = { ...init.headers };
    let body: BodyInit | undefined;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers['content-type'] = 'application/json';
    } else if (init.form) body = init.form;
    const cookies = { get: () => undefined, set: () => undefined };
    return {
      request: new Request(url, { method: init.method ?? 'GET', body, headers }),
      url,
      params: init.params ?? {},
      cookies,
      locals: { user, session: null, apiToken: null },
      getClientAddress: () => init.ip ?? '127.0.0.1',
    } as unknown as RequestEvent;
  }
  const fromSite = (extra: Record<string, string> = {}) => ({ origin: SITE, [REQUEST_ORIGIN_HEADER]: SITE, ...extra });

  const getConfig = (k: string, headers: Record<string, string> = fromSite()) => m.config.GET(ev(null, `/api/v1/embed/${k}/config`, { params: { key: k }, headers }) as never);
  const body = (extra: Record<string, unknown> = {}) => ({
    clientId: uuidv7(),
    kind: 'feedback',
    page: { url: `${SITE}/checkout`, title: 'Checkout' },
    startedAt: Date.now(),
    reviewer: { id: 'rv-123', name: '  Rita   Client ', email: 'rita@client.test' },
    ...extra,
  });
  const create = (k: string, json: unknown, init: Init = {}) =>
    m.create.POST(ev(null, `/api/v1/embed/${k}/recordings`, { method: 'POST', json, params: { key: k }, headers: fromSite(), ...init }) as never);
  const recordingOf = async (id: string) => (await m.db.select().from(m.schema.recording).where(m.orm.eq(m.schema.recording.id, id)))[0]!;

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.S3_KEY_PREFIX = `embedtest-${run}/`;
    process.env.PUBLIC_URL = SERVER;
    process.env.TRANSCRIBE_PROVIDER = 'none';
    execFileSync('node', ['scripts/migrate.ts'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    m = {
      db: (await import('../src/lib/server/db/index.ts')).db,
      schema: await import('../src/lib/server/db/schema/index.ts'),
      settings: await import('../src/lib/server/settings/index.ts'),
      s3: await import('../src/lib/server/s3.ts'),
      key: await import('../src/routes/api/v1/projects/[id]/embed-key/+server.ts'),
      config: await import('../src/routes/api/v1/embed/[key]/config/+server.ts'),
      create: await import('../src/routes/api/v1/embed/[key]/recordings/+server.ts'),
      feedback: await import('../src/routes/api/v1/recordings/[id]/feedback/+server.ts'),
      assets: await import('../src/routes/api/v1/assets/+server.ts'),
      finalize: await import('../src/routes/api/v1/recordings/[id]/finalize/+server.ts'),
      chunk: await import('../src/routes/api/v1/recordings/[id]/streams/[stream]/chunks/[seq]/+server.ts'),
      complete: await import('../src/routes/api/v1/recordings/[id]/streams/[stream]/complete/+server.ts'),
      capture: await import('../src/routes/api/v1/recordings/[id]/+server.ts'),
      token: await import('../src/lib/server/upload/token.ts'),
      core: await import('../src/lib/server/dashboard/core.ts'),
      mcp: await import('../src/lib/server/mcp/data.ts'),
      exp: await import('../src/lib/server/handoff/export.ts'),
      cors: await import('../src/lib/server/embed/cors.ts'),
      orm: await import('drizzle-orm'),
    };
    const ws_ = await import('../src/lib/server/auth/workspaces.ts');
    const mk = async (who: string) => (await m.db.insert(m.schema.user).values({ name: who, email: `${who.toLowerCase()}-${run}@embed.test`, emailVerified: true }).returning())[0]! as U;
    owner = await mk('Ola');
    maker = await mk('Mo');
    ws = (await ws_.createWorkspace(m.db, { userId: owner.id, email: owner.email, name: 'Client', domainJoin: false })).id;
    await m.db.insert(m.schema.member).values({ organizationId: ws, userId: maker.id, role: 'creator' });
    // the server's own origin listed by mistake: the embed still refuses it
    const [p] = await m.db
      .insert(m.schema.project)
      .values({ organizationId: ws, name: 'Client app', origins: [SITE, SERVER], maskingPreset: 'production', bodyAllowlist: [], traceOpenMs: 15_000 })
      .returning();
    projectId = p!.id;
  }, 120_000);

  afterAll(async () => {
    process.env = env0;
    await m?.s3.deletePrefix(`embedtest-${run}/`).catch(() => 0);
    await (await import('../src/lib/server/db/index.ts')).sqlClient.end().catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  const rotate = (u: U) => m.key.POST(ev(u, `/api/v1/projects/${projectId}/embed-key`, { method: 'POST', params: { id: projectId } }) as never);

  it('a workspace admin turns the embed on; others may not', async () => {
    expect((await rotate(maker)).status).toBe(403);
    const r = await rotate(owner);
    expect(r.status).toBe(200);
    const p = await r.json();
    expect(p.embedKey).toMatch(EMBED_KEY_RE);
    key = p.embedKey;
  });

  it('config: 200 on a project origin, 404 for an unknown or malformed key', async () => {
    const r = await getConfig(key);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      project: { id: projectId, name: 'Client app' },
      workspaceId: ws,
      maskingPreset: 'production',
      bodyAllowlist: [],
      traceOpenMs: 15_000,
      brand: { name: expect.any(String), accent: expect.stringMatching(/^#/) },
    });
    expect((await getConfig('tbk_AAAAAAAAAAAAAAAAAAAAAA')).status).toBe(404);
    expect((await getConfig('nope')).status).toBe(404);
  });

  it('origin: the copied request origin wins, Referer is the fallback; other sites and the server itself are refused', async () => {
    // server.js rewrote Origin to the server for a Bearer request; its copy holds the real one
    expect((await getConfig(key, { origin: SERVER, [REQUEST_ORIGIN_HEADER]: SITE })).status).toBe(200);
    expect((await getConfig(key, { referer: `${SITE}/some/page?q=1` })).status).toBe(200);
    for (const headers of <Record<string, string>[]>[{ origin: 'http://localhost:5174' }, { [REQUEST_ORIGIN_HEADER]: 'https://evil.test' }, { origin: SERVER }, { referer: `${SERVER}/x` }, {}]) {
      const r = await getConfig(key, headers);
      expect(r.status, JSON.stringify(headers)).toBe(403);
      expect((await r.json()).error).toBe('origin_not_allowed');
    }
  });

  let recId: string;
  let token: string;

  it('create: a workspace-only embed capture with the reviewer as author and no share link', async () => {
    const b = body({ reviewer: { id: 'rv-123', name: '  Rita   Client ', email: 'not an email' }, workspaceId: 'ignored', source: 'extension' });
    const r = await create(key, b);
    expect(r.status).toBe(201);
    const out = await r.json();
    expect(Object.keys(out).sort()).toEqual(['id', 'uploadToken']);
    expect(out.uploadToken).toMatch(/^tb_upl_/);
    recId = out.id;
    token = out.uploadToken;
    const rec = await recordingOf(recId);
    expect(rec).toMatchObject({
      source: 'embed',
      organizationId: ws,
      projectId,
      access: 'workspace',
      maskingPreset: 'production',
      kind: 'feedback',
      pageUrl: `${SITE}/checkout`,
      authorUserId: null,
      authorName: 'Rita Client',
      authorEmail: null,
      authorIssuer: 'embed',
      authorSubject: 'rv-123',
    });
    // a retry gets the same capture; another reviewer cannot take its clientId
    const again = await create(key, b);
    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(recId);
    expect((await create(key, { ...b, reviewer: { id: 'rv-other' } })).status).toBe(409);
  });

  it('create: the page must be on the request origin; kinds are feedback, replay and trace', async () => {
    const off = await create(key, body({ page: { url: 'http://localhost:5174/', title: '' } }));
    expect(off.status).toBe(403);
    expect((await off.json()).error).toBe('origin_not_allowed');
    expect((await create(key, body(), { headers: { origin: 'http://localhost:5174' } })).status).toBe(403);
    expect((await create(key, body({ kind: 'screenshot' }))).status).toBe(422);
    const ok = await create(key, body({ kind: 'trace', reviewer: { id: 'rv-9', email: 'ann@client.test' } }), { ip: '10.0.0.9' });
    expect(ok.status).toBe(201);
    expect(await recordingOf((await ok.json()).id)).toMatchObject({ kind: 'trace', authorName: null, authorEmail: 'ann@client.test', authorSubject: 'rv-9' });
  });

  it('rate limit: embedRateLimit captures per address and key in an hour, then 429', async () => {
    m.settings._setStoredForTest({ embedRateLimit: 2 } as never);
    try {
      const ip = '10.0.0.42';
      expect((await create(key, body(), { ip })).status).toBe(201);
      expect((await create(key, body(), { ip })).status).toBe(201);
      const third = await create(key, body(), { ip });
      expect(third.status).toBe(429);
      expect((await third.json()).error).toBe('rate_limited');
      // another address has its own allowance
      expect((await create(key, body(), { ip: '10.0.0.43' })).status).toBe(201);
    } finally {
      m.settings._setStoredForTest({} as never);
    }
  });

  const upload = (path: string, init: Init) => ev(null, path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
  const page = { url: `${SITE}/checkout`, title: 'Checkout', viewport: { w: 1280, h: 720 }, scroll: { x: 0, y: 0 }, dpr: 1 };
  const item = (n: number, extra: Record<string, unknown> = {}) => ({
    clientId: crypto.randomUUID(),
    n,
    kind: 'element',
    comment: `note ${n}`,
    target: { selector: 'main > button', tag: 'button', name: 'Pay', rect: { x: 1, y: 2, w: 30, h: 10 } },
    anchor: { fx: 0.5, fy: 0.5, x: 16, y: 7 },
    page,
    t: Date.now(),
    ...extra,
  });

  it('upload token: an asset lands on the capture with no creator, and feedback items take the capture author', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 20, 8, 6, 0, 0, 0]);
    const form = new FormData();
    form.set('kind', 'feedback');
    form.set('recordingId', recId);
    form.set('file', new File([png], 'crop.png', { type: 'image/png' }));
    const a = await m.assets.POST(upload('/api/v1/assets', { method: 'POST', form }) as never);
    expect(a.status).toBe(201);
    const assetId = (await a.json()).id;
    const [row] = await m.db.select().from(m.schema.asset).where(m.orm.eq(m.schema.asset.id, assetId));
    expect(row).toMatchObject({ recordingId: recId, createdBy: null });

    const r = await m.feedback.POST(
      upload(`/api/v1/recordings/${recId}/feedback`, { method: 'POST', params: { id: recId }, json: { items: [item(1, { kind: 'shot', cropAssetId: assetId, cropRect: { x: 0, y: 0, w: 40, h: 20 } }), item(2)] } }) as never,
    );
    expect(r.status).toBe(201);
    const items = (await r.json()).items;
    expect(items).toHaveLength(2);
    expect(items[0].author).toMatchObject({ userId: null, name: 'Rita Client', email: null, issuer: 'embed', subject: 'rv-123' });
    expect(items[0].cropUrl).toContain(assetId);
  });

  it('upload token: no unattached or foreign assets, no other capture, members as before', async () => {
    const [loose] = await m.db.insert(m.schema.asset).values({ kind: 'crop', s3Key: 'x/loose', contentType: 'image/png', bytes: 1, createdBy: owner.id }).returning();
    const stolen = await m.feedback.POST(upload(`/api/v1/recordings/${recId}/feedback`, { method: 'POST', params: { id: recId }, json: { items: [item(5, { cropAssetId: loose!.id })] } }) as never);
    expect(stolen.status).toBe(422);
    const [other] = await m.db.insert(m.schema.recording).values({ clientId: crypto.randomUUID(), organizationId: ws, kind: 'feedback', pageUrl: SITE, authorUserId: owner.id }).returning();
    const wrong = await m.feedback.POST(upload(`/api/v1/recordings/${other!.id}/feedback`, { method: 'POST', params: { id: other!.id }, json: { items: [item(1)] } }) as never);
    expect([401, 403, 404]).toContain(wrong.status);
    // a member still adds items as themselves
    const mine = await m.feedback.POST(ev(owner, `/api/v1/recordings/${other!.id}/feedback`, { method: 'POST', params: { id: other!.id }, json: { items: [item(1)] } }) as never);
    expect(mine.status).toBe(201);
    expect((await mine.json()).items[0].author).toMatchObject({ userId: owner.id, name: 'Ola' });
  });

  // ---- D-213: what an embed capture's upload token may still write ----

  /** A new embed capture started from an address of its own, and calls with its token. */
  let starts = 0;
  async function start(extra: Record<string, unknown> = {}, k = key) {
    starts++;
    const r = await create(k, body(extra), { ip: `10.1.0.${starts}` });
    expect(r.status).toBe(201);
    const out = (await r.json()) as { id: string; uploadToken: string };
    const as = (path: string, init: Init) => ev(null, path, { ...init, headers: { authorization: `Bearer ${out.uploadToken}`, ...init.headers } });
    const feedback = (n: number, ip = '10.9.0.1') =>
      m.feedback.POST(as(`/api/v1/recordings/${out.id}/feedback`, { method: 'POST', params: { id: out.id }, json: { items: [item(n)] }, ip }) as never);
    const asset = (bytes: Uint8Array, ip = '10.9.0.1') => {
      const form = new FormData();
      form.set('kind', 'feedback');
      form.set('recordingId', out.id);
      form.set('file', new File([bytes as BlobPart], 'crop.png', { type: 'image/png' }));
      return m.assets.POST(as('/api/v1/assets', { method: 'POST', form, ip }) as never);
    };
    const finalize = (json: unknown = {}) => m.finalize.POST(as(`/api/v1/recordings/${out.id}/finalize`, { method: 'POST', params: { id: out.id }, json }) as never);
    return { ...out, as, feedback, asset, finalize };
  }
  const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 4, 0, 0, 0, 4, 8, 6, 0, 0, 0]);
  const errorOf = async (r: Response) => ((await r.json()) as { error: string }).error;

  it('upload token: only embed captures take feedback items with it', async () => {
    const [rl] = await m.db
      .insert(m.schema.recording)
      .values({ clientId: crypto.randomUUID(), organizationId: ws, kind: 'video', pageUrl: SITE, source: 'recording-link' })
      .returning();
    const t = m.token.mintUploadToken(rl!.id);
    const r = await m.feedback.POST(ev(null, `/api/v1/recordings/${rl!.id}/feedback`, { method: 'POST', params: { id: rl!.id }, json: { items: [item(1)] }, headers: { authorization: `Bearer ${t}` } }) as never);
    expect(r.status).toBe(403);
  });

  it('assets: at most 25 MB each, 40 per capture and 100 MB in all', async () => {
    const big = await start();
    const tooBig = await big.asset(new Uint8Array(LIMITS.embedAssetBytes + 1));
    expect(tooBig.status).toBe(413);
    expect(await errorOf(tooBig)).toBe('too_large');

    const full = await start();
    const row = (bytes: number) => ({ recordingId: full.id, kind: 'feedback' as const, s3Key: `x/${crypto.randomUUID()}`, contentType: 'image/png', bytes });
    await m.db.insert(m.schema.asset).values(Array.from({ length: LIMITS.embedAssetCount - 1 }, () => row(10)));
    expect((await full.asset(png())).status).toBe(201);
    expect((await full.asset(png())).status).toBe(413);

    const heavy = await start();
    await m.db.insert(m.schema.asset).values({ recordingId: heavy.id, kind: 'feedback', s3Key: 'x/heavy', contentType: 'image/png', bytes: LIMITS.embedAssetTotalBytes - 10 });
    expect((await heavy.asset(png())).status).toBe(413);
  });

  it('finalize: the reviewer name fills an empty author and the items sent before it, never replaces one', async () => {
    const trace = await start({ kind: 'trace', reviewer: { id: 'rv-late' } });
    expect((await trace.feedback(1)).status).toBe(201);
    const done = await trace.finalize({ reviewer: { name: '  Late   Name ' } });
    expect(done.status).toBe(200);
    expect(await recordingOf(trace.id)).toMatchObject({ authorName: 'Late Name', authorIssuer: 'embed', authorSubject: 'rv-late' });
    const items = await m.db.select().from(m.schema.feedbackItem).where(m.orm.eq(m.schema.feedbackItem.recordingId, trace.id));
    expect(items.map((i) => i.authorName)).toEqual(['Late Name']);

    const named = await start();
    expect((await named.finalize({ reviewer: { name: 'Ola' } })).status).toBe(200);
    expect((await recordingOf(named.id)).authorName).toBe('Rita Client');
    // longer than 80 characters: refused like the create body
    const long = await start({ reviewer: { id: 'rv-long' } });
    expect((await long.finalize({ reviewer: { name: 'x'.repeat(81) } })).status).toBe(422);
  });

  it('after finalize: assets and items for ten minutes, then 410', async () => {
    const c = await start();
    expect((await c.finalize()).status).toBe(200);
    expect((await c.feedback(1)).status).toBe(201);
    expect((await c.asset(png())).status).toBe(201);
    await m.db
      .update(m.schema.recording)
      .set({ finalizedAt: new Date(Date.now() - LIMITS.embedWriteAfterFinalizeMs - 1000) })
      .where(m.orm.eq(m.schema.recording.id, c.id));
    const late = await c.feedback(2);
    expect(late.status).toBe(410);
    expect(await errorOf(late)).toBe('expired');
    expect((await c.asset(png())).status).toBe(410);
  });

  it('rate limit: asset and item calls per client address, ten times embedRateLimit an hour, each address its own bucket', async () => {
    m.settings._setStoredForTest({ embedRateLimit: 1 } as never);
    try {
      const c = await start();
      // two browsers behind one proxy: adapter-node gives each its own X-Forwarded-For address
      const a = '203.0.113.7';
      const b = '198.51.100.23';
      for (let n = 1; n <= 9; n++) expect((await c.feedback(n, a)).status, `call ${n}`).toBe(201);
      expect((await c.asset(png(), a)).status).toBe(201);
      const over = await c.feedback(20, a);
      expect(over.status).toBe(429);
      expect(await errorOf(over)).toBe('rate_limited');
      expect((await c.asset(png(), a)).status).toBe(429);
      expect((await c.feedback(21, b)).status).toBe(201);
      expect((await c.asset(png(), b)).status).toBe(201);
    } finally {
      m.settings._setStoredForTest({} as never);
    }
  });

  it('create rate limit: two client addresses get separate buckets', async () => {
    m.settings._setStoredForTest({ embedRateLimit: 1 } as never);
    try {
      expect((await create(key, body(), { ip: '203.0.113.50' })).status).toBe(201);
      expect((await create(key, body(), { ip: '203.0.113.50' })).status).toBe(429);
      expect((await create(key, body(), { ip: '203.0.113.51' })).status).toBe(201);
    } finally {
      m.settings._setStoredForTest({} as never);
    }
  });

  it('unverified authors: summaries, MCP and the hand-off mark them, email filters skip them', async () => {
    // a reviewer who types a member's name and email
    const fake = await start({ reviewer: { id: 'rv-fake', name: 'Ola', email: owner.email } });
    expect((await fake.finalize()).status).toBe(200);
    const rec = await recordingOf(fake.id);
    const [summary] = await m.core.toSummaries(m.db, [rec]);
    expect(summary).toMatchObject({ authorVerified: false, author: { id: null, name: 'Ola', email: owner.email } });
    const [mine] = await m.db
      .insert(m.schema.recording)
      .values({ clientId: crypto.randomUUID(), organizationId: ws, kind: 'feedback', pageUrl: SITE, authorUserId: owner.id, authorName: 'Ola', authorEmail: owner.email, status: 'ready', finalizedAt: new Date() })
      .returning();
    expect((await m.core.toSummaries(m.db, [mine!]))[0]!.authorVerified).toBe(true);

    const brief = await m.mcp.briefOf(m.db, rec, { url: 'x' });
    expect(brief.author).toEqual({ name: 'Ola (embed)', email: owner.email, verified: false });

    const scope = { workspaceId: ws, userId: owner.id, seat: 'admin' as const };
    const filters = (f: Record<string, unknown>) => feedbackFiltersSchema.parse({ status: 'all', ...f });
    const byOwner = (await m.exp.feedbackList(m.db, scope, filters({ creator: owner.email }))).items.map((i) => i.id);
    expect(byOwner).toContain(mine!.id);
    expect(byOwner).not.toContain(fake.id);
    const all = await m.exp.feedbackList(m.db, scope, filters({ limit: 200 }));
    expect(all.items.find((i) => i.id === fake.id)?.reviewer).toBe('Ola (embed)');
    expect(all.items.find((i) => i.id === mine!.id)?.reviewer).toBe('Ola');
  });

  it('CORS: preflights and responses echo the origin, upload routes only for upload tokens, never credentials', async () => {
    const hook = (method: string, path: string, headers: Record<string, string>) =>
      m.cors.embedCors({ event: ev(null, path, { method, headers }), resolve: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }) } as never);
    const pre = await hook('OPTIONS', `/api/v1/embed/${key}/recordings`, { origin: SITE, [REQUEST_ORIGIN_HEADER]: SITE, 'access-control-request-method': 'POST' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET, POST, PUT, OPTIONS');
    expect(pre.headers.get('access-control-allow-headers')).toBe('authorization, content-type, content-encoding, x-sha256, x-t0, x-t1');
    expect(pre.headers.get('access-control-max-age')).toBe('600');
    expect(pre.headers.get('vary')).toContain('Origin');
    expect(pre.headers.has('access-control-allow-credentials')).toBe(false);

    const res = await hook('GET', `/api/v1/embed/${key}/config`, fromSite());
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(res.headers.get('vary')).toContain('Origin');

    const chunk = `/api/v1/recordings/${recId}/streams/events/chunks/0`;
    expect((await hook('OPTIONS', chunk, fromSite())).headers.get('access-control-allow-origin')).toBe(SITE);
    expect((await hook('OPTIONS', '/api/v1/assets', fromSite())).headers.get('access-control-allow-origin')).toBe(SITE);
    // server.js rewrote Origin for the bearer; the copy is what gets echoed
    const put = await hook('PUT', chunk, { origin: SERVER, [REQUEST_ORIGIN_HEADER]: SITE, authorization: `Bearer ${token}` });
    expect(put.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(put.headers.has('access-control-allow-credentials')).toBe(false);
    expect((await hook('PUT', chunk, { ...fromSite(), authorization: 'Bearer tb_pat_x' })).headers.has('access-control-allow-origin')).toBe(false);
    expect((await hook('GET', `/api/v1/recordings/${recId}`, { ...fromSite(), authorization: `Bearer ${token}` })).headers.has('access-control-allow-origin')).toBe(false);
    expect((await hook('GET', '/api/v1/workspaces', fromSite())).headers.has('access-control-allow-origin')).toBe(false);
  });

  it('rotating replaces the key at once and revokes the upload tokens issued under the old one; turning it off ends both', async () => {
    const old = key;
    const before = await start();
    expect((await before.feedback(1)).status).toBe(201);
    const r = await rotate(owner);
    const fresh = (await r.json()).embedKey;
    expect(fresh).not.toBe(old);
    expect((await getConfig(old)).status).toBe(404);
    expect((await create(old, body())).status).toBe(404);
    expect((await getConfig(fresh)).status).toBe(200);

    // every upload-token call of the capture started under the old key: 410 revoked
    const id = before.id;
    const calls: [string, () => Response | Promise<Response>][] = [
      ['chunk', () => m.chunk.PUT(before.as(`/api/v1/recordings/${id}/streams/events/chunks/0`, { method: 'PUT', params: { id, stream: 'events', seq: '0' }, headers: { 'content-type': 'application/x-ndjson' } }) as never)],
      ['complete', () => m.complete.POST(before.as(`/api/v1/recordings/${id}/streams/events/complete`, { method: 'POST', params: { id, stream: 'events' }, json: { lastSeq: 0, totalBytes: 1 } }) as never)],
      ['finalize', () => before.finalize()],
      ['asset', () => before.asset(png())],
      ['feedback', () => before.feedback(2)],
      ['discard', () => m.capture.DELETE(before.as(`/api/v1/recordings/${id}`, { method: 'DELETE', params: { id } }) as never)],
    ];
    for (const [name, call] of calls) {
      const res = await call();
      expect(res.status, name).toBe(410);
      expect(await errorOf(res), name).toBe('revoked');
    }
    // a capture started under the new key works, until the embed is turned off
    const after = await start({}, fresh);
    expect((await after.feedback(1)).status).toBe(201);
    // members are not affected by the key
    expect((await m.feedback.POST(ev(owner, `/api/v1/recordings/${id}/feedback`, { method: 'POST', params: { id }, json: { items: [item(9)] } }) as never)).status).toBe(201);

    expect((await m.key.DELETE(ev(maker, `/api/v1/projects/${projectId}/embed-key`, { method: 'DELETE', params: { id: projectId } }) as never)).status).toBe(403);
    const off = await m.key.DELETE(ev(owner, `/api/v1/projects/${projectId}/embed-key`, { method: 'DELETE', params: { id: projectId } }) as never);
    expect(off.status).toBe(200);
    expect((await off.json()).embedKey).toBeNull();
    expect((await getConfig(fresh)).status).toBe(404);
    expect((await after.feedback(2)).status).toBe(410);
    // turned on again: a new key, and still no way back for the earlier tokens
    key = (await (await rotate(owner)).json()).embedKey;
    expect((await after.feedback(3)).status).toBe(410);
  });
});
