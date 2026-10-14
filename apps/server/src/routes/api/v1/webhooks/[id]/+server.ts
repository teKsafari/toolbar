import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { webhook } from '#lib/server/db/schema/index.ts';
import { hookById, updateHook } from '#lib/server/webhooks/index.ts';
import { eq } from 'drizzle-orm';

export const PATCH = apiRoute(ROUTES['webhooks.update'], async ({ event, params, body }) => {
  const h = await hookById(db, params.id);
  await workspaceFor(db, event, h.organizationId, 'admin');
  return updateHook(db, h, body);
});

export const DELETE = apiRoute(ROUTES['webhooks.delete'], async ({ event, params }) => {
  const h = await hookById(db, params.id);
  await workspaceFor(db, event, h.organizationId, 'admin');
  await db.delete(webhook).where(eq(webhook.id, h.id));
  return { ok: true as const };
});
