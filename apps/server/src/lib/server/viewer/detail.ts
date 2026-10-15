// GET /api/v1/recordings/:id body (captureDetailSchema) and the capture summary for PATCH.
// Media URLs point at the Range-capable proxies: /api/v1/recordings/:id/media/:name for members
// and /s/:token/media/:name for share-token viewers (server-core owns both handlers).
import { and, count, eq, isNull } from 'drizzle-orm';
import { buildPath, ROUTES, type CaptureDetail, type CaptureSummary } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { annotation, asset, comment, folder, recordingChunk, recordingLink, recordingStream, transcript, user } from '#lib/server/db/schema/index.ts';
import { env } from '#lib/server/env.ts';
import { videoRenditions } from '#lib/server/media/proxy.ts';
import type { RecordingRow, ViewerCtx } from './access.ts';
import { indexOf, loadEvents } from './events.ts';

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Base of media URLs for this viewer. */
export function mediaBase(rec: RecordingRow, ctx: Pick<ViewerCtx, 'share' | 'role'>): string {
  if (ctx.share && !ctx.role) return `/s/${ctx.share.token}/media`;
  return buildPath(ROUTES['captures.media'].path, { id: rec.id, name: 'x' }).replace(/\/x$/, '');
}

export async function captureSummary(rec: RecordingRow, ctx: Pick<ViewerCtx, 'share' | 'role'>): Promise<CaptureSummary> {
  const [author] = rec.authorUserId
    ? await db.select({ id: user.id, name: user.name, email: user.email, image: user.image }).from(user).where(eq(user.id, rec.authorUserId)).limit(1)
    : [];
  const [link] = rec.recordingLinkId
    ? await db.select({ name: recordingLink.name }).from(recordingLink).where(eq(recordingLink.id, rec.recordingLinkId)).limit(1)
    : [];
  const [cc] = await db
    .select({ n: count() })
    .from(comment)
    .where(and(eq(comment.recordingId, rec.id), isNull(comment.deletedAt)));
  const base = mediaBase(rec, ctx);
  return {
    id: rec.id,
    kind: rec.kind,
    status: rec.status,
    title: rec.title,
    pageUrl: rec.pageUrl,
    createdAt: rec.createdAt.toISOString(),
    durationMs: rec.durationMs,
    authorName: author?.name ?? rec.authorName,
    thumbUrl: rec.thumbKey ? `${base}/thumb` : null,
    workspaceId: rec.organizationId,
    folderId: rec.folderId,
    source: rec.recordingLinkId ? 'recording-link' : rec.source === 'injector' ? 'injector' : 'extension',
    author: author
      ? { id: author.id, name: author.name, email: author.email, image: author.image }
      : rec.authorName
        ? { id: null, name: rec.authorName, email: rec.authorEmail, image: null }
        : null,
    recordingLinkId: rec.recordingLinkId,
    recordingLinkName: link?.name ?? null,
    commentCount: cc?.n ?? 0,
    hasLinkedIssue: false,
    url: `${env.publicUrl}/c/${rec.id}`,
  };
}

/** Short folder id for the folder chip and /f/ URLs; folders have uuids, so the head will do. */
export const folderShortId = (id: string) => id.replace(/-/g, '').slice(-10);

