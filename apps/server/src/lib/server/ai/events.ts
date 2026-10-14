// Load a capture's events for the summarizer: the finalized `events` object when there is one
// (time-sorted JSON array, gzip), otherwise the uploaded chunks so far (gzip NDJSON per chunk),
// since the editor asks while the draft is still open (J-083).
import { gunzipSync } from 'node:zlib';
import { and, asc, eq } from 'drizzle-orm';
import type { CaptureEvent } from '@toolbar/shared';
import type { Db } from '../db/index.ts';
import { recordingChunk, recordingStream } from '../db/schema/index.ts';
import { getObject, keys } from '../s3.ts';

const MAX_BYTES = 32 * 1024 * 1024;

async function bytesOf(key: string): Promise<Buffer | null> {
  try {
    const r = await getObject(key);
    const b = r.Body ? Buffer.from(await r.Body.transformToByteArray()) : null;
    return b;
  } catch {
    return null;
  }
}

export function decodeEvents(buf: Buffer): CaptureEvent[] {
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf, { maxOutputLength: MAX_BYTES }) : buf;
  const text = raw.toString('utf8').trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    try {
      return JSON.parse(text) as CaptureEvent[];
    } catch {
      return [];
    }
  }
  const out: CaptureEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as CaptureEvent);
    } catch {
      /* a torn line in an open chunk */
    }
  }
  return out;
}

export async function loadEvents(db: Db, recordingId: string): Promise<CaptureEvent[]> {
  const [stream] = await db
    .select({ finalKey: recordingStream.finalKey })
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, recordingId), eq(recordingStream.name, 'events')))
    .limit(1);
  const finalBuf = await bytesOf(stream?.finalKey ?? keys.final(recordingId, 'events.json.gz'));
  if (finalBuf) return decodeEvents(finalBuf);
  const chunks = await db
    .select({ key: recordingChunk.s3Key })
    .from(recordingChunk)
    .where(and(eq(recordingChunk.recordingId, recordingId), eq(recordingChunk.stream, 'events')))
    .orderBy(asc(recordingChunk.seq));
  const out: CaptureEvent[] = [];
  let total = 0;
  for (const c of chunks) {
    const b = await bytesOf(c.key);
    if (!b) continue;
    total += b.length;
    if (total > MAX_BYTES) break;
    out.push(...decodeEvents(b));
  }
  return out.sort((a, b) => a.t - b.t);
}
