// Token revocation (RFC 7009): always 200 for a known client, whether or not the token existed.
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { formOf, OAuthError, revokeToken } from '#lib/server/mcp/oauth.ts';
import { preflight, withCors } from '../cors.ts';

export const POST: RequestHandler = async ({ request }) => {
  try {
    await revokeToken(db, await formOf(request), request.headers.get('authorization'));
    return withCors(new Response(null, { status: 200 }));
  } catch (e) {
    if (e instanceof OAuthError) return withCors(Response.json(e.body(), { status: e.status }));
    throw e;
  }
};
export const OPTIONS: RequestHandler = async () => preflight();
