import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { integrationById, remove, update } from '#lib/server/integrations/index.ts';

export const PATCH = apiRoute(ROUTES['integrations.update'], async ({ event, params, body }) => {
  const r = await integrationById(db, params.id);
  await workspaceFor(db, event, r.organizationId, 'admin');
  return update(db, r, body);
});

export const DELETE = apiRoute(ROUTES['integrations.remove'], async ({ event, params }) => {
  const r = await integrationById(db, params.id);
  const { userId } = await workspaceFor(db, event, r.organizationId, 'admin');
  await remove(db, r, userId);
  return { ok: true as const };
});