export async function captureDetail(ctx: ViewerCtx): Promise<CaptureDetail> {
  const rec = ctx.rec;
  const summary = await captureSummary(rec, ctx);
  const base = mediaBase(rec, ctx);
  const streams = await db.select().from(recordingStream).where(eq(recordingStream.recordingId, rec.id));
  const assets = await db.select().from(asset).where(eq(asset.recordingId, rec.id));
  const anns = await db.select().from(annotation).where(eq(annotation.recordingId, rec.id));
  const [tr] = await db.select().from(transcript).where(eq(transcript.recordingId, rec.id)).limit(1);
  const rrwebChunks = await db
    .select({ seq: recordingChunk.seq })
    .from(recordingChunk)
    .where(and(eq(recordingChunk.recordingId, rec.id), eq(recordingChunk.stream, 'rrweb')))
    .orderBy(recordingChunk.seq);
  const [f] = rec.folderId ? await db.select().from(folder).where(eq(folder.id, rec.folderId)).limit(1) : [];
  const hasVideo = streams.some((s) => s.name === 'video' && s.finalKey);
  const events = await loadEvents(rec);
  const { index, videoOffsetMs } = indexOf(rec, events, hasVideo);
  const crop = assets.find((a) => a.kind === 'crop');
  const shot = assets.find((a) => a.kind === 'screenshot');
  const toAsset = (a: typeof asset.$inferSelect, name: string) => ({
    id: a.id,
    kind: a.kind,
    url: `${base}/${name}`,
    contentType: a.contentType,
    width: a.width,
    height: a.height,
    bytes: a.bytes,
    name: null,
  });
  const videoStream = streams.find((s) => s.name === 'video');
  const env0 = rec.env as CaptureDetail['env'];
  const access = ctx.share?.link.access ?? 'anyone';

  return {
    ...summary,
    description: rec.description,
    pageTitle: rec.pageTitle,
    startedAt: iso(rec.startedAt),
    updatedAt: rec.updatedAt.toISOString(),
    folder: f ? { id: f.id, shortId: folderShortId(f.id), name: f.name } : null,
    env: env0 ?? null,
    authorSnapshot: {
      userId: rec.authorUserId,
      name: rec.authorName,
      email: rec.authorEmail,
      image: null,
      issuer: rec.authorIssuer,
      subject: rec.authorSubject,
    },
    access,
    canEdit: ctx.canEdit,
    canComment: ctx.canComment,
    media: {
      video: hasVideo
        ? {
            url: `${base}/video`,
            mime: videoStream?.contentType ?? 'video/webm',
            width: (env0 as { viewport?: { w: number } } | null)?.viewport?.w ?? null,
            height: (env0 as { viewport?: { h: number } } | null)?.viewport?.h ?? null,
            durationMs: rec.durationMs,
            renditions: videoRenditions(rec, base),
          }
        : null,
      screenshot: crop ? toAsset(crop, 'screenshot') : shot ? toAsset(shot, 'screenshot') : null,
      fullScreenshot: crop && shot ? toAsset(shot, 'full') : null,
      thumbUrl: summary.thumbUrl,
      eventsUrl: streams.some((s) => s.name === 'events') ? `${base}/events` : null,
      rrwebUrls: rrwebChunks.map((c) => `${base}/rrweb-${String(c.seq).padStart(3, '0')}`),
      voiceUrl: streams.some((s) => s.name === 'voice' && s.finalKey) ? `${base}/voice` : null,
      transcriptVttUrl: null,
    },
    streams: streams.map((s) => ({ name: s.name, contentType: s.contentType, lastSeq: s.lastSeq, totalBytes: s.totalBytes, completed: !!s.completedAt })),
    index,
    annotations: anns.map((a) => ({
      id: a.id,
      assetId: a.assetId ?? undefined,
      t: a.t ?? undefined,
      shapes: (a.shapes as Record<string, unknown>[]) ?? [],
      target: (a.target as CaptureDetail['annotations'][number]['target']) ?? undefined,
      comment: a.comment ?? undefined,
      authorId: a.authorUserId,
      createdAt: a.createdAt.toISOString(),
    })),
    attachments: [],
    transcript: tr ? { status: tr.status, language: tr.language } : null,
    chapters: [],
    trim: null,
    linkedIssues: [],
    videoOffsetMs,
    // window.toolbar.setMetadata output stored at create (J-073)
    metadata: rec.metadata && typeof rec.metadata === 'object' && !Array.isArray(rec.metadata) ? (rec.metadata as Record<string, unknown>) : null,
  };
}

/** Parsed transcript cues (WebVTT) for captions and the transcript list (J-074, J-236). */
export async function transcriptCues(recordingId: string): Promise<{ startMs: number; endMs: number; text: string }[]> {
  const [tr] = await db.select().from(transcript).where(eq(transcript.recordingId, recordingId)).limit(1);
  if (!tr?.vtt || tr.status !== 'done') return [];
  return parseVtt(tr.vtt);
}

export function parseVtt(vtt: string): { startMs: number; endMs: number; text: string }[] {
  const ts = (s: string) => {
    const p = s.trim().split(':').map(Number);
    const [h, m, sec] = p.length === 3 ? p : [0, p[0]!, p[1]!];
    return Math.round(((h! * 60 + m!) * 60 + sec!) * 1000);
  };
  const out: { startMs: number; endMs: number; text: string }[] = [];
  for (const block of vtt.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i]!.split('-->');
    out.push({ startMs: ts(a!), endMs: ts(b!.trim().split(/\s+/)[0]!), text: lines.slice(i + 1).join('\n').trim() });
  }
  return out;
}
