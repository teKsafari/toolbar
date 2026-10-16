import { redirect } from '@sveltejs/kit';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { errorResponse } from '#lib/server/auth/http.ts';
import { isAllowedRedirect, issueCode, redirectWithCode } from '#lib/server/auth/ext.ts';

/**
 * launchWebAuthFlow target (X-05, architecture s9). Signed out: to the login page and back here.
 * Signed in: a 60 s single-use code bound to the PKCE challenge, sent to the extension's
 * chromiumapp.org (Chrome) or extensions.allizom.org (Firefox) redirect. A bad redirect_uri gets
 * a 400, never a redirect.
 */
export const GET = async ({ url, locals }) => {
  const q = ROUTES['ext.connect'].query.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return errorResponse('invalid_query', 'Missing or malformed sign-in parameters.', q.error.issues);
  if (!isAllowedRedirect(q.data.redirect_uri)) return errorResponse('invalid_redirect_uri', 'This extension is not allowed to sign in here.');
  if (!locals.user || locals.apiToken) redirect(302, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  const code = await issueCode(db, { userId: locals.user.id, codeChallenge: q.data.code_challenge, redirectUri: q.data.redirect_uri });
  // Allowed above: https://<allowed extension id>.chromiumapp.org/cb or the Firefox form only.
  redirect(302, redirectWithCode(q.data.redirect_uri, code, q.data.state), { external: [new URL(q.data.redirect_uri).origin] });
};
