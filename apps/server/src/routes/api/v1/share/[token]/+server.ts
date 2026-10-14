import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { resolveShareFor } from '#lib/server/share/settings.ts';

export const GET = apiRoute(ROUTES['sharing.resolve'], async ({ event, params }) => {
  const { link, rec } = await resolveShareFor(db, event, params.token);
  return { recordingId: rec.id, access: rec.access, devtools: link.devtools, expiresAt: link.expiresAt?.toISOString() ?? null };
});
