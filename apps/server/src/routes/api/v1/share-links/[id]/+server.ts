import { eq } from 'drizzle-orm';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { shareLink } from '#lib/server/db/schema/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';

export const DELETE = apiRoute(ROUTES['sharing.revokeLink'], async ({ event, params }) => {
  const [link] = await db.select().from(shareLink).where(eq(shareLink.id, params.id));
  if (!link) fail('not_found', 'No such link');
  await captureAccess(db, event, link.recordingId, { mode: 'member', role: 'creator', own: true });
  if (!link.revokedAt) await db.update(shareLink).set({ revokedAt: new Date() }).where(eq(shareLink.id, link.id));
  return { ok: true as const };
});
