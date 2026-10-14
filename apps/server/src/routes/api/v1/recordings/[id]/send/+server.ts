import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { integrationById, sendCapture } from '#lib/server/integrations/index.ts';

// J-138: file an existing capture to a connected app.
export const POST = apiRoute(ROUTES['integrations.send'], async ({ event, params, body }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'member', role: 'creator' });
  const r = await integrationById(db, body.integrationId);
  return sendCapture(db, a.rec, r, body.fields, a.userId);
});
