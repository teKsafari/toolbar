import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { completeStream } from '#lib/server/upload/service.ts';

export const POST = apiRoute(ROUTES['captures.completeStream'], async ({ event, params, body }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'upload', role: 'creator', own: true });
  return completeStream(db, a.rec, params.stream, body);
});
