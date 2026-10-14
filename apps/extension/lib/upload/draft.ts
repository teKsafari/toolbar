// Create a capture from a draft (J-086, J-087, J-189): the editor's create button calls
// uploadDraft(). It makes the server capture if recording did not already, moves queued chunks
// to the server id, uploads the events and rrweb slices kept locally until now, the screenshot
// assets, drains the queue, completes each stream and finalizes. Nothing of a screenshot or an
// instant replay reaches the server before this call.
import type { StreamName } from '@toolbar/shared';
import { LIMITS, STREAM_CONTENT_TYPES } from '@toolbar/shared/constants';
import type { Draft } from '@toolbar/shared/ext';
import type { FinalizeCaptureBody } from '@toolbar/shared/api';
import { getBlob, idbDelete } from '../idb';
import { api, gzip, HttpError, type UploadAuthLike } from './client';
import { drain, dropRows, enqueueChunk, pendingRows, rekey, withRetry } from './queue';

/** Raw NDJSON bytes per chunk before gzip; well under the 8 MiB chunk cap after compression. */
export const NDJSON_CHUNK_RAW = 4 * 1024 * 1024;

/** Splits NDJSON lines into gzip chunks and queues them. Returns the stream summary. */
export async function enqueueNdjson(rowKey: string, stream: 'events' | 'rrweb', ndjson: string, firstSeq = 0, times?: { t0: number; t1: number }): Promise<{ lastSeq: number; totalBytes: number } | null> {
  const lines = ndjson.split('\n').filter((l) => l.trim());
  if (!lines.length) return null;
  let seq = firstSeq;
  let totalBytes = 0;
  let buf: string[] = [];
  let size = 0;
  const flush = async () => {
    if (!buf.length) return;
    const text = buf.join('\n') + '\n';
    const body = await gzip(text);
    const first = timeOf(buf[0]!) ?? times?.t0 ?? 0;
    const last = timeOf(buf[buf.length - 1]!) ?? times?.t1 ?? first;
    await enqueueChunk({ recordingId: rowKey, stream, seq, body, t0: first, t1: last, contentType: STREAM_CONTENT_TYPES[stream], contentEncoding: 'gzip' });
    totalBytes += body.size;
    seq++;
    buf = [];
    size = 0;
  };
  for (const l of lines) {
    if (size + l.length > NDJSON_CHUNK_RAW && buf.length) await flush();
    buf.push(l);
    size += l.length + 1;
  }
  await flush();
  return { lastSeq: seq - 1, totalBytes };
}

function timeOf(line: string): number | undefined {
  const m = /"(?:t|timestamp)":(\d+(?:\.\d+)?)/.exec(line);
  return m ? Number(m[1]) : undefined;
}

export interface UploadDraftOptions {
  auth: UploadAuthLike;
  workspaceId: string;
  /** progress callback: chunks sent and total */
  onProgress?: (sent: number, total: number) => void;
}

export interface UploadDraftResult {
  recordingId: string;
  shareUrl: string;
  status: string;
  issue: unknown;
  issueError: string | null;
}

