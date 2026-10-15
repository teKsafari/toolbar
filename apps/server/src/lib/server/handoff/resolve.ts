// Resolving feedback (PLAN: the agent marks the feedback resolved when done). One row in
// feedback_resolution per resolved capture; resolving fires the feedback.resolved webhook.
import { eq } from 'drizzle-orm';
import type { Resolution } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { feedbackResolution, user } from '../db/schema/index.ts';
import type { RecordingRow } from '../share/access.ts';
import { dispatch } from '../webhooks/index.ts';
import { capturePayload } from '../dashboard/notices.ts';
import { feedbackPayload } from './payload.ts';

type Row = typeof feedbackResolution.$inferSelect;

export function toResolution(r: Row | undefined | null): Resolution {
  if (!r) return { resolved: false, resolvedAt: null, resolvedBy: null, note: null, commit: null, via: null };
  return {
    resolved: true,
    resolvedAt: r.resolvedAt.toISOString(),
    resolvedBy: { id: r.resolvedBy, name: r.resolvedByName, email: r.resolvedByEmail },
    note: r.note,
    commit: r.commit,
    via: r.via,
  };
}

export async function resolutionOf(db: Db, recId: string): Promise<Resolution> {
  const [r] = await db.select().from(feedbackResolution).where(eq(feedbackResolution.recordingId, recId));
  return toResolution(r);
}

/**
 * Mark the feedback resolved (again: a second call replaces the note and commit). `via` names the
 * MCP client, "API" or "browser".
 */
export async function resolveFeedback(db: Db, rec: RecordingRow, userId: string, body: { note?: string; commit?: string }, via: string): Promise<Resolution> {
  const [u] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId));
  const values = {
    recordingId: rec.id,
    resolvedAt: new Date(),
    resolvedBy: userId,
    resolvedByName: u?.name ?? null,
    resolvedByEmail: u?.email ?? null,
    note: body.note?.trim() || null,
    commit: body.commit?.trim() || null,
    via,
  };
  const [row] = await db
    .insert(feedbackResolution)
    .values(values)
    .onConflictDoUpdate({ target: feedbackResolution.recordingId, set: values })
    .returning();
  const res = toResolution(row);
  await dispatch(db, rec.organizationId, 'feedback.resolved', {
    capture: capturePayload(rec),
    feedback: feedbackPayload(rec.id, {
      resolvedAt: res.resolvedAt!,
      resolvedBy: { id: userId, name: u?.name ?? u?.email ?? 'Unknown', email: u?.email ?? null, image: null },
      note: res.note,
      commit: res.commit,
      via,
    }),
  });
  return res;
}

export async function reopenFeedback(db: Db, recId: string): Promise<void> {
  await db.delete(feedbackResolution).where(eq(feedbackResolution.recordingId, recId));
}
