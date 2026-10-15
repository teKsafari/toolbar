// GET /api/v1/recordings/:id/folder/files: what the feedback folder holds, its README and the pull command.
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { folderOf } from '#lib/server/handoff/folder.ts';
import { folderCapture, folderIndex } from '#lib/server/handoff/http.ts';

export const GET = apiRoute(ROUTES['handoff.folderIndex'], async ({ event, params }) => {
  const rec = await folderCapture(event, params.id);
  return folderIndex((await folderOf(db, rec)).folder);
});
