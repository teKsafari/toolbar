import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { isDevtoolsMedia, serveMedia } from '#lib/server/media/proxy.ts';
import { fail } from '#lib/server/share/http.ts';

const handler = apiRoute(ROUTES['captures.media'], async ({ event, params }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'viewer' });
  if (a.via === 'share' && a.share && !a.share.devtools && isDevtoolsMedia(params.name)) fail('forbidden', 'This link does not include dev tools');
  return serveMedia(db, a.rec, params.name, event.request);
});
export const GET = handler;
export const HEAD = handler;
