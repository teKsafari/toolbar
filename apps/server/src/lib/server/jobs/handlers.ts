// Server-core job handlers (X-02): finalize-recording, remux-video, thumbnail, renditions,
// transcribe, chapters, purge-recording, expire-shares, sweep-drafts. Every handler is idempotent:
// a job interrupted by a crash runs again from the start and reaches the same result.
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { CaptureEvent, StreamName } from '@toolbar/shared';
import type { Trim } from '@toolbar/shared/api';
import { db as defaultDb, type Db } from '../db/index.ts';
import { asset, job, recording, recordingChunk, recordingStream, transcript } from '../db/schema/index.ts';
import { deleteKeys, getBytes, getObject, keys, putFile, putObjectWith } from '../s3.ts';
import { computeEventIndex, dedupeEvents, parseNdjson, parseRrwebNdjson, rrwebNdjsonParts, sortEvents, trimEvents, trimRrweb, videoOffsetOf } from '../event-index.ts';
import { imageThumb, joinWebm, posterFrame, probe, RENDITION_HEIGHTS, renderRendition, trimWebm, withTmp, type Probe } from '../media/ffmpeg.ts';
import { pickScreenshots, type Rendition } from '../media/proxy.ts';
import { createTranscriber, parseVtt } from '../transcribe/index.ts';
import { deleteStaleLinks } from '../share/tokens.ts';
import { purgeMedia, sha256hex } from '../upload/service.ts';
import { enqueue, type JobRow } from './queue.ts';
import { registerJob, RetryLater } from './worker.ts';
import { aiChapters, aiConfigured } from './chapters.ts';
import { aiAllowed } from '../dashboard/core.ts';

let db: Db = defaultDb;
/** Tests point the handlers at their own database. */
export function useDb(d: Db) {
  db = d;
}

const recIdOf = (payload: unknown) => {
  const id = (payload as { recordingId?: unknown })?.recordingId;
  if (typeof id !== 'string') throw new Error('payload.recordingId missing');
  return id;
};

async function loadRec(id: string) {
  const [rec] = await db.select().from(recording).where(eq(recording.id, id));
  return rec ?? null;
}

async function setProgress(id: string, p: number) {
  await db.update(recording).set({ processingProgress: p }).where(eq(recording.id, id));
}

async function chunksOf(recId: string, stream: StreamName) {
  return db
    .select()
    .from(recordingChunk)
    .where(and(eq(recordingChunk.recordingId, recId), eq(recordingChunk.stream, stream)))
    .orderBy(asc(recordingChunk.seq));
}

/** Chunk bodies from seq 0 up to the first gap. */
async function contiguousBodies(recId: string, stream: StreamName): Promise<Uint8Array[]> {
  const rows = await chunksOf(recId, stream);
  const out: Uint8Array[] = [];
  for (let i = 0; i < rows.length && rows[i]!.seq === i; i++) out.push(await getBytes(rows[i]!.s3Key));
  return out;
}

const gunzipMaybe = (b: Uint8Array) => (b[0] === 0x1f && b[1] === 0x8b ? gunzipSync(b) : Buffer.from(b));

/**
 * Events chunks are NDJSON, each gzipped on its own (architecture s5). A client that split one
 * gzip stream across chunks also works: the bodies are then joined before gunzip.
 */
export function decodeEventChunks(bodies: Uint8Array[]): CaptureEvent[] {
  try {
    return bodies.flatMap((b) => parseNdjson(gunzipMaybe(b).toString('utf8')).events);
  } catch {
    return parseNdjson(gunzipMaybe(Buffer.concat(bodies)).toString('utf8')).events;
  }
}

async function downloadToFile(key: string, path: string) {
  const r = await getObject(key);
  await pipeline(Readable.fromWeb(r.Body!.transformToWebStream() as import('node:stream/web').ReadableStream), createWriteStream(path));
}

