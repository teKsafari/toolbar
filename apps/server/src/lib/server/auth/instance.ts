// Instance admin (D-112): the person who may change instance-wide settings such as branding.
// With ADMIN_EMAILS set: a user whose email is listed and verified. Without it: the first
// account on the server (the rule J-177's support link uses too).
import { asc } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { user } from '../db/schema/index.ts';
import { env } from '../env.ts';

export interface AdminCandidate {
  id: string;
  email: string;
  emailVerified?: boolean | null;
}

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
