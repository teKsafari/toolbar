import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { listGrants } from '#lib/server/mcp/oauth.ts';
import { mcpUrl } from '#lib/server/mcp/data.ts';

// Connected agents of the signed-in user (J-147) and the server URL for the setup snippets (J-145).
export const GET = apiRoute(ROUTES['agent.listClients'], async ({ event }) => {
  const items = await listGrants(db, event.locals.user!.id);
  return { items, serverUrl: mcpUrl() };
});
