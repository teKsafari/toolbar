// Instance settings (D-194) against a throwaway Postgres database: the admin-only routes, the
// sealed API key in `instance_setting`, a change taking effect without a restart (and on another
// replica after the cache expires), the environment lock, workspace project defaults, and the
// bootstrap rule. Route handlers are called directly with the locals the hooks would set. Skips
// when Postgres is down.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { execFileSync } from 'node:child_process';
import type { RequestEvent } from '@sveltejs/kit';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_settingstest_${process.pid}`;
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

describe.skipIf(!reachable)('instance settings (integration)', () => {
  let admin: postgres.Sql;
  let m: {
    db: typeof import('../src/lib/server/db/index.ts').db;
    schema: typeof import('../src/lib/server/db/schema/index.ts');
    settings: typeof import('../src/lib/server/settings/index.ts');
    instance: typeof import('../src/lib/server/auth/instance.ts');
    allow: typeof import('../src/lib/server/auth/allowlist.ts');
    crypto: typeof import('../src/lib/server/crypto.ts');
    transcribe: typeof import('../src/lib/server/transcribe/config.ts');
    ws: typeof import('../src/lib/server/auth/workspaces.ts');
    route: typeof import('../src/routes/api/v1/admin/settings/+server.ts');
    test: typeof import('../src/routes/api/v1/admin/settings/test/+server.ts');
    projects: typeof import('../src/routes/api/v1/workspaces/[workspaceId]/projects/+server.ts');
  };
  const env0 = { ...process.env };
  type U = { id: string; email: string; name: string; emailVerified: boolean };
  let first: U;
  let second: U;

  const mkUser = async (who: string, verified = true) => {
    const [u] = await m.db.insert(m.schema.user).values({ name: who, email: `${who.toLowerCase()}-${run}@settings.test`, emailVerified: verified }).returning();
    return u! as U;
  };

  function ev(user: U | null, init: { method?: string; url?: string; json?: unknown; params?: Record<string, string>; token?: boolean } = {}) {
    const url = new URL(init.url ?? 'http://localhost:3000/api/v1/admin/settings');
    const request = new Request(url, {
      method: init.method ?? 'GET',
      body: init.json === undefined ? undefined : JSON.stringify(init.json),
      headers: init.json === undefined ? {} : { 'content-type': 'application/json' },
    });
    const apiToken = init.token ? { id: 't', kind: 'personal', scopes: ['cli:read', 'cli:write'] } : null;
    return { request, url, params: init.params ?? {}, locals: { user, session: null, apiToken }, getClientAddress: () => '127.0.0.1' } as unknown as RequestEvent;
  }
  const get = (u: U | null, token = false) => m.route.GET(ev(u, { token }) as never);
  const patch = (u: U | null, json: unknown) => m.route.PATCH(ev(u, { method: 'PATCH', json }) as never);

  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    process.env.DATABASE_URL = url.toString();
    process.env.ADMIN_EMAILS = '';
    for (const k of Object.keys(process.env)) if (/^(TRANSCRIBE_|STT_|OPENAI_API_KEY|WHISPER_URL|SHARE_LINK_DAYS|EXPORT_MAX_MB|ALLOWED_EMAIL_DOMAINS|AUTH_ALLOWED_DOMAINS|OIDC_SCOPES|OIDC_PROVIDER_NAME|MAX_RECORDING_MIN)/.test(k)) delete process.env[k];
    execFileSync('node', ['scripts/migrate.ts'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env }, stdio: 'ignore' });
    m = {
      db: (await import('../src/lib/server/db/index.ts')).db,
      schema: await import('../src/lib/server/db/schema/index.ts'),
      settings: await import('../src/lib/server/settings/index.ts'),
      instance: await import('../src/lib/server/auth/instance.ts'),
      allow: await import('../src/lib/server/auth/allowlist.ts'),
      crypto: await import('../src/lib/server/crypto.ts'),
      transcribe: await import('../src/lib/server/transcribe/config.ts'),
      ws: await import('../src/lib/server/auth/workspaces.ts'),
      route: await import('../src/routes/api/v1/admin/settings/+server.ts'),
      test: await import('../src/routes/api/v1/admin/settings/test/+server.ts'),
      projects: await import('../src/routes/api/v1/workspaces/[workspaceId]/projects/+server.ts'),
    };
    first = await mkUser('Ada');
    second = await mkUser('Bo');
  }, 120_000);

  afterAll(async () => {
    process.env = env0;
    await (await import('../src/lib/server/db/index.ts')).sqlClient.end().catch(() => {});
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('only the instance admin, signed in with a session, reads and changes the settings', async () => {
    expect((await get(null)).status).toBe(401);
    expect((await get(second)).status).toBe(403);
    expect((await patch(second, { shareLinkDays: 3 })).status).toBe(403);
    expect((await get(first, true)).status).toBe(403); // a personal token never reaches them
    const r = await get(first);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.values).toMatchObject({ shareLinkDays: 14, transcribeProvider: 'none', allowedEmailDomains: [] });
    expect(body.locked.shareLinkDays).toBeNull();
    expect(body.oidc.redirectUri).toBe('http://localhost:3000/api/auth/callback/oidc');
  });

  it('stores a change, and readers see it at once without a restart', async () => {
    const r = await patch(first, { shareLinkDays: 30, transcribeProvider: 'openai', transcribeModel: 'whisper-1', allowedEmailDomains: 'settings.test' });
    expect(r.status).toBe(200);
    expect((await r.json()).stored).toMatchObject({ shareLinkDays: true, transcribeProvider: true });
    expect(m.settings.setting('shareLinkDays')).toBe(30);
    expect(m.transcribe.transcribeConfig()).toMatchObject({ provider: 'openai', model: 'whisper-1' });
    expect(m.allow.domainAllowed(`x@settings.test`)).toBe(true);
    expect(m.allow.domainAllowed(`x@elsewhere.test`)).toBe(false);
    const [row] = await m.db.select().from(m.schema.instanceSetting).where((await import('drizzle-orm')).eq(m.schema.instanceSetting.key, 'instance'));
    expect(row!.updatedBy).toBe(first.id);
    expect(row!.value).toMatchObject({ shareLinkDays: 30, allowedEmailDomains: ['settings.test'] });
  });

  it('seals the API key at rest and never returns it', async () => {
    const key = 'sk-proj-integration-secret-9876';
    const r = await patch(first, { transcribeApiKey: key });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain('integration-secret');
    expect(JSON.parse(text).values.transcribeApiKey).toBe('...9876');
    const c = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    const rows = (await c`SELECT value FROM instance_setting WHERE key = 'instance'`) as unknown as { value: Record<string, unknown> }[];
    await c.end();
    const stored = rows[0]!.value.transcribeApiKey as { sealed: string };
    expect(JSON.stringify(rows[0]!.value)).not.toContain('integration-secret');
    expect(m.crypto.unseal(Buffer.from(stored.sealed, 'base64'), 'instance-secret')).toBe(key);
    expect(m.transcribe.transcribeConfig().apiKey).toBe(key);
    // removing it
    expect((await (await patch(first, { transcribeApiKey: null })).json()).values.transcribeApiKey).toBeNull();
    expect(m.transcribe.transcribeConfig().apiKey).toBe('');
  });

  it('another replica picks a change up after the cache expires', async () => {
    // as if written by another server process
    await m.db.update(m.schema.instanceSetting).set({ value: { shareLinkDays: 5 } });
    expect(m.settings.setting('shareLinkDays')).toBe(30); // still the cached value
    m.settings.invalidateSettings();
    await m.settings.refreshSettings(m.db);
    expect(m.settings.setting('shareLinkDays')).toBe(5);
  });

  it('validation errors name the field (422), a locked field answers 409, null resets', async () => {
    const bad = await patch(first, { exportMaxMb: 0 });
    expect(bad.status).toBe(422);
    expect((await bad.json()).message).toBe('Export page size: At least 1 MB');
    process.env.EXPORT_MAX_MB = '75';
    try {
      const locked = await patch(first, { exportMaxMb: 20 });
      expect(locked.status).toBe(409);
      expect((await locked.json()).error).toBe('locked_by_env');
      expect((await (await get(first)).json()).locked.exportMaxMb).toBe('EXPORT_MAX_MB');
      expect(m.settings.setting('exportMaxMb')).toBe(75);
    } finally {
      delete process.env.EXPORT_MAX_MB;
    }
    expect((await (await patch(first, { shareLinkDays: null })).json()).values.shareLinkDays).toBe(14);
  });

  it('the test route answers for the admin only and needs a provider for OIDC', async () => {
    const denied = await m.test.POST(ev(second, { method: 'POST', url: 'http://localhost:3000/api/v1/admin/settings/test', json: { target: 'oidc' } }) as never);
    expect(denied.status).toBe(403);
    const r = await m.test.POST(ev(first, { method: 'POST', url: 'http://localhost:3000/api/v1/admin/settings/test', json: { target: 'transcription', values: { transcribeProvider: 'none' } } }) as never);
    expect(await r.json()).toEqual({ ok: false, message: 'Transcription is off. Pick a provider first.' });
  });

  it('new projects take the workspace default, else the instance default', async () => {
    const ws = (await m.ws.createWorkspace(m.db, { userId: first.id, email: first.email, name: 'Lab', domainJoin: false })).id;
    const create = async (json: unknown) =>
      (await m.projects.POST(ev(first, { method: 'POST', url: `http://localhost:3000/api/v1/workspaces/${ws}/projects`, json, params: { workspaceId: ws } }) as never)).json();
    await patch(first, { defaultMaskingPreset: 'production', defaultTraceOpenMs: 20_000 });
    expect(await create({ name: 'A', origins: ['https://a.test'] })).toMatchObject({ maskingPreset: 'production', traceOpenMs: 20_000 });
    await m.ws.patchSettings(m.db, ws, { defaultMaskingPreset: 'staging', defaultTraceOpenMs: 30_000 });
    expect(await create({ name: 'B', origins: ['https://b.test'] })).toMatchObject({ maskingPreset: 'staging', traceOpenMs: 30_000 });
    // an explicit value still wins
    expect(await create({ name: 'C', origins: ['https://c.test'], maskingPreset: 'production', traceOpenMs: 5000 })).toMatchObject({ maskingPreset: 'production', traceOpenMs: 5000 });
    await patch(first, { defaultMaskingPreset: null, defaultTraceOpenMs: null });
  });

  describe('bootstrap rule on a public URL', () => {
    const pub = 'https://feedback.example.com';

    it('does not apply on localhost or with allowed domains', async () => {
      expect(await m.instance.bootstrapRefusal(m.db, { email: 'stranger@gmail.com' }, { publicUrl: 'http://localhost:3000', domains: [], adminEmails: [] })).toBeNull();
      expect(await m.instance.bootstrapRefusal(m.db, { email: 'stranger@gmail.com' }, { publicUrl: pub, domains: ['acme.test'], adminEmails: [] })).toBeNull();
    });

    it('until an admin exists, only a verified ADMIN_EMAILS address gets in', async () => {
      const admins = [`boss-${run}@settings.test`];
      const o = { publicUrl: pub, domains: [], adminEmails: admins };
      expect(await m.instance.bootstrapGateClosed(m.db, o)).toBe(true);
      expect(await m.instance.bootstrapRefusal(m.db, { email: 'stranger@gmail.com' }, o)).toBe(m.instance.NO_ADMIN_YET);
      expect(await m.instance.bootstrapRefusal(m.db, { email: admins[0], verified: false }, o)).toBe(m.instance.NO_ADMIN_YET);
      expect(await m.instance.bootstrapRefusal(m.db, { email: admins[0]!.toUpperCase(), verified: true }, o)).toBeNull();
      // the admin signs in: the gate opens, and the admin's domain choice applies from then on
      await m.db.insert(m.schema.user).values({ name: 'Boss', email: admins[0]!, emailVerified: true });
      expect(await m.instance.bootstrapGateClosed(m.db, o)).toBe(false);
      expect(await m.instance.bootstrapRefusal(m.db, { email: 'stranger@gmail.com' }, o)).toBeNull();
    });

    it('with ADMIN_EMAILS empty on an empty server, nobody gets in', async () => {
      await m.db.delete(m.schema.user);
      const o = { publicUrl: pub, domains: [], adminEmails: [] };
      expect(await m.instance.bootstrapRefusal(m.db, { email: 'first@acme.test', verified: true }, o)).toBe(m.instance.NO_ADMIN_YET);
    });
  });
});
