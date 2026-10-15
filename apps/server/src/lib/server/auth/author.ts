// Who left a record (PLAN "Part 2 specifics": issuer, subject, email and name on every record,
// D-114). Captures and comments take this snapshot when they are made, so a later profile or
// provider change does not rewrite history.
import { asc, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { account, user } from '../db/schema/index.ts';
import { env } from '../env.ts';

export interface AuthorSnapshot {
  userId: string | null;
  name: string | null;
  email: string | null;
  issuer: string | null;
  subject: string | null;
}

/**
 * The user's name and email, and the issuer and subject of their identity: the configured OIDC
 * provider's account when they have one (`iss` is the issuer URL, `sub` the provider's subject),
 * else their first account. A dev password account (AUTH_DEV_PASSWORD) is issued by this server.
 */
export async function authorSnapshot(db: Db, userId: string): Promise<AuthorSnapshot> {
  const [u] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId));
  const accounts = await db
    .select({ providerId: account.providerId, accountId: account.accountId })
    .from(account)
    .where(eq(account.userId, userId))
    .orderBy(asc(account.createdAt));
  const oidc = env.auth.oidc;
  const a = (oidc && accounts.find((x) => x.providerId === oidc.providerId)) || accounts[0];
  const issuer = !a || a.providerId === 'credential' ? env.publicUrl : oidc && a.providerId === oidc.providerId ? oidc.issuer : a.providerId;
  return { userId, name: u?.name ?? null, email: u?.email ?? null, issuer, subject: a?.accountId ?? userId };
}
