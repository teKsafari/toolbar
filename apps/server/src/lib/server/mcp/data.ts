// Capture data for agents: events from events.json.gz with the derived panel models, comments,
// transcript, a brief for the markdown and the investigation guide. Used by the REST event
// queries, the MCP tools, the markdown share page and the agent tab. Owner: agent area.
import { gunzipSync } from 'node:zlib';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { CaptureEvent, EnvInfo } from '@toolbar/shared';
import { prepare, type BriefComment, type CaptureBrief, type Prepared } from '@toolbar/shared/derive';
import type { Db } from '../db/index.ts';
import { asset, comment, commentAttachment, folder, project, recordingStream, transcript, user } from '../db/schema/index.ts';
import { voiceNoteTranscripts } from '../transcribe/notes.ts';
import { getBytes } from '../s3.ts';
import { env } from '../env.ts';
import { fail } from '../share/http.ts';
import type { RecordingRow } from '../share/access.ts';
import { parseVtt } from '../transcribe/index.ts';

export const memberUrlOf = (id: string) => `${env.publicUrl}/c/${id}`;
export const mcpUrl = () => `${env.publicUrl}/mcp`;
export const CLI_NAME = 'open-toolbar';
export const apiUrl = () => `${env.publicUrl}/api/v1`;
/** Where agents can read a capture: MCP, the HTTP API, and the CLI only while FEATURE_CLI is on (docs/scope.md). */
export const agentPointers = () => ({ mcpUrl: mcpUrl(), apiUrl: apiUrl(), cli: env.features.cli ? CLI_NAME : null });

// ---------- events ----------

const cache = new Map<string, CaptureEvent[]>();
const CACHE_MAX = 16;

export function decodeEventsFile(bytes: Uint8Array): CaptureEvent[] {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : Buffer.from(bytes);
  const text = raw.toString('utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) return JSON.parse(text) as CaptureEvent[];
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as CaptureEvent);
}

/** Merged, time-sorted events of a capture; null while there is no events file yet. */
export async function loadEvents(db: Db, rec: RecordingRow): Promise<CaptureEvent[] | null> {
  const ck = `${rec.id}:${rec.updatedAt.getTime()}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  const [s] = await db
    .select({ finalKey: recordingStream.finalKey })
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, rec.id), eq(recordingStream.name, 'events')))
    .limit(1);
  if (!s?.finalKey) return null;
  let events: CaptureEvent[];
  try {
    events = decodeEventsFile(await getBytes(s.finalKey));
  } catch (e) {
    console.warn(`[agent] events of ${rec.id} unreadable:`, (e as Error).message);
    return null;
  }
  cache.set(ck, events);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return events;
}

export async function hasVideo(db: Db, rec: RecordingRow): Promise<boolean> {
  if (rec.kind !== 'video' && rec.kind !== 'screen') return false;
  const [s] = await db
    .select({ finalKey: recordingStream.finalKey })
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, rec.id), eq(recordingStream.name, 'video')))
    .limit(1);
  return !!s?.finalKey;
}

export async function preparedOf(db: Db, rec: RecordingRow): Promise<Prepared | null> {
  const events = await loadEvents(db, rec);
  if (!events) return null;
  return prepare(events, rec.startedAt?.getTime() ?? null, await hasVideo(db, rec));
}

/** For routes: the prepared events, or 409 conflict while the capture is still processing. */
export async function requirePrepared(db: Db, rec: RecordingRow): Promise<Prepared> {
  const p = await preparedOf(db, rec);
  if (!p) fail('conflict', `The capture's events are not ready (status ${rec.status}). Try again when it is ready.`);
  return p;
}

// ---------- comments ----------

export interface CommentRow {
  id: string;
  parentId: string | null;
  author: string;
  authorUserId: string | null;
  body: string;
  tMs: number | null;
  createdAt: string;
  editedAt: string | null;
  /** only on comments with a voice note (D-087): its machine transcript, spoken by the author */
  voiceNote?: { status: string; language: string | null; transcript: string | null; reason: string | null };
}

