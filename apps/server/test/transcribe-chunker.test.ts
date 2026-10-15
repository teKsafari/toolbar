// The chunker on real speech (D-087): a 2 minute file built at test time from the two FLEURS
// fixtures (fixtures/transcribe, CC BY 4.0), alternating Swahili and English with 0.8 s and 2 s
// pauses, one Swahili span 30 dB quieter to stand in for a weak microphone. Every cut must fall
// inside a pause. Needs ffmpeg on PATH; skips without it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodePcm, encodeSlice } from '../src/lib/server/transcribe/audio.ts';
import { findPauses, frameLevels, planChunks, SAMPLE_RATE } from '../src/lib/server/transcribe/chunk.ts';

const FIX = new URL('../fixtures/transcribe/', import.meta.url).pathname;
const SW = join(FIX, 'fleurs-sw_ke-1999.webm');
const EN = join(FIX, 'fleurs-en_us-1904.webm');

const hasFfmpeg = (() => {
  try {
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const probeS = (f: string) => Number(execFileSync(process.env.FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());

describe.skipIf(!hasFfmpeg)('chunker on the FLEURS fixtures', () => {
  let dir = '';
  let file = '';
  /** inserted silence, seconds from the start */
  const gaps: { start: number; end: number }[] = [];
  let total = 0;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'tb-chunker-'));
    const sw = probeS(SW);
    const en = probeS(EN);
    // sw en sw(quiet) en sw en ... until about two minutes
    const plan: { src: 'sw' | 'en'; quiet: boolean; gap: number }[] = [];
    for (let i = 0; total < 120; i++) {
      const src = i % 2 === 0 ? 'sw' : 'en';
      const gap = i % 3 === 2 ? 2 : 0.8;
      plan.push({ src, quiet: i === 2, gap });
      total += (src === 'sw' ? sw : en) + gap;
    }
    const inputs: string[] = [];
    const filters: string[] = [];
    let t = 0;
    plan.forEach((p, i) => {
      inputs.push('-i', p.src === 'sw' ? SW : EN);
      filters.push(`[${i}:a]aresample=16000,aformat=channel_layouts=mono${p.quiet ? ',volume=-30dB' : ''},apad=pad_dur=${p.gap}[a${i}]`);
      t += p.src === 'sw' ? sw : en;
      gaps.push({ start: t, end: t + p.gap });
      t += p.gap;
    });
    total = t;
    filters.push(`${plan.map((_, i) => `[a${i}]`).join('')}concat=n=${plan.length}:v=0:a=1[out]`);
    file = join(dir, 'mix.webm');
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-c:a', 'libopus', '-b:a', '32k', file]);
  }, 60_000);

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('decodes to 16 kHz PCM of the right length', async () => {
    const pcm = await decodePcm(readFileSync(file));
    expect(pcm.length / SAMPLE_RATE).toBeGreaterThan(115);
    expect(Math.abs(pcm.length / SAMPLE_RATE - total)).toBeLessThan(0.5);
  });

  it('cuts every chunk inside a pause, at most 30 s long, quiet span included', async () => {
    const pcm = await decodePcm(readFileSync(file));
    const { pauses, duration } = findPauses(pcm);
    const chunks = planChunks(pauses, duration, 30);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(30.001);
    // Inside a pause: the audio within 100 ms of the cut is at least 15 dB below the loudest
    // 30 ms of the 3 s around it. Measured on the PCM, apart from the detector's own threshold.
    const levels = frameLevels(pcm);
    const at = (s: number) => Math.round(s / 0.03);
    for (const c of chunks.slice(1)) {
      expect(c.overlap).toBe(false);
      const near = Math.max(...levels.slice(at(c.start - 0.1), at(c.start + 0.1) + 1));
      const around = Math.max(...levels.slice(at(c.start - 3), at(c.start + 3) + 1));
      expect(around - near, `cut at ${c.start.toFixed(2)} s: ${near.toFixed(1)} dB against ${around.toFixed(1)} dB`).toBeGreaterThanOrEqual(15);
    }
    // most cuts land on the inserted pauses (the rest on a speaker's own pause, after a comma)
    const onGap = chunks.slice(1).filter((c) => gaps.some((g) => c.start >= g.start - 1.2 && c.start <= g.end + 1.2)).length;
    expect(onGap).toBeGreaterThanOrEqual(Math.ceil((chunks.length - 1) / 2));
    // the quiet Swahili span (third clip) is speech, not one long pause
    const quiet = { start: gaps[1]!.end, end: gaps[2]!.start };
    const longest = Math.max(...pauses.filter((p) => p.start >= quiet.start && p.end <= quiet.end).map((p) => p.end - p.start), 0);
    expect(longest).toBeLessThan(2);
    expect(chunks.some((c) => c.voiced.some((v) => v.start < quiet.end - 2 && v.end > quiet.start + 2))).toBe(true);
  });

  it('encodes a slice to WebM/Opus of the same length', async () => {
    const pcm = await decodePcm(readFileSync(file));
    const out = await encodeSlice(pcm, 10, 25);
    const f = join(dir, 'slice.webm');
    writeFileSync(f, out);
    expect(Math.abs(probeS(f) - 15)).toBeLessThan(0.1);
    // about 4 KB a second at 32 kbps
    expect(out.byteLength).toBeLessThan(90_000);
  });
});
