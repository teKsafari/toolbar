// Reviewer sign-in for apps behind the injector (D-134). /review/start asks the signed-in person
// to confirm, then mints a device token for that app origin (listed under connected browsers, so
// it can be revoked) and signs it into a cookie value that the browser posts to the injector's
// /__toolbar/session on the app's own origin.
import type { Db } from '../db/index.ts';
import { env } from '../env.ts';
import { createApiToken } from '../tokens.ts';
import { projectForUrl } from '@toolbar/shared/projects';
import { projectsOfUser } from '../projects.ts';
import { normalizeOrigin, signReview } from './cookie.ts';

export const MIN_SECRET_LENGTH = 32;

export function injectorEnabled(e = env): boolean {
  return e.injector.secret.length >= MIN_SECRET_LENGTH;
}

/** Is this app origin one the injector fronts (INJECTOR_ORIGINS)? */
export function reviewOriginAllowed(origin: string | null, e = env): origin is string {
  return !!origin && e.injector.origins.some((o) => normalizeOrigin(o) === origin);
}

/**
 * The origins a cookie may be signed for: INJECTOR_ORIGINS when set (the operator's list of what
 * the injector fronts); when it is empty, the origins of the projects (D-123) in the person's
 * workspaces. The hand-off posts a device token to that origin, so it must never be one the
 * operator or a workspace admin of the person did not name.
 */
export async function reviewOriginAllowedFor(db: Db, userId: string, origin: string | null, e = env): Promise<boolean> {
  if (!origin) return false;
  if (e.injector.origins.length) return reviewOriginAllowed(origin, e);
  return !!projectForUrl(await projectsOfUser(db, userId), `${origin}/`);
}

export async function issueReviewCookie(db: Db, opts: { userId: string; origin: string; now?: number }, e = env): Promise<{ value: string; expiresAt: Date }> {
  const origin = normalizeOrigin(opts.origin);
  if (!origin || !injectorEnabled(e) || !(await reviewOriginAllowedFor(db, opts.userId, origin, e))) throw new Error('origin_not_allowed');
  const now = opts.now ?? Date.now();
  const { secret } = await createApiToken(db, {
    userId: opts.userId,
    kind: 'device',
    name: `Review on ${new URL(origin).host}`.slice(0, 100),
    expiresInDays: e.injector.cookieDays,
  });
  const expiresAt = new Date(now + e.injector.cookieDays * 86_400_000);
  const value = signReview(e.injector.secret, { v: 1, o: origin, u: opts.userId, x: Math.floor(expiresAt.getTime() / 1000), k: secret });
  return { value, expiresAt };
}
