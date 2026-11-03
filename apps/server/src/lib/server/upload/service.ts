// Upload protocol (architecture s5, X-01): create, numbered idempotent chunks per stream, resume
// by listing, complete, finalize; assets; discard and delete. Route files call these.
import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { EMBED_ISSUER, HEADERS, LIMITS, STREAM_CONTENT_TYPES, uuidv7, type ShareAccess, type StreamName } from '@toolbar/shared';
import {
  MAX_ASSET_BYTES,
  UPLOAD_ASSET_KINDS,
  uploadAssetFieldsSchema,
  type Asset,
  type CaptureSource,
  type FinalizeCaptureBody,
  type LinkedIssue,
  type UploadAssetKind,
} from '@toolbar/shared/api';
import type { z } from 'zod';
import type { createCaptureBodySchema, finalizeCaptureBodySchema } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { annotation, asset, feedbackItem, folder, organization, recording, recordingChunk, recordingStream } from '../db/schema/index.ts';
import { deleteKeys, deletePrefix, keys, putObjectWith } from '../s3.ts';
import { enqueue } from '../jobs/queue.ts';
import { env } from '../env.ts';
import { fail } from '../share/http.ts';
import { seatOf, type RecordingRow } from '../share/access.ts';
import { primaryShareUrl, revokeLinksOf } from '../share/tokens.ts';
import { mintUploadToken } from './token.ts';

type CreateBody = z.output<typeof createCaptureBodySchema>;
type FinalizeBody = z.output<typeof finalizeCaptureBodySchema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- create ----------

export { authorSnapshot, type AuthorSnapshot } from '../auth/author.ts';
import type { AuthorSnapshot } from '../auth/author.ts';

/** Workspace default link access (J-120), from the organization metadata the dashboard writes. */
export async function defaultAccessOf(db: Db, organizationId: string): Promise<ShareAccess> {
  const [o] = await db.select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, organizationId));
  try {
    const m = o?.metadata ? (JSON.parse(o.metadata) as Record<string, unknown>) : {};
    const s = (m.settings as Record<string, unknown> | undefined) ?? m;
    return s.defaultLinkAccess === 'workspace' ? 'workspace' : 'anyone';
  } catch {
    return 'anyone';
  }
}

async function checkFolder(db: Db, folderId: string | null | undefined, organizationId: string) {
  if (!folderId) return null;
  if (!UUID.test(folderId)) fail('invalid_body', 'folderId is not an id');
  const [f] = await db.select({ id: folder.id }).from(folder).where(and(eq(folder.id, folderId), eq(folder.organizationId, organizationId)));
  if (!f) fail('invalid_body', 'Folder not found in this workspace');
  return f.id;
}

export interface CreateInput {
  organizationId: string;
  clientId: string;
  kind: CreateBody['kind'];
  folderId?: string | null;
  page: { url: string; title: string };
  startedAt: number;
  env?: unknown;
  durationMs?: number;
  source: CaptureSource;
  author: AuthorSnapshot | null;
  recordingLinkId?: string | null;
  /** project the page belongs to and the preset applied (D-123, D-125) */
  projectId?: string | null;
  maskingPreset?: 'staging' | 'production' | 'none' | null;
  /** link access; left out: the workspace default (J-120). The embed passes `workspace` (D-211). */
  access?: ShareAccess;
}

/**
 * Insert a capture in state "uploading" and mint its share link. Idempotent on clientId.
 * The dashboard's recording-link route calls this with `author: null`, `source: 'recording-link'`
 * and hands the returned `uploadToken` to the recipient.
 */
