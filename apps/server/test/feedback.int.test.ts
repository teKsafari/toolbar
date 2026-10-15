// Reviewer toolbar feedback items (Part 2) against a throwaway Postgres database and the dev
// Garage bucket under a key prefix of its own: create through the route with the locals the hooks
// would set, idempotent retries, asset claiming, the author snapshot, access, the voice note job.
// Skips when Postgres is down.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import type { RequestEvent } from '@sveltejs/kit';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_feedbacktest_${process.pid}`;
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

describe.skipIf(!reachable)('feedback items (integration)', () => {
  let admin: postgres.Sql;
  let m: {
    db: typeof import('../src/lib/server/db/index.ts').db;
    schema: typeof import('../src/lib/server/db/schema/index.ts');
    svc: typeof import('../src/lib/server/feedback/service.ts');
    route: typeof import('../src/routes/api/v1/recordings/[id]/feedback/+server.ts');
    s3: typeof import('../src/lib/server/s3.ts');
  };
  const env0 = { ...process.env };
  type U = { id: string; email: string; name: string };
  let owner: U;
  let outsider: U;
  let recId: string;

  function ev(user: U | null, init: { method?: string; json?: unknown; id?: string } = {}) {
    const id = init.id ?? recId;
    const url = new URL(`http://localhost:3000/api/v1/recordings/${id}/feedback`);
    const headers: Record<string, string> = {};
    let body: string | undefined;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers['content-type'] = 'application/json';
    }
    const cookies = { get: () => undefined, set: () => undefined };
    return { request: new Request(url, { method: init.method ?? 'GET', body, headers }), url, params: { id }, cookies, locals: { user, session: null, apiToken: null } } as unknown as RequestEvent;
  }

  const page = { url: 'http://localhost:5173/', title: 'Lab', viewport: { w: 1280, h: 720 }, scroll: { x: 0, y: 0 }, dpr: 1 };
  const item = (n: number, extra: Record<string, unknown> = {}) => ({
    clientId: crypto.randomUUID(),
    n,
    kind: 'element',
    comment: `note ${n}`,
    target: { selector: 'main > button:nth-of-type(1)', tag: 'button', name: 'Save', testId: 'works', rect: { x: 10, y: 20, w: 80, h: 30 } },
    anchor: { fx: 0.5, fy: 0.5, x: 50, y: 35 },
    context: { windowMs: 60000, errors: [{ t: 1, kind: 'error', text: 'TypeError: x is undefined' }], failedRequests: [{ t: 2, kind: 'network', text: 'POST /api/fail', status: 500 }] },
    page,
    t: Date.now(),
    ...extra,
  });

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.S3_KEY_PREFIX = `feedbacktest-${run}/`;
    process.env.TRANSCRIBE_PROVIDER = 'none';
    execFileSync('node', ['scripts/migrate.ts'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    m = {
      db: (await import('../src/lib/server/db/index.ts')).db,
      schema: await import('../src/lib/server/db/schema/index.ts'),
      svc: await import('../src/lib/server/feedback/service.ts'),
      route: await import('../src/routes/api/v1/recordings/[id]/feedback/+server.ts'),
      s3: await import('../src/lib/server/s3.ts'),
    };
    const [a] = await m.db.insert(m.schema.user).values({ name: 'Rae Viewer', email: `rae-${run}@fb.test`, emailVerified: true }).returning();
    const [b] = await m.db.insert(m.schema.user).values({ name: 'Out Sider', email: `out-${run}@fb.test`, emailVerified: true }).returning();
    owner = a as U;
    outsider = b as U;
    const [org] = await m.db.insert(m.schema.organization).values({ name: 'Feedback shop', slug: `fb-${run}` }).returning();
    await m.db.insert(m.schema.member).values({ organizationId: org!.id, userId: owner.id, role: 'owner' });
    const [rec] = await m.db
      .insert(m.schema.recording)
      .values({ clientId: crypto.randomUUID(), organizationId: org!.id, kind: 'feedback', pageUrl: page.url, authorUserId: owner.id })
      .returning();
    recId = rec!.id;
  }, 120_000);

  afterAll(async () => {
    process.env = env0;
    await m?.s3.deletePrefix(`feedbacktest-${run}/`).catch(() => 0);
    await (await import('../src/lib/server/db/index.ts')).sqlClient.end().catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('stores the items in pin order with the author snapshot; a retry adds nothing', async () => {
    const body = { items: [item(2), item(1)] };
    const r = await m.route.POST(ev(owner, { method: 'POST', json: body }) as never);
    expect(r.status).toBe(201);
    const out = (await r.json()).items;
    expect(out.map((i: { n: number }) => i.n)).toEqual([1, 2]);
    expect(out[0]).toMatchObject({ kind: 'element', comment: 'note 1', status: 'pending', intent: 'fix', severity: 'important', author: { userId: owner.id, email: owner.email, name: 'Rae Viewer' } });
    expect(out[0].author.issuer).toBeTruthy();
    expect(out[0].context.failedRequests[0].status).toBe(500);
    const again = await m.route.POST(ev(owner, { method: 'POST', json: body }) as never);
    expect((await again.json()).items).toHaveLength(2);
    const list = await (await m.route.GET(ev(owner) as never)).json();
    expect(list.items).toHaveLength(2);
  });

  it('claims the uploaded crop and voice note; a voice note with transcription off says so', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 20, 8, 6, 0, 0, 0]);
    const [crop] = await m.db.insert(m.schema.asset).values({ kind: 'crop', s3Key: 'x/crop', contentType: 'image/png', bytes: png.length, createdBy: owner.id, width: 40, height: 20 }).returning();
    const [voice] = await m.db.insert(m.schema.asset).values({ kind: 'attachment', s3Key: 'x/voice', contentType: 'audio/webm', bytes: 10, createdBy: owner.id }).returning();
    const r = await m.route.POST(ev(owner, { method: 'POST', json: { items: [item(3, { kind: 'shot', cropAssetId: crop!.id, cropRect: { x: 0, y: 0, w: 40, h: 20 }, voiceAssetId: voice!.id, voiceDurationMs: 1500 })] } }) as never);
    expect(r.status).toBe(201);
    const [it3] = (await r.json()).items;
    expect(it3.cropUrl).toContain(`/recordings/${recId}/media/${crop!.id}`);
    expect(it3.voiceUrl).toContain(voice!.id);
    expect(it3.transcript).toMatchObject({ status: 'off' });
    const assets = await m.db.select().from(m.schema.asset);
    const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
    // the crop is not the capture's main image: pickScreenshots reads screenshot and crop only
    expect(byId[crop!.id]).toMatchObject({ recordingId: recId, kind: 'feedback' });
    expect(byId[voice!.id]).toMatchObject({ recordingId: recId, kind: 'voice-note' });
  });

  it('refuses someone else\'s upload and a non-member; validates the body', async () => {
    const [theirs] = await m.db.insert(m.schema.asset).values({ kind: 'crop', s3Key: 'x/other', contentType: 'image/png', bytes: 1, createdBy: outsider.id }).returning();
    const stolen = await m.route.POST(ev(owner, { method: 'POST', json: { items: [item(9, { cropAssetId: theirs!.id })] } }) as never);
    expect(stolen.status).toBe(422);
    const out = await m.route.POST(ev(outsider, { method: 'POST', json: { items: [item(9)] } }) as never);
    expect(out.status).toBe(404);
    const anon = await m.route.POST(ev(null, { method: 'POST', json: { items: [item(9)] } }) as never);
    expect(anon.status).toBe(401);
    const bad = await m.route.POST(ev(owner, { method: 'POST', json: { items: [{ ...item(9), kind: 'poem' }] } }) as never);
    expect(bad.status).toBe(422);
  });

  it('vttText joins the cues of a transcript', () => {
    expect(m.svc.vttText('WEBVTT\n\n00:00.000 --> 00:01.000\nThe export\n\n00:01.000 --> 00:02.500\ndoes nothing\n')).toBe('The export does nothing');
  });
});
