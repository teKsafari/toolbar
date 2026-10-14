import { eq } from 'drizzle-orm';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { recording } from '#lib/server/db/schema/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { statusStream } from '#lib/server/upload/status.ts';

export const GET = apiRoute(ROUTES['captures.status'], async ({ event, params }) => {
  await captureAccess(db, event, params.id, { mode: 'viewer' });
  const read = async () => {
    const [r] = await db
      .select({ status: recording.status, progress: recording.processingProgress, error: recording.processingError, deletedAt: recording.deletedAt })
      .from(recording)
      .where(eq(recording.id, params.id));
    return r ?? null;
  };
  return statusStream(read, event.request.signal);
});
