// API tokens (device tokens from the extension sign-in, personal tokens for the CLI).
// Only sha256 hashes are stored.
import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { TOKEN_PREFIX } from '@toolbar/shared';
import type { Db } from './db/index.ts';
import { apiToken, user } from './db/schema/index.ts';

export const hashToken = (token: string) => createHash('sha256').update(token).digest();

export function bearerFrom(header: string | null): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  const t = m?.[1];
  return t && (t.startsWith(TOKEN_PREFIX.device) || t.startsWith(TOKEN_PREFIX.personal)) ? t : null;
}

export async function resolveApiToken(db: Db, token: string) {
  const [row] = await db
    .select({ tokenId: apiToken.id, kind: apiToken.kind, user })
    .from(apiToken)
    .innerJoin(user, eq(user.id, apiToken.userId))
    .where(and(eq(apiToken.tokenHash, hashToken(token)), isNull(apiToken.revokedAt)))
    .limit(1);
  if (!row) return null;
  void db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, row.tokenId)).catch(() => {});
  return row;
}
