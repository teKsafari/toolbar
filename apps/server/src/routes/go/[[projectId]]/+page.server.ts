// Review links (D-200): /go/<project id>[?site=<origin or host>][&next=/path], and /go?site=...
// (where the injector's /__toolbar/login sends people). Signed out: to /login and back. Signed
// in: one button; its POST mints the reviewer cookie for that site, and the page posts it to
// <site>/__toolbar/session, where the injector sets it and opens the app with the toolbar.
// The dashboard's "Open with toolbar" posts straight to the action.
import { fail, redirect } from '@sveltejs/kit';
import { projectForUrl } from '@toolbar/shared/projects';
import { db } from '#lib/server/db/index.ts';
import { env } from '#lib/server/env.ts';
import { projectsOfUser } from '#lib/server/projects.ts';
import { safeNext } from '#lib/server/review/cookie.ts';
import { injectorEnabled, issueReviewCookie, reviewAccess, reviewSite } from '#lib/server/review/index.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type GoState =
  | { state: 'ready'; origin: string; host: string; next: string; email: string; days: number; projectName: string | null }
  /** the server has no INJECTOR_SECRET */
  | { state: 'disabled' }
  /** no such project, or not one of the person's */
  | { state: 'not_found' }
  /** the project has several sites (or none) and the link names none */
  | { state: 'pick_site'; projectName: string; sites: { host: string; href: string }[] }
  /** the link names no site at all */
  | { state: 'bad_link' }
  /** the site is not in a project of the person's, or not in INJECTOR_ORIGINS */
  | { state: 'not_allowed'; host: string; reason: 'not_in_project' | 'not_listed' };

async function resolve(user: { id: string; email: string }, url: URL, projectId: string | undefined): Promise<GoState> {
  if (!injectorEnabled()) return { state: 'disabled' };
  let project: Awaited<ReturnType<typeof projectsOfUser>>[number] | null = null;
  if (projectId) {
    if (!UUID.test(projectId)) return { state: 'not_found' };
    project = (await projectsOfUser(db, user.id)).find((p) => p.id === projectId) ?? null;
    if (!project) return { state: 'not_found' };
  }
  const next = safeNext(url.searchParams.get('next'));
  const origin = reviewSite(url.searchParams.get('site'), project?.origins);
  if (!origin) {
    if (!project) return { state: 'bad_link' };
    const sites = project.origins.filter((o) => !o.includes('*'));
    return {
      state: 'pick_site',
      projectName: project.name,
      sites: sites.map((o) => ({ host: new URL(o).host, href: `${url.pathname}?site=${encodeURIComponent(o)}${next !== '/' ? `&next=${encodeURIComponent(next)}` : ''}` })),
    };
  }
  const host = new URL(origin).host;
  // a link names its project: the site must be one of that project's
  if (project && !projectForUrl([project], `${origin}/`)) return { state: 'not_allowed', host, reason: 'not_in_project' };
  const access = await reviewAccess(db, user.id, origin);
  if (!access.allowed) return { state: 'not_allowed', host, reason: access.reason };
  return { state: 'ready', origin, host, next, email: user.email, days: env.injector.cookieDays, projectName: project?.name ?? null };
}

const signIn = (url: URL) => `/login?next=${encodeURIComponent(url.pathname + url.search)}`;

export const load = async ({ locals, url, params, setHeaders }) => {
  // same-origin, not no-referrer: under no-referrer Chrome sends `Origin: null` with the page's
  // own POST, and SvelteKit's CSRF check refuses it (D-162). Cross-origin requests from this page,
  // the hand-off to <site>/__toolbar/session included, carry no Referer.
  setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'same-origin' });
  if (!injectorEnabled()) return { go: { state: 'disabled' } as GoState };
  if (!locals.user || locals.apiToken) redirect(303, signIn(url));
  return { go: await resolve(locals.user, url, params.projectId) };
};

export const actions = {
  default: async ({ locals, url, params }) => {
    if (!locals.user || locals.apiToken) return fail(401, { signedOut: true as const, login: signIn(url) });
    const go = await resolve(locals.user, url, params.projectId);
    if (go.state !== 'ready') return fail(400, { refused: go.state });
    const { value } = await issueReviewCookie(db, { userId: locals.user.id, origin: go.origin });
    return { handoff: { action: `${go.origin}/__toolbar/session`, token: value, next: go.next } };
  },
};
