// Still frames from a capture's video for agents (J-149 getFrames, J-247 CLI frames): one JPEG
// at a player time, or a 4x3 overview grid. The video is fetched from S3 once per capture
// version into a temp folder and reused.
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { recordingStream } from '../db/schema/index.ts';
import { getBytes } from '../s3.ts';
import { ffmpeg, probe } from '../media/ffmpeg.ts';
import { fail } from '../share/http.ts';
import type { RecordingRow } from '../share/access.ts';

const DIR = join(tmpdir(), 'tb-agent-frames');
export const FRAME_SIZES = { '360': 360, '720': 720, '1080': 1080 } as const;
export type FrameSize = keyof typeof FRAME_SIZES;

async function localVideo(db: Db, rec: RecordingRow): Promise<string> {
  if (rec.kind !== 'video' && rec.kind !== 'screen') fail('conflict', `This capture is a ${rec.kind}, not a video. Use the screenshot instead.`);
  const [s] = await db
    .select({ finalKey: recordingStream.finalKey })
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, rec.id), eq(recordingStream.name, 'video')))
    .limit(1);
  if (!s?.finalKey) fail('conflict', `The video is not ready yet (status ${rec.status}).`);
  await mkdir(DIR, { recursive: true });
  const path = join(DIR, `${rec.id}-${rec.updatedAt.getTime()}.webm`);
  const have = await stat(path).catch(() => null);
  if (!have?.size) await writeFile(path, await getBytes(s!.finalKey!));
  return path;
}

async function durationMs(path: string, rec: RecordingRow): Promise<number> {
  if (rec.durationMs) return rec.durationMs;
  const p = await probe(path).catch(() => null);
  return p?.durationMs ?? 0;
}

async function grab(args: string[]): Promise<Buffer> {
  const out = join(DIR, `f-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  try {
    await ffmpeg([...args, '-frames:v', '1', '-q:v', '3', out], 60_000);
    return await readFile(out);
  } finally {
    await rm(out, { force: true });
  }
}

/** One frame at `atMs` (player ms), scaled to `size` px high. Times past the end clamp to the last frame. */
export async function frameAt(db: Db, rec: RecordingRow, atMs: number, size: FrameSize = '720'): Promise<{ jpeg: Buffer; atMs: number }> {
  const path = await localVideo(db, rec);
  const dur = await durationMs(path, rec);
  const at = Math.max(0, dur ? Math.min(atMs, Math.max(0, dur - 120)) : atMs);
  const h = FRAME_SIZES[size];
  const jpeg = await grab(['-ss', (at / 1000).toFixed(3), '-i', path, '-vf', `scale=-2:${h}`]);
  return { jpeg, atMs: at };
}

/** A 4x3 grid of evenly spaced frames; returns the times of the twelve cells. */
export async function overview(db: Db, rec: RecordingRow, size: FrameSize = '720'): Promise<{ jpeg: Buffer; times: number[] }> {
  const path = await localVideo(db, rec);
  const dur = Math.max(1000, await durationMs(path, rec));
  const cellH = Math.round(FRAME_SIZES[size] / 3 / 2) * 2;
  const step = dur / 12;
  const times = Array.from({ length: 12 }, (_, i) => Math.round(step * i + step / 2));
  const fps = 12 / (dur / 1000);
  const jpeg = await grab(['-i', path, '-vf', `fps=${fps.toFixed(5)},scale=-2:${cellH},tile=4x3:padding=4:color=white`]);
  return { jpeg, times };
}

/** Evenly spaced times across a range, for "N frames between A and B". */
export function spread(fromMs: number, toMs: number, count: number): number[] {
  const n = Math.max(1, Math.min(12, Math.round(count)));
  if (n === 1) return [Math.round((fromMs + toMs) / 2)];
  const step = (toMs - fromMs) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(fromMs + step * i));
}