async function setStreamFinal(recId: string, name: StreamName, contentType: string, finalKey: string, bytes?: number) {
  await db
    .insert(recordingStream)
    .values({ recordingId: recId, name, contentType, finalKey, totalBytes: bytes ?? 0, completedAt: new Date() })
    .onConflictDoUpdate({ target: [recordingStream.recordingId, recordingStream.name], set: { finalKey, completedAt: sql`coalesce(${recordingStream.completedAt}, now())` } });
}

// ---------- finalize-recording ----------

export async function finalizeRecording(payload: unknown, j: Pick<JobRow, 'attempts' | 'max_attempts'>) {
  const id = recIdOf(payload);
  const rec = await loadRec(id);
  if (!rec || rec.deletedAt || rec.status === 'ready') return;
  try {
    await runFinalize(rec, j.attempts);
  } catch (e) {
    if (!(e instanceof RetryLater) && j.attempts >= j.max_attempts) {
      await db
        .update(recording)
        .set({ status: 'failed', processingError: e instanceof Error ? e.message.slice(0, 1000) : String(e) })
        .where(eq(recording.id, id));
    }
    throw e;
  }
}

async function runFinalize(rec: typeof recording.$inferSelect, attempts: number) {
  const id = rec.id;
  const streams = await db.select().from(recordingStream).where(eq(recordingStream.recordingId, id));
  const chunkCounts = await db
    .select({ stream: recordingChunk.stream, n: sql<number>`count(*)::int` })
    .from(recordingChunk)
    .where(eq(recordingChunk.recordingId, id))
    .groupBy(recordingChunk.stream);
  const has = (s: StreamName) => (chunkCounts.find((c) => c.stream === s)?.n ?? 0) > 0;
  // Streams still uploading (J-087: create can come before the last chunks): wait, then use what arrived.
  const open = streams.filter((s) => !s.completedAt && has(s.name));
  if (open.length && attempts < 8) throw new RetryLater(`waiting for streams ${open.map((s) => s.name).join(', ')}`, 3000);
  await setProgress(id, 0.1);

  // events
  const trim = (rec.trim as Trim | null) ?? null;
  let startedAt = (rec.startedAt ?? rec.createdAt).getTime();
  let events: CaptureEvent[] = [];
  if (has('events')) {
    events = decodeEventChunks(await contiguousBodies(id, 'events'));
  } else {
    const prior = streams.find((s) => s.name === 'events')?.finalKey;
    if (prior) events = JSON.parse(gunzipSync(await getBytes(prior)).toString('utf8')) as CaptureEvent[];
  }
  events = sortEvents(dedupeEvents(events));
  const videoOffsetMs = videoOffsetOf(events, startedAt);
  if (trim) {
    // The DOM replay is cut to the same range as the logs (J-227), before startedAt moves.
    if (has('rrweb')) await trimRrwebStream(id, startedAt + videoOffsetMs + trim.startMs, startedAt + videoOffsetMs + trim.endMs);
    ({ events, startedAt } = trimEvents(events, startedAt, videoOffsetMs, trim));
  }
  const eventsKey = keys.final(id, 'events.json.gz');
  const gz = gzipSync(JSON.stringify(events));
  await putObjectWith(eventsKey, gz, { contentType: 'application/gzip' });
  await setStreamFinal(id, 'events', 'application/x-ndjson', eventsKey, gz.byteLength);
  const index = computeEventIndex(events, startedAt);
  await setProgress(id, 0.3);

  let durationMs: number | null = trim ? trim.endMs - trim.startMs : rec.durationMs;
  let width: number | null = rec.videoWidth;
  let height: number | null = rec.videoHeight;
  let thumbKey: string | null = rec.thumbKey;
  let hasVideo = false;
  let hasVoice = false;

  await withTmp(async (dir) => {
    // video
    if (has('video')) {
      const joined = join(dir, 'video.webm');
      await joinWebm(dir, await contiguousBodies(id, 'video'), joined, 'video');
      let p: Probe = await probe(joined);
      let out = joined;
      if (trim) {
        out = join(dir, 'video-trim.webm');
        await trimWebm(joined, out, trim.startMs, Math.min(trim.endMs, p.durationMs ?? trim.endMs), p);
        p = await probe(out);
      }
      await setProgress(id, 0.6);
      const key = keys.final(id, 'video.webm');
      const bytes = await putFile(key, out, 'video/webm');
      await setStreamFinal(id, 'video', 'video/webm', key, bytes);
      durationMs = p.durationMs ?? durationMs;
      width = p.width;
      height = p.height;
      hasVideo = p.hasVideo;
      if (p.hasVideo) {
        const thumb = join(dir, 'thumb.webp');
        await posterFrame(out, thumb, Math.min(1000, Math.max(0, (p.durationMs ?? 0) / 2)));
        thumbKey = keys.final(id, 'thumb.webp');
        await putFile(thumbKey, thumb, 'image/webp');
      }
    }
    // voice (mic only, used for transcription)
    if (has('voice')) {
      const joined = join(dir, 'voice.webm');
      await joinWebm(dir, await contiguousBodies(id, 'voice'), joined, 'voice');
      let out = joined;
      if (trim) {
        const p = await probe(joined);
        out = join(dir, 'voice-trim.webm');
        await trimWebm(joined, out, trim.startMs, Math.min(trim.endMs, p.durationMs ?? trim.endMs), p);
      }
      const key = keys.final(id, 'voice.webm');
      const bytes = await putFile(key, out, 'audio/webm');
      await setStreamFinal(id, 'voice', 'audio/webm', key, bytes);
      hasVoice = true;
    }
    // screenshot stream: a PNG sent as chunks instead of POST /assets
    if (has('screenshot')) {
      const assets = await db.select().from(asset).where(eq(asset.recordingId, id));
      if (!assets.some((a) => a.kind === 'screenshot' || a.kind === 'crop')) {
        const png = Buffer.concat(await contiguousBodies(id, 'screenshot'));
        const [row] = await db
          .insert(asset)
          .values({ recordingId: id, kind: 'screenshot', s3Key: '', contentType: 'image/png', bytes: png.byteLength })
          .returning({ id: asset.id });
        const key = keys.asset(id, row!.id);
        await putObjectWith(key, png, { contentType: 'image/png' });
        await db.update(asset).set({ s3Key: key }).where(eq(asset.id, row!.id));
      }
    }
    // image captures: thumbnail from the shown image
    if (!hasVideo) {
      const all = await db.select().from(asset).where(eq(asset.recordingId, id));
      const { main } = pickScreenshots(all);
      // a DOM replay sends a still of the page as its card image (J-158)
      const still = main ? null : (all.find((a) => a.kind === 'thumb') ?? all.find((a) => a.kind === 'keyframe')); // a trace: its first keyframe
      if (still) {
        const src = join(dir, 'still');
        await writeFile(src, await getBytes(still.s3Key));
        const thumb = join(dir, 'thumb.webp');
        await imageThumb(src, thumb);
        thumbKey = keys.final(id, 'thumb.webp');
        await putFile(thumbKey, thumb, 'image/webp');
      }
      if (main) {
        const src = join(dir, 'shot');
        await writeFile(src, await getBytes(main.s3Key));
        const thumb = join(dir, 'thumb.webp');
        await imageThumb(src, thumb);
        thumbKey = keys.final(id, 'thumb.webp');
        await putFile(thumbKey, thumb, 'image/webp');
        width = main.width;
        height = main.height;
      }
    }
  });

  if ((await loadRec(id))?.deletedAt) return;
  if (durationMs === null && index.lastT !== null && rec.kind !== 'screenshot') durationMs = Math.max(0, Math.round(index.lastT - startedAt));
  await db
    .update(recording)
    .set({
      status: 'ready',
      startedAt: new Date(startedAt),
      durationMs,
      videoOffsetMs,
      videoWidth: hasVideo ? width : null,
      videoHeight: hasVideo ? height : null,
      eventIndex: index,
      thumbKey,
      processingProgress: 1,
      processingError: null,
    })
    .where(eq(recording.id, id));

  if (hasVideo && height && height > 240) await enqueue(db, 'renditions', { recordingId: id });
  if (hasVoice && createTranscriber()) {
    await db
      .insert(transcript)
      .values({ recordingId: id, stream: 'voice', provider: createTranscriber()!.id, status: 'pending' })
      .onConflictDoUpdate({ target: [transcript.recordingId, transcript.stream], set: { status: 'pending', error: null } });
    await enqueue(db, 'transcribe', { recordingId: id });
  }

  // Raw chunks are now inside the final files; rrweb chunks stay (they are the rrweb-NNN media).
  const done = await db
    .select({ key: recordingChunk.s3Key })
    .from(recordingChunk)
    .where(and(eq(recordingChunk.recordingId, id), inArray(recordingChunk.stream, ['video', 'voice', 'screenshot', 'events'])));
  await deleteKeys(done.map((d) => d.key));
  await db.delete(recordingChunk).where(and(eq(recordingChunk.recordingId, id), inArray(recordingChunk.stream, ['video', 'voice', 'screenshot', 'events'])));
}

