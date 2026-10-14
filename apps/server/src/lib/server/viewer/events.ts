// Load a capture's merged events (rec/<id>/events.json.gz, written at finalize) and compute the
// event index from them. server-core computes the index at finalize (lib/server/event-index.ts);
// until that lands, and for captures finalized before it, the viewer computes it here and caches it.
import { gunzipSync } from 'node:zlib';
import type { CaptureEvent } from '@toolbar/shared';
import type { EventIndex } from '@toolbar/shared/api';
import { buildTimeMap, computeEventIndex } from '@toolbar/ui/viewer';
import { getObject, keys } from '#lib/server/s3.ts';
import type { RecordingRow } from './access.ts';

const cache = new Map<string, { stamp: number; events: CaptureEvent[] }>();
const MAX = 64;

async function bytesOf(body: unknown): Promise<Uint8Array> {
  const b = body as { transformToByteArray?: () => Promise<Uint8Array> };
  if (b?.transformToByteArray) return b.transformToByteArray();
  throw new Error('unexpected S3 body');
}

export async function loadEvents(rec: RecordingRow): Promise<CaptureEvent[]> {
  const stamp = rec.updatedAt.getTime();
  const hit = cache.get(rec.id);
  if (hit && hit.stamp === stamp) return hit.events;
  let events: CaptureEvent[] = [];
  try {
    const obj = await getObject(keys.final(rec.id, 'events.json.gz'));
    const raw = await bytesOf(obj.Body);
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : Buffer.from(raw).toString('utf8');
    const parsed = JSON.parse(text) as unknown;
    events = Array.isArray(parsed) ? (parsed as CaptureEvent[]) : [];
  } catch {
    events = [];
  }
  if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
  cache.set(rec.id, { stamp, events });
  return events;
}

export function indexOf(rec: RecordingRow, events: CaptureEvent[], hasVideo: boolean): { index: EventIndex; videoOffsetMs: number } {
  const map = buildTimeMap(events, rec.startedAt?.getTime() ?? null, hasVideo);
  return { index: computeEventIndex(events, map), videoOffsetMs: map.videoOffsetMs };
}
