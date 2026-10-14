// Range-capable media proxy (architecture s7): the S3 endpoint stays internal and every media
// URL points here, at /api/v1/recordings/:id/media/:name (members) or /s/:token/media/:name
// (share links). Names: video, video-720 .. video-240, screenshot, full, thumb, voice, events,
// rrweb-000.., transcript, or an asset id of the capture.
import { and, asc, eq } from 'drizzle-orm';
import type { CaptureMedia } from '@toolbar/shared/api';
import type { Db } from '../db/index.ts';
import { asset, recordingChunk, recordingStream, transcript } from '../db/schema/index.ts';
import { getObject, keys, presignGet } from '../s3.ts';
import { env } from '../env.ts';
import type { RecordingRow } from '../share/access.ts';
import { errorJson } from '../share/http.ts';

export interface Rendition {
  label: string;
  height: number | null;
  key: string;
}

type AssetRow = typeof asset.$inferSelect;
interface Target {
  key: string;
  contentType: string;
  filename: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEVTOOLS_ONLY = /^(events|rrweb-\d+)$/;

/** Names that carry dev tools data; content-only share links (J-118) do not serve them. */
export const isDevtoolsMedia = (name: string) => DEVTOOLS_ONLY.test(name);

const slug = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'capture';
const ext = (ct: string) =>
  ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/webm': 'webm', 'audio/webm': 'webm', 'application/pdf': 'pdf' })[ct] ?? 'bin';

/** The image shown first (crop for area shots) and the kept full viewport (J-004, J-051). */
export function pickScreenshots(assets: AssetRow[]) {
  const crop = assets.find((a) => a.kind === 'crop');
  const shot = assets.find((a) => a.kind === 'screenshot');
  return { main: crop ?? shot ?? null, full: crop && shot ? shot : null };
}

async function resolveName(db: Db, rec: RecordingRow, name: string): Promise<Target | 'transcript' | null> {
  const base = slug(rec.title || `capture-${rec.id.slice(-6)}`);
  if (name === 'video' || name.startsWith('video-')) {
    if (name === 'video') {
      const [s] = await db
        .select()
        .from(recordingStream)
        .where(and(eq(recordingStream.recordingId, rec.id), eq(recordingStream.name, 'video')));
      if (!s?.finalKey) return null;
      return { key: s.finalKey, contentType: 'video/webm', filename: `${base}.webm` };
    }
    const r = ((rec.renditions as Rendition[] | null) ?? []).find((x) => `video-${x.height}` === name);
    return r ? { key: r.key, contentType: 'video/webm', filename: `${base}-${r.height}p.webm` } : null;
  }
  if (name === 'voice') {
    const [s] = await db
      .select()
      .from(recordingStream)
      .where(and(eq(recordingStream.recordingId, rec.id), eq(recordingStream.name, 'voice')));
    return s?.finalKey ? { key: s.finalKey, contentType: 'audio/webm', filename: `${base}-voice.webm` } : null;
  }
  if (name === 'thumb') return rec.thumbKey ? { key: rec.thumbKey, contentType: 'image/webp', filename: `${base}-thumb.webp` } : null;
  if (name === 'events') {
    const [s] = await db
      .select()
      .from(recordingStream)
      .where(and(eq(recordingStream.recordingId, rec.id), eq(recordingStream.name, 'events')));
    const key = s?.finalKey ?? (rec.status === 'ready' ? keys.final(rec.id, 'events.json.gz') : null);
    return key ? { key, contentType: 'application/gzip', filename: `${base}-events.json.gz` } : null;
  }
  if (name === 'transcript') return 'transcript';
  const rr = name.match(/^rrweb-(\d+)$/);
  if (rr) {
    const [c] = await db
      .select()
      .from(recordingChunk)
      .where(and(eq(recordingChunk.recordingId, rec.id), eq(recordingChunk.stream, 'rrweb'), eq(recordingChunk.seq, Number(rr[1]))));
    return c ? { key: c.s3Key, contentType: 'application/gzip', filename: `${base}-rrweb-${rr[1]}.ndjson.gz` } : null;
  }
  if (name === 'screenshot' || name === 'full') {
    const assets = await db.select().from(asset).where(eq(asset.recordingId, rec.id));
    const { main, full } = pickScreenshots(assets);
    const a = name === 'screenshot' ? main : full;
    return a ? { key: a.s3Key, contentType: a.contentType, filename: `${base}${name === 'full' ? '-full' : ''}.${ext(a.contentType)}` } : null;
  }
  if (UUID.test(name)) {
    const [a] = await db
      .select()
      .from(asset)
      .where(and(eq(asset.id, name), eq(asset.recordingId, rec.id)));
    return a ? { key: a.s3Key, contentType: a.contentType, filename: a.name ?? `${base}-${a.kind}.${ext(a.contentType)}` } : null;
  }
  return null;
}

/** Serve one media object with Range support. `rec` must already have passed the access check. */
export async function serveMedia(db: Db, rec: RecordingRow, name: string, request: Request, cacheControl = 'private, no-cache'): Promise<Response> {
  if (rec.deletedAt) return errorJson('not_found', 'This capture was deleted');
  const target = await resolveName(db, rec, name);
  if (!target) return errorJson('not_found', `No ${name} media for this capture`);
  const download = new URL(request.url).searchParams.has('download');
  if (target === 'transcript') {
    const [t] = await db
      .select()
      .from(transcript)
      .where(and(eq(transcript.recordingId, rec.id), eq(transcript.status, 'done')))
      .limit(1);
    if (!t?.vtt) return errorJson('not_found', 'No transcript');
    return new Response(t.vtt, { headers: { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': cacheControl } });
  }
  // Anything a browser could render as a document is served as a download (attachments).
  const inline = /^(image\/(png|jpeg|webp|gif)|video\/|audio\/|application\/gzip$)/.test(target.contentType);
  return proxyObject(target.key, request, {
    contentType: target.contentType,
    cacheControl,
    disposition: download || !inline ? `attachment; filename="${target.filename.replace(/["\\\r\n]/g, '')}"` : undefined,
  });
}

export async function proxyObject(key: string, request: Request, opts: { contentType: string; cacheControl: string; disposition?: string }): Promise<Response> {
  // With S3_PUBLIC_URL set, hand out a short-lived presigned URL instead of streaming (architecture s7).
  const signed = await presignGet(key, { contentType: opts.contentType, disposition: opts.disposition, expiresIn: 600 });
  if (signed) return new Response(null, { status: 302, headers: { location: signed, 'cache-control': 'private, no-store' } });
  const range = request.headers.get('range') ?? undefined;
  if (range && !/^bytes=\d*-\d*$/.test(range.trim())) return rangeNotSatisfiable();
  const inm = request.headers.get('if-none-match');
  let obj;
  try {
    obj = await getObject(key, range);
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return errorJson('not_found', 'Media is gone');
    if (status === 416) return rangeNotSatisfiable();
    throw e;
  }
  const h = new Headers({
    'content-type': opts.contentType,
    'accept-ranges': 'bytes',
    'cache-control': opts.cacheControl,
    'x-content-type-options': 'nosniff',
  });
  if (obj.ETag) h.set('etag', obj.ETag);
  if (obj.LastModified) h.set('last-modified', obj.LastModified.toUTCString());
  if (opts.disposition) h.set('content-disposition', opts.disposition);
  if (!range && inm && obj.ETag && inm === obj.ETag) {
    await obj.Body?.transformToByteArray().catch(() => {});
    return new Response(null, { status: 304, headers: h });
  }
  if (obj.ContentLength !== undefined) h.set('content-length', String(obj.ContentLength));
  let status = 200;
  if (range && obj.ContentRange) {
    status = 206;
    h.set('content-range', obj.ContentRange);
  }
  const body = obj.Body?.transformToWebStream() ?? null;
  return new Response(request.method === 'HEAD' ? null : body, { status, headers: h });
}

function rangeNotSatisfiable() {
  return new Response(null, { status: 416, headers: { 'content-range': 'bytes */*' } });
}

/** Media URLs for captureDetailSchema.media, against the member proxy or a share token's proxy. */
export async function captureMedia(db: Db, rec: RecordingRow, via: { shareToken?: string; devtools?: boolean } = {}): Promise<CaptureMedia> {
  const devtools = via.devtools !== false;
  const base = via.shareToken ? `${env.publicUrl}/s/${via.shareToken}/media` : `${env.publicUrl}/api/v1/recordings/${rec.id}/media`;
  const u = (name: string) => `${base}/${name}`;
  const streams = await db.select().from(recordingStream).where(eq(recordingStream.recordingId, rec.id));
  const byName = new Map(streams.map((s) => [s.name, s]));
  const assets = await db.select().from(asset).where(eq(asset.recordingId, rec.id));
  const { main, full } = pickScreenshots(assets);
  const rrweb = await db
    .select({ seq: recordingChunk.seq })
    .from(recordingChunk)
    .where(and(eq(recordingChunk.recordingId, rec.id), eq(recordingChunk.stream, 'rrweb')))
    .orderBy(asc(recordingChunk.seq));
  const [tr] = await db
    .select({ status: transcript.status })
    .from(transcript)
    .where(eq(transcript.recordingId, rec.id))
    .limit(1);
  const renditions = (rec.renditions as Rendition[] | null) ?? [];
  const video = byName.get('video')?.finalKey
    ? {
        url: u('video'),
        mime: 'video/webm',
        width: rec.videoWidth,
        height: rec.videoHeight,
        durationMs: rec.durationMs,
        renditions: [
          { label: 'Original', height: rec.videoHeight, url: u('video') },
          ...renditions.filter((r) => r.height !== null).map((r) => ({ label: `${r.height}p`, height: r.height, url: u(`video-${r.height}`) })),
        ],
      }
    : null;
  const assetDto = (a: AssetRow, url: string) => ({
    id: a.id,
    kind: a.kind,
    url,
    contentType: a.contentType,
    width: a.width,
    height: a.height,
    bytes: a.bytes,
    name: a.name,
  });
  return {
    video,
    screenshot: main ? assetDto(main, u('screenshot')) : null,
    fullScreenshot: full ? assetDto(full, u('full')) : null,
    thumbUrl: rec.thumbKey ? u('thumb') : null,
    eventsUrl: devtools && (byName.get('events')?.finalKey || rec.status === 'ready') ? u('events') : null,
    rrwebUrls: (devtools ? rrweb : []).map((r) => u(`rrweb-${String(r.seq).padStart(3, '0')}`)),
    voiceUrl: byName.get('voice')?.finalKey ? u('voice') : null,
    transcriptVttUrl: tr?.status === 'done' ? u('transcript') : null,
  };
}
