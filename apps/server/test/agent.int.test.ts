// Agent area against a throwaway Postgres database (skips when Postgres is not reachable):
// OAuth DCR + PKCE + refresh + revoke (J-146, J-147), the MCP endpoint with OAuth and personal
// tokens (J-148 scopes), and the search and write tools (J-150, J-151).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import * as schema from '../src/lib/server/db/schema/index.ts';
import type { Db } from '../src/lib/server/db/index.ts';
import { approve, listGrants, registerClient, resolveMcpAccessToken, revokeGrant, tokenRequest, OAuthError, checkAuthorize } from '../src/lib/server/mcp/oauth.ts';
import { handleMcpPost } from '../src/lib/server/mcp/protocol.ts';
import { createApiToken } from '../src/lib/server/tokens.ts';

const base = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
const name = `toolbar_agenttest_${process.pid}`;
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

const b64 = (b: Buffer) => b.toString('base64url');
let ids: { org: string; dana: string; vic: string; rec: string };

async function rpc(token: string, method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const res = await handleMcpPost(
    db,
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as { result?: { content: { text: string }[]; isError?: boolean }; error?: unknown }) : null, res };
}

const tool = async (token: string, name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const r = await rpc(token, 'tools/call', { name, arguments: args }, headers);
  return r.body!.result!;
};

