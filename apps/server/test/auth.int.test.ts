// Auth area against a throwaway Postgres database (skips when Postgres is not reachable):
// first-sign-in workspace (X-06), domain join (J-125), auto-upgrade (J-124), invites (J-123,
// J-234) and the extension code exchange (X-05).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { execFileSync } from 'node:child_process';
import { pkcePair, extRedirectUri } from '@toolbar/shared/areas/auth';
import * as schema from '../src/lib/server/db/schema/index.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { activeWorkspaceId, bootstrapNewUser, createWorkspace, ensureCanCreate, listWorkspaces, patchSettings, seatRole } from '../src/lib/server/auth/workspaces.ts';
import { acceptInvite, createInvites, getInviteLink, resetInviteLink, resolveInvite } from '../src/lib/server/auth/invites.ts';
import { exchangeCode, issueCode, PINNED_EXTENSION_ID } from '../src/lib/server/auth/ext.ts';
import { createApiToken, resolveApiToken } from '../src/lib/server/tokens.ts';
import { authorSnapshot } from '../src/lib/server/auth/author.ts';
import { env } from '../src/lib/server/env.ts';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_authtest_${process.pid}`;
let admin: postgres.Sql | null = null;
let client: postgres.Sql | null = null;
let db: Db;

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

const mkUser = async (email: string, verified = true) => {
  const [u] = await db.insert(schema.user).values({ name: email.split('@')[0]!, email, emailVerified: verified }).returning();
  return u!;
};

describe.skipIf(!reachable)('auth (integration)', () => {
  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
    // Area branches add columns without migrations (docs/parallel.md rule 1): push the rest.
    execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'ignore',
    });
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('X-06: a first sign-in gets a personal workspace as owner, active', async () => {
    const u = await mkUser('first@solo.test');
    const r = await bootstrapNewUser(db, u);
    expect(r.created).toBeTruthy();
    const ws = await listWorkspaces(db, u.id);
    expect(ws).toEqual([expect.objectContaining({ role: 'admin', isOwner: true, memberCount: 1 })]);
    expect(await activeWorkspaceId(db, u.id)).toBe(ws[0]!.id);
  });

  it('J-125: a verified same-domain sign-up joins as viewer and gets no personal workspace', async () => {
    const owner = await mkUser('boss@acme-int.test');
    const ws = await createWorkspace(db, { userId: owner.id, email: owner.email, name: 'Acme', domainJoin: true });
    const unverified = await mkUser('sneaky@acme-int.test', false);
    expect((await bootstrapNewUser(db, unverified)).joined).toEqual([]);
    const u = await mkUser('new@acme-int.test');
    const r = await bootstrapNewUser(db, u);
    expect(r).toEqual({ joined: [ws.id], created: null });
    expect(await seatRole(db, u.id, ws.id)).toBe('viewer');
    expect(await activeWorkspaceId(db, u.id)).toBe(ws.id);
  });

  it('J-125: webmail domains never turn on domain join', async () => {
    const u = await mkUser('someone@gmail.com');
    const ws = await createWorkspace(db, { userId: u.id, email: u.email, name: 'Mail', domainJoin: true });
    const [row] = await db.select().from(schema.organization).where(eq(schema.organization.id, ws.id));
    expect(row!.settings).toMatchObject({ domainJoin: { enabled: false, domain: null } });
  });

  it('J-124: a viewer is upgraded on create when auto-approve is on, refused when off', async () => {
    const owner = await mkUser('o@up.test');
    const ws = await createWorkspace(db, { userId: owner.id, email: owner.email, name: 'Up', domainJoin: false });
    const v = await mkUser('v@up.test');
    await db.insert(schema.member).values({ organizationId: ws.id, userId: v.id, role: 'viewer' });
    await patchSettings(db, ws.id, { autoApproveCreators: false });
    expect(await ensureCanCreate(db, v.id, ws.id)).toBe('viewer');
    await patchSettings(db, ws.id, { autoApproveCreators: true });
    expect(await ensureCanCreate(db, v.id, ws.id)).toBe('creator');
    expect(await seatRole(db, v.id, ws.id)).toBe('creator');
    expect(await ensureCanCreate(db, owner.id, ws.id)).toBe('admin');
    expect(await ensureCanCreate(db, (await mkUser('x@up.test')).id, ws.id)).toBeNull();
  });

  it('J-123 / J-234: email invites keep their role and address; the link joins as creator', async () => {
    const owner = await mkUser('o@inv.test');
    const ws = await createWorkspace(db, { userId: owner.id, email: owner.email, name: 'Inv', domainJoin: false });
    const inviter = { id: owner.id, name: owner.name, email: owner.email, image: null };
    const [inv] = await createInvites(db, { workspaceId: ws.id, inviter, emails: ['Guest@Other.test'], role: 'viewer' });
    expect(inv).toMatchObject({ email: 'guest@other.test', role: 'viewer', status: 'pending' });
    // a member is skipped
    expect(await createInvites(db, { workspaceId: ws.id, inviter, emails: [owner.email], role: 'creator' })).toEqual([]);

    const wrong = await mkUser('wrong@other.test');
    expect(await acceptInvite(db, inv!.id, wrong)).toMatchObject({ ok: false, code: 'forbidden' });
    const guest = await mkUser('guest@other.test');
    expect(await acceptInvite(db, inv!.id, guest)).toEqual({ ok: true, workspaceId: ws.id, role: 'viewer' });
    expect((await resolveInvite(db, inv!.id))?.status).toBe('accepted');

    const link = await getInviteLink(db, ws.id, owner.id);
    const token = link.url!.split('/').pop()!;
    const joiner = await mkUser('joiner@third.test');
    expect(await acceptInvite(db, token, joiner)).toEqual({ ok: true, workspaceId: ws.id, role: 'creator' });
    // joining again keeps the seat; a viewer joining by link is not upgraded
    expect(await acceptInvite(db, token, guest)).toMatchObject({ ok: true, role: 'viewer' });

    await resetInviteLink(db, ws.id, owner.id);
    expect(await acceptInvite(db, token, await mkUser('late@third.test'))).toMatchObject({ ok: false, code: 'not_found' });
    await patchSettings(db, ws.id, { inviteLinkEnabled: false });
    expect(await getInviteLink(db, ws.id, owner.id)).toMatchObject({ enabled: false, url: null });
  });

  it('X-05: code exchange checks the verifier and redirect, is single use, and mints a device token', async () => {
    const u = await mkUser('ext@dev.test');
    const redirect = extRedirectUri(PINNED_EXTENSION_ID);
    const { verifier, challenge } = await pkcePair();
    const code = await issueCode(db, { userId: u.id, codeChallenge: challenge, redirectUri: redirect });
    expect(await exchangeCode(db, { code, code_verifier: 'x'.repeat(43), redirect_uri: redirect })).toEqual({ ok: false, code: 'invalid_code' });

    const code2 = await issueCode(db, { userId: u.id, codeChallenge: challenge, redirectUri: redirect });
    const ok = await exchangeCode(db, { code: code2, code_verifier: verifier, redirect_uri: redirect, device_name: 'Chromium on Linux' });
    expect(ok).toMatchObject({ ok: true, userId: u.id, token: expect.stringMatching(/^tb_dev_/) });
    expect(await exchangeCode(db, { code: code2, code_verifier: verifier, redirect_uri: redirect })).toEqual({ ok: false, code: 'invalid_code' });
    const row = await resolveApiToken(db, (ok as { token: string }).token);
    expect(row).toMatchObject({ kind: 'device', user: { id: u.id } });

    const code3 = await issueCode(db, { userId: u.id, codeChallenge: challenge, redirectUri: redirect });
    await db.update(schema.extAuthCode).set({ expiresAt: new Date(Date.now() - 1000) });
    expect(await exchangeCode(db, { code: code3, code_verifier: verifier, redirect_uri: redirect })).toEqual({ ok: false, code: 'expired' });
  });

  it('D-114: a token of an address the allowlist no longer admits stops working; authors carry issuer and subject', async () => {
    const u = await mkUser('late@allow-int.test');
    const { secret } = await createApiToken(db, { userId: u.id, kind: 'device', name: 'ext' });
    expect((await resolveApiToken(db, secret))?.user.id).toBe(u.id);
    env.auth.allowedDomains.push('elsewhere.test');
    try {
      expect(await resolveApiToken(db, secret)).toBeNull();
      env.auth.allowedDomains.push('allow-int.test');
      expect((await resolveApiToken(db, secret))?.user.id).toBe(u.id);
    } finally {
      env.auth.allowedDomains.length = 0;
    }
    // a password account is issued by this server; an OIDC account by the provider's issuer
    expect(await authorSnapshot(db, u.id)).toMatchObject({ issuer: env.publicUrl, subject: u.id, email: u.email });
    await db.insert(schema.account).values({ userId: u.id, providerId: 'github', accountId: 'gh-42' });
    expect(await authorSnapshot(db, u.id)).toMatchObject({ issuer: 'github', subject: 'gh-42', name: 'late' });
  });
});
