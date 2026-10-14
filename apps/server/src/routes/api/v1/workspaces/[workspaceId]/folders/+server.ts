import { ROUTES } from '@toolbar/shared/api';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { createFolder, listFolders, toFolders } from '#lib/server/dashboard/folders.ts';

export const GET = apiRoute(ROUTES['folders.list'], async ({ event, params }) => {
  const ctx = await workspaceFor(db, event, params.workspaceId, 'viewer');
  return { items: await listFolders(db, params.workspaceId, ctx) };
});

export const POST = apiRoute(ROUTES['folders.create'], async ({ event, params, body }) => {
  const ctx = await workspaceFor(db, event, params.workspaceId, 'creator');
  const f = await createFolder(db, params.workspaceId, ctx.userId, body);
  return json((await toFolders(db, [f], ctx))[0], { status: 201 });
});