/**
 * Replace the rrweb chunks with the trimmed range (J-227). The new chunks go to fresh keys and the
 * rows swap in one transaction, so a crash at any point leaves either the old or the new set; the
 * trim is idempotent, so a rerun on the new set gives the same chunks.
 */
async function trimRrwebStream(id: string, from: number, to: number) {
  const rows = await chunksOf(id, 'rrweb');
  const bodies: Uint8Array[] = [];
  for (let i = 0; i < rows.length && rows[i]!.seq === i; i++) bodies.push(await getBytes(rows[i]!.s3Key));
  let rr;
  try {
    rr = bodies.flatMap((b) => parseRrwebNdjson(gunzipMaybe(b).toString('utf8')));
  } catch {
    rr = parseRrwebNdjson(gunzipMaybe(Buffer.concat(bodies)).toString('utf8'));
  }
  const parts = rrwebNdjsonParts(trimRrweb(rr, from, to));
  const gen = Date.now().toString(36);
  const fresh: (typeof recordingChunk.$inferInsert)[] = [];
  for (let seq = 0; seq < parts.length; seq++) {
    const body = gzipSync(parts[seq]!.text);
    const key = `${keys.recording(id)}rrweb-trim-${gen}/${String(seq).padStart(6, '0')}`;
    await putObjectWith(key, body, { contentType: 'application/x-ndjson', contentEncoding: 'gzip' });
    fresh.push({ recordingId: id, stream: 'rrweb', seq, s3Key: key, bytes: body.byteLength, sha256: sha256hex(body), t0: Math.round(parts[seq]!.t0), t1: Math.round(parts[seq]!.t1) });
  }
  await db.transaction(async (tx) => {
    await tx.delete(recordingChunk).where(and(eq(recordingChunk.recordingId, id), eq(recordingChunk.stream, 'rrweb')));
    if (fresh.length) await tx.insert(recordingChunk).values(fresh);
    await tx
      .update(recordingStream)
      .set({ lastSeq: fresh.length ? fresh.length - 1 : null, totalBytes: fresh.reduce((n, c) => n + c.bytes!, 0) })
      .where(and(eq(recordingStream.recordingId, id), eq(recordingStream.name, 'rrweb')));
  });
  const kept = new Set(fresh.map((c) => c.s3Key));
  await deleteKeys(rows.map((r) => r.s3Key).filter((k) => !kept.has(k)));
}

