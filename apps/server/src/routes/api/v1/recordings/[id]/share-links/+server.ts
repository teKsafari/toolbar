import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { mintShareLink, shareLinkDtos } from '#lib/server/share/tokens.ts';

export const POST = apiRoute(ROUTES['sharing.createLink'], async ({ event, params, body }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'member', role: 'creator', own: true });
  const { row } = await mintShareLink(db, a.rec.id, {
    access: body.access ?? a.rec.access,
    devtools: body.devtools,
    expiresInDays: body.expiresInDays,
    createdBy: a.userId,
  });
  return (await shareLinkDtos(db, [row])).get(row.id)!;
});
