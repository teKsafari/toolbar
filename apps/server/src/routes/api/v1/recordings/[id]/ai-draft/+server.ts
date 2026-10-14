// POST /api/v1/recordings/:id/ai-draft (J-083): ghost title, summary, steps with times and a
// result for a video or replay draft. 503 unavailable when AI_PROVIDER=none, the workspace AI
// switch is off, or the provider has nothing.
import { json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import { ROUTES, aiDraftSchema, roleAtLeast, seatRoleOf } from '@toolbar/shared/api';
import { apiError, requireUser } from '#lib/server/api.ts';
import { db } from '#lib/server/db/index.ts';
import { member, organization, recording, transcript } from '#lib/server/db/schema/index.ts';
import { aiConfig, createSummarizer, workspaceAiEnabled } from '#lib/server/ai/index.ts';
import { loadEvents } from '#lib/server/ai/events.ts';
import { buildTimeline, vttText } from '#lib/server/ai/timeline.ts';

const route = ROUTES['captures.aiDraft'];

export const POST = async (event) => {
  const user = requireUser(event);
  const p = route.params!.safeParse(event.params);
  if (!p.success) return apiError(404, 'not_found', 'No such capture');
  const id = p.data.id;

  const [rec] = await db
    .select({ id: recording.id, kind: recording.kind, orgId: recording.organizationId, pageUrl: recording.pageUrl, pageTitle: recording.pageTitle, startedAt: recording.startedAt, durationMs: recording.durationMs, metadata: organization.metadata })
    .from(recording)
    .innerJoin(organization, eq(organization.id, recording.organizationId))
    .where(and(eq(recording.id, id), isNull(recording.deletedAt)))
    .limit(1);
  if (!rec) return apiError(404, 'not_found', 'No such capture');
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, rec.orgId), eq(member.userId, user.id)))
    .limit(1);
  if (!m) return apiError(404, 'not_found', 'No such capture');
  if (!roleAtLeast(seatRoleOf(m.role), route.role ?? 'creator')) return apiError(403, 'forbidden', 'Viewers cannot draft captures');
  if (rec.kind === 'screenshot') return apiError(503, 'unavailable', 'AI drafts are for videos and replays');

  const cfg = aiConfig();
  if (cfg.provider === 'none') return apiError(503, 'unavailable', 'AI is off on this server (AI_PROVIDER=none)');
  if (!workspaceAiEnabled(rec.metadata)) return apiError(503, 'unavailable', 'AI is off for this workspace');

  const events = await loadEvents(db, rec.id);
  const t0 = rec.startedAt?.getTime() ?? events[0]?.t ?? 0;
  const [tr] = await db
    .select({ vtt: transcript.vtt })
    .from(transcript)
    .where(and(eq(transcript.recordingId, rec.id), eq(transcript.status, 'done')))
    .limit(1);
  let draft;
  try {
    draft = await createSummarizer(cfg).draft({
      kind: rec.kind,
      pageUrl: rec.pageUrl,
      pageTitle: rec.pageTitle,
      durationMs: rec.durationMs,
      timeline: buildTimeline(events, t0),
      transcript: vttText(tr?.vtt),
    });
  } catch (e) {
    return apiError(503, 'unavailable', `The AI provider failed: ${(e as Error).message}`);
  }
  if (!draft) return apiError(503, 'unavailable', 'The AI provider returned nothing usable');
  return json(aiDraftSchema.parse(draft), { status: route.status ?? 200 });
};
