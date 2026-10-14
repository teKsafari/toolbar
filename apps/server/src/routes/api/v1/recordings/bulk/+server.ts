import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { seatOf } from '#lib/server/share/access.ts';
import { requireUserId } from '#lib/server/dashboard/core.ts';
import { bulkDelete, bulkMove, changeable } from '#lib/server/dashboard/captures.ts';

// J-165, J-166: move or delete the selection. Admins change any capture, creators their own.
export const POST = apiRoute(ROUTES['captures.bulk'], async ({ event, body }) => {
  const userId = requireUserId(event);
  const { recs, ok } = await changeable(db, body.ids, userId, (ws) => seatOf(db, userId, ws));
  if (!recs.length) fail('not_found', 'None of these captures exist');
  if (!ok.length) fail('forbidden', 'You can only change your own captures');
  const updated = body.action === 'move' ? await bulkMove(db, ok, body.folderId, userId) : await bulkDelete(db, ok, userId);
  return { updated };
});