describe.skipIf(!reachable)('agent (integration)', () => {
  beforeAll(async () => {
    admin = postgres(base, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${name}`);
    const url = new URL(base);
    url.pathname = `/${name}`;
    client = postgres(url.toString(), { max: 4, onnotice: () => {} });
    db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as Db;
    await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
    execFileSync('pnpm', ['exec', 'drizzle-kit', 'push', '--force'], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'ignore',
    });
    const [dana] = await db.insert(schema.user).values({ name: 'Dana', email: 'dana@agent.test', emailVerified: true }).returning();
    const [vic] = await db.insert(schema.user).values({ name: 'Vic', email: 'vic@agent.test', emailVerified: true }).returning();
    const [org] = await db.insert(schema.organization).values({ name: 'Agent shop', slug: `agent-${process.pid}` }).returning();
    await db.insert(schema.member).values([
      { organizationId: org!.id, userId: dana!.id, role: 'owner' },
      { organizationId: org!.id, userId: vic!.id, role: 'viewer' },
    ]);
    const [rec] = await db
      .insert(schema.recording)
      .values({
        clientId: crypto.randomUUID(),
        organizationId: org!.id,
        kind: 'video',
        status: 'ready',
        title: 'Checkout breaks',
        description: 'Submit order fails',
        pageUrl: 'http://lab.test/checkout',
        authorUserId: dana!.id,
        authorName: 'Dana',
        finalizedAt: new Date(),
      })
      .returning();
    ids = { org: org!.id, dana: dana!.id, vic: vic!.id, rec: rec!.id };
  }, 60_000);

  afterAll(async () => {
    await client?.end();
    await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  it('runs dynamic registration, consent, PKCE exchange, refresh and revoke (J-146, J-147)', async () => {
    const reg = await registerClient(db, { client_name: 'Claude Code (test)', redirect_uris: ['http://127.0.0.1:43123/callback'] });
    expect(reg.client_id).toMatch(/^nbc_/);
    const verifier = b64(randomBytes(40));
    const challenge = b64(createHash('sha256').update(verifier).digest());
    const check = await checkAuthorize(db, { response_type: 'code', client_id: reg.client_id, redirect_uri: 'http://127.0.0.1:43123/callback', code_challenge: challenge, code_challenge_method: 'S256', state: 'st' });
    expect(check.error).toBeNull();
    expect(check.client.name).toBe('Claude Code (test)');
    await expect(checkAuthorize(db, { client_id: reg.client_id, redirect_uri: 'https://evil.example/cb' })).rejects.toBeInstanceOf(OAuthError);

    const code = await approve(db, { clientId: reg.client_id, userId: ids.dana, organizationId: ids.org, scopes: ['captures:read', 'captures:write'], redirectUri: 'http://127.0.0.1:43123/callback', codeChallenge: challenge });
    const form = (o: Record<string, string>) => new URLSearchParams(o);
    await expect(tokenRequest(db, form({ grant_type: 'authorization_code', code, client_id: reg.client_id, code_verifier: 'wrong'.repeat(10) }), null)).rejects.toMatchObject({ code: 'invalid_grant' });
    // a failed attempt burns the code
    await expect(tokenRequest(db, form({ grant_type: 'authorization_code', code, client_id: reg.client_id, code_verifier: verifier }), null)).rejects.toMatchObject({ code: 'invalid_grant' });

    const code2 = await approve(db, { clientId: reg.client_id, userId: ids.dana, organizationId: ids.org, scopes: ['captures:read', 'captures:write'], redirectUri: 'http://127.0.0.1:43123/callback', codeChallenge: challenge });
    const tok = await tokenRequest(db, form({ grant_type: 'authorization_code', code: code2, client_id: reg.client_id, code_verifier: verifier, redirect_uri: 'http://127.0.0.1:43123/callback' }), null);
    expect(tok.access_token).toMatch(/^tb_mcp_/);
    expect(tok.scope).toBe('captures:read captures:write');
    const p = await resolveMcpAccessToken(db, tok.access_token);
    expect(p).toMatchObject({ userId: ids.dana, workspaceId: ids.org, canWrite: true, clientName: 'Claude Code (test)' });

    const init = await rpc(tok.access_token, 'initialize', { protocolVersion: '2025-06-18' });
    expect(init.status).toBe(200);

    const refreshed = await tokenRequest(db, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }), null);
    expect(refreshed.access_token).not.toBe(tok.access_token);
    await expect(tokenRequest(db, form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: reg.client_id }), null)).rejects.toMatchObject({ code: 'invalid_grant' });

    const grants = await listGrants(db, ids.dana);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.name).toBe('Claude Code (test)');
    expect(await revokeGrant(db, ids.dana, grants[0]!.id)).toBe(true);
    expect(await resolveMcpAccessToken(db, refreshed.access_token)).toBeNull();
    const after = await rpc(refreshed.access_token, 'tools/list');
    expect(after.status).toBe(401);
    expect(after.res.headers.get('www-authenticate')).toContain('resource_metadata=');
    expect(await listGrants(db, ids.dana)).toHaveLength(0);
  });

  it('answers 401 without a token, and checks personal token scopes per surface (J-148)', async () => {
    const res = await handleMcpPost(db, new Request('http://localhost/mcp', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer resource_metadata="/);

    const cliOnly = await createApiToken(db, { userId: ids.dana, kind: 'personal', name: 'cli', scopes: ['cli:read'] });
    expect((await rpc(cliOnly.secret, 'tools/list')).status).toBe(403);
    const asCli = await rpc(cliOnly.secret, 'tools/list', {}, { 'x-nib-client': 'cli' });
    expect(asCli.status).toBe(200);

    const mcpRead = await createApiToken(db, { userId: ids.dana, kind: 'personal', name: 'ro', scopes: ['mcp:read'] });
    const w = await tool(mcpRead.secret, 'create_comment', { capture: ids.rec, body: 'should fail' });
    expect(w.isError).toBe(true);
    expect(w.content[0]!.text).toMatch(/read-only/);
  });

  it('comments with a time, lists, searches, updates and deletes as the user (J-150, J-151)', async () => {
    const rw = await createApiToken(db, { userId: ids.dana, kind: 'personal', name: 'rw', scopes: ['mcp:write'] });
    const url = `http://localhost:3107/c/${ids.rec}`;
    const c = await tool(rw.secret, 'create_comment', { capture: url, body: 'Root cause: the **inventory** check throws. Fixed in checkout.ts.', videoMs: 2630, intent: 'report the fix' });
    expect(c.isError).toBeFalsy();
    const made = JSON.parse(c.content[0]!.text) as { id: string; videoMs: number };
    expect(made.videoMs).toBe(2630);
    const [row] = await db.select().from(schema.comment).where(eq(schema.comment.id, made.id));
    expect(row).toMatchObject({ authorUserId: ids.dana, tMs: 2630 });

    const list = JSON.parse((await tool(rw.secret, 'list_comments', { capture: ids.rec })).content[0]!.text) as { items: { body: string; videoMs: number }[] };
    expect(list.items[0]!.videoMs).toBe(2630);

    const byWord = JSON.parse((await tool(rw.secret, 'search', { query: 'inventory' })).content[0]!.text) as { items: { id: string }[] };
    expect(byWord.items.map((i) => i.id)).toContain(ids.rec);
    const byUrl = JSON.parse((await tool(rw.secret, 'search', { query: `look at ${url} please` })).content[0]!.text) as { items: { id: string; match: string }[] };
    expect(byUrl.items[0]).toMatchObject({ id: ids.rec, match: 'id' });

    const folder = JSON.parse((await tool(rw.secret, 'create_folder', { name: 'Fixed' })).content[0]!.text) as { id: string };
    const up = await tool(rw.secret, 'update_capture', { capture: ids.rec, title: 'Checkout breaks (fixed)', folderId: folder.id });
    expect(up.isError).toBeFalsy();
    const [rec] = await db.select().from(schema.recording).where(eq(schema.recording.id, ids.rec));
    expect(rec).toMatchObject({ title: 'Checkout breaks (fixed)', folderId: folder.id });
    const folders = JSON.parse((await tool(rw.secret, 'list_folders', {})).content[0]!.text) as { items: { name: string; captures: number }[] };
    expect(folders.items).toEqual([expect.objectContaining({ name: 'Fixed', captures: 1 })]);
    const members = JSON.parse((await tool(rw.secret, 'list_members', {})).content[0]!.text) as { items: { email: string; seat: string }[] };
    expect(members.items.map((m) => [m.email, m.seat])).toEqual([
      ['dana@agent.test', 'admin'],
      ['vic@agent.test', 'viewer'],
    ]);

    // a viewer seat may comment but not edit
    const vic = await createApiToken(db, { userId: ids.vic, kind: 'personal', name: 'vic', scopes: ['mcp:write'] });
    const denied = await tool(vic.secret, 'update_capture', { capture: ids.rec, title: 'nope' });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]!.text).toMatch(/^forbidden/);
    const vicDel = await tool(vic.secret, 'delete_comment', { commentId: made.id });
    expect(vicDel.content[0]!.text).toMatch(/own comments/);

    const del = await tool(rw.secret, 'delete_comment', { commentId: made.id });
    expect(del.isError).toBeFalsy();
    const empty = JSON.parse((await tool(rw.secret, 'list_comments', { capture: ids.rec })).content[0]!.text) as { items: unknown[] };
    expect(empty.items).toHaveLength(0);

    const details = await tool(rw.secret, 'get_capture', { capture: ids.rec });
    const d = JSON.parse(details.content[0]!.text) as { title: string; folder: string; canEdit: boolean };
    expect(d).toMatchObject({ title: 'Checkout breaks (fixed)', folder: 'Fixed', canEdit: true });
    expect(details.content[1]!.text).toContain('not ready');
  });
});
