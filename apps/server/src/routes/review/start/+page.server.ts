// /review/start?origin=<app origin>&next=<path> (D-130): the injector's /__toolbar/login sends
// reviewers here. Signed out: to /login and back. Signed in: a confirm button; its POST mints the
// reviewer cookie and the page posts it to <origin>/__toolbar/session, which sets it on the app.
import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { env } from '#lib/server/env.ts';
import { normalizeOrigin, safeNext } from '#lib/server/review/cookie.ts';
import { injectorEnabled, issueReviewCookie, reviewOriginAllowedFor } from '#lib/server/review/index.ts';

const NOT_SET_UP = 'This site is not set up for review on this server: add its origin to a project (Settings, Projects) or to INJECTOR_ORIGINS.';

function target(url: URL) {
  if (!injectorEnabled()) error(404, 'Not found');
  const origin = normalizeOrigin(url.searchParams.get('origin'));
  if (!origin) error(400, NOT_SET_UP);
  return { origin, next: safeNext(url.searchParams.get('next')) };
}

export const load = async ({ locals, url, setHeaders }) => {
  const t = target(url);
  if (!locals.user || locals.apiToken) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  if (!(await reviewOriginAllowedFor(db, locals.user.id, t.origin))) error(400, NOT_SET_UP);
  setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  return { ...t, host: new URL(t.origin).host, email: locals.user.email, days: env.injector.cookieDays };
};

export const actions = {
  // load runs after the action and sets no-store and no-referrer on this page too
  default: async ({ locals, url }) => {
    const t = target(url);
    if (!locals.user || locals.apiToken) return fail(401, { message: 'Sign in again.' });
    if (!(await reviewOriginAllowedFor(db, locals.user.id, t.origin))) return fail(400, { message: NOT_SET_UP });
    const { value } = await issueReviewCookie(db, { userId: locals.user.id, origin: t.origin });
    return { handoff: { action: `${t.origin}/__toolbar/session`, token: value, next: t.next } };
  },
};
