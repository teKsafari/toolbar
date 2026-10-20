// The source map /embed.js points at (relative to the script, so beside it).
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { embedFileResponse } from '#lib/server/embed/files.ts';

export const GET: RequestHandler = async ({ request }) => {
  const r = await embedFileResponse('embed.js.map', request);
  if (!r) error(404, { message: 'Not found' });
  return r;
};
