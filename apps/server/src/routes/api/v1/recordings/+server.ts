import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { folderGuestRole, requireSeat, seatOf } from '#lib/server/share/access.ts';
import { folder } from '#lib/server/db/schema/index.ts';
import { eq } from 'drizzle-orm';
import { authorSnapshot, createCaptureRecord } from '#lib/server/upload/service.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { listCaptures } from '#lib/server/dashboard/captures.ts';
import { json } from '@sveltejs/kit';
import { projectForCapture } from '#lib/server/projects.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST: server-core (X-01). Idempotent on clientId: 201 first time, 200 with the same id after.
export const POST = apiRoute(ROUTES['captures.create'], async ({ event, body }) => {
  if (!UUID.test(body.workspaceId)) fail('invalid_body', 'workspaceId is not an id');
  const { userId } = await requireSeat(db, event, body.workspaceId, 'creator');
  // D-118: the page must be on an origin of one of the workspace's projects
  const proj = await projectForCapture(db, body.workspaceId, { pageUrl: body.page?.url, kind: body.kind });
  // D-119: the preset the browser applied, else the project's
  const applied = (body.env as { maskingPreset?: 'staging' | 'production' | 'none' } | undefined)?.maskingPreset;
  const r = await createCaptureRecord(db, {
    projectId: proj?.id ?? null,
    maskingPreset: applied ?? proj?.maskingPreset ?? null,
    organizationId: body.workspaceId,
    clientId: body.clientId,
    kind: body.kind,
    folderId: body.folderId ?? null,
    page: body.page,
    startedAt: body.startedAt,
    env: body.env,
    durationMs: body.durationMs,
    source: body.source,
    author: await authorSnapshot(db, userId),
  });
  return json({ id: r.id, shareUrl: r.shareUrl }, { status: r.created ? 201 : 200 });
});

// GET (list): dashboard area (J-158, J-160, J-203).
export const GET = apiRoute(ROUTES['captures.list'], async ({ event, query }) => {
  // a folder guest (J-122) lists the one folder they were invited to, as a viewer
  if (query.folderId && UUID.test(query.folderId) && event.locals.user) {
    const [f] = await db.select({ ws: folder.organizationId }).from(folder).where(eq(folder.id, query.folderId)).limit(1);
    const userId = event.locals.user.id;
    if (f && (!query.workspaceId || query.workspaceId === f.ws) && !(await seatOf(db, userId, f.ws)) && (await folderGuestRole(db, userId, query.folderId)))
      return listCaptures(db, query, { workspaceId: f.ws, userId, seat: 'viewer' });
  }
  const ctx = await workspaceFor(db, event, query.workspaceId);
  return listCaptures(db, query, ctx);
});
