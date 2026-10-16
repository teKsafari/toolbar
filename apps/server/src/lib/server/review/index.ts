// Reviewer sign-in for apps behind the injector (D-157, D-201). A review link (/go/<project>)
// asks the signed-in person to confirm, then mints a device token for that app origin (listed
// under connected browsers, so it can be revoked) and signs it into a cookie value that the
// browser posts to the injector's /__toolbar/session on the app's own origin.
import type { Db } from '../db/index.ts';
import { env } from '../env.ts';
import { createApiToken } from '../tokens.ts';
import { normalizeOrigin, signReview } from './cookie.ts';
import { injectorOriginListed, reviewAccess } from './access.ts';

export { injectorOriginListed, reviewAccess, type ReviewAccess } from './access.ts';

export const MIN_SECRET_LENGTH = 32;

export function injectorEnabled(e = env): boolean {
  return e.injector.secret.length >= MIN_SECRET_LENGTH;
}

export async function issueReviewCookie(db: Db, opts: { userId: string; origin: string; now?: number }, e = env): Promise<{ value: string; expiresAt: Date }> {
  const origin = normalizeOrigin(opts.origin);
  if (!origin || !injectorEnabled(e) || !(await reviewAccess(db, opts.userId, origin, e)).allowed) throw new Error('origin_not_allowed');
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

/**
 * The site a review link opens: `site` (an origin, or a bare host for https) when given, else the
 * project's only exact origin. Wildcard origins (`*.`) name no single site.
 */
export function reviewSite(site: string | null | undefined, projectOrigins: string[] = []): string | null {
  if (site) return normalizeOrigin(/^[a-z][a-z0-9+.-]*:\/\//i.test(site) ? site : `https://${site}`);
  const exact = projectOrigins.filter((o) => !o.includes('*'));
  return exact.length === 1 ? normalizeOrigin(exact[0]) : null;
}

/** The share-ready review link of a project site: `<server>/go/<project id>`, plus `?site=` when the project has several. */
export function reviewLink(publicUrl: string, projectId: string, origin: string, projectOrigins: string[]): string {
  const base = `${publicUrl.replace(/\/+$/, '')}/go/${projectId}`;
  return reviewSite(null, projectOrigins) === origin ? base : `${base}?site=${encodeURIComponent(origin)}`;
}

export interface ReviewLink {
  origin: string;
  host: string;
  href: string;
}

/**
 * The review links of projects, by project id: one per exact origin (a `*.` origin names no
 * single site), none for an origin outside INJECTOR_ORIGINS. Null while the injector is off.
 */
export function reviewLinksOf(projects: { id: string; origins: string[] }[], e = env): Record<string, ReviewLink[]> | null {
  if (!injectorEnabled(e)) return null;
  return Object.fromEntries(
    projects.map((p) => [
      p.id,
      p.origins
        .filter((o) => !o.includes('*'))
        .map((o) => normalizeOrigin(o))
        .filter((o): o is string => !!o && injectorOriginListed(o, e))
        .map((o) => ({ origin: o, host: new URL(o).host, href: reviewLink(e.publicUrl, p.id, o, p.origins) })),
    ]),
  );
}
