import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { integrationById, options } from '#lib/server/integrations/index.ts';

// J-140: repos, labels, assignees and milestones from the tracker API.
export const GET = apiRoute(ROUTES['integrations.options'], async ({ event, params, query }) => {
  const r = await integrationById(db, params.id);
  await workspaceFor(db, event, r.organizationId, 'creator');
  return options(db, r, query);
});
