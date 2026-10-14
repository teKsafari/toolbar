import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { recent } from '#lib/server/search/index.ts';

// J-161: recently viewed rows for the empty palette.
export const GET = apiRoute(ROUTES['search.recent'], async ({ event, query }) => {
  const ctx = await workspaceFor(db, event, query.workspaceId, 'viewer');
  return { items: await recent(db, query.limit, ctx) };
});
