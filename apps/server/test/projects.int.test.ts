// Projects (D-123 to D-127) in the strict site access mode (SITE_ACCESS=projects, D-200) against a
// throwaway Postgres database: the CRUD routes and their
// roles, origin normalization, the extension bootstrap list and the origin check on submit.
// Route handlers are called directly with the locals the hooks would set. Skips when Postgres is down.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import type { RequestEvent } from '@sveltejs/kit';
import { uuidv7 } from '@toolbar/shared';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_projtest_${process.pid}`;
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

describe.skipIf(!reachable)('projects (integration)', () => {
  let admin: postgres.Sql;
  let m: {
    db: typeof import('../src/lib/server/db/index.ts').db;
    schema: typeof import('../src/lib/server/db/schema/index.ts');
    ws: typeof import('../src/lib/server/auth/workspaces.ts');
    boot: typeof import('../src/lib/server/auth/bootstrap.ts');
    list: typeof import('../src/routes/api/v1/workspaces/[workspaceId]/projects/+server.ts');
    one: typeof import('../src/routes/api/v1/projects/[id]/+server.ts');
    rec: typeof import('../src/routes/api/v1/recordings/+server.ts');
  };
  const env0 = { ...process.env };
  type U = { id: string; email: string; name: string };
  let owner: U;
  let maker: U;
  let outsider: U;
  let ws: string;

  const mkUser = async (who: string) => {
    const [u] = await m.db.insert(m.schema.user).values({ name: who, email: `${who.toLowerCase()}-${run}@proj.test`, emailVerified: true }).returning();
    return u! as U;
  };

  function ev(user: U | null, init: { method?: string; url: string; json?: unknown; params?: Record<string, string> }) {
    const url = new URL(init.url);
    const request = new Request(url, {
      method: init.method ?? 'GET',
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      headers: init.json === undefined ? {} : { 'content-type': 'application/json' },
    });
    return { request, url, params: init.params ?? {}, locals: { user, session: null, apiToken: null }, getClientAddress: () => '127.0.0.1' } as unknown as RequestEvent;
  }

  const create = (u: U, json: unknown) =>
    m.list.POST(ev(u, { method: 'POST', url: `http://localhost:3000/api/v1/workspaces/${ws}/projects`, json, params: { workspaceId: ws } }) as never);
  const capture = (u: U, pageUrl: string, kind = 'screenshot', env?: Record<string, unknown>) =>
    m.rec.POST(
      ev(u, {
        method: 'POST',
        url: 'http://localhost:3000/api/v1/recordings',
        json: { clientId: uuidv7(), kind, workspaceId: ws, page: { url: pageUrl, title: 't' }, startedAt: Date.now(), ...(env ? { env: { ua: 'x', viewport: { w: 1, h: 1 }, dpr: 1, ...env } } : {}) },
      }) as never,
    );

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.S3_KEY_PREFIX = `projtest-${run}/`;
    // the strict mode (D-126); the default `all` mode is covered by site-access.int.test.ts (D-200)
    process.env.SITE_ACCESS = 'projects';
    execFileSync('node', ['scripts/migrate.ts'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    m = {
      db: (await import('../src/lib/server/db/index.ts')).db,
      schema: await import('../src/lib/server/db/schema/index.ts'),
      ws: await import('../src/lib/server/auth/workspaces.ts'),
      boot: await import('../src/lib/server/auth/bootstrap.ts'),
      list: await import('../src/routes/api/v1/workspaces/[workspaceId]/projects/+server.ts'),
      one: await import('../src/routes/api/v1/projects/[id]/+server.ts'),
      rec: await import('../src/routes/api/v1/recordings/+server.ts'),
    };
    owner = await mkUser('Ola');
    maker = await mkUser('Mo');
    outsider = await mkUser('Out');
    ws = (await m.ws.createWorkspace(m.db, { userId: owner.id, email: owner.email, name: 'Lab', domainJoin: false })).id;
    await m.db.insert(m.schema.member).values({ organizationId: ws, userId: maker.id, role: 'creator' });
  }, 120_000);

  afterAll(async () => {
    process.env = env0;
    await (await import('../src/lib/server/db/index.ts')).sqlClient.end().catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('a workspace without projects accepts captures from any origin', async () => {
    const r = await capture(maker, 'http://localhost:5174/anything');
    expect(r.status).toBe(201);
  });

  it('only admins create projects; origins are normalized and bad ones refused', async () => {
    const denied = await create(maker, { name: 'Lab', origins: ['http://localhost:5173'] });
    expect(denied.status).toBe(403);
    const bad = await create(owner, { name: 'Lab', origins: ['ftp://nope'] });
    expect(bad.status).toBe(422);
    const ok = await create(owner, { name: '  Lab  app ', origins: ['http://LOCALHOST:5173/some/path', 'http://localhost:5173', 'staging.lab.test'] });
    expect(ok.status).toBe(201);
    const p = await ok.json();
    expect(p).toMatchObject({ name: 'Lab app', origins: ['http://localhost:5173', 'https://staging.lab.test'], maskingPreset: 'staging', bodyAllowlist: [] });
    const listed = await (await m.list.GET(ev(maker, { url: `http://localhost:3000/api/v1/workspaces/${ws}/projects`, params: { workspaceId: ws } }) as never)).json();
    expect(listed.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
    const hidden = await m.list.GET(ev(outsider, { url: `http://localhost:3000/api/v1/workspaces/${ws}/projects`, params: { workspaceId: ws } }) as never);
    expect(hidden.status).toBe(404);
  });

  it('the submit check: project origins pass and get the project and preset, others get 403 origin_not_allowed', async () => {
    const ok = await capture(maker, 'http://localhost:5173/form', 'screenshot', { maskingPreset: 'staging' });
    expect(ok.status).toBe(201);
    const { id } = await ok.json();
    const [row] = await m.db.select().from(m.schema.recording).where((await import('drizzle-orm')).eq(m.schema.recording.id, id));
    expect(row!.projectId).not.toBeNull();
    expect(row!.maskingPreset).toBe('staging');

    const refused = await capture(maker, 'http://localhost:5174/');
    expect(refused.status).toBe(403);
    expect((await refused.json()).error).toBe('origin_not_allowed');
    // exempt: desktop recordings and pages of this server
    expect((await capture(maker, 'http://localhost:5174/', 'screen')).status).toBe(201);
    const { env } = await import('../src/lib/server/env.ts');
    expect((await capture(maker, `${env.publicUrl}/c/x`)).status).toBe(201);
  });

  it('the extension bootstrap lists the projects of every workspace the user is in', async () => {
    const me = { id: maker.id, name: maker.name, email: maker.email, image: null };
    const b = await m.boot.extBootstrap(m.db, me, { serverVersion: 'test' });
    expect(b.projects?.map((p) => p.origins)).toEqual([['http://localhost:5173', 'https://staging.lab.test']]);
    const none = await m.boot.extBootstrap(m.db, { id: outsider.id, name: outsider.name, email: outsider.email, image: null }, { serverVersion: 'test' });
    expect(none.projects).toEqual([]);
  });

  it('injector sign-in (D-134): project origins count while INJECTOR_ORIGINS is empty, the cookie verifies and holds a working token', async () => {
    const review = await import('../src/lib/server/review/index.ts');
    const { verifyReview } = await import('../src/lib/server/review/cookie.ts');
    const { resolveApiToken } = await import('../src/lib/server/tokens.ts');
    const { env } = await import('../src/lib/server/env.ts');
    const e = (origins: string[]) => ({ ...env, injector: { secret: 's'.repeat(40), origins, cookieDays: 7 } }) as typeof env;
    const allowed = async (userId: string, origin: string, origins: string[]) => (await review.reviewAccess(m.db, userId, origin, e(origins))).allowed;
    expect(await allowed(maker.id, 'http://localhost:5173', [])).toBe(true);
    expect(await allowed(maker.id, 'https://staging.lab.test', [])).toBe(true);
    expect(await allowed(maker.id, 'http://localhost:5174', [])).toBe(false);
    expect(await allowed(outsider.id, 'http://localhost:5173', [])).toBe(false);
    // the operator's list, when set, is a hard allowlist on top of the projects (D-201)
    expect(await review.reviewAccess(m.db, maker.id, 'http://localhost:5173', e(['https://nuru.example.org']))).toEqual({ allowed: false, reason: 'not_listed' });
    expect(await allowed(maker.id, 'http://localhost:5173', ['http://localhost:5173'])).toBe(true);
    expect(await allowed(maker.id, 'http://localhost:5174', ['http://localhost:5174'])).toBe(false);
    const ok = await review.reviewAccess(m.db, maker.id, 'http://localhost:5173', e([]));
    expect(ok.allowed && ok.projectId).toBeTruthy();
    await expect(review.issueReviewCookie(m.db, { userId: outsider.id, origin: 'http://localhost:5173' }, e([]))).rejects.toThrow('origin_not_allowed');

    const { value, expiresAt } = await review.issueReviewCookie(m.db, { userId: maker.id, origin: 'http://localhost:5173' }, e([]));
    const claims = verifyReview('s'.repeat(40), value, 'http://localhost:5173');
    expect(claims).toMatchObject({ v: 1, o: 'http://localhost:5173', u: maker.id });
    expect(claims!.x).toBe(Math.floor(expiresAt.getTime() / 1000));
    const tok = await resolveApiToken(m.db, claims!.k);
    expect(tok?.user.id).toBe(maker.id);
    expect(tok?.kind).toBe('device');
  });

  it('admins switch the preset and the allowlist; removing a project keeps its captures', async () => {
    const [p] = await m.db.select().from(m.schema.project);
    const patch = (u: U, json: unknown) => m.one.PATCH(ev(u, { method: 'PATCH', url: `http://localhost:3000/api/v1/projects/${p!.id}`, json, params: { id: p!.id } }) as never);
    expect((await patch(maker, { maskingPreset: 'production' })).status).toBe(403);
    const r = await patch(owner, { maskingPreset: 'production', bodyAllowlist: ['https://staging.lab.test/api/public/*'] });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ maskingPreset: 'production', bodyAllowlist: ['https://staging.lab.test/api/public/*'] });
    expect((await patch(owner, { bodyAllowlist: ['not a url'] })).status).toBe(422);
    expect((await patch(owner, { origins: [] })).status).toBe(422);
    // the trace span window (D-166): 10 s unless the admin changes it, within 3 s to 10 min
    expect(p!.traceOpenMs).toBe(10_000);
    const longer = await patch(owner, { traceOpenMs: 45_000 });
    expect(longer.status).toBe(200);
    expect(await longer.json()).toMatchObject({ traceOpenMs: 45_000 });
    expect((await patch(owner, { traceOpenMs: 500 })).status).toBe(422);
    expect((await patch(owner, { traceOpenMs: 3_600_000 })).status).toBe(422);
    const { traceConfigOf } = await import('../src/lib/server/projects.ts');
    expect(await traceConfigOf(m.db, { projectId: p!.id })).toEqual({ maxOpenMs: 45_000 });
    expect(await traceConfigOf(m.db, { projectId: null })).toEqual({ maxOpenMs: 10_000 });

    const before = (await m.db.select().from(m.schema.recording)).length;
    const del = await m.one.DELETE(ev(owner, { method: 'DELETE', url: `http://localhost:3000/api/v1/projects/${p!.id}`, params: { id: p!.id } }) as never);
    expect(del.status).toBe(200);
    const rows = await m.db.select().from(m.schema.recording);
    expect(rows.length).toBe(before);
    expect(rows.every((x) => x.projectId === null)).toBe(true);
  });
});
