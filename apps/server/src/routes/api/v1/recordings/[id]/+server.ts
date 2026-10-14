import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { deleteCapture } from '#lib/server/upload/service.ts';

// GET and PATCH: viewer area. DELETE: server-core (J-191 archive, J-189 draft discard).
export const DELETE = apiRoute(ROUTES['captures.delete'], async ({ event, params }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'upload', role: 'creator', own: true });
  return deleteCapture(db, a.rec);
});
