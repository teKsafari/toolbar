import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { requireUserId } from '#lib/server/dashboard/core.ts';
import { deleteFolder, folderFor, toFolders, updateFolder } from '#lib/server/dashboard/folders.ts';

export const GET = apiRoute(ROUTES['folders.get'], async ({ event, params }) => {
  const userId = requireUserId(event);
  const { f, seat } = await folderFor(db, params.id, userId);
  return (await toFolders(db, [f], { userId, seat }))[0]!;
});

// J-164 rename; J-237 private
export const PATCH = apiRoute(ROUTES['folders.update'], async ({ event, params, body }) => {
  const userId = requireUserId(event);
  const { f, seat } = await folderFor(db, params.id, userId, 'creator');
  const u = await updateFolder(db, f, body);
  return (await toFolders(db, [u], { userId, seat }))[0]!;
});

// J-164: the folder and its captures go.
export const DELETE = apiRoute(ROUTES['folders.delete'], async ({ event, params }) => {
  const userId = requireUserId(event);
  const { f } = await folderFor(db, params.id, userId, 'creator');
  const deletedCaptures = await deleteFolder(db, f, userId);
  return { ok: true as const, deletedCaptures };
});
