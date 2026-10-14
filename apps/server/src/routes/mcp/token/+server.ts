// Token endpoint: authorization_code with PKCE, and refresh_token with rotation (J-146).
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { formOf, OAuthError, tokenRequest } from '#lib/server/mcp/oauth.ts';
import { preflight, withCors } from '../cors.ts';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const out = await tokenRequest(db, await formOf(request), request.headers.get('authorization'));
    return withCors(Response.json(out, { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }));
  } catch (e) {
    if (e instanceof OAuthError) return withCors(Response.json(e.body(), { status: e.status, headers: { 'cache-control': 'no-store' } }));
    throw e;
  }
};
export const OPTIONS: RequestHandler = async () => preflight();
