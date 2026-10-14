// Chunk queue (architecture s5, D-009). Each producer writes a chunk to IndexedDB `uploads`
// (key [recordingId, stream, seq]) before uploading and deletes it after a 2xx, so a killed
// worker, a closed offscreen document or a browser restart loses nothing that reached IndexedDB.
// Rows are keyed by the local capture id until the server id is known; `rekey` moves them.
import type { StreamName } from '@toolbar/shared';
import type { UploadRow } from '@toolbar/shared/ext';
import { idbDelete, idbGetAll, idbPut, idbPutMany, openDb, prefixRange } from '../idb';
import { HttpError, api, sha256Hex, type UploadAuthLike } from './client';

export const MAX_BACKOFF_MS = 60_000;
export const backoffMs = (attempts: number) => Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempts - 1));

export async function enqueueChunk(row: Omit<UploadRow, 'attempts' | 'sha256'> & { sha256?: string }): Promise<UploadRow> {
  const full: UploadRow = { ...row, sha256: row.sha256 ?? (await sha256Hex(row.body)), attempts: 0 };
  await idbPut('uploads', full);
  return full;
}

export async function pendingRows(recordingId: string, stream?: StreamName): Promise<UploadRow[]> {
  return idbGetAll<UploadRow>('uploads', stream ? prefixRange(recordingId, stream) : prefixRange(recordingId));
}

export async function allPendingIds(): Promise<string[]> {
  const db = await openDb();
  const out = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction('uploads').objectStore('uploads').openKeyCursor(null, 'nextunique');
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const id = (c.key as [string])[0];
      out.add(id);
      c.continue([id, []] as IDBValidKey);
    };
    req.onerror = () => reject(req.error);
  });
  return [...out];
}

/** Moves rows from a local id to the server id (after POST /recordings answered). */
export async function rekey(fromId: string, toId: string): Promise<number> {
  if (fromId === toId) return 0;
  const rows = await pendingRows(fromId);
  if (!rows.length) return 0;
  await idbPutMany('uploads', rows.map((r) => ({ ...r, recordingId: toId })));
  await idbDelete('uploads', prefixRange(fromId));
  return rows.length;
}

export async function dropRows(recordingId: string): Promise<void> {
  await idbDelete('uploads', prefixRange(recordingId));
}

/** Uploads one row; deletes it on 2xx (new or duplicate). Throws HttpError otherwise. */
export async function sendRow(auth: UploadAuthLike, serverId: string, row: UploadRow): Promise<void> {
  try {
    await api.putChunk(auth, serverId, row.stream as StreamName, row.seq, row.body, row);
  } catch (e) {
    if (e instanceof HttpError && !e.retryable && e.code !== 'unauthorized') {
      // 409 hash_mismatch or 410/422: the server will never take this row; keep a record and drop it.
      await idbDelete('uploads', [row.recordingId, row.stream, row.seq]);
    } else {
      await idbPut('uploads', { ...row, attempts: row.attempts + 1 });
    }
    throw e;
  }
  await idbDelete('uploads', [row.recordingId, row.stream, row.seq]);
}

export interface DrainResult {
  sent: number;
  failed: number;
  lastError: HttpError | null;
}

/**
 * Sends every queued row of a capture, in seq order per stream, with up to `parallel` PUTs in
 * flight. Retryable failures stay queued for the next drain.
 */
export async function drain(auth: UploadAuthLike, rowKey: string, serverId: string, opts: { parallel?: number; stream?: StreamName; onProgress?: (sent: number) => void } = {}): Promise<DrainResult> {
  const rows = (await pendingRows(rowKey, opts.stream)).sort((a, b) => (a.stream === b.stream ? a.seq - b.seq : a.stream < b.stream ? -1 : 1));
  let sent = 0;
  let failed = 0;
  let lastError: HttpError | null = null;
  let i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const row = rows[i++]!;
      try {
        await sendRow(auth, serverId, row);
        sent++;
        opts.onProgress?.(sent);
      } catch (e) {
        failed++;
        lastError = e instanceof HttpError ? e : new HttpError(0, 'network', String(e));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.parallel ?? 3) }, worker));
  return { sent, failed, lastError };
}

/** Resume after a restart: rows the server already holds with the same hash are dropped. */
export async function reconcile(auth: UploadAuthLike, rowKey: string, serverId: string, stream: StreamName): Promise<number> {
  const rows = await pendingRows(rowKey, stream);
  if (!rows.length) return 0;
  const held = await api.listChunks(auth, serverId, stream);
  const bySeq = new Map(held.chunks.map((c) => [c.seq, c.sha256]));
  let dropped = 0;
  for (const r of rows) {
    if (bySeq.get(r.seq) === r.sha256) {
      await idbDelete('uploads', [r.recordingId, r.stream, r.seq]);
      dropped++;
    }
  }
  return dropped;
}

/** Retries `fn` with exponential backoff (1 s to 60 s) while it fails with a retryable error. */
export async function withRetry<T>(fn: () => Promise<T>, opts: { tries?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const tries = opts.tries ?? 6;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof HttpError) || !e.retryable || attempt >= tries) throw e;
      await sleep(backoffMs(attempt));
    }
  }
}
