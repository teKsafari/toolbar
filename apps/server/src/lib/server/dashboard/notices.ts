// Capture lifecycle notices: when a capture is created (finalized) or deleted, send the
// workspace's webhooks (J-142), write the audit log (J-178), email the owner of the recording
// link it came through (J-017, J-126), and store issue references in its text (J-241).
// A sweep every two seconds compares recording rows with `capture_notice`, so no other
// area has to call in. `auto-delete` (J-178) archives captures older than a workspace's limit.
import { and, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { PRODUCT_NAME } from '@toolbar/shared';
import type { WebhookPayload } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { captureNotice, job, organization, recording, recordingLink, user } from '../db/schema/index.ts';
import { enqueue } from '../jobs/queue.ts';
import { sendMail } from '../mail.ts';
import { recordingLinkUsedMail } from '../mail-templates/index.ts';
import { dispatch } from '../webhooks/index.ts';
import { syncTextRefs } from '../integrations/index.ts';
import { deleteCapture } from '../upload/service.ts';
import { readSettings } from '../auth/workspaces.ts';
import { audit, captureUrl, emailAllowed, mediaUrl, personOf, type RecordingRow } from './core.ts';

export const NOTICE_EVERY_MS = 2000;

function capturePayload(r: RecordingRow): WebhookPayload['data']['capture'] {
  const media: string[] = [];
  if (r.kind === 'screenshot') media.push(mediaUrl(r.id, 'screenshot'));
  else media.push(mediaUrl(r.id, 'video'));
  if (r.thumbKey) media.push(mediaUrl(r.id, 'thumb'));
  return {
    id: r.id,
    kind: r.kind,
    source: r.source,
    title: r.title,
    url: captureUrl(r.id),
    pageUrl: r.pageUrl,
    author: personOf({ id: r.authorUserId, name: r.authorName, email: r.authorEmail }),
    env: (r.env as WebhookPayload['data']['capture']['env']) ?? null,
    mediaUrls: media,
    createdAt: (r.finalizedAt ?? r.createdAt).toISOString(),
  };
}

export async function onCreated(db: Db, r: RecordingRow) {
  await dispatch(db, r.organizationId, 'capture.created', { capture: capturePayload(r) });
  await audit(db, { workspaceId: r.organizationId, actorId: r.authorUserId, action: 'capture.created', target: { type: 'capture', id: r.id, label: r.title || null }, details: { kind: r.kind, source: r.source } });
  await syncTextRefs(db, r).catch(() => {});
  if (r.recordingLinkId) {
    const [l] = await db
      .select({ name: recordingLink.name, createdBy: recordingLink.createdBy, email: user.email })
      .from(recordingLink)
      .leftJoin(user, eq(user.id, recordingLink.createdBy))
      .where(eq(recordingLink.id, r.recordingLinkId));
    if (l?.email && l.createdBy && (await emailAllowed(db, l.createdBy, 'recordingLinkUsed'))) {
      const note = (r.metadata as { note?: string } | null)?.note ?? (r.description || null);
      const m = recordingLinkUsedMail({ linkName: l.name || 'Recording link', captureUrl: captureUrl(r.id), note, product: PRODUCT_NAME });
      await sendMail(l.email, m.subject, m.text, m.html).catch((e) => console.warn('[dashboard] link-used mail failed', e));
    }
  }
}

export async function onDeleted(db: Db, r: RecordingRow) {
  await dispatch(db, r.organizationId, 'capture.deleted', { capture: capturePayload(r) });
}

/** One pass: new creations and deletions since the last pass. */
export async function sweepNotices(db: Db) {
  const created = await db
    .select({ r: recording })
    .from(recording)
    .leftJoin(captureNotice, eq(captureNotice.recordingId, recording.id))
    .where(and(isNotNull(recording.finalizedAt), isNull(captureNotice.createdSentAt), gt(recording.finalizedAt, sql`now() - interval '1 day'`)))
    .limit(50);
  let nc = 0;
  for (const { r } of created) {
    // The insert is the claim: only the process whose write lands sends the notice.
    const won = await db
      .insert(captureNotice)
      .values({ recordingId: r.id, organizationId: r.organizationId, createdSentAt: new Date() })
      .onConflictDoUpdate({ target: captureNotice.recordingId, set: { createdSentAt: new Date() }, setWhere: isNull(captureNotice.createdSentAt) })
      .returning({ id: captureNotice.recordingId });
    if (!won.length) continue;
    nc++;
    await onCreated(db, r).catch((e) => console.warn('[dashboard] created notice failed', e));
  }
  const deleted = await db
    .select({ r: recording })
    .from(recording)
    .innerJoin(captureNotice, eq(captureNotice.recordingId, recording.id))
    .where(and(isNotNull(recording.deletedAt), isNull(captureNotice.deletedSentAt)))
    .limit(50);
  let nd = 0;
  for (const { r } of deleted) {
    const won = await db
      .update(captureNotice)
      .set({ deletedSentAt: new Date() })
      .where(and(eq(captureNotice.recordingId, r.id), isNull(captureNotice.deletedSentAt)))
      .returning({ id: captureNotice.recordingId });
    if (!won.length) continue;
    nd++;
    await onDeleted(db, r).catch((e) => console.warn('[dashboard] deleted notice failed', e));
  }
  return { created: nc, deleted: nd };
}

/** Mark everything that exists now as already announced (first start on an existing database). */
export async function baselineNotices(db: Db) {
  await db.execute(sql`
    INSERT INTO capture_notice (recording_id, organization_id, created_sent_at, deleted_sent_at)
    SELECT id, organization_id, now(), CASE WHEN deleted_at IS NOT NULL THEN now() END FROM recording
    WHERE finalized_at IS NOT NULL AND finalized_at < now() - interval '1 day'
    ON CONFLICT DO NOTHING`);
}

/** J-178: archive captures older than the workspace's auto-delete days. */
export async function autoDelete(db: Db) {
  const orgs = await db.select({ id: organization.id, settings: organization.settings }).from(organization);
  let n = 0;
  for (const o of orgs) {
    const days = readSettings(o.settings).autoDeleteDays;
    if (!days) continue;
    const cutoff = new Date(Date.now() - days * 86_400_000);
    const old = await db
      .select()
      .from(recording)
      .where(and(eq(recording.organizationId, o.id), isNull(recording.deletedAt), lt(recording.createdAt, cutoff), or(isNotNull(recording.finalizedAt), lt(recording.createdAt, cutoff))))
      .limit(200);
    for (const r of old) {
      await deleteCapture(db, r);
      await audit(db, { workspaceId: o.id, actorId: null, action: 'capture.deleted', target: { type: 'capture', id: r.id, label: r.title || null }, details: { reason: 'auto-delete', days } });
      n++;
    }
  }
  return n;
}

/** One pending row per recurring dashboard job. */
export async function ensureDashboardJobs(db: Db) {
  for (const type of ['auto-delete'] as const) {
    const [row] = await db
      .select({ id: job.id })
      .from(job)
      .where(and(eq(job.type, type), isNull(job.doneAt)))
      .limit(1);
    if (!row) await enqueue(db, type, {}, { maxAttempts: 1000 });
  }
}

export async function scheduleNext(db: Db, type: 'auto-delete', ms: number) {
  await enqueue(db, type, {}, { runAt: new Date(Date.now() + ms), maxAttempts: 1000 });
}
