import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { resolveShareFor } from '#lib/server/share/settings.ts';
import { isDevtoolsMedia, serveMedia } from '#lib/server/media/proxy.ts';

const handler = apiRoute(ROUTES['sharing.media'], async ({ event, params }) => {
  const { link, rec } = await resolveShareFor(db, event, params.token);
  if (!link.devtools && isDevtoolsMedia(params.name)) fail('forbidden', 'This link does not include dev tools');
  return serveMedia(db, rec, params.name, event.request, 'private, no-cache');
});
export const GET = handler;
export const HEAD = handler;
