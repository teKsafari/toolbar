// Reviewer sign-in for apps behind the injector (D-123). /review/start asks the signed-in person
// to confirm, then mints a device token for that app origin (listed under connected browsers, so
// it can be revoked) and signs it into a cookie value that the browser posts to the injector's
// /__toolbar/session on the app's own origin.
import type { Db } from '../db/index.ts';
import { env } from '../env.ts';
import { createApiToken } from '../tokens.ts';
import { normalizeOrigin, signReview } from './cookie.ts';

export const MIN_SECRET_LENGTH = 32;

export function injectorEnabled(e = env): boolean {
  return e.injector.secret.length >= MIN_SECRET_LENGTH;
}

/** Is this app origin one the injector fronts (INJECTOR_ORIGINS)? */
export function reviewOriginAllowed(origin: string | null, e = env): origin is string {
  return !!origin && e.injector.origins.some((o) => normalizeOrigin(o) === origin);
}

export async function issueReviewCookie(db: Db, opts: { userId: string; origin: string; now?: number }, e = env): Promise<{ value: string; expiresAt: Date }> {
  const origin = normalizeOrigin(opts.origin);
  if (!injectorEnabled(e) || !reviewOriginAllowed(origin, e)) throw new Error('origin_not_allowed');
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