export async function commentRows(db: Db, recId: string): Promise<CommentRow[]> {
  const rows = await db
    .select({ c: comment, name: user.name })
    .from(comment)
    .leftJoin(user, eq(user.id, comment.authorUserId))
    .where(and(eq(comment.recordingId, recId), isNull(comment.deletedAt)))
    .orderBy(asc(comment.createdAt));
  const ids = rows.map((r) => r.c.id);
  const notes = ids.length
    ? await db
        .select({ commentId: commentAttachment.commentId, assetId: asset.id })
        .from(commentAttachment)
        .innerJoin(asset, eq(asset.id, commentAttachment.assetId))
        .where(and(inArray(commentAttachment.commentId, ids), eq(asset.kind, 'voice')))
    : [];
  const tr = await voiceNoteTranscripts(db, recId, notes.map((n) => n.assetId));
  const noteOf = new Map(notes.map((n) => [n.commentId, n.assetId]));
  return rows.map(({ c, name }) => {
    const t = noteOf.has(c.id) ? tr.get(noteOf.get(c.id)!) : undefined;
    return {
      id: c.id,
      parentId: c.parentId,
      author: name ?? c.authorName ?? 'Anonymous',
      authorUserId: c.authorUserId,
      body: c.body,
      tMs: c.tMs,
      createdAt: c.createdAt.toISOString(),
      editedAt: c.editedAt?.toISOString() ?? null,
      ...(noteOf.has(c.id) ? { voiceNote: { status: t?.status ?? 'none', language: t?.language ?? null, transcript: t?.text ?? null, reason: t?.reason ?? null } } : {}),
    };
  });
}

export function threadsOf(rows: CommentRow[]): (CommentRow & { replies: CommentRow[] })[] {
  const top = rows.filter((r) => !r.parentId || !rows.some((p) => p.id === r.parentId));
  return top.map((t) => ({ ...t, replies: rows.filter((r) => r.parentId === t.id) }));
}

const briefComment = (c: CommentRow & { replies?: CommentRow[] }): BriefComment => ({
  author: c.author,
  body: c.body,
  tMs: c.tMs,
  createdAt: c.createdAt,
  replies: c.replies?.map((r) => briefComment(r)),
});

// ---------- transcript ----------

export async function transcriptOf(db: Db, recId: string) {
  const [t] = await db
    .select()
    .from(transcript)
    .where(and(eq(transcript.recordingId, recId), eq(transcript.stream, 'voice')))
    .limit(1);
  if (!t) return null;
  const cues = t.status === 'done' && t.vtt ? parseVtt(t.vtt) : [];
  return { status: t.status, language: t.language, cues, text: cues.map((c) => c.text).join(' ') || null, error: t.error };
}

// ---------- brief ----------

export async function screenshotAssets(db: Db, recId: string) {
  const rows = await db.select().from(asset).where(eq(asset.recordingId, recId));
  const crop = rows.find((a) => a.kind === 'crop');
  const shot = rows.find((a) => a.kind === 'screenshot');
  return { main: crop ?? shot ?? null, full: crop && shot ? shot : null, all: rows };
}

export async function briefOf(db: Db, rec: RecordingRow, opts: { url: string; imageUrl?: string | null }): Promise<CaptureBrief> {
  const [f] = rec.folderId ? await db.select({ name: folder.name }).from(folder).where(eq(folder.id, rec.folderId)).limit(1) : [];
  const tr = await transcriptOf(db, rec.id);
  return {
    id: rec.id,
    title: rec.title,
    description: rec.description,
    kind: rec.kind,
    status: rec.status,
    url: opts.url,
    pageUrl: rec.pageUrl,
    pageTitle: rec.pageTitle,
    createdAt: rec.createdAt.toISOString(),
    durationMs: rec.durationMs,
    author: rec.authorName || rec.authorEmail ? { name: rec.authorName, email: rec.authorEmail } : null,
    env: (rec.env as EnvInfo | null) ?? null,
    folder: f?.name ?? null,
    imageUrl: opts.imageUrl ?? null,
    comments: threadsOf(await commentRows(db, rec.id)).map(briefComment),
    transcript: tr ? { status: tr.status, text: tr.text } : null,
    metadata: (rec.metadata as Record<string, unknown> | null) ?? null,
    project: rec.projectId ? ((await db.select({ name: project.name }).from(project).where(eq(project.id, rec.projectId)).limit(1))[0]?.name ?? null) : null,
    maskingPreset: rec.maskingPreset ?? (rec.env as EnvInfo | null)?.maskingPreset ?? null,
  };
}

/** Content-only share links (J-118) do not reach console, network or events. */
export function assertDevtools(a: { via: string; share: { devtools: boolean } | null }) {
  if (a.via === 'share' && a.share && !a.share.devtools) fail('forbidden', 'This link shares the media only, without dev tools.');
}
