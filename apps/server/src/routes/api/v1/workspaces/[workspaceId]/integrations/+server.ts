import { ROUTES } from '@toolbar/shared/api';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { connect, listIntegrations } from '#lib/server/integrations/index.ts';

// J-139, J-251: connections belong to the workspace.
export const GET = apiRoute(ROUTES['integrations.list'], async ({ event, params }) => {
  await workspaceFor(db, event, params.workspaceId, 'viewer');
  return { items: await listIntegrations(db, params.workspaceId) };
});

export const POST = apiRoute(ROUTES['integrations.connect'], async ({ event, params, body }) => {
  const { userId } = await workspaceFor(db, event, params.workspaceId, 'admin');
  return json(await connect(db, params.workspaceId, userId, body), { status: 201 });
});
