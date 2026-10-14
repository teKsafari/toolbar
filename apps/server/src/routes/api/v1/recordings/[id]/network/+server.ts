import { ROUTES } from '@toolbar/shared/api';
import { queryNetwork } from '@toolbar/shared/derive';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { assertDevtools, requirePrepared } from '#lib/server/mcp/data.ts';

export const GET = apiRoute(ROUTES['captures.network'], async ({ event, params, query }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'viewer' });
  assertDevtools(a);
  return queryNetwork(await requirePrepared(db, a.rec), query);
});
