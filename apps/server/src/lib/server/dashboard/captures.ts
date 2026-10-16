// Capture grid queries (J-158, J-160, J-203), bulk move and delete (J-165, J-166), and video
// upload (J-020).
import type { RequestEvent } from '@sveltejs/kit';
import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { uuidv7 } from '@toolbar/shared';
import type { listCapturesQuerySchema, CaptureSummary, Page, SeatRole } from '@toolbar/shared/api';
import { MAX_UPLOAD_VIDEO_BYTES } from '@toolbar/shared/areas/dashboard';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Db } from '../db/index.ts';
import { folder, linkedIssue, recording } from '../db/schema/index.ts';
import { visibleCapturesWhere } from '../share/access.ts';
import { fail } from '../share/http.ts';
import { authorSnapshot, completeStream, createCaptureRecord, deleteCapture, finalizeCapture, putChunk } from '../upload/service.ts';
import { ffmpeg, probe, withTmp } from '../media/ffmpeg.ts';
import { LIMITS } from '@toolbar/shared';
import { audit, toSummaries, UUID, type RecordingRow } from './core.ts';

type ListQuery = z.output<typeof listCapturesQuerySchema>;

function encodeCursor(r: { createdAt: Date; id: string }) {
  return Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString('base64url');
}
function decodeCursor(c: string): { at: Date; id: string } | null {
  try {
    const [at, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    const d = new Date(at!);
    return Number.isNaN(d.getTime()) || !id || !UUID.test(id) ? null : { at: d, id };
  } catch {
    return null;
  }
}

export function captureFilters(q: Partial<ListQuery>, workspaceId: string, userId: string, seat: SeatRole): SQL {
  const parts: (SQL | undefined)[] = [eq(recording.organizationId, workspaceId), visibleCapturesWhere(userId, seat)];
  if (q.folderId === 'none') parts.push(isNull(recording.folderId));
  else if (q.folderId && q.folderId !== 'all') parts.push(eq(recording.folderId, q.folderId));
  if (q.kinds?.length) parts.push(inArray(recording.kind, q.kinds));
  if (q.sources?.length) parts.push(inArray(recording.source, q.sources));
  if (q.authors?.length) parts.push(inArray(recording.authorUserId, q.authors));
  if (q.recordingLinkId) parts.push(eq(recording.recordingLinkId, q.recordingLinkId));
  if (q.projectId) parts.push(eq(recording.projectId, q.projectId));
  const issueExists = sql`EXISTS (SELECT 1 FROM linked_issue li WHERE li.recording_id = ${recording.id})`;
  if (q.hasIssue === true) parts.push(issueExists);
  if (q.hasIssue === false) parts.push(sql`NOT ${issueExists}`);
  if (q.q?.trim()) {
    const like = `%${q.q.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`;
    parts.push(or(ilike(recording.title, like), ilike(recording.description, like), ilike(recording.pageUrl, like), ilike(recording.authorName, like)));
  }
  if (q.from) parts.push(gte(recording.createdAt, new Date(q.from)));
  if (q.to) parts.push(lte(recording.createdAt, new Date(q.to)));
  return and(...parts.filter((p): p is SQL => !!p))!;
}

export async function listCaptures(db: Db, q: ListQuery, ctx: { workspaceId: string; userId: string; seat: SeatRole }): Promise<Page<CaptureSummary>> {
  const where = captureFilters(q, ctx.workspaceId, ctx.userId, ctx.seat);
  const newest = q.sort !== 'oldest';
  const cur = q.cursor ? decodeCursor(q.cursor) : null;
  if (q.cursor && !cur) fail('invalid_query', 'Bad cursor');
  const after = cur
    ? newest
      ? or(lt(recording.createdAt, cur.at), and(eq(recording.createdAt, cur.at), lt(recording.id, cur.id)))
      : or(gt(recording.createdAt, cur.at), and(eq(recording.createdAt, cur.at), gt(recording.id, cur.id)))
    : undefined;
  const rows = await db
    .select()
    .from(recording)
    .where(after ? and(where, after) : where)
    .orderBy(newest ? desc(recording.createdAt) : asc(recording.createdAt), newest ? desc(recording.id) : asc(recording.id))
    .limit(q.limit + 1);
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(recording).where(where)) as [{ n: number }];
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return {
    items: await toSummaries(db, page),
    total: Number(n),
    returned: page.length,
    hasMore,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/** Captures the caller may change: admins any, creators their own (J-165). */
export async function changeable(db: Db, ids: string[], userId: string, seatFor: (ws: string) => Promise<SeatRole | null>) {
  const recs = ids.length ? await db.select().from(recording).where(and(inArray(recording.id, ids), isNull(recording.deletedAt))) : [];
  const ok: RecordingRow[] = [];
  const seats = new Map<string, SeatRole | null>();
  for (const r of recs) {
    if (!seats.has(r.organizationId)) seats.set(r.organizationId, await seatFor(r.organizationId));
    const seat = seats.get(r.organizationId);
    if (seat === 'admin' || (seat === 'creator' && r.authorUserId === userId)) ok.push(r);
  }
  return { recs, ok };
}

export async function bulkMove(db: Db, recs: RecordingRow[], folderId: string | null, actorId: string) {
  if (!recs.length) return 0;
  if (folderId) {
    const [f] = await db.select().from(folder).where(eq(folder.id, folderId));
    if (!f) fail('invalid_body', 'No such folder');
    if (recs.some((r) => r.organizationId !== f.organizationId)) fail('invalid_body', 'The folder is in another workspace');
  }
  const res = await db
    .update(recording)
    .set({ folderId })
    .where(inArray(recording.id, recs.map((r) => r.id)))
    .returning({ id: recording.id });
  void actorId;
  return res.length;
}

export async function bulkDelete(db: Db, recs: RecordingRow[], actorId: string) {
  for (const r of recs) {
    await deleteCapture(db, r);
    await audit(db, { workspaceId: r.organizationId, actorId, action: 'capture.deleted', target: { type: 'capture', id: r.id, label: r.title || null } });
  }
  return recs.length;
}

// ---------- J-020 upload an existing video ----------

/**
 * Turn an uploaded file into a capture: create (source upload), convert to WebM when needed,
 * store as video chunks, complete and finalize. The finalize job then probes, thumbnails and
 * makes renditions as for any recording.
 */
export async function uploadVideo(
  db: Db,
  event: RequestEvent,
  input: { file: File; workspaceId: string; folderId: string | null; title: string | null; userId: string },
) {
  const { file } = input;
  if (file.size > MAX_UPLOAD_VIDEO_BYTES) fail('too_large', 'Videos are limited to 200 MB');
  const type = (file.type || '').toLowerCase();
  const name = file.name || 'video';
  if (!/^video\//.test(type) && !/\.(mp4|webm|mov|m4v|mkv)$/i.test(name)) fail('unsupported_media_type', 'Only video files can be uploaded');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const webm = await withTmp(async (dir) => {
    const src = join(dir, 'in' + (name.match(/\.\w+$/)?.[0] ?? '.bin'));
    await writeFile(src, bytes);
    let p;
    try {
      p = await probe(src);
    } catch {
      fail('unsupported_media_type', 'This file is not a video we can read');
    }
    if (!p.hasVideo) fail('unsupported_media_type', 'This file has no video track');
    const out = join(dir, 'out.webm');
    const isWebm = type === 'video/webm' || /\.webm$/i.test(name);
    if (isWebm) await ffmpeg(['-i', src, '-c', 'copy', out], 120_000);
    else
      await ffmpeg(
        [
          '-i', src,
          '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '32', '-b:v', '0',
          ...(p.hasAudio ? ['-c:a', 'libopus', '-b:a', '96k'] : ['-an']),
          out,
        ],
        10 * 60_000,
      );
    return { data: new Uint8Array(await readFile(out)), durationMs: p.durationMs };
  });

  const title = (input.title ?? name.replace(/\.\w+$/, '')).slice(0, 200);
  const created = await createCaptureRecord(db, {
    organizationId: input.workspaceId,
    clientId: uuidv7(),
    kind: 'video',
    folderId: input.folderId,
    page: { url: '', title },
    startedAt: Date.now(),
    durationMs: webm.durationMs ?? undefined,
    source: 'upload',
    author: await authorSnapshot(db, input.userId),
  });
  let [rec] = await db.select().from(recording).where(eq(recording.id, created.id));
  const n = Math.max(1, Math.ceil(webm.data.byteLength / LIMITS.chunkBytes));
  for (let i = 0; i < n; i++) {
    const part = webm.data.subarray(i * LIMITS.chunkBytes, (i + 1) * LIMITS.chunkBytes);
    await putChunk(db, rec!, 'video', i, part, new Headers({ 'content-type': 'video/webm' }));
  }
  [rec] = await db.select().from(recording).where(eq(recording.id, created.id));
  await completeStream(db, rec!, 'video', { lastSeq: n - 1, totalBytes: webm.data.byteLength });
  [rec] = await db.select().from(recording).where(eq(recording.id, created.id));
  const fin = await finalizeCapture(
    db,
    rec!,
    {
      title,
      description: '',
      annotations: [],
      folderId: input.folderId,
      destination: { type: 'link' },
      attachmentAssetIds: [],
      aiAccepted: false,
      durationMs: webm.durationMs ?? undefined,
    } as Parameters<typeof finalizeCapture>[2],
    { userId: input.userId },
  );
  void event;
  return { id: fin.id, shareUrl: fin.shareUrl };
}
