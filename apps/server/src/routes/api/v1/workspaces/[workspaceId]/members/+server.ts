import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { listMembers } from '#lib/server/dashboard/workspace.ts';

// J-173: members with role and last activity; also the mention picker source.
export const GET = apiRoute(ROUTES['members.list'], async ({ event, params, query }) => {
  await workspaceFor(db, event, params.workspaceId, 'viewer');
  return { items: await listMembers(db, params.workspaceId, query.q) };
});
