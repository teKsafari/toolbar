// Load a capture for the feedback folder and build it (assemble.ts), with a short-lived cache so
// the tarball, the file listing and the MCP file reads of one agent session build it once.
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import type { EnvInfo, TargetRef } from '@toolbar/shared';
import { prepare } from '@toolbar/shared/derive';
import type { MaskingPresetName } from '@toolbar/shared/areas/handoff';
import type { Db } from '../db/index.ts';
import { annotation, asset, comment, commentAttachment, feedbackResolution, folder, organization, recordingChunk, recordingStream, transcript, user } from '../db/schema/index.ts';
import { getBytes } from '../s3.ts';
import { env } from '../env.ts';
import type { RecordingRow } from '../share/access.ts';
import { loadEvents, memberUrlOf } from '../mcp/data.ts';
import { frameAt } from '../mcp/frames.ts';
import { assembleFolder, type BuiltFolder, type FolderData, type FolderIo } from './assemble.ts';
import { cropRegion, flatten, frameToCss, sizeOf, toCssPixels } from './images.ts';
import { ocrAvailable, ocrPng } from './ocr.ts';
import { deriveSpans } from './spans.ts';
import { tarGz } from './tar.ts';
import sharp from 'sharp';

export async function collectFolder(db: Db, rec: RecordingRow): Promise<FolderData> {
  const r = rec as RecordingRow & { maskingPreset?: MaskingPresetName | null; projectId?: string | null };
  const [ws] = await db.select({ name: organization.name }).from(organization).where(eq(organization.id, rec.organizationId));
  const [f] = rec.folderId ? await db.select({ name: folder.name }).from(folder).where(eq(folder.id, rec.folderId)) : [];
  const streams = await db.select().from(recordingStream).where(eq(recordingStream.recordingId, rec.id));
  const assets = await db.select().from(asset).where(eq(asset.recordingId, rec.id)).orderBy(asc(asset.createdAt));
  const anns = await db
    .select({ a: annotation, name: user.name, email: user.email })
    .from(annotation)
    .leftJoin(user, eq(user.id, annotation.authorUserId))
    .where(eq(annotation.recordingId, rec.id));
  const comments = await db
    .select({ c: comment, name: user.name, email: user.email })
    .from(comment)
    .leftJoin(user, eq(user.id, comment.authorUserId))
    .where(and(eq(comment.recordingId, rec.id), sql`${comment.deletedAt} IS NULL`))
    .orderBy(asc(comment.createdAt));
  const atts = comments.length
    ? await db.select().from(commentAttachment).where(inArray(commentAttachment.commentId, comments.map((c) => c.c.id))).orderBy(asc(commentAttachment.position))
    : [];
  const trs = await db.select().from(transcript).where(eq(transcript.recordingId, rec.id));
  const rrweb = await db
    .select({ key: recordingChunk.s3Key })
    .from(recordingChunk)
    .where(and(eq(recordingChunk.recordingId, rec.id), eq(recordingChunk.stream, 'rrweb')))
    .orderBy(asc(recordingChunk.seq));
  const [res] = await db.select().from(feedbackResolution).where(eq(feedbackResolution.recordingId, rec.id));
  const events = await loadEvents(db, rec);
  const hasVideo = streams.some((s) => s.name === 'video' && !!s.finalKey);
  const prepared = events ? prepare(events, rec.startedAt?.getTime() ?? null, hasVideo) : null;
  const startedAt = rec.startedAt?.getTime();
  const spans = events
    ? deriveSpans(events, { ...(startedAt !== undefined ? { startedAt } : {}), ...(startedAt !== undefined && rec.durationMs != null ? { endedAt: startedAt + rec.durationMs } : {}) })
    : null;
  return {
    server: env.publicUrl,
    memberUrl: memberUrlOf(rec.id),
    rec: {
      id: rec.id,
      kind: rec.kind,
      title: rec.title,
      description: rec.description,
      pageUrl: rec.pageUrl,
      pageTitle: rec.pageTitle,
      createdAt: rec.createdAt,
      startedAt: rec.startedAt,
      durationMs: rec.durationMs,
      env: (rec.env as EnvInfo | null) ?? null,
      metadata: (rec.metadata as Record<string, unknown> | null) ?? null,
      authorName: rec.authorName,
      authorEmail: rec.authorEmail,
      authorIssuer: rec.authorIssuer,
      authorSubject: rec.authorSubject,
      maskingPreset: r.maskingPreset ?? null,
      project: null,
      workspace: ws?.name ?? null,
      folder: f?.name ?? null,
    },
    events,
    prepared,
    spans,
    assets: assets.map((a) => ({ id: a.id, kind: a.kind, s3Key: a.s3Key, contentType: a.contentType, width: a.width, height: a.height, createdAt: a.createdAt })),
    annotations: anns.map(({ a, name, email }) => ({
      id: a.id,
      assetId: a.assetId,
      t: a.t,
      shapes: (a.shapes as Record<string, unknown>[]) ?? [],
      target: (a.target as TargetRef | null) ?? null,
      locator: ((a as Record<string, unknown>).locator as Record<string, unknown> | null | undefined) ?? null,
      comment: a.comment,
      author: name ?? email ?? rec.authorName ?? 'reviewer',
      createdAt: a.createdAt,
    })),
    comments: comments.map(({ c, name, email }) => ({
      id: c.id,
      parentId: c.parentId,
      author: name ?? c.authorName ?? 'Anonymous',
      authorEmail: email ?? c.authorEmail ?? null,
      body: c.body,
      tMs: c.tMs,
      createdAt: c.createdAt,
      resolvedAt: c.resolvedAt,
      viaAgent: c.viaAgent,
      attachments: atts.filter((x) => x.commentId === c.id).map((x) => x.assetId),
    })),
    transcripts: trs.map((t) => ({ stream: t.stream, status: t.status, language: t.language, vtt: t.vtt })),
    voiceKey: streams.find((s) => s.name === 'voice')?.finalKey ?? null,
    rrwebKeys: rrweb.map((x) => x.key),
    hasVideo,
    resolution: res ? { at: res.resolvedAt, by: res.resolvedByName ?? res.resolvedByEmail, note: res.note, commit: res.commit, via: res.via } : null,
  };
}

