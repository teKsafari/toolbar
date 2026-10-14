// captures.view: one row per viewer per capture (recently viewed, first-view email).
import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { captureView } from '#lib/server/db/schema/index.ts';
import { anonKeyOf, handle, viewerAccess } from '#lib/server/viewer/access.ts';
import { notifyFirstView } from '#lib/server/dashboard/notices.ts';

export const POST = handle(async (event) => {
  const ctx = await viewerAccess(event, event.params.id!);
  const actor = ctx.actor ?? `a:${anonKeyOf(event.cookies, true)}`;
  await db
    .insert(captureView)
    .values({ recordingId: ctx.rec.id, viewer: actor, userId: ctx.user?.id ?? null })
    .onConflictDoUpdate({ target: [captureView.recordingId, captureView.viewer], set: { lastAt: new Date(), count: sql`${captureView.count} + 1` } });
  // J-136: the author hears about the first view by someone else (unless they turned it off)
  void notifyFirstView(db, ctx.rec, { actor, userId: ctx.user?.id ?? null, name: ctx.user?.name ?? null }).catch((e) => console.warn('[viewer] first-view mail failed', e));
  return json({ ok: true });
});
