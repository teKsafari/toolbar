// Feedback items of the in-page reviewer toolbar (Part 2): store a submit, list a capture's items,
// transcribe each voice note. Items attach to any capture the caller may edit: a running trace
// (still uploading) or the `feedback` capture the extension makes at submit.
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FeedbackItem, FeedbackItemInput } from '@toolbar/shared/areas/reviewer';
import { feedbackItemInputSchema } from '@toolbar/shared/areas/reviewer';
import { db as defaultDb, type Db } from '../db/index.ts';
import { asset, feedbackItem, recording } from '../db/schema/index.ts';
import { authorSnapshot } from '../auth/author.ts';
import { assetUrl } from '../upload/service.ts';
import { getBytes } from '../s3.ts';
import { createTranscriber, parseVtt, transcribeConfig } from '../transcribe/index.ts';
import { dbLedger, runTranscription } from '../transcribe/run.ts';
import { decodePcm } from '../transcribe/audio.ts';
import { enqueue } from '../jobs/queue.ts';
import { registerJob } from '../jobs/worker.ts';
import { ApiFail } from '../viewer/access.ts';

type Row = typeof feedbackItem.$inferSelect;
type RecordingRow = typeof recording.$inferSelect;

let db: Db = defaultDb;
/** Tests point the service at their own database. */
export function useFeedbackDb(d: Db) {
  db = d;
}

const fail = (status: number, code: string, message: string): never => {
  throw new ApiFail(status, code, message);
};

/** Asset kinds an item may point at, and the kind each one is stored as. */
const CROP_KIND = 'feedback';
const VOICE_KIND = 'voice-note';

/**
 * Takes the item's assets into the capture: an asset the caller uploaded without a capture, or one
 * already on this capture. Anything else (another capture, another person's upload) is refused.
 */
async function claim(rec: RecordingRow, ids: string[], userId: string) {
  if (!ids.length) return;
  const rows = await db.select().from(asset).where(inArray(asset.id, ids));
  for (const id of ids) {
    const a = rows.find((r) => r.id === id);
    if (!a) fail(422, 'invalid_body', `Asset ${id} not found`);
    if (a!.recordingId && a!.recordingId !== rec.id) fail(422, 'invalid_body', `Asset ${id} belongs to another capture`);
    if (!a!.recordingId && a!.createdBy && a!.createdBy !== userId) fail(422, 'invalid_body', `Asset ${id} was uploaded by someone else`);
  }
  await db.update(asset).set({ recordingId: rec.id }).where(inArray(asset.id, ids));
}

export async function createFeedbackItems(rec: RecordingRow, userId: string, input: FeedbackItemInput[]): Promise<FeedbackItem[]> {
  const items = input.map((i) => feedbackItemInputSchema.parse(i));
  const cropIds = items.map((i) => i.cropAssetId).filter((x): x is string => !!x);
  const voiceIds = items.map((i) => i.voiceAssetId).filter((x): x is string => !!x);
  await claim(rec, [...new Set([...cropIds, ...voiceIds])], userId);
  // a crop of a trace must not become the trace's main image: pickScreenshots reads screenshot and crop only
  if (cropIds.length) await db.update(asset).set({ kind: CROP_KIND }).where(inArray(asset.id, cropIds));
  if (voiceIds.length) await db.update(asset).set({ kind: VOICE_KIND }).where(inArray(asset.id, voiceIds));

  const who = await authorSnapshot(db, userId);
  const transcriber = createTranscriber();
  const inserted = await db
    .insert(feedbackItem)
    .values(
      items.map((i) => ({
        recordingId: rec.id,
        clientId: i.clientId,
        n: i.n,
        kind: i.kind,
        comment: i.comment,
        quote: i.quote ?? null,
        target: i.target ?? null,
        locator: i.locator ?? null,
        anchor: i.anchor ?? null,
        shapes: i.shapes,
        cropAssetId: i.cropAssetId ?? null,
        cropRect: i.cropRect ?? null,
        voiceAssetId: i.voiceAssetId ?? null,
        voiceDurationMs: i.voiceDurationMs ?? null,
        transcriptStatus: i.voiceAssetId ? (transcriber ? ('pending' as const) : ('off' as const)) : null,
        context: i.context ?? null,
        page: i.page,
        intent: i.intent,
        severity: i.severity,
        t: Math.round(i.t),
        authorUserId: userId,
        authorName: who.name,
        authorEmail: who.email,
        authorIssuer: who.issuer,
        authorSubject: who.subject,
      })),
    )
    .onConflictDoNothing({ target: [feedbackItem.recordingId, feedbackItem.clientId] })
    .returning();
  for (const row of inserted) if (row.voiceAssetId && transcriber) await enqueue(db, 'transcribe-note', { recordingId: rec.id, itemId: row.id }, { maxAttempts: 3 });
  // the whole submit, including items a retry had stored before
  const clientIds = items.map((i) => i.clientId);
  const rows = await db
    .select()
    .from(feedbackItem)
    .where(and(eq(feedbackItem.recordingId, rec.id), inArray(feedbackItem.clientId, clientIds)))
    .orderBy(asc(feedbackItem.n));
  return rows.map((r) => dto(r));
}

