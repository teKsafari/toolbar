// /s/<token>.md: the markdown summary of a shared capture (J-153).
import type { RequestHandler } from './$types';
import { shareMarkdownResponse } from '#lib/server/mcp/markdown.ts';

export const GET: RequestHandler = async ({ params, locals }) => shareMarkdownResponse(params.token, locals.user?.id ?? null);
