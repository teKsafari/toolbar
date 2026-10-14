import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { search } from '#lib/server/search/index.ts';

// J-161, J-228, J-150, J-241
export const GET = apiRoute(ROUTES['search.query'], async ({ event, query }) => {
  const ctx = await workspaceFor(db, event, query.workspaceId, 'viewer');
  return search(db, query, ctx);
});
