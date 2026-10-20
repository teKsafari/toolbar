// Site access (D-200, D-203, D-205) against a throwaway Postgres database. The default is now
// `projects` (D-203); the `all` cases set SITE_ACCESS=all. In `all` mode the first
// capture on an origin makes its project (once, even under concurrent first captures), captures
// are grouped by project, an admin merges projects (origins and captures move), and the strict mode (SITE_ACCESS=projects)
// refuses an unlisted origin and makes nothing, and members add a site from the extension (D-205):
// to a project or a new one, unless the workspace lets only admins; admins or the person who added
// it remove it. Route handlers are called directly with the
// locals the hooks would set. Skips when Postgres is down.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import type { RequestEvent } from '@sveltejs/kit';
import { uuidv7 } from '@toolbar/shared';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_sitetest_${process.pid}`;
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

describe.skipIf(!reachable)('site access (integration, D-200)', () => {
  let admin: postgres.Sql;
  let m: {
    db: typeof import('../src/lib/server/db/index.ts').db;
    schema: typeof import('../src/lib/server/db/schema/index.ts');
    ws: typeof import('../src/lib/server/auth/workspaces.ts');
    boot: typeof import('../src/lib/server/auth/bootstrap.ts');
    access: typeof import('../src/lib/server/projects/access.ts');
    list: typeof import('../src/routes/api/v1/workspaces/[workspaceId]/projects/+server.ts');
    merge: typeof import('../src/routes/api/v1/projects/[id]/merge/+server.ts');
    addSite: typeof import('../src/routes/api/v1/workspaces/[workspaceId]/sites/+server.ts');
    removeSite: typeof import('../src/routes/api/v1/projects/[id]/sites/+server.ts');
    rec: typeof import('../src/routes/api/v1/recordings/+server.ts');
    orm: typeof import('drizzle-orm');
  };
  const env0 = { ...process.env };
  type U = { id: string; email: string; name: string };
  let owner: U;
  let maker: U;
  let other: U;
  let ws: string;
  let ws2: string;

  const mkUser = async (who: string) => {
    const [u] = await m.db.insert(m.schema.user).values({ name: who, email: `${who.toLowerCase()}-${run}@site.test`, emailVerified: true }).returning();
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

  const capture = (u: U, pageUrl: string, opts: { kind?: string; workspaceId?: string; clientId?: string } = {}) =>
    m.rec.POST(
      ev(u, {
        method: 'POST',
        url: 'http://localhost:3000/api/v1/recordings',
        json: { clientId: opts.clientId ?? uuidv7(), kind: opts.kind ?? 'screenshot', workspaceId: opts.workspaceId ?? ws, page: { url: pageUrl, title: 't' }, startedAt: Date.now() },
      }) as never,
    );
  const projectsOf = async (w: string) => (await m.db.select().from(m.schema.project).where(m.orm.eq(m.schema.project.organizationId, w))).sort((a, b) => a.name.localeCompare(b.name));
  const recordingOf = async (id: string) => (await m.db.select().from(m.schema.recording).where(m.orm.eq(m.schema.recording.id, id)))[0]!;
  const listByProject = async (u: U, projectId: string) => {
    // the grid lists finished captures; these were only created
    await m.db.update(m.schema.recording).set({ status: 'ready' });
    return (await (await m.rec.GET(ev(u, { url: `http://localhost:3000/api/v1/recordings?workspaceId=${ws}&projectId=${projectId}` }) as never)).json()) as { total: number; items: { id: string }[] };
  };

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.S3_KEY_PREFIX = `sitetest-${run}/`;
    delete process.env.SITE_ACCESS;
    execFileSync('node', ['scripts/migrate.ts'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    m = {
      db: (await import('../src/lib/server/db/index.ts')).db,
      schema: await import('../src/lib/server/db/schema/index.ts'),
      ws: await import('../src/lib/server/auth/workspaces.ts'),
      boot: await import('../src/lib/server/auth/bootstrap.ts'),
      access: await import('../src/lib/server/projects/access.ts'),
      list: await import('../src/routes/api/v1/workspaces/[workspaceId]/projects/+server.ts'),
      merge: await import('../src/routes/api/v1/projects/[id]/merge/+server.ts'),
      addSite: await import('../src/routes/api/v1/workspaces/[workspaceId]/sites/+server.ts'),
      removeSite: await import('../src/routes/api/v1/projects/[id]/sites/+server.ts'),
      rec: await import('../src/routes/api/v1/recordings/+server.ts'),
      orm: await import('drizzle-orm'),
    };
    owner = await mkUser('Ana');
    maker = await mkUser('Ben');
    other = await mkUser('Cy');
    ws = (await m.ws.createWorkspace(m.db, { userId: owner.id, email: owner.email, name: 'Lab', domainJoin: false })).id;
    ws2 = (await m.ws.createWorkspace(m.db, { userId: other.id, email: other.email, name: 'Elsewhere', domainJoin: false })).id;
    await m.db.insert(m.schema.member).values({ organizationId: ws, userId: maker.id, role: 'creator' });
    // the workspace's own default for new projects (D-194) applies to the projects made here
    await m.ws.patchSettings(m.db, ws, { defaultMaskingPreset: 'production', defaultTraceOpenMs: 20_000 });
  }, 120_000);

  afterAll(async () => {
    process.env = env0;
    await (await import('../src/lib/server/db/index.ts')).sqlClient.end().catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('defaults to project sites only (D-203); an admin opts in to all sites', () => {
    expect(m.access.siteAccessMode()).toBe('projects');
    process.env.SITE_ACCESS = 'all';
    expect(m.access.siteAccessMode()).toBe('all');
  });

  it('the first capture on each origin makes its project, with the workspace defaults; the next capture there joins it', async () => {
    const a = await capture(maker, 'http://localhost:5173/form');
    expect(a.status).toBe(201);
    const b = await capture(maker, 'http://127.0.0.1:5173/other');
    expect(b.status).toBe(201);
    const again = await capture(maker, 'http://localhost:5173/second');
    expect(again.status).toBe(201);

    const projects = await projectsOf(ws);
    expect(projects.map((p) => [p.name, p.origins])).toEqual([
      ['127.0.0.1:5173', ['http://127.0.0.1:5173']],
      ['localhost:5173', ['http://localhost:5173']],
    ]);
    expect(projects.every((p) => p.maskingPreset === 'production' && p.traceOpenMs === 20_000 && p.createdBy === maker.id)).toBe(true);
    const local = projects.find((p) => p.name === 'localhost:5173')!;
    const loop = projects.find((p) => p.name === '127.0.0.1:5173')!;
    expect((await recordingOf((await a.json()).id)).projectId).toBe(local.id);
    expect((await recordingOf((await again.json()).id)).projectId).toBe(local.id);
    expect((await recordingOf((await b.json()).id)).projectId).toBe(loop.id);

    // captures are grouped by project in the dashboard
    expect((await listByProject(maker, local.id)).total).toBe(2);
    expect((await listByProject(maker, loop.id)).total).toBe(1);
  });

  it('concurrent first captures on a new origin make one project', async () => {
    const rs = await Promise.all(Array.from({ length: 6 }, () => capture(maker, 'http://localhost:5174/race')));
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect((await projectsOf(ws)).filter((p) => p.origins.includes('http://localhost:5174'))).toHaveLength(1);
  });

  it('makes no project for desktop recordings, non-web pages or the server itself', async () => {
    const before = (await projectsOf(ws)).length;
    const { env } = await import('../src/lib/server/env.ts');
    for (const [url, kind] of [
      ['http://localhost:5199/', 'screen'],
      ['chrome://extensions', 'screenshot'],
      [`${env.publicUrl}/c/x`, 'screenshot'],
    ] as const) {
      const r = await capture(maker, url, { kind });
      expect(r.status, url).toBe(201);
      expect((await recordingOf((await r.json()).id)).projectId, url).toBeNull();
    }
    expect((await projectsOf(ws)).length).toBe(before);
  });

  it('merge: only admins; the second project’s origins and captures move into the first, which keeps its settings', async () => {
    const [loop, local] = await projectsOf(ws);
    await m.db.update(m.schema.project).set({ maskingPreset: 'staging' }).where(m.orm.eq(m.schema.project.id, local!.id));
    const call = (u: U, into: string, from: string) =>
      m.merge.POST(ev(u, { method: 'POST', url: `http://localhost:3000/api/v1/projects/${into}/merge`, json: { from }, params: { id: into } }) as never);

    expect((await call(maker, local!.id, loop!.id)).status).toBe(403);
    expect((await call(other, local!.id, loop!.id)).status).toBe(404);
    expect((await call(owner, local!.id, local!.id)).status).toBe(422);

    const r = await call(owner, local!.id, loop!.id);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.movedCaptures).toBe(1);
    expect(body.project).toMatchObject({ id: local!.id, origins: ['http://localhost:5173', 'http://127.0.0.1:5173'], maskingPreset: 'staging' });
    expect((await projectsOf(ws)).some((p) => p.id === loop!.id)).toBe(false);
    expect((await listByProject(maker, local!.id)).total).toBe(3);

    // a capture on the merged origin now lands in the merged project, no new project appears
    const n = (await projectsOf(ws)).length;
    const c = await capture(maker, 'http://127.0.0.1:5173/after');
    expect((await recordingOf((await c.json()).id)).projectId).toBe(local!.id);
    expect((await projectsOf(ws)).length).toBe(n);

    // projects of two workspaces never merge
    const foreign = (await capture(other, 'https://foreign.test/', { workspaceId: ws2 })).status;
    expect(foreign).toBe(201);
    const [f] = await projectsOf(ws2);
    await m.db.insert(m.schema.member).values({ organizationId: ws2, userId: owner.id, role: 'admin' });
    expect((await call(owner, local!.id, f!.id)).status).toBe(422);
  });

  it('domains: an exact origin wins over a wildcard; a wildcard covers the bare domain and subdomains over https', async () => {
    const mk = async (pname: string, origins: string[]) =>
      (await (
        await m.list.POST(ev(owner, { method: 'POST', url: `http://localhost:3000/api/v1/workspaces/${ws}/projects`, json: { name: pname, origins }, params: { workspaceId: ws } }) as never)
      ).json()) as { id: string };
    const nuru = await mk('Nuru', ['*.nuru.test']);
    const staging = await mk('Nuru staging', ['https://staging.nuru.test']);
    const projectOf = async (url: string) => (await recordingOf((await (await capture(maker, url)).json()).id)).projectId;
    expect(await projectOf('https://nuru.test/')).toBe(nuru.id);
    expect(await projectOf('https://116.nuru.test/x')).toBe(nuru.id);
    expect(await projectOf('https://staging.nuru.test/x')).toBe(staging.id);
    // http is not covered by an https domain: a capture there makes its own project
    const plain = await projectOf('http://116.nuru.test/');
    expect(plain).not.toBe(nuru.id);
    expect((await projectsOf(ws)).find((p) => p.id === plain)?.origins).toEqual(['http://116.nuru.test']);
  });

  it('the extension bootstrap carries the mode and each workspace’s new-project defaults', async () => {
    const b = await m.boot.extBootstrap(m.db, { id: maker.id, name: maker.name, email: maker.email, image: null }, { serverVersion: 'test' });
    // a creator may add sites unless the workspace lets only admins (D-205)
    expect(b.siteAccess).toEqual({ mode: 'all', defaults: [{ workspaceId: ws, maskingPreset: 'production', traceOpenMs: 20_000 }], canAdd: [ws] });
  });

  it('strict mode: an unlisted origin is refused and no project is made; listed origins pass', async () => {
    process.env.SITE_ACCESS = 'projects';
    try {
      expect(m.access.siteAccessMode()).toBe('projects');
      const before = (await projectsOf(ws)).length;
      const refused = await capture(maker, 'https://unlisted.test/');
      expect(refused.status).toBe(403);
      expect((await refused.json()).error).toBe('origin_not_allowed');
      expect((await projectsOf(ws)).length).toBe(before);
      expect((await capture(maker, 'https://staging.nuru.test/')).status).toBe(201);
      const b = await m.boot.extBootstrap(m.db, { id: maker.id, name: maker.name, email: maker.email, image: null }, { serverVersion: 'test' });
      expect(b.siteAccess?.mode).toBe('projects');
    } finally {
      process.env.SITE_ACCESS = 'all';
    }
  });

  describe('sites from the extension (D-205)', () => {
    const add = (u: U, w: string, json: unknown) =>
      m.addSite.POST(ev(u, { method: 'POST', url: `http://localhost:3000/api/v1/workspaces/${w}/sites`, json, params: { workspaceId: w } }) as never);
    const remove = (u: U, projectId: string, origin: string) =>
      m.removeSite.DELETE(ev(u, { method: 'DELETE', url: `http://localhost:3000/api/v1/projects/${projectId}/sites?origin=${encodeURIComponent(origin)}`, params: { id: projectId } }) as never);

    it('a member adds a site to a new project named after the host, and to an existing one; the bootstrap marks them as theirs', async () => {
      delete process.env.SITE_ACCESS;
      const made = await add(maker, ws, { origin: 'https://fresh.example.test/some/page?q=1' });
      expect(made.status).toBe(200);
      const a = (await made.json()) as { project: { id: string; name: string; origins: string[] }; created: boolean };
      expect(a).toMatchObject({ created: true, project: { name: 'fresh.example.test', origins: ['https://fresh.example.test'] } });
      // again: the same project, nothing new
      expect(((await (await add(maker, ws, { origin: 'https://fresh.example.test' })).json()) as { created: boolean; project: { id: string } })).toMatchObject({ created: false, project: { id: a.project.id } });
      const into = (await (await add(maker, ws, { origin: 'http://second.example.test:8080/', projectId: a.project.id })).json()) as { project: { origins: string[] } };
      expect(into.project.origins).toEqual(['https://fresh.example.test', 'http://second.example.test:8080']);
      const b = await m.boot.extBootstrap(m.db, { id: maker.id, name: maker.name, email: maker.email, image: null }, { serverVersion: 'test' });
      expect(b.projects?.find((p) => p.id === a.project.id)?.mine?.sort()).toEqual(['http://second.example.test:8080', 'https://fresh.example.test']);
      expect(b.projects?.find((p) => p.id !== a.project.id)?.mine).toBeUndefined();
      // the projects mode then captures there
      expect((await capture(maker, 'http://second.example.test:8080/x')).status).toBe(201);
    });

    it('refuses the server, non-web pages, another workspace and an unknown project', async () => {
      expect((await add(maker, ws, { origin: `${(await import('../src/lib/server/env.ts')).env.publicUrl}/c/1` })).status).toBe(422);
      expect((await add(maker, ws, { origin: 'chrome://extensions' })).status).toBe(422);
      expect((await add(maker, ws2, { origin: 'https://x.test' })).status).toBe(404);
      expect((await add(maker, ws, { origin: 'https://x.test', projectId: uuidv7() })).status).toBe(404);
    });

    it('only admins add sites when the workspace says so', async () => {
      await m.ws.patchSettings(m.db, ws, { restrictSiteAdds: true });
      try {
        const denied = await add(maker, ws, { origin: 'https://denied.test' });
        expect(denied.status).toBe(403);
        const b = await m.boot.extBootstrap(m.db, { id: maker.id, name: maker.name, email: maker.email, image: null }, { serverVersion: 'test' });
        expect(b.siteAccess?.canAdd).toEqual([]);
        expect((await add(owner, ws, { origin: 'https://allowed.test' })).status).toBe(200);
      } finally {
        await m.ws.patchSettings(m.db, ws, { restrictSiteAdds: false });
      }
    });

    it('remove: the person who added it or an admin; the last origin takes the project, its captures stay', async () => {
      const p = (await (await add(maker, ws, { origin: 'https://gone.test' })).json()) as { project: { id: string } };
      await add(owner, ws, { origin: 'https://admins.test', projectId: p.project.id });
      const rec = await capture(maker, 'https://gone.test/a');
      expect(rec.status).toBe(201);
      const recId = ((await rec.json()) as { id: string }).id;
      // the maker did not add admins.test and is no admin
      expect((await remove(maker, p.project.id, 'https://admins.test')).status).toBe(403);
      // another workspace's member sees no such project
      expect((await remove(other, p.project.id, 'https://gone.test')).status).toBe(404);
      const left = (await (await remove(maker, p.project.id, 'https://gone.test/')).json()) as { project: { origins: string[] } | null };
      expect(left.project?.origins).toEqual(['https://admins.test']);
      const gone = (await (await remove(owner, p.project.id, 'https://admins.test')).json()) as { project: null };
      expect(gone.project).toBeNull();
      expect((await projectsOf(ws)).some((x) => x.id === p.project.id)).toBe(false);
      expect((await recordingOf(recId)).projectId).toBeNull();
    });
  });
});
