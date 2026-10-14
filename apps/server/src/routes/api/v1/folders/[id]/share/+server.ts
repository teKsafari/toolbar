import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { requireUserId } from '#lib/server/dashboard/core.ts';
import { folderFor, folderShare, updateFolderShare } from '#lib/server/dashboard/folders.ts';

// J-122: folder link, who has access, invite by email, general access.
export const GET = apiRoute(ROUTES['folders.getShare'], async ({ event, params }) => {
  const { f } = await folderFor(db, params.id, requireUserId(event));
  return folderShare(db, f);
});

export const PATCH = apiRoute(ROUTES['folders.updateShare'], async ({ event, params, body }) => {
  const userId = requireUserId(event);
  const { f } = await folderFor(db, params.id, userId, 'creator');
  return updateFolderShare(db, f, { id: userId, name: event.locals.user?.name ?? 'A teammate' }, body);
});
