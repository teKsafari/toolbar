// Keyframes (PLAN "What a trace is"): screenshots on route changes, annotations, `changed`
// spans and bursts of DOM change, at most one every 1 to 2 seconds, near-duplicates removed.
// The planner decides when; the capturer (the extension worker) takes the screenshot, hashes it
// with a 33x32 dHash and drops it when it is a near-duplicate of the last kept one.
import type { KeyframeReason, KeyframeRequest, TraceConfig } from './types.ts';

const PRIORITY: Record<KeyframeReason, number> = { annotation: 5, nav: 4, start: 3, changed: 2, 'dom-burst': 1 };

/**
 * Rate-limited keyframe requests. `want()` asks for a screenshot at a time; `due(now)` returns
 * the requests whose time has come. A request inside the gap after the last one moves to the
 * end of the gap and merges with any request already waiting there (the higher reason wins).
 */
export class KeyframePlanner {
  private last = -Infinity;
  private waiting: KeyframeRequest | null = null;

  constructor(private gapMs: number) {}

  want(req: KeyframeRequest) {
    const t = Math.max(req.t, this.last + this.gapMs);
    if (this.waiting) {
      // one waiting request at a time: it absorbs the new one
      // a stronger reason may need a later time (a route change waits for the render)
      if (PRIORITY[req.reason] > PRIORITY[this.waiting.reason]) this.waiting = { ...req, t: Math.max(t, this.waiting.t) };
      return;
    }
    this.waiting = { ...req, t };
  }

  /** Requests due at `now` (zero or one). */
  due(now: number): KeyframeRequest[] {
    const w = this.waiting;
    if (!w || w.t > now) return [];
    this.waiting = null;
    this.last = w.t;
    return [w];
  }

  /** Everything still waiting (the trace stopped). */
  flush(): KeyframeRequest[] {
    const w = this.waiting;
    this.waiting = null;
    if (!w) return [];
    this.last = w.t;
    return [w];
  }
}

export function plannerFor(c: Pick<TraceConfig, 'keyframeGapMs'>) {
  return new KeyframePlanner(c.keyframeGapMs);
}

/** Keyframe hashes use a 33x32 dHash (1024 bits): measured on the lab app, a status text change
 * flips 6 bits, a canvas redraw 8, an opened modal 116, and the same screen 0 to 2. A 9x8 hash
 * (64 bits) missed the text change entirely. */
export const KEYFRAME_HASH_SIZE = { w: 33, h: 32 } as const;

/**
 * dHash of an image already scaled to `w` x `h` pixels (RGBA, row-major): one bit per pixel
 * pair, set when the left pixel is brighter than its right neighbour, as hex.
 */
export function dHash(rgba: ArrayLike<number>, w = 9, h = 8): string {
  if (rgba.length < w * h * 4) throw new Error(`dHash needs a ${w}x${h} RGBA image`);
  const lum = (i: number) => 0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!;
  let hex = '';
  let nibble = 0;
  let bits = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const bit = lum(y * w + x) > lum(y * w + x + 1) ? 1 : 0;
      nibble = (nibble << 1) | bit;
      if (++bits === 4) {
        hex += nibble.toString(16);
        nibble = 0;
        bits = 0;
      }
    }
  }
  if (bits) hex += (nibble << (4 - bits)).toString(16);
  return hex;
}

/** Bits that differ between two hex hashes of the same length. */
export function hamming(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length) * 4;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Share of differing bits up to which two hashes are the same picture (3 of 1024, at least 1). */
export const NEAR_DUPLICATE_SHARE = 0.003;

export function nearDuplicateBits(hash: string): number {
  return Math.max(1, Math.round(hash.length * 4 * NEAR_DUPLICATE_SHARE));
}

export function isNearDuplicate(a: string, b: string, maxBits = nearDuplicateBits(a)): boolean {
  return hamming(a, b) <= maxBits;
}

/** Drops each keyframe that is a near-duplicate of the last one kept. */
export function dedupeKeyframes<K extends { hash: string }>(frames: readonly K[], maxBits?: number): K[] {
  const out: K[] = [];
  for (const f of frames) {
    const prev = out[out.length - 1];
    if (prev && isNearDuplicate(prev.hash, f.hash, maxBits ?? nearDuplicateBits(prev.hash))) continue;
    out.push(f);
  }
  return out;
}