export async function createCaptureRecord(db: Db, input: CreateInput): Promise<{ id: string; shareUrl: string; uploadToken: string; created: boolean }> {
  const [existing] = await db.select().from(recording).where(eq(recording.clientId, input.clientId)).limit(1);
  if (existing) {
    if (existing.organizationId !== input.organizationId || existing.authorUserId !== (input.author?.userId ?? null) || existing.deletedAt)
      fail('conflict', 'clientId already used by another capture');
    return { id: existing.id, shareUrl: await primaryShareUrl(db, existing, existing.authorUserId), uploadToken: mintUploadToken(existing.id), created: false };
  }
  const folderId = await checkFolder(db, input.folderId, input.organizationId);
  const access = input.access ?? (await defaultAccessOf(db, input.organizationId));
  const [rec] = await db
    .insert(recording)
    .values({
      clientId: input.clientId,
      organizationId: input.organizationId,
      folderId,
      kind: input.kind,
      status: 'uploading',
      title: input.page.title?.slice(0, 500) ?? '',
      pageUrl: input.page.url,
      pageTitle: input.page.title,
      startedAt: new Date(input.startedAt),
      durationMs: input.durationMs ?? null,
      env: input.env ?? null,
      authorUserId: input.author?.userId ?? null,
      authorName: input.author?.name ?? null,
      authorEmail: input.author?.email ?? null,
      authorIssuer: input.author?.issuer ?? null,
      authorSubject: input.author?.subject ?? null,
      recordingLinkId: input.recordingLinkId ?? null,
      source: input.source,
      access,
      projectId: input.projectId ?? null,
      maskingPreset: input.maskingPreset ?? null,
    })
    .onConflictDoNothing({ target: recording.clientId })
    .returning();
  if (!rec) return createCaptureRecord(db, input); // lost a race on clientId: return the winner
  const shareUrl = await primaryShareUrl(db, rec, rec.authorUserId);
  return { id: rec.id, shareUrl, uploadToken: mintUploadToken(rec.id), created: true };
}

// ---------- chunks ----------

export const sha256hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export type PutChunkOutcome = { stored: 'new' | 'duplicate'; status: 200 | 201 };

/** Pure decision for a chunk PUT against what is stored (tested in test/upload.test.ts). */
export function chunkDecision(
  existing: { sha256: string } | null,
  incoming: { sha256: string },
  state: { recordingStatus: RecordingRow['status']; streamCompleted: boolean; lastSeq: number | null; seq: number },
): { action: 'store' } | { action: 'duplicate' } | { action: 'reject'; code: 'hash_mismatch' | 'already_finalized' } {
  if (existing) return existing.sha256 === incoming.sha256 ? { action: 'duplicate' } : { action: 'reject', code: 'hash_mismatch' };
  if (state.recordingStatus === 'ready' || state.recordingStatus === 'failed') return { action: 'reject', code: 'already_finalized' };
  if (state.streamCompleted && (state.lastSeq === null || state.seq > state.lastSeq)) return { action: 'reject', code: 'already_finalized' };
  return { action: 'store' };
}

