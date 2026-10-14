import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { hookById, listDeliveries } from '#lib/server/webhooks/index.ts';

export const GET = apiRoute(ROUTES['webhooks.deliveries'], async ({ event, params, query }) => {
  const h = await hookById(db, params.id);
  await workspaceFor(db, event, h.organizationId, 'admin');
  return listDeliveries(db, h.id, query);
});