export function serverIo(db: Db, rec: RecordingRow): FolderIo {
  const env0 = rec.env as EnvInfo | null;
  return {
    bytes: getBytes,
    toCss: toCssPixels,
    flatten,
    crop: cropRegion,
    size: sizeOf,
    // tesseract reads small text better at twice the size
    ocr: async (png) => ocrPng(await sharp(png).resize({ width: Math.round(((await sizeOf(png)).width || 1) * 2) }).png().toBuffer()),
    ocrAvailable,
    frame: async (atMs) => frameToCss((await frameAt(db, rec, atMs, '1080')).jpeg, env0?.viewport.w ?? null),
  };
}

// ---------- cache ----------

interface Cached {
  key: string;
  at: number;
  folder: BuiltFolder;
  tgz?: Uint8Array;
}
const cache = new Map<string, Cached>();
const TTL_MS = 10 * 60_000;
const MAX = 4;

/** Changes whenever anything the folder shows changes. */
async function fingerprint(db: Db, rec: RecordingRow): Promise<string> {
  const [c] = await db
    .select({ n: sql<number>`count(*)::int`, last: max(sql`greatest(${comment.createdAt}, coalesce(${comment.editedAt}, ${comment.createdAt}), coalesce(${comment.deletedAt}, ${comment.createdAt}))`) })
    .from(comment)
    .where(eq(comment.recordingId, rec.id));
  const [t] = await db.select({ u: transcript.updatedAt }).from(transcript).where(eq(transcript.recordingId, rec.id)).orderBy(desc(transcript.updatedAt)).limit(1);
  const [r] = await db.select({ at: feedbackResolution.resolvedAt }).from(feedbackResolution).where(eq(feedbackResolution.recordingId, rec.id));
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(asset).where(eq(asset.recordingId, rec.id));
  return [rec.id, rec.updatedAt.getTime(), c?.n, String(c?.last ?? ''), t?.u?.getTime() ?? '', r?.at?.getTime() ?? '', a?.n].join('|');
}

export async function folderOf(db: Db, rec: RecordingRow): Promise<Cached> {
  const key = await fingerprint(db, rec);
  const hit = cache.get(rec.id);
  if (hit && hit.key === key && Date.now() - hit.at < TTL_MS) return hit;
  const folder = await assembleFolder(await collectFolder(db, rec), serverIo(db, rec));
  const entry: Cached = { key, at: Date.now(), folder };
  cache.delete(rec.id);
  cache.set(rec.id, entry);
  while (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return entry;
}

export async function folderTarGz(db: Db, rec: RecordingRow): Promise<{ folder: BuiltFolder; tgz: Uint8Array }> {
  const c = await folderOf(db, rec);
  c.tgz ??= tarGz(c.folder.files.map((f) => ({ path: `${c.folder.dir}/${f.path}`, data: f.data })));
  return { folder: c.folder, tgz: c.tgz };
}

export const fileBytes = (d: Uint8Array | string) => (typeof d === 'string' ? Buffer.byteLength(d) : d.byteLength);
