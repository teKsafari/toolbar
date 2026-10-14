import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { onboarding } from '#lib/server/dashboard/workspace.ts';

// J-169
export const GET = apiRoute(ROUTES['dashboard.onboarding'], async ({ event, query }) => {
  const ctx = await workspaceFor(db, event, query.workspaceId);
  return onboarding(db, ctx.userId, ctx.workspaceId);
});
