// Streamable HTTP MCP endpoint (J-146, J-149 to J-151). See lib/server/mcp/protocol.ts.
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { handleMcpPost, methodNotAllowed } from '#lib/server/mcp/protocol.ts';
import { preflight, withCors } from './cors.ts';

export const POST: RequestHandler = async ({ request }) => withCors(await handleMcpPost(db, request));
export const GET: RequestHandler = async () => withCors(methodNotAllowed());
export const DELETE: RequestHandler = async () => withCors(methodNotAllowed());
export const OPTIONS: RequestHandler = async () => preflight();
