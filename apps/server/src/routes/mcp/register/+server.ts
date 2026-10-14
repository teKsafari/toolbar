// Dynamic client registration (RFC 7591) for MCP clients (J-146).
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { OAuthError, registerClient } from '#lib/server/mcp/oauth.ts';
import { preflight, withCors } from '../cors.ts';

export const POST: RequestHandler = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withCors(Response.json({ error: 'invalid_client_metadata', error_description: 'Body must be JSON' }, { status: 400 }));
  }
  try {
    return withCors(Response.json(await registerClient(db, body), { status: 201, headers: { 'cache-control': 'no-store' } }));
  } catch (e) {
    if (e instanceof OAuthError) return withCors(Response.json(e.body(), { status: e.status }));
    throw e;
  }
};
export const OPTIONS: RequestHandler = async () => preflight();
