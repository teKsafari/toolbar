// Discovery document, also under a path suffix (/.well-known/.../mcp) that clients try first.
import type { RequestHandler } from './$types';
import { authServerMetadata } from '#lib/server/mcp/oauth.ts';
import { preflight, withCors } from '../../../mcp/cors.ts';

export const GET: RequestHandler = async () => withCors(Response.json(authServerMetadata()));
export const OPTIONS: RequestHandler = async () => preflight();
