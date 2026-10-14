import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { requireSeat } from '#lib/server/share/access.ts';
import { authorSnapshot, createCaptureRecord } from '#lib/server/upload/service.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { listCaptures } from '#lib/server/dashboard/captures.ts';
import { json } from '@sveltejs/kit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST: server-core (X-01). Idempotent on clientId: 201 first time, 200 with the same id after.
export const POST = apiRoute(ROUTES['captures.create'], async ({ event, body }) => {
  if (!UUID.test(body.workspaceId)) fail('invalid_body', 'workspaceId is not an id');
  const { userId } = await requireSeat(db, event, body.workspaceId, 'creator');
  const r = await createCaptureRecord(db, {
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
  const ctx = await workspaceFor(db, event, query.workspaceId);
  return listCaptures(db, query, ctx);
});
