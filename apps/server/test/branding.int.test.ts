// Instance branding (D-112) against a throwaway Postgres database and the dev Garage bucket
// under a key prefix of its own. Route handlers are called directly with the locals the hooks
// would set. Skips when Postgres is down.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import type { RequestEvent } from '@sveltejs/kit';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_brandtest_${process.pid}`;
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

const CLEAN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" rx="4" fill="#0b7a5c"/></svg>';
const HOSTILE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"><rect width="1" height="1"/></svg>';

describe.skipIf(!reachable)('branding (integration)', () => {
  let admin: postgres.Sql;
  let m: {
    db: typeof import('../src/lib/server/db/index.ts').db;
    schema: typeof import('../src/lib/server/db/schema/index.ts');
    brand: typeof import('../src/lib/server/branding/index.ts');
    instance: typeof import('../src/lib/server/auth/instance.ts');
    env: typeof import('../src/lib/server/env.ts');
    s3: typeof import('../src/lib/server/s3.ts');
    pub: typeof import('../src/routes/api/v1/branding/+server.ts');
    adm: typeof import('../src/routes/api/v1/admin/branding/+server.ts');
    logo: typeof import('../src/routes/api/v1/admin/branding/logo/+server.ts');
    file: typeof import('../src/routes/brand/[file]/+server.ts');
  };
  const env0 = { ...process.env };
  type U = { id: string; email: string; emailVerified: boolean };
  let first: U;
  let second: U;

  const mkUser = async (who: string, verified = true) => {
    const [u] = await m.db.insert(m.schema.user).values({ name: who, email: `${who.toLowerCase()}-${run}@brand.test`, emailVerified: verified }).returning();
    return u! as U;
  };

  async function ev(user: U | null, init: { method?: string; url?: string; body?: BodyInit; json?: unknown; params?: Record<string, string> } = {}) {
    const url = new URL(init.url ?? 'http://localhost:3000/api/v1/admin/branding');
    const headers: Record<string, string> = {};
    let body = init.body;
    if (init.json !== undefined) {
      body = JSON.stringify(init.json);
      headers['content-type'] = 'application/json';
    }
    const request = new Request(url, { method: init.method ?? 'GET', body, headers });
    return { request, url, params: init.params ?? {}, locals: { user, brand: await m.brand.getBrand(m.db), session: null, apiToken: null } } as unknown as RequestEvent;
  }

  const putLogo = async (user: U, bytes: Uint8Array<ArrayBuffer> | string, type: string, variant = 'light') => {
    const fd = new FormData();
    fd.set('file', new File([bytes], type === 'image/png' ? 'logo.png' : 'logo.svg', { type }));
    return m.logo.PUT((await ev(user, { method: 'PUT', url: `http://localhost:3000/api/v1/admin/branding/logo?variant=${variant}`, body: fd })) as never);
  };

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.S3_KEY_PREFIX = `brandtest-${run}/`;
    process.env.ADMIN_EMAILS = '';
    process.env.APP_NAME = '';
    execFileSync('node', ['scripts/migrate.ts'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    m = {
      db: (await import('../src/lib/server/db/index.ts')).db,
      schema: await import('../src/lib/server/db/schema/index.ts'),
      brand: await import('../src/lib/server/branding/index.ts'),
      instance: await import('../src/lib/server/auth/instance.ts'),
      env: await import('../src/lib/server/env.ts'),
      s3: await import('../src/lib/server/s3.ts'),
      pub: await import('../src/routes/api/v1/branding/+server.ts'),
      adm: await import('../src/routes/api/v1/admin/branding/+server.ts'),
      logo: await import('../src/routes/api/v1/admin/branding/logo/+server.ts'),
      file: await import('../src/routes/brand/[file]/+server.ts'),
    };
    first = await mkUser('Ada');
    second = await mkUser('Bo');
  }, 120_000);

  afterAll(async () => {
    process.env = env0;
    await m?.s3.deletePrefix(`brandtest-${run}/`).catch(() => 0);
    await (await import('../src/lib/server/db/index.ts')).sqlClient.end().catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('the first account is the instance admin without ADMIN_EMAILS; with it, only verified listed emails', async () => {
    expect(await m.instance.isInstanceAdmin(m.db, first, [])).toBe(true);
    expect(await m.instance.isInstanceAdmin(m.db, second, [])).toBe(false);
    expect(await m.instance.isInstanceAdmin(m.db, second, [second.email])).toBe(true);
    const unverified = await mkUser('Cy', false);
    expect(await m.instance.isInstanceAdmin(m.db, unverified, [unverified.email])).toBe(false);
  });

  it('only the instance admin changes the name; the public branding follows at once', async () => {
    const denied = await m.adm.PUT((await ev(second, { method: 'PUT', json: { name: 'Nope' } })) as never);
    expect(denied.status).toBe(403);
    const ok = await m.adm.PUT((await ev(first, { method: 'PUT', json: { name: 'Acme Review', accent: '#0B7A5C' } })) as never);
    expect(ok.status).toBe(200);
    const pub = await (await m.pub.GET((await ev(null, { url: 'http://localhost:3000/api/v1/branding' })) as never)).json();
    expect(pub).toMatchObject({ name: 'Acme Review', accent: '#0b7a5c', onAccent: '#ffffff', defaultLogo: true });
    expect(pub.logo.icons['32']).toMatch(/\/brand\/icon-32\.png\?v=/);
    const bad = await m.adm.PUT((await ev(first, { method: 'PUT', json: { name: '<b>x</b>' } })) as never);
    expect(bad.status).toBe(422);
  });

  it('a field set by the environment is locked (409)', async () => {
    m.env.env.brand.name = 'From Env';
    m.brand.invalidateBrand();
    try {
      const r = await m.adm.PUT((await ev(first, { method: 'PUT', json: { name: 'Other' } })) as never);
      expect(r.status).toBe(409);
      expect((await r.json()).error).toBe('locked_by_env');
      const view = await (await m.adm.GET((await ev(first)) as never)).json();
      expect(view.locked.name).toBe(true);
      expect(view.branding.name).toBe('From Env');
    } finally {
      m.env.env.brand.name = '';
      m.brand.invalidateBrand();
    }
  });

  it('logo upload: clean SVG stored with renditions, hostile SVG 422, JPEG 415, too large 413', async () => {
    const ok = await putLogo(first, CLEAN_SVG, 'image/svg+xml');
    expect(ok.status).toBe(200);
    const view = await ok.json();
    expect(view.stored.logo.light.type).toBe('image/svg+xml');
    expect(view.branding.defaultLogo).toBe(false);
    expect((await putLogo(second, CLEAN_SVG, 'image/svg+xml')).status).toBe(403);
    expect((await putLogo(first, HOSTILE_SVG, 'image/svg+xml')).status).toBe(422);
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } }).jpeg().toBuffer();
    expect((await putLogo(first, new Uint8Array(jpeg) as Uint8Array<ArrayBuffer>, 'image/jpeg')).status).toBe(415);
    expect((await putLogo(first, new Uint8Array(600 * 1024), 'image/png')).status).toBe(413);

    const b = await m.brand.getBrand(m.db);
    const icon = await m.file.GET((await ev(null, { url: `http://localhost:3000/brand/icon-32.png?v=${b.version}`, params: { file: 'icon-32.png' } })) as never);
    expect(icon.status).toBe(200);
    expect(icon.headers.get('cache-control')).toContain('immutable');
    expect((await sharp(Buffer.from(await icon.arrayBuffer())).metadata()).width).toBe(32);
    const svg = await m.file.GET((await ev(null, { url: 'http://localhost:3000/brand/logo.svg', params: { file: 'logo.svg' } })) as never);
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    expect(svg.headers.get('content-security-policy')).toContain('sandbox');
    expect(svg.headers.get('cache-control')).toBe('public, max-age=300');
    expect(await svg.text()).toContain('rx="4"');
    await expect(m.file.GET((await ev(null, { url: 'http://localhost:3000/brand/logo-dark.svg', params: { file: 'logo-dark.svg' } })) as never)).rejects.toMatchObject({ status: 404 });
  });

  it('a dark PNG logo, then removing both logos falls back to the rectangle', async () => {
    const png = await sharp({ create: { width: 200, height: 80, channels: 4, background: '#ffffff' } }).png().toBuffer();
    const r = await putLogo(first, new Uint8Array(png) as Uint8Array<ArrayBuffer>, 'image/png', 'dark');
    expect(r.status).toBe(200);
    expect((await r.json()).branding.logo.dark).toMatch(/\/brand\/logo-dark\.png\?v=/);
    for (const variant of ['light', 'dark']) {
      const d = await m.logo.DELETE((await ev(first, { method: 'DELETE', url: `http://localhost:3000/api/v1/admin/branding/logo?variant=${variant}` })) as never);
      expect(d.status).toBe(200);
    }
    const b = await m.brand.getBrand(m.db);
    expect(b.logo).toEqual({ light: null, dark: null });
    const svg = await m.file.GET((await ev(null, { url: 'http://localhost:3000/brand/logo.svg', params: { file: 'logo.svg' } })) as never);
    expect(await svg.text()).toContain('fill="#0b7a5c"');
  });
});
