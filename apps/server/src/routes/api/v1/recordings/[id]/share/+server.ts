import { eq } from 'drizzle-orm';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { recording, shareLink } from '#lib/server/db/schema/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { shareSettings } from '#lib/server/share/settings.ts';

export const GET = apiRoute(ROUTES['sharing.get'], async ({ event, params }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'member' });
  return shareSettings(db, a.rec, a.userId);
});

export const PATCH = apiRoute(ROUTES['sharing.update'], async ({ event, params, body }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'member', role: 'creator', own: true });
  await db.update(recording).set({ access: body.access }).where(eq(recording.id, a.rec.id));
  await db.update(shareLink).set({ access: body.access }).where(eq(shareLink.recordingId, a.rec.id));
  return shareSettings(db, { ...a.rec, access: body.access }, a.userId);
});
