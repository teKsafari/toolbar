import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { eraseWorkspace, updateWorkspace, workspaceDetail } from '#lib/server/dashboard/workspace.ts';

export const GET = apiRoute(ROUTES['workspaces.get'], async ({ event, params }) => {
  const { userId } = await workspaceFor(db, event, params.workspaceId, 'viewer');
  return workspaceDetail(db, params.workspaceId, userId);
});

// J-120, J-156, J-172, J-173, J-178, J-222: settings save at once, nothing is plan-gated.
export const PATCH = apiRoute(ROUTES['workspaces.update'], async ({ event, params, body }) => {
  const { userId } = await workspaceFor(db, event, params.workspaceId, 'admin');
  return updateWorkspace(db, params.workspaceId, userId, body);
});

// J-249: the workspace, its captures and their media go.
export const DELETE = apiRoute(ROUTES['workspaces.delete'], async ({ event, params }) => {
  await workspaceFor(db, event, params.workspaceId, 'admin');
  await eraseWorkspace(db, params.workspaceId);
  return { ok: true as const };
});
