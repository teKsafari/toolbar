// ffmpeg steps of the chunked path: decode a voice track to 16 kHz mono PCM, and encode a slice
// of that PCM to WebM/Opus for upload. Cutting from the decoded PCM keeps each chunk's offset
// exact (no container seek), so cue times match the recording.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SAMPLE_RATE } from './chunk.ts';

const FFMPEG = () => process.env.FFMPEG_PATH || 'ffmpeg';

function ffmpegBytes(args: string[], stdin: Uint8Array | null, timeoutMs = 10 * 60_000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG(), ['-hide_banner', '-loglevel', 'error', ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    p.stdout!.on('data', (d: Buffer) => out.push(d));
    p.stderr!.on('data', (d) => {
      err += d;
      if (err.length > 16_000) err = err.slice(-8000);
    });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited with ${code}: ${err.trim().split('\n').slice(-2).join(' | ')}`));
    });
    if (stdin && p.stdin) {
      p.stdin.on('error', () => {});
      p.stdin.end(Buffer.from(stdin.buffer, stdin.byteOffset, stdin.byteLength));
    }
  });
}

/** Any audio or video file to 16 kHz mono signed 16-bit PCM. */
export async function decodePcm(audio: Uint8Array): Promise<Int16Array> {
  // a file, not stdin: MP4 and M4A keep their index at the end
  const dir = await mkdtemp(join(tmpdir(), 'tb-stt-'));
  try {
    const src = join(dir, 'in');
    await writeFile(src, audio);
    const b = await ffmpegBytes(['-i', src, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'], null);
    const copy = new Uint8Array(b.byteLength - (b.byteLength % 2));
    copy.set(b.subarray(0, copy.byteLength));
    return new Int16Array(copy.buffer);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Seconds [a, b) of the PCM as WebM/Opus, 32 kbps mono (about 120 KB per 30 s). */
export async function encodeSlice(pcm: Int16Array, a: number, b: number): Promise<Buffer> {
  const i = Math.max(0, Math.floor(a * SAMPLE_RATE));
  const j = Math.min(pcm.length, Math.ceil(b * SAMPLE_RATE));
  const slice = pcm.subarray(i, j);
  const bytes = new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength);
  // to a file, so the muxer can go back and write the duration into the header
  const dir = await mkdtemp(join(tmpdir(), 'tb-stt-'));
  try {
    const out = join(dir, 'chunk.webm');
    await ffmpegBytes(['-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1', '-i', 'pipe:0', '-c:a', 'libopus', '-b:a', '32k', '-y', out], bytes);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