/** Everything create needs to do. Throws HttpError when the server refuses or stays down. */
export async function uploadDraft(draft: Draft, finalize: FinalizeCaptureBody, opts: UploadDraftOptions): Promise<UploadDraftResult> {
  const { auth } = opts;
  const rowKey = draft.uploadKey ?? draft.clientId;
  let id = draft.recordingId;
  let shareUrl = draft.shareUrl ?? '';
  if (!id) {
    const created = await withRetry(() =>
      api.createCapture(auth, {
        clientId: draft.clientId,
        kind: draft.kind,
        workspaceId: finalize.workspaceId ?? opts.workspaceId,
        ...(draft.folderId ? { folderId: draft.folderId } : {}),
        page: { url: draft.pageUrl, title: draft.pageTitle },
        startedAt: draft.startedAt ?? draft.createdAt,
        ...(draft.env ? { env: draft.env } : {}),
        ...(draft.durationMs !== null ? { durationMs: Math.round(draft.durationMs) } : {}),
      }),
    );
    id = created.id;
    shareUrl = created.shareUrl;
  }
  await rekey(rowKey, id);

  const streams: Partial<Record<StreamName, { lastSeq: number; totalBytes: number }>> = { ...(draft.streams ?? {}) };
  for (const [stream, blobId] of [
    ['events', draft.eventsBlobId],
    ['rrweb', draft.rrwebBlobId],
  ] as const) {
    if (!blobId || streams[stream]) continue;
    const blob = await getBlob(blobId);
    if (!blob) continue;
    const s = await enqueueNdjson(id, stream, await blob.text());
    if (s) streams[stream] = s;
  }
  if (draft.replaySegmentBlobIds?.length && !streams.video) {
    let seq = 0;
    let totalBytes = 0;
    for (const bid of draft.replaySegmentBlobIds) {
      const b = await getBlob(bid);
      if (!b) continue;
      await enqueueChunk({ recordingId: id, stream: 'video', seq, body: b, t0: 0, t1: 0, contentType: STREAM_CONTENT_TYPES.video, contentEncoding: null });
      totalBytes += b.size;
      seq++;
    }
    if (seq) streams.video = { lastSeq: seq - 1, totalBytes };
  }

  const body: FinalizeCaptureBody = { ...finalize };
  if (!body.screenshotAssetId && draft.screenshotBlobId) {
    const shot = await getBlob(draft.screenshotBlobId);
    if (shot) {
      const isCrop = !!draft.crop;
      const a = await withRetry(() => api.uploadAsset(auth, { kind: isCrop ? 'crop' : 'screenshot', recordingId: id! }, shot, 'screenshot.png'));
      body.screenshotAssetId = a.id;
    }
  }
  if (body.fullScreenshotAssetId === undefined && draft.crop && draft.keepFull && draft.fullBlobId) {
    const full = await getBlob(draft.fullBlobId);
    if (full) body.fullScreenshotAssetId = (await withRetry(() => api.uploadAsset(auth, { kind: 'screenshot', recordingId: id! }, full, 'viewport.png'))).id;
  }

  const total = (await pendingRows(id)).length;
  for (let attempt = 1; ; attempt++) {
    const r = await drain(auth, id, id, { parallel: 4, onProgress: (n) => opts.onProgress?.(n, total) });
    if (!r.failed) break;
    if (r.lastError && !r.lastError.retryable) throw r.lastError;
    if (attempt >= 6) throw r.lastError ?? new HttpError(0, 'network', 'upload failed');
    await new Promise((res) => setTimeout(res, Math.min(60_000, 1000 * 2 ** (attempt - 1))));
  }
  for (const [stream, s] of Object.entries(streams)) {
    if (!s) continue;
    await withRetry(() => api.completeStream(auth, id!, stream as StreamName, s));
  }
  if (draft.metadata && !body.metadata) body.metadata = draft.metadata;
  if (body.durationMs === undefined && draft.durationMs !== null) body.durationMs = Math.round(draft.durationMs);
  const res = await withRetry(() => api.finalize(auth, id!, body));
  return { recordingId: res.id, shareUrl: res.shareUrl || shareUrl, status: res.status, issue: res.issue, issueError: res.issueError };
}

/** Discard (J-189): delete what reached the server and everything kept locally. */
export async function discardDraftData(draft: Draft, auth: UploadAuthLike | null): Promise<void> {
  if (draft.recordingId && auth) {
    try {
      await api.deleteCapture(auth, draft.recordingId);
    } catch {
      /* the server's purge job also expires unfinalized captures */
    }
  }
  await dropRows(draft.uploadKey ?? draft.clientId);
  if (draft.recordingId) await dropRows(draft.recordingId);
  const blobIds = [draft.screenshotBlobId, draft.fullBlobId, draft.thumbBlobId, draft.videoBlobId, draft.voiceBlobId, draft.eventsBlobId, draft.rrwebBlobId, ...(draft.replaySegmentBlobIds ?? []), ...draft.attachmentBlobIds];
  for (const b of blobIds) if (b) await idbDelete('blobs', b);
}

export { LIMITS };