// ---------- remux-video: rebuild video.webm from video.webm (fix duration and cues) ----------

async function remuxVideo(payload: unknown) {
  const id = recIdOf(payload);
  const [s] = await db
    .select()
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, id), eq(recordingStream.name, 'video')));
  if (!s?.finalKey) return;
  await withTmp(async (dir) => {
    const src = join(dir, 'src.webm');
    await downloadToFile(s.finalKey!, src);
    const out = join(dir, 'out.webm');
    await joinWebm(dir, [await readFile(src)], out, 're');
    const p = await probe(out);
    await putFile(s.finalKey!, out, 'video/webm');
    if (p.durationMs) await db.update(recording).set({ durationMs: p.durationMs }).where(eq(recording.id, id));
  });
}

// ---------- thumbnail ----------

async function thumbnail(payload: unknown) {
  const id = recIdOf(payload);
  const atMs = Number((payload as { atMs?: number }).atMs ?? 1000);
  const rec = await loadRec(id);
  if (!rec || rec.deletedAt) return;
  const [s] = await db
    .select()
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, id), eq(recordingStream.name, 'video')));
  await withTmp(async (dir) => {
    const thumb = join(dir, 'thumb.webp');
    if (s?.finalKey) {
      const src = join(dir, 'v.webm');
      await downloadToFile(s.finalKey, src);
      await posterFrame(src, thumb, Math.min(atMs, Math.max(0, (rec.durationMs ?? 0) - 100)));
    } else {
      const { main } = pickScreenshots(await db.select().from(asset).where(eq(asset.recordingId, id)));
      if (!main) return;
      const src = join(dir, 'shot');
      await writeFile(src, await getBytes(main.s3Key));
      await imageThumb(src, thumb);
    }
    const key = keys.final(id, 'thumb.webp');
    await putFile(key, thumb, 'image/webp');
    await db.update(recording).set({ thumbKey: key }).where(eq(recording.id, id));
  });
}

