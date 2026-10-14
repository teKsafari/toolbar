// Discovery document, also under a path suffix (/.well-known/.../mcp) that clients try first.
import type { RequestHandler } from './$types';
import { protectedResourceMetadata } from '#lib/server/mcp/oauth.ts';
import { preflight, withCors } from '../../../mcp/cors.ts';

export const GET: RequestHandler = async () => withCors(Response.json(protectedResourceMetadata()));
export const OPTIONS: RequestHandler = async () => preflight();