export async function putChunk(
  db: Db,
  rec: RecordingRow,
  stream: StreamName,
  seq: number,
  body: Uint8Array,
  headers: Headers,
): Promise<PutChunkOutcome> {
  if (body.byteLength > LIMITS.chunkBytes) fail('too_large', `Chunks are at most ${LIMITS.chunkBytes} bytes`);
  const sha = sha256hex(body);
  const claimed = headers.get(HEADERS.sha256)?.toLowerCase();
  if (claimed && claimed !== sha) fail('hash_mismatch', `Body sha256 ${sha} does not match ${HEADERS.sha256}`);

  const [s] = await db
    .select()
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, rec.id), eq(recordingStream.name, stream)));
  const [existing] = await db
    .select({ sha256: recordingChunk.sha256 })
    .from(recordingChunk)
    .where(and(eq(recordingChunk.recordingId, rec.id), eq(recordingChunk.stream, stream), eq(recordingChunk.seq, seq)));
  const d = chunkDecision(existing ?? null, { sha256: sha }, { recordingStatus: rec.status, streamCompleted: !!s?.completedAt, lastSeq: s?.lastSeq ?? null, seq });
  if (d.action === 'duplicate') return { stored: 'duplicate', status: 200 };
  if (d.action === 'reject') fail(d.code, d.code === 'hash_mismatch' ? `Chunk ${seq} is already stored with a different hash` : 'The capture no longer accepts chunks');

  const num = (h: string) => {
    const v = Number(headers.get(h));
    return headers.get(h) !== null && Number.isFinite(v) ? Math.round(v) : null;
  };
  const key = keys.chunk(rec.id, stream, seq);
  const sentType = headers.get('content-type')?.split(';')[0]?.trim();
  const contentType = !sentType || sentType === 'application/octet-stream' ? STREAM_CONTENT_TYPES[stream] : sentType;
  // Claim the seq first, so two different bodies for one seq cannot both land in S3.
  const [row] = await db
    .insert(recordingChunk)
    .values({ recordingId: rec.id, stream, seq, s3Key: key, bytes: body.byteLength, sha256: sha, t0: num(HEADERS.t0), t1: num(HEADERS.t1) })
    .onConflictDoNothing()
    .returning({ seq: recordingChunk.seq });
  if (!row) {
    const [again] = await db
      .select({ sha256: recordingChunk.sha256 })
      .from(recordingChunk)
      .where(and(eq(recordingChunk.recordingId, rec.id), eq(recordingChunk.stream, stream), eq(recordingChunk.seq, seq)));
    if (again?.sha256 === sha) return { stored: 'duplicate', status: 200 };
    fail('hash_mismatch', `Chunk ${seq} is already stored with a different hash`);
  }
  try {
    await putObjectWith(key, body, { contentType, contentEncoding: headers.get('content-encoding') ?? undefined });
  } catch (e) {
    await db
      .delete(recordingChunk)
      .where(and(eq(recordingChunk.recordingId, rec.id), eq(recordingChunk.stream, stream), eq(recordingChunk.seq, seq)));
    throw e;
  }
  await db
    .insert(recordingStream)
    .values({
      recordingId: rec.id,
      name: stream,
      contentType,
      lastSeq: seq,
      totalBytes: body.byteLength,
    })
    .onConflictDoUpdate({
      target: [recordingStream.recordingId, recordingStream.name],
      set: {
        lastSeq: sql`greatest(coalesce(${recordingStream.lastSeq}, -1), ${seq})`,
        totalBytes: sql`${recordingStream.totalBytes} + ${body.byteLength}`,
      },
    });
  return { stored: 'new', status: 201 };
}

export async function listChunks(db: Db, recId: string, stream: StreamName) {
  const chunks = await db
    .select({ seq: recordingChunk.seq, bytes: recordingChunk.bytes, sha256: recordingChunk.sha256 })
    .from(recordingChunk)
    .where(and(eq(recordingChunk.recordingId, recId), eq(recordingChunk.stream, stream)))
    .orderBy(asc(recordingChunk.seq));
  const [s] = await db
    .select()
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, recId), eq(recordingStream.name, stream)));
  return { stream, chunks, lastSeq: s?.lastSeq ?? null, completed: !!s?.completedAt };
}

/** Seqs 0..lastSeq that are absent. */
export function missingSeqs(have: number[], lastSeq: number): number[] {
  const set = new Set(have);
  const out: number[] = [];
  for (let i = 0; i <= lastSeq; i++) if (!set.has(i)) out.push(i);
  return out;
}