// ---------- renditions (J-054: original plus 720p to 240p) ----------

async function renditions(payload: unknown) {
  const id = recIdOf(payload);
  const rec = await loadRec(id);
  if (!rec || rec.deletedAt) return;
  const [s] = await db
    .select()
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, id), eq(recordingStream.name, 'video')));
  if (!s?.finalKey) return;
  await withTmp(async (dir) => {
    const src = join(dir, 'src.webm');
    await downloadToFile(s.finalKey!, src);
    const p = await probe(src);
    const srcH = p.height ?? 0;
    const list: Rendition[] = [];
    for (const h of RENDITION_HEIGHTS) {
      if (h >= srcH) continue;
      const out = join(dir, `r${h}.webm`);
      await renderRendition(src, out, h, p.hasAudio);
      const key = keys.final(id, `video-${h}.webm`);
      if ((await loadRec(id))?.deletedAt) return; // deleted meanwhile: the purge job owns the prefix
      await putFile(key, out, 'video/webm');
      list.push({ label: `${h}p`, height: h, key });
      await db.update(recording).set({ renditions: list }).where(eq(recording.id, id));
    }
  });
}

// ---------- transcribe (J-074) ----------

async function transcribe(payload: unknown, j: JobRow) {
  const id = recIdOf(payload);
  const rec = await loadRec(id);
  if (!rec || rec.deletedAt) return;
  const t = createTranscriber();
  if (!t) return;
  const [s] = await db
    .select()
    .from(recordingStream)
    .where(and(eq(recordingStream.recordingId, id), eq(recordingStream.name, 'voice')));
  if (!s?.finalKey) return;
  await db
    .insert(transcript)
    .values({ recordingId: id, stream: 'voice', provider: t.id, status: 'running' })
    .onConflictDoUpdate({ target: [transcript.recordingId, transcript.stream], set: { status: 'running', provider: t.id, error: null } });
  try {
    const audio = await getBytes(s.finalKey);
    const r = await t.transcribe({ audio, mime: 'audio/webm' });
    const language = r.language ?? null;
    await db
      .update(transcript)
      .set({ status: 'done', vtt: r.vtt, model: r.model, language, error: null })
      .where(and(eq(transcript.recordingId, id), eq(transcript.stream, 'voice')));
    if (aiConfigured() && parseVtt(r.vtt).length && (await aiAllowed(db, rec.organizationId))) await enqueue(db, 'chapters', { recordingId: id });
  } catch (e) {
    const last = j.attempts >= j.max_attempts;
    await db
      .update(transcript)
      .set({ status: last ? 'failed' : 'pending', error: e instanceof Error ? e.message.slice(0, 1000) : String(e) })
      .where(and(eq(transcript.recordingId, id), eq(transcript.stream, 'voice')));
    throw e;
  }
}

