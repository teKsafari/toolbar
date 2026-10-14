// captures.get and captures.update: viewer area. DELETE (captures.delete): server-core
// (J-191 archive, J-189 draft discard).
import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { folder, recording } from '#lib/server/db/schema/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { deleteCapture } from '#lib/server/upload/service.ts';
import { fail, handle, jsonBody, memberAccess, viewerAccess } from '#lib/server/viewer/access.ts';
import { captureDetail, captureSummary } from '#lib/server/viewer/detail.ts';
import { notifyMentions } from '#lib/server/viewer/comments.ts';
import { mentionsIn } from '@toolbar/ui/viewer';

export const GET = handle(async (event) => {
  const ctx = await viewerAccess(event, event.params.id!);
  return json(await captureDetail(ctx));
});

export const PATCH = handle(async (event) => {
  const ctx = await memberAccess(event, event.params.id!, 'creator');
  const body = await jsonBody(event.request, ROUTES['captures.update'].body);
  if (body.folderId) {
    const [f] = await db.select().from(folder).where(eq(folder.id, body.folderId)).limit(1);
    if (!f || f.organizationId !== ctx.rec.organizationId) fail(422, 'invalid_body', 'Unknown folder');
  }
  const patch: Partial<typeof recording.$inferInsert> = {};
  if (body.title !== undefined) patch.title = body.title.trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.folderId !== undefined) patch.folderId = body.folderId;
  const [rec] = Object.keys(patch).length ? await db.update(recording).set(patch).where(eq(recording.id, ctx.rec.id)).returning() : [ctx.rec];
  if (body.description !== undefined) {
    const before = new Set(mentionsIn(ctx.rec.description));
    const added = mentionsIn(body.description).filter((id) => !before.has(id));
    void notifyMentions({ ...ctx, rec: rec! }, null, added, 'the description').catch(() => {});
  }
  return json(await captureSummary(rec!, ctx));
});

export const DELETE = apiRoute(ROUTES['captures.delete'], async ({ event, params }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'upload', role: 'creator', own: true });
  return deleteCapture(db, a.rec);
});