export async function completeStream(db: Db, rec: RecordingRow, stream: StreamName, body: { lastSeq: number; totalBytes: number }) {
  const { chunks } = await listChunks(db, rec.id, stream);
  const missing = missingSeqs(
    chunks.map((c) => c.seq),
    body.lastSeq,
  );
  const extra = chunks.filter((c) => c.seq > body.lastSeq).map((c) => c.seq);
  const total = chunks.filter((c) => c.seq <= body.lastSeq).reduce((n, c) => n + c.bytes, 0);
  if (missing.length) fail('stream_incomplete', `Missing chunks: ${missing.slice(0, 50).join(', ')}`, { missing }, { stream, completed: false, missing });
  if (extra.length) fail('stream_incomplete', `Chunks after lastSeq: ${extra.join(', ')}`, { extra }, { stream, completed: false, missing: [] });
  if (total !== body.totalBytes) fail('stream_incomplete', `totalBytes ${body.totalBytes} does not match the ${total} bytes stored`, { total }, { stream, completed: false, missing: [] });
  await db
    .insert(recordingStream)
    .values({ recordingId: rec.id, name: stream, contentType: STREAM_CONTENT_TYPES[stream], lastSeq: body.lastSeq, totalBytes: total, completedAt: new Date() })
    .onConflictDoUpdate({
      target: [recordingStream.recordingId, recordingStream.name],
      set: { lastSeq: body.lastSeq, totalBytes: total, completedAt: sql`coalesce(${recordingStream.completedAt}, now())` },
    });
  return { stream, completed: true, missing: [] as number[] };
}

// ---------- finalize ----------

export type DestinationHandler = (
  db: Db,
  rec: RecordingRow,
  destination: Extract<FinalizeBody['destination'], { type: 'integration' }>,
  shareUrl: string,
) => Promise<LinkedIssue>;

let destinationHandler: DestinationHandler | null = null;
/** The dashboard area registers its integration sender here (J-079, J-137). */
export function setDestinationHandler(fn: DestinationHandler | null) {
  destinationHandler = fn;
}

async function claimAsset(db: Db, rec: RecordingRow, assetId: string | null | undefined, kind: UploadAssetKind | null, userId: string | null) {
  if (!assetId) return;
  const [a] = await db.select().from(asset).where(eq(asset.id, assetId));
  if (!a) fail('invalid_body', `Asset ${assetId} not found`);
  if (a.recordingId && a.recordingId !== rec.id) fail('invalid_body', `Asset ${assetId} belongs to another capture`);
  if (!a.recordingId && a.createdBy && a.createdBy !== userId) fail('invalid_body', `Asset ${assetId} was uploaded by someone else`);
  await db
    .update(asset)
    .set({ recordingId: rec.id, ...(kind ? { kind } : {}) })
    .where(eq(asset.id, assetId));
}

