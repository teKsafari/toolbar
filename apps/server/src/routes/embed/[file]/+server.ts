// The embed's other files (D-210): fonts, lazy chunks, the source map and open-toolbar-embed.tgz.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { embedFileResponse } from '#lib/server/embed/files.ts';

export const GET: RequestHandler = async ({ params, request }) => {
  const r = await embedFileResponse(params.file, request);
  if (!r) error(404, { message: 'Not found' });
  return r;
};
