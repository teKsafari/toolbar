// STAND-INS for server-core routes the capture page calls: the media proxy, share settings and
// capture delete. They let the viewer branch run end to end against the seed data. At the merge,
// server-core's handlers replace the route files that call this module, and this file goes.
// Keep it small and contract-shaped (captures.media, sharing.get, captures.delete).
import { and, eq, isNull } from 'drizzle-orm';
import type { Asset, ShareLink, ShareSettings } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { asset, recording, recordingChunk, recordingStream, shareLink } from '#lib/server/db/schema/index.ts';
import { env } from '#lib/server/env.ts';
import { getObject, keys, putObject } from '#lib/server/s3.ts';
import { seal, unseal } from '#lib/server/crypto.ts';
import { hashToken } from '#lib/server/tokens.ts';
import type { RecordingRow } from './access.ts';

async function keyFor(rec: RecordingRow, name: string): Promise<{ key: string; type: string } | null> {
  const final = async (stream: string, file: string, type: string) => {
    const [s] = await db
      .select()
      .from(recordingStream)
      .where(and(eq(recordingStream.recordingId, rec.id), eq(recordingStream.name, stream as 'video')))
      .limit(1);
    return s ? { key: s.finalKey ?? keys.final(rec.id, file), type } : null;
  };
  switch (name) {
    case 'video':
      return final('video', 'video.webm', 'video/webm');
    case 'voice':
      return final('voice', 'voice.webm', 'audio/webm');
    case 'events':
      return final('events', 'events.json.gz', 'application/gzip');
    case 'thumb':
      return rec.thumbKey ? { key: rec.thumbKey, type: 'image/webp' } : null;
    case 'screenshot':
    case 'full': {
      const rows = await db.select().from(asset).where(eq(asset.recordingId, rec.id));
      const crop = rows.find((a) => a.kind === 'crop');
      const shot = rows.find((a) => a.kind === 'screenshot');
      const a = name === 'full' ? (crop ? shot : undefined) : (crop ?? shot);
      return a ? { key: a.s3Key, type: a.contentType } : null;
    }
    default: {
      const rr = name.match(/^rrweb-(\d{1,6})$/);
      if (rr) {
        const [c] = await db
          .select()
          .from(recordingChunk)
          .where(and(eq(recordingChunk.recordingId, rec.id), eq(recordingChunk.stream, 'rrweb'), eq(recordingChunk.seq, Number(rr[1]))))
          .limit(1);
        return c ? { key: c.s3Key, type: 'application/gzip' } : null;
      }
      if (!/^[0-9a-f-]{36}$/.test(name)) return null;
      const [a] = await db.select().from(asset).where(eq(asset.id, name)).limit(1);
      if (!a || (a.recordingId && a.recordingId !== rec.id)) return null;
      return { key: a.s3Key, type: a.contentType };
    }
  }
}

/** Range-capable proxy of one media object (206 on Range). */
export async function serveMedia(rec: RecordingRow, name: string, range: string | null, download: boolean): Promise<Response> {
  const k = await keyFor(rec, name);
  if (!k) return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  try {
    const obj = await getObject(k.key, range ?? undefined);
    const headers = new Headers({
      'content-type': obj.ContentType && obj.ContentType !== 'application/octet-stream' ? obj.ContentType : k.type,
      'accept-ranges': 'bytes',
      'cache-control': 'private, max-age=300',
    });
    if (obj.ContentLength != null) headers.set('content-length', String(obj.ContentLength));
    if (obj.ContentRange) headers.set('content-range', obj.ContentRange);
    if (download) {
      const ext = k.type.includes('webm') ? 'webm' : k.type.includes('png') ? 'png' : k.type.includes('webp') ? 'webp' : 'bin';
      const base = (rec.title || 'capture').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'capture';
      headers.set('content-disposition', `attachment; filename="${base}.${ext}"`);
    }
    const body = (obj.Body as { transformToWebStream: () => ReadableStream }).transformToWebStream();
    return new Response(body, { status: obj.ContentRange ? 206 : 200, headers });
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 416) return new Response(null, { status: 416 });
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } });
  }
}

const linkUrl = (token: string, devtools: boolean) => `${env.publicUrl}/s/${token}${devtools ? '' : '?devtools=0'}`;

/** Share settings with the default link; makes one when the capture has none. */
export async function shareSettings(rec: RecordingRow, userId: string): Promise<ShareSettings> {
  let rows = await db
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.recordingId, rec.id), isNull(shareLink.revokedAt)));
  if (!rows.length) {
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url');
    await db.insert(shareLink).values({ recordingId: rec.id, tokenHash: hashToken(token), tokenEnc: seal(token, 'share-token'), access: 'anyone', createdBy: userId });
    rows = await db.select().from(shareLink).where(and(eq(shareLink.recordingId, rec.id), isNull(shareLink.revokedAt)));
  }
  const toLink = (r: (typeof rows)[number], devtools: boolean): ShareLink => ({
    id: r.id,
    url: linkUrl(unseal(r.tokenEnc, 'share-token'), devtools),
    access: r.access,
    devtools,
    createdAt: r.createdAt.toISOString(),
    createdBy: null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: null,
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  });
  const main = rows[0]!;
  return { access: main.access, link: toLink(main, true), contentOnlyLink: toLink(main, false), links: rows.map((r) => toLink(r, true)) };
}

/** Archive: gone from lists and URLs, links revoked (J-114, J-191). The purge job is server-core's. */
export async function archiveCapture(rec: RecordingRow) {
  const now = new Date();
  await db.update(recording).set({ deletedAt: now }).where(eq(recording.id, rec.id));
  await db.update(shareLink).set({ revokedAt: now }).where(and(eq(shareLink.recordingId, rec.id), isNull(shareLink.revokedAt)));
  return { ok: true as const, purged: false };
}

/** Store an uploaded image for a capture (comment attachments). */
export async function uploadAssetStandIn(rec: RecordingRow, kind: string, file: File): Promise<Asset> {
  const id = crypto.randomUUID();
  const key = keys.asset(rec.id, id);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await putObject(key, bytes, file.type);
  await db.insert(asset).values({ id, recordingId: rec.id, kind: kind as 'screenshot', s3Key: key, contentType: file.type, bytes: bytes.length });
  return { id, kind: kind as Asset['kind'], url: `/api/v1/recordings/${rec.id}/media/${id}`, contentType: file.type, width: null, height: null, bytes: bytes.length, name: file.name || null };
}
