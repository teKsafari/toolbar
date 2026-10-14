// ffmpeg and ffprobe wrappers for the media jobs. The server image installs Debian's ffmpeg
// (apps/server/Dockerfile); dev machines need it on PATH (FFMPEG_PATH / FFPROBE_PATH override).
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

export function run(bin: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => {
      stderr += d;
      if (stderr.length > 64_000) stderr = stderr.slice(-32_000);
    });
    const timer = setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs ?? 10 * 60_000);
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

export const ffmpeg = (args: string[], timeoutMs?: number) => run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeoutMs });

export interface Probe {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

export async function probe(path: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]);
  const j = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[];
  };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  const a = j.streams?.find((s) => s.codec_type === 'audio');
  const d = Number(j.format?.duration ?? v?.duration ?? a?.duration);
  return {
    durationMs: Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : null,
    width: v?.width ?? null,
    height: v?.height ?? null,
    hasVideo: !!v,
    hasAudio: !!a,
  };
}

export async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'nib-media-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const EBML = [0x1a, 0x45, 0xdf, 0xa3];
export const isEbmlStart = (b: Uint8Array) => b.length >= 4 && EBML.every((x, i) => b[i] === x);

/**
 * Join WebM chunks into one seekable file at `out`. MediaRecorder timeslice chunks continue one
 * stream (only the first starts with an EBML header): concatenate and remux with `-c copy`, which
 * writes duration and cues. Instant-replay segments are standalone files (each starts with a
 * header): use the concat demuxer.
 */
export async function joinWebm(dir: string, chunks: Uint8Array[], out: string, name = 'in') {
  const headers = chunks.filter(isEbmlStart).length;
  if (headers > 1) {
    const list: string[] = [];
    let seg: Uint8Array[] = [];
    let n = 0;
    const flush = async () => {
      if (!seg.length) return;
      const p = join(dir, `${name}-seg${n++}.webm`);
      await writeFile(p, Buffer.concat(seg));
      list.push(`file '${p}'`);
      seg = [];
    };
    for (const c of chunks) {
      if (isEbmlStart(c)) await flush();
      seg.push(c);
    }
    await flush();
    const listPath = join(dir, `${name}-list.txt`);
    await writeFile(listPath, list.join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', out]);
  } else {
    const raw = join(dir, `${name}-raw.webm`);
    await writeFile(raw, Buffer.concat(chunks));
    await ffmpeg(['-fflags', '+genpts', '-i', raw, '-c', 'copy', out]);
  }
}

const VP9_FAST = ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-crf', '34', '-b:v', '0'];

/** Cut [startMs, endMs] with re-encoding, so the cut is frame-accurate (MediaRecorder keyframes are sparse). */
export async function trimWebm(input: string, out: string, startMs: number, endMs: number, p: Probe) {
  // -ss before -i seeks to the keyframe before the start and then decodes up to the exact time.
  const args = ['-ss', (startMs / 1000).toFixed(3), '-i', input, '-t', ((endMs - startMs) / 1000).toFixed(3)];
  args.push(...(p.hasVideo ? VP9_FAST : ['-vn']));
  args.push(...(p.hasAudio ? ['-c:a', 'libopus', '-b:a', '96k'] : ['-an']));
  await ffmpeg([...args, out]);
}

export const RENDITION_HEIGHTS = [720, 480, 360, 240] as const;

export async function renderRendition(input: string, out: string, height: number, hasAudio: boolean) {
  const bitrate = { 720: '1500k', 480: '800k', 360: '500k', 240: '300k' }[height] ?? '500k';
  await ffmpeg([
    '-i', input,
    '-vf', `scale=-2:${height}`,
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-b:v', bitrate,
    ...(hasAudio ? ['-c:a', 'libopus', '-b:a', '64k'] : ['-an']),
    out,
  ]);
}

/** Poster frame as WebP, 640 px wide at most. */
export async function posterFrame(input: string, out: string, atMs: number) {
  await ffmpeg(['-ss', (atMs / 1000).toFixed(3), '-i', input, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-c:v', 'libwebp', '-quality', '80', out]);
}

/** Thumbnail of a still image (screenshot captures). */
export async function imageThumb(input: string, out: string) {
  await ffmpeg(['-i', input, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-c:v', 'libwebp', '-quality', '80', out]);
}

/** Audio track only, for transcription when there is no separate voice stream. */
export async function extractAudio(input: string, out: string) {
  await ffmpeg(['-i', input, '-vn', '-c:a', 'libopus', '-b:a', '64k', out]);
}