export async function finalizeCapture(
  db: Db,
  rec: RecordingRow,
  body: FinalizeBody,
  caller: { userId: string | null },
): Promise<{ id: string; shareUrl: string; status: 'processing'; issue: LinkedIssue | null; issueError: string | null }> {
  if (rec.finalizedAt || rec.status !== 'uploading') fail('already_finalized', 'This capture was already created');
  let organizationId = rec.organizationId;
  if (body.workspaceId && body.workspaceId !== rec.organizationId) {
    if (!caller.userId) fail('forbidden', 'Only members can move a capture to another workspace');
    const seat = await seatOf(db, caller.userId, body.workspaceId);
    if (!seat || seat === 'viewer') fail('forbidden', 'Needs the creator role in the target workspace');
    organizationId = body.workspaceId;
  }
  const folderId = body.folderId === undefined ? rec.folderId : await checkFolder(db, body.folderId, organizationId);
  if (body.metadata && JSON.stringify(body.metadata).length > 10_240) fail('invalid_body', 'metadata is limited to 10 KB');
  // D-214: only a trace capture holds traces; the finalize job keeps what is inside their windows
  if (body.traces && rec.kind !== 'trace') fail('invalid_body', 'Only a trace capture takes traces');
  if (body.traces && body.trim) fail('invalid_body', 'A capture with traces takes no trim');

  await claimAsset(db, rec, body.screenshotAssetId, null, caller.userId);
  await claimAsset(db, rec, body.fullScreenshotAssetId, 'screenshot', caller.userId);
  for (const id of body.attachmentAssetIds) await claimAsset(db, rec, id, 'attachment', caller.userId);

  await db.delete(annotation).where(eq(annotation.recordingId, rec.id));
  if (body.annotations.length) {
    await db.insert(annotation).values(
      body.annotations.map((a) => {
        const assetId = a.assetId && UUID.test(a.assetId) ? a.assetId : null;
        // D-128: the crop of a locator is the annotation's own asset
        const locator = a.locator ? { ...a.locator, ...(a.locator.crop && assetId ? { crop: { ...a.locator.crop, assetId } } : {}) } : null;
        return {
          id: a.id && UUID.test(a.id) ? a.id : uuidv7(),
          recordingId: rec.id,
          assetId,
          t: a.t ?? null,
          shapes: a.shapes,
          target: a.target ?? null,
          locator,
          comment: a.comment ?? null,
          authorUserId: caller.userId,
        };
      }),
    );
  }

  // the embed (D-213): a name the reviewer typed after the capture started fills an empty author,
  // and the items they sent before it
  const reviewerName = !caller.userId && rec.source === 'embed' && !rec.authorName ? body.reviewer?.name || null : null;
  if (reviewerName)
    await db
      .update(feedbackItem)
      .set({ authorName: reviewerName })
      .where(and(eq(feedbackItem.recordingId, rec.id), eq(feedbackItem.authorIssuer, EMBED_ISSUER), sql`${feedbackItem.authorName} is null`));

  const [updated] = await db
    .update(recording)
    .set({
      ...(reviewerName ? { authorName: reviewerName } : {}),
      organizationId,
      folderId,
      title: body.title || rec.title,
      description: body.description,
      trim: body.trim ?? null,
      traces: body.traces ?? null,
      durationMs: body.durationMs ?? rec.durationMs,
      metadata: body.metadata ?? null,
      status: 'processing',
      processingProgress: 0,
      finalizedAt: new Date(),
    })
    .where(and(eq(recording.id, rec.id), eq(recording.status, 'uploading')))
    .returning();
  if (!updated) fail('already_finalized', 'This capture was already created');
  await enqueue(db, 'finalize-recording', { recordingId: rec.id }, { maxAttempts: 12 });
  const shareUrl = await primaryShareUrl(db, updated, updated.authorUserId);

  let issue: LinkedIssue | null = null;
  let issueError: string | null = null;
  if (body.destination.type === 'integration') {
    if (!destinationHandler) issueError = 'Integrations are not set up on this server; the capture was saved with a link.';
    else {
      try {
        issue = await destinationHandler(db, updated, body.destination, shareUrl);
      } catch (e) {
        issueError = e instanceof Error ? e.message : String(e);
      }
    }
  }
  return { id: rec.id, shareUrl, status: 'processing', issue, issueError };
}

// ---------- assets ----------

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** voice notes (D-087): what MediaRecorder and common recorders write */
const VOICE_TYPES = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac', 'video/webm'];
const BLOCKED_TYPES = /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml)/i;

export function assetTypeAllowed(kind: UploadAssetKind, contentType: string): boolean {
  if (BLOCKED_TYPES.test(contentType)) return false;
  if (kind === 'attachment') return true;
  if (kind === 'voice') return VOICE_TYPES.includes(contentType);
  // reviewer toolbar voice notes (MediaRecorder: WebM or Ogg Opus, MP4 on Safari)
  if (kind === 'voice-note') return /^audio\/(webm|ogg|mp4|mpeg|wav)$/.test(contentType);
  return IMAGE_TYPES.includes(contentType);
}

/** Width and height from a PNG, GIF or WebP header (enough for screenshots). */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (b.length > 30 && b[8] === 0x57 && b[9] === 0x45 && b[12] === 0x56 && b[13] === 0x50 && b[14] === 0x38) {
    if (b[15] === 0x20) return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (b[15] === 0x4c) {
      const bits = dv.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (b[15] === 0x58) return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) };
  }
  return null;
}

