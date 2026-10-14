import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { revokeGrant } from '#lib/server/mcp/oauth.ts';

// Remove a connected agent: its tokens stop working at once (J-147).
export const DELETE = apiRoute(ROUTES['agent.removeClient'], async ({ event, params }) => {
  if (!(await revokeGrant(db, event.locals.user!.id, params.id))) fail('not_found', 'No such connected agent.');
  return { ok: true as const };
});
