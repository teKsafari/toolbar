// API tokens (device tokens from the extension sign-in, personal tokens for the CLI and MCP).
// Only sha256 hashes are stored; the secret is shown once at creation (J-148).
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { TOKEN_PREFIX } from '@toolbar/shared';
import type { ApiTokenInfo, TokenScope } from '@toolbar/shared/api';
import type { Db } from './db/index.ts';
import { apiToken, user } from './db/schema/index.ts';
import { domainAllowed } from './auth/allowlist.ts';

export const hashToken = (token: string) => createHash('sha256').update(token).digest();

/** Characters of the secret kept in clear for recognition, e.g. "tb_pat_Ab12". */
const PREFIX_LEN = 11;
export const ALL_SCOPES: TokenScope[] = ['cli:read', 'cli:write', 'mcp:read', 'mcp:write'];

export function bearerFrom(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  const t = m?.[1];
  return t && (t.startsWith(TOKEN_PREFIX.device) || t.startsWith(TOKEN_PREFIX.personal)) ? t : null;
}

export function newTokenSecret(kind: 'device' | 'personal'): string {
  return TOKEN_PREFIX[kind] + randomBytes(24).toString('base64url');
}

export async function resolveApiToken(db: Db, token: string) {
  const now = new Date();
  const [row] = await db
    .select({ tokenId: apiToken.id, kind: apiToken.kind, scopes: apiToken.scopes, user })
    .from(apiToken)
    .innerJoin(user, eq(user.id, apiToken.userId))
    .where(
      and(
        eq(apiToken.tokenHash, hashToken(token)),
        isNull(apiToken.revokedAt),
        or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, now)),
      ),
    )
    .limit(1);
  // an address the allowlist no longer admits cannot use its old tokens (D-114)
  if (!row || !domainAllowed(row.user.email)) return null;
  void db.update(apiToken).set({ lastUsedAt: now }).where(eq(apiToken.id, row.tokenId)).catch(() => {});
  return row;
}

type TokenRow = typeof apiToken.$inferSelect;

export function tokenInfo(r: TokenRow): ApiTokenInfo {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    prefix: r.prefix,
    scopes: r.scopes.filter((s): s is TokenScope => (ALL_SCOPES as string[]).includes(s)),
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
  };
}

export async function createApiToken(
  db: Db,
  opts: { userId: string; kind: 'device' | 'personal'; name: string; scopes?: TokenScope[]; expiresInDays?: number | null },
): Promise<{ secret: string; row: TokenRow }> {
  const secret = newTokenSecret(opts.kind);
  const expiresAt = opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86_400_000) : null;
  const [row] = await db
    .insert(apiToken)
    .values({
      userId: opts.userId,
      kind: opts.kind,
      name: opts.name,
      tokenHash: hashToken(secret),
      prefix: secret.slice(0, PREFIX_LEN),
      scopes: opts.scopes ?? ALL_SCOPES,
      expiresAt,
    })
    .returning();
  return { secret, row: row! };
}

/** Live (not revoked, not expired) tokens of a user, newest first. */
export async function listApiTokens(db: Db, userId: string, kind?: 'device' | 'personal') {
  const now = new Date();
  const rows = await db
    .select()
    .from(apiToken)
    .where(
      and(
        eq(apiToken.userId, userId),
        isNull(apiToken.revokedAt),
        or(isNull(apiToken.expiresAt), gt(apiToken.expiresAt, now)),
        kind ? eq(apiToken.kind, kind) : undefined,
      ),
    )
    .orderBy(desc(apiToken.createdAt));
  return rows.map(tokenInfo);
}

/** Revoke one of the user's tokens. Returns false when there is no such live token. */
export async function revokeApiToken(db: Db, userId: string, id: string): Promise<boolean> {
  const r = await db
    .update(apiToken)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiToken.id, id), eq(apiToken.userId, userId), isNull(apiToken.revokedAt)))
    .returning({ id: apiToken.id });
  return r.length > 0;
}
