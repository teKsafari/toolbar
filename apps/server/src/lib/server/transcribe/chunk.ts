// Pause detection and chunk planning (docs/research/transcription.md section 3, steps 2 and 3).
// Pure functions over 16 kHz mono PCM, so they run in unit tests without ffmpeg.

export const SAMPLE_RATE = 16_000;
/** 30 ms analysis frames */
export const FRAME_S = 0.03;
const FRAME = Math.round(SAMPLE_RATE * FRAME_S);

export interface Pause {
  /** seconds */
  start: number;
  end: number;
}

export interface Chunk {
  start: number;
  end: number;
  /** true when the chunk starts inside the previous one (hard cut with no pause) */
  overlap: boolean;
  /** voiced spans inside [start, end], in seconds from the start of the file */
  voiced: Pause[];
}

/** RMS level in dBFS of each 30 ms frame of signed 16-bit PCM. */
export function frameLevels(pcm: Int16Array): Float32Array {
  const k = Math.floor(pcm.length / FRAME);
  const out = new Float32Array(k);
  for (let i = 0; i < k; i++) {
    let sum = 0;
    for (let j = i * FRAME, z = j + FRAME; j < z; j++) {
      const s = pcm[j]! / 32768;
      sum += s * s;
    }
    out[i] = 20 * Math.log10(Math.sqrt(sum / FRAME) + 1e-9);
  }
  return out;
}

function percentile(sorted: Float32Array, p: number): number {
  if (!sorted.length) return -180;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i]!;
}

/**
 * Adaptive energy detector: a frame is quiet when it is below the local 10th percentile plus
 * 0.35 x (95th - 10th percentile) over a 10 s window. A fixed dB threshold fails on quiet
 * microphones (some recordings sit at -60 dB RMS). The threshold is computed once per second of
 * audio, which keeps an hour of audio in milliseconds.
 */
export function quietFrames(levels: Float32Array, windowS = 10): Uint8Array {
  const k = levels.length;
  const quiet = new Uint8Array(k);
  const half = Math.round(windowS / FRAME_S / 2);
  const block = Math.round(1 / FRAME_S);
  for (let b = 0; b < k; b += block) {
    const centre = Math.min(k - 1, b + Math.floor(block / 2));
    const win = levels.slice(Math.max(0, centre - half), Math.min(k, centre + half + 1)).sort();
    const lo = percentile(win, 0.1);
    const hi = percentile(win, 0.95);
    // a window of one level throughout (digital silence, or a steady tone) has no speech contrast
    const thr = hi - lo < 6 ? (hi < -50 ? Infinity : -Infinity) : lo + 0.35 * (hi - lo);
    for (let i = b; i < Math.min(k, b + block); i++) quiet[i] = levels[i]! < thr ? 1 : 0;
  }
  return quiet;
}

/** Runs of quiet frames of at least `minPause` seconds. */
export function findPauses(pcm: Int16Array, minPause = 0.3): { pauses: Pause[]; duration: number; quiet: Uint8Array } {
  const quiet = quietFrames(frameLevels(pcm));
  const pauses: Pause[] = [];
  for (let i = 0; i < quiet.length; ) {
    if (!quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < quiet.length && quiet[j]) j++;
    if ((j - i) * FRAME_S >= minPause) pauses.push({ start: round(i * FRAME_S), end: round(j * FRAME_S) });
    i = j;
  }
  return { pauses, duration: pcm.length / SAMPLE_RATE, quiet };
}

const round = (s: number) => Math.round(s * 1000) / 1000;

/** Voiced spans of [a, b]: the complement of the pauses. */
export function voicedIn(pauses: Pause[], a: number, b: number): Pause[] {
  const out: Pause[] = [];
  let t = a;
  for (const p of pauses) {
    if (p.end <= a || p.start >= b) continue;
    if (p.start > t) out.push({ start: round(t), end: round(Math.min(p.start, b)) });
    t = Math.max(t, p.end);
  }
  if (t < b) out.push({ start: round(t), end: round(b) });
  return out.filter((v) => v.end - v.start >= FRAME_S);
}

/**
 * Contiguous chunks of at most `maxS` seconds. From each chunk start, cut at the centre of the
 * longest pause whose centre falls between max(minS, maxS / 2) and maxS seconds later. With no
 * pause there, cut hard at maxS and start the next chunk 1 s earlier (its repeated words are
 * removed when the texts are joined). Chunks with no voiced frames are dropped: they cost money
 * and invite "Thank you." hallucinations.
 */
export function planChunks(pauses: Pause[], duration: number, maxS = 30, minS = 4): Chunk[] {
  const raw: { start: number; end: number; overlap: boolean }[] = [];
  let start = 0;
  let overlap = false;
  const hardOverlap = Math.min(1, maxS / 10);
  while (duration - start > maxS) {
    const lo = start + Math.max(minS, maxS / 2);
    const hi = start + maxS;
    let best: Pause | null = null;
    for (const p of pauses) {
      const c = (p.start + p.end) / 2;
      if (c < lo || c > hi) continue;
      if (!best || p.end - p.start > best.end - best.start) best = p;
    }
    if (best) {
      const cut = round((best.start + best.end) / 2);
      raw.push({ start, end: cut, overlap });
      start = cut;
      overlap = false;
    } else {
      raw.push({ start, end: round(start + maxS), overlap });
      start = round(start + maxS - hardOverlap);
      overlap = true;
    }
  }
  raw.push({ start, end: round(duration), overlap });
  return raw.map((c) => ({ ...c, voiced: voicedIn(pauses, c.start, c.end) })).filter((c) => c.voiced.length > 0 && c.end - c.start > 0.05);
}
