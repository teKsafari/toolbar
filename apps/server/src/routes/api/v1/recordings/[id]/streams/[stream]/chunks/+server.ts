import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { listChunks } from '#lib/server/upload/service.ts';

export const GET = apiRoute(ROUTES['captures.listChunks'], async ({ event, params }) => {
  await captureAccess(db, event, params.id, { mode: 'upload', own: true });
  return listChunks(db, params.id, params.stream);
});