export function assetUrl(a: { id: string; recordingId: string | null }) {
  return a.recordingId ? `${env.publicUrl}/api/v1/recordings/${a.recordingId}/media/${a.id}` : `${env.publicUrl}/api/v1/assets/${a.id}`;
}

export function assetDto(a: typeof asset.$inferSelect): Asset {
  return {
    id: a.id,
    kind: a.kind,
    url: assetUrl(a),
    contentType: a.contentType,
    width: a.width,
    height: a.height,
    bytes: a.bytes,
    name: a.name,
  };
}

export async function storeAsset(
  db: Db,
  input: { fields: Record<string, unknown>; file: File; recordingId: string | null; userId: string | null },
): Promise<Asset> {
  const parsed = uploadAssetFieldsSchema.safeParse(input.fields);
  if (!parsed.success) fail('invalid_body', 'Fields do not match the contract', parsed.error.issues);
  const f = parsed.data;
  if (!UPLOAD_ASSET_KINDS.includes(f.kind)) fail('invalid_body', 'Unknown kind');
  if (input.file.size > MAX_ASSET_BYTES) fail('too_large', `Assets are at most ${MAX_ASSET_BYTES} bytes`);
  const contentType = (input.file.type || 'application/octet-stream').split(';')[0]!.trim().toLowerCase();
  if (!assetTypeAllowed(f.kind, contentType)) fail('unsupported_media_type', `${contentType} is not accepted for ${f.kind}`);
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  if (f.sha256 && sha256hex(bytes) !== f.sha256) fail('invalid_body', 'sha256 does not match the file');
  const size = IMAGE_TYPES.includes(contentType) ? imageSize(bytes) : null;
  const id = uuidv7();
  const key = keys.asset(input.recordingId, id);
  await putObjectWith(key, bytes, { contentType });
  const [row] = await db
    .insert(asset)
    .values({
      id,
      recordingId: input.recordingId,
      kind: f.kind,
      s3Key: key,
      contentType,
      width: f.width ?? size?.width ?? null,
      height: f.height ?? size?.height ?? null,
      bytes: bytes.byteLength,
      name: input.file.name && input.file.name !== 'blob' ? input.file.name.slice(0, 200) : null,
      createdBy: input.userId,
    })
    .returning();
  return assetDto(row!);
}

// ---------- discard and delete ----------

/** Remove every object and chunk row of a capture (purge job and draft discard). */
export async function purgeMedia(db: Db, recId: string) {
  const n = await deletePrefix(keys.recording(recId));
  const outside = await db.select({ key: asset.s3Key }).from(asset).where(eq(asset.recordingId, recId));
  const stray = outside.map((a) => a.key).filter((k) => !k.startsWith(keys.recording(recId)));
  await deleteKeys(stray);
  await db.delete(recordingChunk).where(eq(recordingChunk.recordingId, recId));
  return n + stray.length;
}

/**
 * DELETE /recordings/:id. A draft (status uploading) is discarded at once: objects and the row go
 * (J-189). A created capture is archived: hidden everywhere, links revoked, purge job enqueued (J-191).
 */
export async function deleteCapture(db: Db, rec: RecordingRow): Promise<{ ok: true; purged: boolean }> {
  if (rec.status === 'uploading' && !rec.finalizedAt) {
    await purgeMedia(db, rec.id);
    await db.delete(recording).where(eq(recording.id, rec.id));
    return { ok: true, purged: true };
  }
  await db.update(recording).set({ deletedAt: new Date() }).where(eq(recording.id, rec.id));
  await revokeLinksOf(db, rec.id);
  await enqueue(db, 'purge-recording', { recordingId: rec.id });
  return { ok: true, purged: false };
}

export async function recordingsByIds(db: Db, ids: string[]) {
  return ids.length ? db.select().from(recording).where(inArray(recording.id, ids)) : [];
}

export type { FinalizeCaptureBody };
