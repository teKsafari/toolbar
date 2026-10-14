import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { asset } from '#lib/server/db/schema/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { proxyObject } from '#lib/server/media/proxy.ts';

const PUBLIC_KINDS = new Set(['avatar', 'logo']);

const handler = apiRoute(ROUTES['core.asset'], async ({ event, params }) => {
  const [a] = await db.select().from(asset).where(eq(asset.id, params.id));
  if (!a) fail('not_found', 'No such asset');
  if (a.recordingId) redirect(302, `/api/v1/recordings/${a.recordingId}/media/${a.id}`);
  if (!PUBLIC_KINDS.has(a.kind)) {
    const uid = event.locals.user?.id;
    if (!uid) fail('unauthorized');
    if (a.createdBy !== uid) fail('not_found', 'No such asset');
  }
  return proxyObject(a.s3Key, event.request, { contentType: a.contentType, cacheControl: PUBLIC_KINDS.has(a.kind) ? 'public, max-age=86400' : 'private, no-cache' });
});
export const GET = handler;
export const HEAD = handler;
