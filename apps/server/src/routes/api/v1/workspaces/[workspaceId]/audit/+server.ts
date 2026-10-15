import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { env } from '#lib/server/env.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { listAudit } from '#lib/server/dashboard/workspace.ts';

// J-178. Audit logs are paused unless FEATURE_ADMIN_EXTRAS is on (docs/scope.md): the route
// answers 503 unavailable, as ai-draft does with FEATURE_AI off.
export const GET = apiRoute(ROUTES['workspaces.audit'], async ({ event, params, query }) => {
  if (!env.features.adminExtras) fail('unavailable', 'Audit logs are paused on this server (FEATURE_ADMIN_EXTRAS is off)');
  await workspaceFor(db, event, params.workspaceId, 'admin');
  return listAudit(db, params.workspaceId, query);
});
