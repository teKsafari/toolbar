import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { finalizeCapture } from '#lib/server/upload/service.ts';

export const POST = apiRoute(ROUTES['captures.finalize'], async ({ event, params, body }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'upload', role: 'creator', own: true });
  return finalizeCapture(db, a.rec, body, { userId: a.userId });
});