// ---------- chapters (J-075) ----------

async function chapters(payload: unknown) {
  const id = recIdOf(payload);
  const rec = await loadRec(id);
  if (!rec || rec.deletedAt || !aiConfigured()) return;
  // J-156: the workspace's AI switch (dashboard settings) turns chapters off
  if (!(await aiAllowed(db, rec.organizationId))) return;
  const [t] = await db
    .select()
    .from(transcript)
    .where(and(eq(transcript.recordingId, id), eq(transcript.status, 'done')));
  const cues = t?.vtt ? parseVtt(t.vtt) : [];
  const list = await aiChapters({ title: rec.title, durationMs: rec.durationMs ?? 0, cues, index: rec.eventIndex as never });
  await db.update(recording).set({ chapters: list }).where(eq(recording.id, id));
}

// ---------- purge, expire, sweep ----------

async function purgeRecording(payload: unknown) {
  const id = recIdOf(payload);
  const rec = await loadRec(id);
  if (!rec) return;
  if (!rec.deletedAt) return; // restored or never deleted: keep the media
  await purgeMedia(db, id);
  await db.update(recordingStream).set({ finalKey: null }).where(eq(recordingStream.recordingId, id));
  await db.update(recording).set({ thumbKey: null, renditions: null }).where(eq(recording.id, id));
  // A media job that was mid-write when the capture was deleted may still put one object; sweep again.
  const pass = Number((payload as { pass?: number }).pass ?? 1);
  if (pass < 2) await enqueue(db, 'purge-recording', { recordingId: id, pass: pass + 1 }, { runAt: new Date(Date.now() + 10 * 60_000) });
}

const HOUR = 3_600_000;

async function expireShares() {
  const n = await deleteStaleLinks(db);
  if (n) console.log(`[jobs] expire-shares removed ${n} old link(s)`);
  await enqueue(db, 'expire-shares', {}, { runAt: new Date(Date.now() + HOUR) });
}

/** Drafts never created after 7 days: nothing of them may stay on the server (J-189). */
async function sweepDrafts() {
  const cut = new Date(Date.now() - 7 * 24 * HOUR);
  const stale = await db
    .select({ id: recording.id })
    .from(recording)
    .where(and(eq(recording.status, 'uploading'), isNull(recording.finalizedAt), lt(recording.createdAt, cut)))
    .limit(200);
  for (const r of stale) {
    await purgeMedia(db, r.id);
    await db.delete(recording).where(eq(recording.id, r.id));
  }
  if (stale.length) console.log(`[jobs] sweep-drafts removed ${stale.length} abandoned draft(s)`);
  await enqueue(db, 'sweep-drafts', {}, { runAt: new Date(Date.now() + 6 * HOUR) });
}

export function registerServerCoreJobs() {
  registerJob('finalize-recording', finalizeRecording, 2);
  registerJob('remux-video', remuxVideo, 1);
  registerJob('thumbnail', thumbnail, 2);
  registerJob('renditions', renditions, 1);
  registerJob('transcribe', transcribe, 1);
  registerJob('chapters', chapters, 1);
  registerJob('purge-recording', purgeRecording, 2);
  registerJob('expire-shares', expireShares, 1);
  registerJob('sweep-drafts', sweepDrafts, 1);
}

/** One pending row per recurring job type. */
export async function ensureRecurringJobs(d: Db = db) {
  for (const type of ['expire-shares', 'sweep-drafts'] as const) {
    const [row] = await d
      .select({ id: job.id })
      .from(job)
      .where(and(eq(job.type, type), isNull(job.doneAt)))
      .limit(1);
    if (!row) await enqueue(d, type, {}, { maxAttempts: 1000 });
  }
}

export const _internal = { runFinalize, purgeRecording, renditions, transcribe, chapters };
