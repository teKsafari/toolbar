// The embed's script tag source (D-210): <script src="<server>/embed.js" data-key="tbk_...">.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { embedFileResponse } from '#lib/server/embed/files.ts';

export const GET: RequestHandler = async ({ request }) => {
  const r = await embedFileResponse('embed.js', request);
  if (!r) error(404, { message: 'This server has no embed build. Run pnpm --filter @open-toolbar/embed build.' });
  return r;
};
