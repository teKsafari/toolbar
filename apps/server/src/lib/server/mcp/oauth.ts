// OAuth 2.1 for MCP clients (J-146, J-147): dynamic client registration (RFC 7591), the
// authorization code flow with PKCE S256 only, refresh tokens, revocation (RFC 7009), and the
// discovery documents (RFC 8414, RFC 9728). The consent page lives at /mcp/authorize.
// Owner: agent area.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { MCP_CLIENT_PREFIX, MCP_SCOPES, MCP_TOKEN_PREFIX, MCP_TTL, type McpScope } from '@toolbar/shared/areas/agent';
import type { Db } from '../db/index.ts';
import { mcpAuthCode, mcpClient, mcpGrant, mcpToken, organization, user } from '../db/schema/index.ts';
import { env } from '../env.ts';
import { currentBrand } from '#lib/server/branding/index.ts';

const sha = (s: string) => createHash('sha256').update(s).digest();
const rand = (n = 32) => randomBytes(n).toString('base64url');

export const issuer = () => env.publicUrl;
export const resourceUrl = () => `${env.publicUrl}/mcp`;
export const resourceMetadataUrl = () => `${env.publicUrl}/.well-known/oauth-protected-resource/mcp`;

export function authServerMetadata() {
  const base = env.publicUrl;
  return {
    issuer: base,
    authorization_endpoint: `${base}/mcp/authorize`,
    token_endpoint: `${base}/mcp/token`,
    registration_endpoint: `${base}/mcp/register`,
    revocation_endpoint: `${base}/mcp/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [...MCP_SCOPES],
    service_documentation: `${base}/settings/mcp`,
  };
}

export function protectedResourceMetadata() {
  return {
    resource: resourceUrl(),
    authorization_servers: [issuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: `${currentBrand().name} captures`,
  };
}

/** OAuth error body (RFC 6749 section 5.2). */
export class OAuthError extends Error {
  constructor(
    public code: string,
    public description: string,
    public status = 400,
  ) {
    super(description);
  }
  body() {
    return { error: this.code, error_description: this.description };
  }
}

// ---------- registration ----------

const redirectUriSchema = z.string().refine((u) => {
  try {
    const url = new URL(u);
    if (url.hash) return false;
    // https anywhere; http only for loopback (native clients); custom schemes for desktop apps (RFC 8252)
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !['javascript:', 'data:', 'file:', 'vbscript:'].includes(url.protocol);
  } catch {
    return false;
  }
}, 'redirect_uri must be https, loopback http, or an app scheme');

export const registerSchema = z.object({
  redirect_uris: z.array(redirectUriSchema).min(1).max(10),
  client_name: z.string().trim().max(120).optional(),
  client_uri: z.string().url().max(500).optional(),
  logo_uri: z.string().url().max(500).optional(),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post', 'client_secret_basic']).default('none'),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().optional(),
});

export async function registerClient(db: Db, raw: unknown) {
  const r = registerSchema.safeParse(raw);
  if (!r.success) throw new OAuthError('invalid_client_metadata', r.error.issues.map((i) => i.message).join('; '));
  const b = r.data;
  const id = MCP_CLIENT_PREFIX + rand(16);
  const secret = b.token_endpoint_auth_method === 'none' ? null : 'nbs_' + rand(32);
  const name = (b.client_name || 'Unnamed agent').slice(0, 120);
  const [row] = await db
    .insert(mcpClient)
    .values({
      id,
      name,
      redirectUris: b.redirect_uris,
      clientUri: b.client_uri ?? null,
      logoUri: b.logo_uri ?? null,
      tokenEndpointAuthMethod: b.token_endpoint_auth_method,
      secretHash: secret ? sha(secret) : null,
    })
    .returning();
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(row!.createdAt.getTime() / 1000),
    client_name: name,
    redirect_uris: b.redirect_uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: b.token_endpoint_auth_method,
    ...(b.client_uri ? { client_uri: b.client_uri } : {}),
    ...(b.logo_uri ? { logo_uri: b.logo_uri } : {}),
  };
}

export async function getClient(db: Db, id: string) {
  const [c] = await db.select().from(mcpClient).where(eq(mcpClient.id, id)).limit(1);
  return c ?? null;
}

// ---------- authorize ----------

export const authorizeQuerySchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().optional(),
  code_challenge: z.string().min(43).max(128),
  code_challenge_method: z.literal('S256'),
  state: z.string().max(1000).optional(),
  scope: z.string().optional(),
  resource: z.string().optional(),
});
export type AuthorizeQuery = z.infer<typeof authorizeQuerySchema>;

/** Scopes from a request: known ones only; none asked means both (Jam asks for both). */
export function parseScopes(scope: string | undefined | null): McpScope[] {
  const asked = (scope ?? '').split(/\s+/).filter(Boolean);
  const known = asked.filter((s): s is McpScope => (MCP_SCOPES as readonly string[]).includes(s));
  return known.length ? known : [...MCP_SCOPES];
}

/**
 * Check an authorize request before showing consent. Errors that make the redirect URI
 * untrustworthy are thrown (shown on our page); the rest go back to the client.
 */
export async function checkAuthorize(db: Db, q: Record<string, string>) {
  const client = q.client_id ? await getClient(db, q.client_id) : null;
  if (!client) throw new OAuthError('invalid_client', 'This agent is not registered with the server. Remove it from the agent and add the server again.');
  const redirectUri = q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) throw new OAuthError('invalid_request', 'The redirect address does not match what the agent registered.');
  const p = authorizeQuerySchema.safeParse(q);
  if (!p.success) return { client, redirectUri, error: new OAuthError('invalid_request', 'The request needs response_type=code and a PKCE S256 code challenge.') };
  return { client, redirectUri, query: p.data, scopes: parseScopes(p.data.scope), error: null };
}

export function redirectWith(uri: string, params: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/** Approve: one grant per client, user and workspace (re-approval reuses it), and a 60 s code. */
export async function approve(
  db: Db,
  input: { clientId: string; userId: string; organizationId: string; scopes: McpScope[]; redirectUri: string; codeChallenge: string },
): Promise<string> {
  const [existing] = await db
    .select()
    .from(mcpGrant)
    .where(
      and(
        eq(mcpGrant.clientId, input.clientId),
        eq(mcpGrant.userId, input.userId),
        eq(mcpGrant.organizationId, input.organizationId),
        isNull(mcpGrant.revokedAt),
      ),
    )
    .limit(1);
  let grantId = existing?.id;
  if (existing) {
    const scopes = [...new Set([...existing.scopes, ...input.scopes])];
    await db.update(mcpGrant).set({ scopes }).where(eq(mcpGrant.id, existing.id));
  } else {
    const [g] = await db
      .insert(mcpGrant)
      .values({ clientId: input.clientId, userId: input.userId, organizationId: input.organizationId, scopes: input.scopes })
      .returning({ id: mcpGrant.id });
    grantId = g!.id;
  }
  const code = 'nbk_' + rand(32);
  await db.insert(mcpAuthCode).values({
    codeHash: sha(code),
    grantId: grantId!,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    expiresAt: new Date(Date.now() + MCP_TTL.codeMs),
  });
  return code;
}

// ---------- token ----------

/** Token and revoke bodies are form-encoded (RFC 6749); some clients send JSON. */
export async function formOf(request: Request): Promise<URLSearchParams> {
  const ct = request.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(j).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await request.text());
}


function s256(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function safeEq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Client credentials from the form body or HTTP Basic. */
export function clientCredentials(form: URLSearchParams, authorization: string | null): { id: string | null; secret: string | null } {
  const m = authorization?.match(/^Basic\s+(\S+)$/i);
  if (m) {
    const [id, secret] = Buffer.from(m[1]!, 'base64').toString('utf8').split(':');
    return { id: decodeURIComponent(id ?? '') || null, secret: secret !== undefined ? decodeURIComponent(secret) : null };
  }
  return { id: form.get('client_id'), secret: form.get('client_secret') };
}

async function authenticateClient(db: Db, creds: { id: string | null; secret: string | null }) {
  if (!creds.id) throw new OAuthError('invalid_client', 'client_id is missing', 401);
  const client = await getClient(db, creds.id);
  if (!client) throw new OAuthError('invalid_client', 'Unknown client', 401);
  if (client.secretHash) {
    if (!creds.secret || !timingSafeEqual(sha(creds.secret), client.secretHash)) throw new OAuthError('invalid_client', 'Client authentication failed', 401);
  }
  return client;
}

async function issueTokens(db: Db, grantId: string, scopes: string[]) {
  const access = MCP_TOKEN_PREFIX.access + rand(32);
  const refresh = MCP_TOKEN_PREFIX.refresh + rand(32);
  const now = Date.now();
  await db.insert(mcpToken).values([
    { grantId, kind: 'access', tokenHash: sha(access), expiresAt: new Date(now + MCP_TTL.accessMs) },
    { grantId, kind: 'refresh', tokenHash: sha(refresh), expiresAt: new Date(now + MCP_TTL.refreshMs) },
  ]);
  return { access_token: access, token_type: 'Bearer', expires_in: Math.floor(MCP_TTL.accessMs / 1000), refresh_token: refresh, scope: scopes.join(' ') };
}

export async function tokenRequest(db: Db, form: URLSearchParams, authorization: string | null) {
  const client = await authenticateClient(db, clientCredentials(form, authorization));
  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') {
    const code = form.get('code') ?? '';
    const verifier = form.get('code_verifier') ?? '';
    const [row] = await db
      .delete(mcpAuthCode)
      .where(eq(mcpAuthCode.codeHash, sha(code)))
      .returning();
    if (!row || row.expiresAt.getTime() < Date.now()) throw new OAuthError('invalid_grant', 'The code is unknown, used or expired');
    const [grant] = await db.select().from(mcpGrant).where(eq(mcpGrant.id, row.grantId)).limit(1);
    if (!grant || grant.revokedAt || grant.clientId !== client.id) throw new OAuthError('invalid_grant', 'The code was issued to another client');
    const redirect = form.get('redirect_uri');
    if (redirect && redirect !== row.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri does not match the authorization request');
    if (!verifier || !safeEq(s256(verifier), row.codeChallenge)) throw new OAuthError('invalid_grant', 'PKCE verification failed');
    return issueTokens(db, grant.id, grant.scopes);
  }
  if (grantType === 'refresh_token') {
    const token = form.get('refresh_token') ?? '';
    const [row] = await db
      .select({ t: mcpToken, g: mcpGrant })
      .from(mcpToken)
      .innerJoin(mcpGrant, eq(mcpGrant.id, mcpToken.grantId))
      .where(and(eq(mcpToken.tokenHash, sha(token)), eq(mcpToken.kind, 'refresh')))
      .limit(1);
    if (!row || row.t.revokedAt || row.g.revokedAt || row.t.expiresAt.getTime() < Date.now() || row.g.clientId !== client.id)
      throw new OAuthError('invalid_grant', 'The refresh token is unknown, revoked or expired');
    // rotate: the old refresh token stops working
    await db.update(mcpToken).set({ revokedAt: new Date() }).where(eq(mcpToken.id, row.t.id));
    return issueTokens(db, row.g.id, row.g.scopes);
  }
  throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token');
}

export async function revokeToken(db: Db, form: URLSearchParams, authorization: string | null) {
  await authenticateClient(db, clientCredentials(form, authorization));
  const token = form.get('token') ?? '';
  await db.update(mcpToken).set({ revokedAt: new Date() }).where(eq(mcpToken.tokenHash, sha(token)));
}

// ---------- resolving a bearer on /mcp ----------

export interface McpPrincipal {
  userId: string;
  /** set for OAuth grants: the workspace the user picked on the consent page */
  workspaceId: string | null;
  canWrite: boolean;
  via: 'oauth' | 'personal';
  grantId: string | null;
  clientName: string | null;
}

export async function resolveMcpAccessToken(db: Db, token: string): Promise<McpPrincipal | null> {
  if (!token.startsWith(MCP_TOKEN_PREFIX.access)) return null;
  const now = new Date();
  const [row] = await db
    .select({ g: mcpGrant, name: mcpClient.name })
    .from(mcpToken)
    .innerJoin(mcpGrant, eq(mcpGrant.id, mcpToken.grantId))
    .innerJoin(mcpClient, eq(mcpClient.id, mcpGrant.clientId))
    .where(and(eq(mcpToken.tokenHash, sha(token)), eq(mcpToken.kind, 'access'), isNull(mcpToken.revokedAt), isNull(mcpGrant.revokedAt), gt(mcpToken.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  void db.update(mcpGrant).set({ lastUsedAt: now }).where(eq(mcpGrant.id, row.g.id)).catch(() => {});
  return {
    userId: row.g.userId,
    workspaceId: row.g.organizationId,
    canWrite: row.g.scopes.includes('captures:write'),
    via: 'oauth',
    grantId: row.g.id,
    clientName: row.name,
  };
}

// ---------- connected agents (J-147) ----------

export async function listGrants(db: Db, userId: string) {
  const rows = await db
    .select({ g: mcpGrant, name: mcpClient.name, ws: organization.name })
    .from(mcpGrant)
    .innerJoin(mcpClient, eq(mcpClient.id, mcpGrant.clientId))
    .innerJoin(organization, eq(organization.id, mcpGrant.organizationId))
    .where(and(eq(mcpGrant.userId, userId), isNull(mcpGrant.revokedAt)))
    .orderBy(desc(mcpGrant.createdAt));
  return rows.map(({ g, name, ws }) => ({
    id: g.id,
    name,
    workspaceId: g.organizationId,
    workspaceName: ws,
    scopes: g.scopes,
    createdAt: g.createdAt.toISOString(),
    lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Remove a connected agent: the grant and every token of it stop working at once. */
export async function revokeGrant(db: Db, userId: string, grantId: string): Promise<boolean> {
  const now = new Date();
  const r = await db
    .update(mcpGrant)
    .set({ revokedAt: now })
    .where(and(eq(mcpGrant.id, grantId), eq(mcpGrant.userId, userId), isNull(mcpGrant.revokedAt)))
    .returning({ id: mcpGrant.id });
  if (!r.length) return false;
  await db.update(mcpToken).set({ revokedAt: now }).where(and(eq(mcpToken.grantId, grantId), isNull(mcpToken.revokedAt)));
  return true;
}

/**
 * REST access for OAuth access tokens (the CLI's browser login uses the same flow): the user and
 * the CLI scopes the grant maps to, for hooks.server.ts. Null for unknown, expired or revoked tokens.
 */
export async function restIdentityOfMcpToken(db: Db, token: string) {
  const p = await resolveMcpAccessToken(db, token);
  if (!p) return null;
  const [u] = await db.select().from(user).where(eq(user.id, p.userId)).limit(1);
  if (!u) return null;
  return { user: u, grantId: p.grantId!, scopes: p.canWrite ? ['cli:read', 'cli:write'] : ['cli:read'] };
}
