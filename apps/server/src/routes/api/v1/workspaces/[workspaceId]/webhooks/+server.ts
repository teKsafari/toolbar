import { ROUTES } from '@toolbar/shared/api';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { createHook, listHooks } from '#lib/server/webhooks/index.ts';

// J-142
export const GET = apiRoute(ROUTES['webhooks.list'], async ({ event, params }) => {
  await workspaceFor(db, event, params.workspaceId, 'admin');
  return { items: await listHooks(db, params.workspaceId) };
});

export const POST = apiRoute(ROUTES['webhooks.create'], async ({ event, params, body }) => {
  const { userId } = await workspaceFor(db, event, params.workspaceId, 'admin');
  return json(await createHook(db, params.workspaceId, userId, body), { status: 201 });
});