/** `mediaBase` is the member or share-link media proxy prefix (viewer/detail.ts). */
export async function listFeedbackItems(recordingId: string, mediaBase?: string): Promise<FeedbackItem[]> {
  const rows = await db.select().from(feedbackItem).where(eq(feedbackItem.recordingId, recordingId)).orderBy(asc(feedbackItem.n), asc(feedbackItem.createdAt));
  return rows.map((r) => dto(r, mediaBase));
}

export function vttText(vtt: string): string {
  return parseVtt(vtt)
    .map((c) => c.text.trim())
    .filter(Boolean)
    .join(' ');
}

export function dto(r: Row, mediaBase?: string): FeedbackItem {
  const media = (id: string) => (mediaBase ? `${mediaBase}/${id}` : assetUrl({ id, recordingId: r.recordingId }));
  return {
    id: r.id,
    recordingId: r.recordingId,
    clientId: r.clientId,
    n: r.n,
    kind: r.kind,
    comment: r.comment,
    ...(r.quote != null ? { quote: r.quote } : {}),
    ...(r.target ? { target: r.target as FeedbackItem['target'] } : {}),
    ...(r.locator ? { locator: r.locator as FeedbackItem['locator'] } : {}),
    ...(r.anchor ? { anchor: r.anchor as FeedbackItem['anchor'] } : {}),
    shapes: (r.shapes as FeedbackItem['shapes']) ?? [],
    ...(r.cropAssetId ? { cropAssetId: r.cropAssetId } : {}),
    ...(r.cropRect ? { cropRect: r.cropRect as FeedbackItem['cropRect'] } : {}),
    ...(r.voiceAssetId ? { voiceAssetId: r.voiceAssetId } : {}),
    ...(r.voiceDurationMs != null ? { voiceDurationMs: r.voiceDurationMs } : {}),
    ...(r.context ? { context: r.context as FeedbackItem['context'] } : {}),
    page: r.page as FeedbackItem['page'],
    intent: r.intent,
    severity: r.severity,
    t: r.t,
    cropUrl: r.cropAssetId ? media(r.cropAssetId) : null,
    voiceUrl: r.voiceAssetId ? media(r.voiceAssetId) : null,
    transcript: r.transcriptStatus
      ? { status: r.transcriptStatus, text: r.transcriptText, vtt: r.transcriptVtt, language: r.transcriptLanguage }
      : null,
    status: r.status,
    author: { userId: r.authorUserId, name: r.authorName, email: r.authorEmail, issuer: r.authorIssuer, subject: r.authorSubject },
    createdAt: r.createdAt.toISOString(),
  };
}

// ---------- transcribe-note ----------

export async function transcribeNote(payload: unknown, j: { attempts: number; max_attempts: number }) {
  const itemId = (payload as { itemId?: unknown })?.itemId;
  if (typeof itemId !== 'string') throw new Error('payload.itemId missing');
  const [row] = await db.select().from(feedbackItem).where(eq(feedbackItem.id, itemId));
  if (!row?.voiceAssetId) return;
  const t = createTranscriber();
  if (!t) {
    await db.update(feedbackItem).set({ transcriptStatus: 'off' }).where(eq(feedbackItem.id, itemId));
    return;
  }
  const [a] = await db.select().from(asset).where(eq(asset.id, row.voiceAssetId));
  if (!a) return;
  await db.update(feedbackItem).set({ transcriptStatus: 'running', transcriptError: null }).where(eq(feedbackItem.id, itemId));
  try {
    // through the same length and monthly caps as every other transcription (D-132, D-141).
    // MediaRecorder files carry no duration in their header, and the client's length is not trusted
    // for a cap: measure by decoding, and hand the PCM on so the chunked path does not decode twice.
    const audio = await getBytes(a.s3Key);
    const pcm = await decodePcm(audio);
    const durationMs = Math.round((pcm.length / 16_000) * 1000);
    const out = await runTranscription(t, { audio, mime: a.contentType || 'audio/webm', durationMs, pcm }, transcribeConfig(), dbLedger(db));
    if (out.status === 'skipped') {
      await db.update(feedbackItem).set({ transcriptStatus: 'failed', transcriptError: out.reason }).where(eq(feedbackItem.id, itemId));
      return;
    }
    const r = out.result;
    await db
      .update(feedbackItem)
      .set({ transcriptStatus: 'done', transcriptVtt: r.vtt, transcriptText: vttText(r.vtt), transcriptLanguage: r.language ?? null, transcriptError: null })
      .where(eq(feedbackItem.id, itemId));
  } catch (e) {
    const last = j.attempts >= j.max_attempts;
    await db
      .update(feedbackItem)
      .set({ transcriptStatus: last ? 'failed' : 'pending', transcriptError: e instanceof Error ? e.message.slice(0, 1000) : String(e) })
      .where(eq(feedbackItem.id, itemId));
    throw e;
  }
}

export function registerFeedbackJobs() {
  registerJob('transcribe-note', transcribeNote, 1);
}
