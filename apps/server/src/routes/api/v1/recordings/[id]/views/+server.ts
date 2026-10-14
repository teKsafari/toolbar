// captures.view: one row per viewer per capture (recently viewed, first-view email).
import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { captureView } from '#lib/server/db/schema/index.ts';
import { anonKeyOf, handle, viewerAccess } from '#lib/server/viewer/access.ts';

export const POST = handle(async (event) => {
  const ctx = await viewerAccess(event, event.params.id!);
  const actor = ctx.actor ?? `a:${anonKeyOf(event.cookies, true)}`;
  await db
    .insert(captureView)
    .values({ recordingId: ctx.rec.id, viewer: actor, userId: ctx.user?.id ?? null })
    .onConflictDoUpdate({ target: [captureView.recordingId, captureView.viewer], set: { lastAt: new Date(), count: sql`${captureView.count} + 1` } });
  return json({ ok: true });
});
