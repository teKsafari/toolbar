// One clock for the capture page (architecture s12). Events carry epoch ms; the player works in
// "player ms", the position in the video file. The video starts a little after the capture
// (videoOffset) and leaves out paused time (J-029), so the map between the two is piecewise.
import type { CaptureEvent } from '@toolbar/shared/events';

export interface TimeMap {
  /** Capture start, epoch ms. */
  startedAt: number;
  /** Capture start to the first video frame, ms (0 without video). */
  videoOffsetMs: number;
  /** Paused spans in epoch ms. */
  pauses: { from: number; to: number }[];
  /** Epoch ms to player ms. Times inside a pause map to the pause point. */
  toPlayer(t: number): number;
  /** Player ms to epoch ms (the first instant that shows that frame). */
  toEpoch(playerMs: number): number;
}

const VIDEO_STREAMS = new Set(['video', 'screen']);

export function buildTimeMap(events: readonly CaptureEvent[], startedAt: number | null, hasVideo: boolean): TimeMap {
  const first = events.find((e) => e.kind !== 'env')?.t ?? events[0]?.t ?? 0;
  const t0 = startedAt ?? first;
  let videoStart: number | null = null;
  const pauses: { from: number; to: number }[] = [];
  let pausedAt: number | null = null;
  let stopAt: number | null = null;
  for (const e of events) {
    if (e.kind !== 'media' || !VIDEO_STREAMS.has(e.data.stream)) continue;
    if (e.data.op === 'start' && videoStart === null) videoStart = e.t;
    else if (e.data.op === 'pause' && pausedAt === null) pausedAt = e.t;
    else if (e.data.op === 'resume' && pausedAt !== null) {
      pauses.push({ from: pausedAt, to: e.t });
      pausedAt = null;
    } else if (e.data.op === 'stop') stopAt = e.t;
  }
  if (pausedAt !== null) pauses.push({ from: pausedAt, to: stopAt ?? Number.POSITIVE_INFINITY });
  const origin = hasVideo && videoStart !== null ? videoStart : t0;
  const videoOffsetMs = hasVideo && videoStart !== null ? videoStart - t0 : 0;

  const toPlayer = (t: number) => {
    let cut = 0;
    for (const p of pauses) {
      if (t >= p.to) cut += p.to - p.from;
      else if (t > p.from) {
        cut += t - p.from;
        break;
      } else break;
    }
    return t - origin - cut;
  };
  const toEpoch = (ms: number) => {
    let t = origin + ms;
    for (const p of pauses) {
      if (t >= p.from) t += p.to - p.from;
      else break;
    }
    return t;
  };
  return { startedAt: t0, videoOffsetMs, pauses, toPlayer, toEpoch };
}

/** Index of the last row whose time is <= ms (rows sorted by `at`); -1 when none. */
export function indexAt<T extends { at: number }>(rows: readonly T[], ms: number): number {
  let lo = 0;
  let hi = rows.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.at <= ms) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
