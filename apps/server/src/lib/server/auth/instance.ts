// Instance admin (D-112): the person who may change instance-wide settings such as branding and
// Settings > Server (D-194). With ADMIN_EMAILS set: a user whose email is listed and verified.
// Without it: the first account on the server (the rule J-177's support link uses too).
//
// Bootstrap rule (D-194): on a public URL with no allowed email domains, anyone the provider signs
// in could otherwise be the first account. There, until an instance admin exists, only a verified
// address of ADMIN_EMAILS may sign in; with ADMIN_EMAILS empty nobody can, and the login page
// says why. Once an admin exists, the admin's choice of allowed domains applies.
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { user } from '../db/schema/index.ts';
import { env, isLocalUrl } from '../env.ts';
import { allowedDomains } from '../settings/index.ts';

export interface AdminCandidate {
  id: string;
  email: string;
  emailVerified?: boolean | null;
}

export const NO_ADMIN_YET = 'This server has no admin yet. Until one signs in, only the addresses in ADMIN_EMAILS can sign in.';

/** The first account by creation time, or null on an empty server. */
export async function firstAccountId(db: Db): Promise<string | null> {
  const [first] = await db.select({ id: user.id }).from(user).orderBy(asc(user.createdAt), asc(user.id)).limit(1);
  return first?.id ?? null;
}

export async function isInstanceAdmin(db: Db, u: AdminCandidate | null | undefined, adminEmails: string[] = env.adminEmails): Promise<boolean> {
  if (!u) return false;
  if (adminEmails.length) return !!u.emailVerified && adminEmails.includes(u.email.trim().toLowerCase());
  return (await firstAccountId(db)) === u.id;
}

/** Does an instance admin account exist: a verified ADMIN_EMAILS address, or, without the list, any account. */
export async function adminExists(db: Db, adminEmails: string[] = env.adminEmails): Promise<boolean> {
  if (!adminEmails.length) return (await firstAccountId(db)) !== null;
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(sql<string>`lower(${user.email})`, adminEmails), eq(user.emailVerified, true)))
    .limit(1);
  return rows.length > 0;
}

export interface BootstrapOpts {
  publicUrl: string;
  domains: string[];
  adminEmails: string[];
}

const current = (): BootstrapOpts => ({ publicUrl: env.publicUrl, domains: allowedDomains(), adminEmails: env.adminEmails });

/** Is the bootstrap gate closed to everyone but ADMIN_EMAILS right now? */
export async function bootstrapGateClosed(db: Db, o: BootstrapOpts = current()): Promise<boolean> {
  if (isLocalUrl(o.publicUrl) || o.domains.length) return false;
  return !(await adminExists(db, o.adminEmails));
}

/**
 * The bootstrap rule at sign-in: null when this address may sign in, else the reason. `verified`
 * is the provider's `email_verified` (false refuses an admin address too).
 */
export async function bootstrapRefusal(
  db: Db,
  who: { email: string | null | undefined; verified?: boolean | null },
  o: BootstrapOpts = current(),
): Promise<string | null> {
  if (!(await bootstrapGateClosed(db, o))) return null;
  const email = (who.email ?? '').trim().toLowerCase();
  if (email && who.verified !== false && o.adminEmails.includes(email)) return null;
  return NO_ADMIN_YET;
}
