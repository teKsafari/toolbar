import { ROUTES } from '@toolbar/shared/api';
import { querySocketFrames } from '@toolbar/shared/derive';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { assertDevtools, requirePrepared } from '#lib/server/mcp/data.ts';

export const GET = apiRoute(ROUTES['captures.socketFrames'], async ({ event, params, query }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'viewer' });
  assertDevtools(a);
  const page = querySocketFrames(await requirePrepared(db, a.rec), params.rid, query);
  return page ?? fail('not_found', 'No WebSocket or EventSource row with that rid.');
});
