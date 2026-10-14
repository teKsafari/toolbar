import { ROUTES } from '@toolbar/shared/api';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { hookById, testHook, toDelivery } from '#lib/server/webhooks/index.ts';

export const POST = apiRoute(ROUTES['webhooks.test'], async ({ event, params }) => {
  const h = await hookById(db, params.id);
  await workspaceFor(db, event, h.organizationId, 'admin');
  return json(toDelivery(await testHook(db, h)), { status: 201 });
});
