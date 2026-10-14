import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { listAudit } from '#lib/server/dashboard/workspace.ts';

// J-178
export const GET = apiRoute(ROUTES['workspaces.audit'], async ({ event, params, query }) => {
  await workspaceFor(db, event, params.workspaceId, 'admin');
  return listAudit(db, params.workspaceId, query);
});
