import { ROUTES } from '@toolbar/shared/api';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { createLink, listLinks, toLinks } from '#lib/server/dashboard/links.ts';

// J-167: status, sort and creator filters.
export const GET = apiRoute(ROUTES['recordingLinks.list'], async ({ event, params, query }) => {
  const ctx = await workspaceFor(db, event, params.workspaceId, 'viewer');
  return listLinks(db, params.workspaceId, query, ctx);
});

// J-015, J-167: the client copies `url` at once.
export const POST = apiRoute(ROUTES['recordingLinks.create'], async ({ event, params, body }) => {
  const ctx = await workspaceFor(db, event, params.workspaceId, 'creator');
  const l = await createLink(db, params.workspaceId, ctx.userId, body);
  return json((await toLinks(db, [l], ctx))[0], { status: 201 });
});
