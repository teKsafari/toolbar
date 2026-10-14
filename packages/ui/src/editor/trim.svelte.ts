// Trim state for video and replay drafts (J-084, J-085): two grips, each drag one undo step.
import { History } from './history.ts';

export interface TrimRange {
  startMs: number;
  endMs: number;
}

/** Shortest range the grips allow. */
export const MIN_TRIM_MS = 500;

/** "12 seconds", "1 minute 5 seconds", "2 minutes": the draft spells the length out (J-084). */
export function spellDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const out: string[] = [];
  if (h) out.push(part(h, 'hour'));
  if (m) out.push(part(m, 'minute'));
  if (s || !out.length) out.push(part(s, 'second'));
  return out.join(' ');
}

/** m:ss (or h:mm:ss) clock for time links and the playhead label. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export class TrimState {
  durationMs = $state(0);
  startMs = $state(0);
  endMs = $state(0);
  canUndo = $state(false);
  canRedo = $state(false);
  version = $state(0);
  private history = new History<TrimRange>();
  private dragBefore: TrimRange | null = null;

  constructor(durationMs: number, range?: TrimRange | null) {
    this.setDuration(durationMs, range);
  }

  /** Called once the real length is known (WebM from MediaRecorder reports it late). */
  setDuration(durationMs: number, range?: TrimRange | null) {
    const wasFull = this.endMs === 0 || this.endMs === this.durationMs;
    this.durationMs = Math.max(0, Math.round(durationMs));
    if (range) {
      this.startMs = Math.max(0, Math.min(range.startMs, this.durationMs));
      this.endMs = Math.max(this.startMs, Math.min(range.endMs, this.durationMs));
    } else {
      this.startMs = Math.min(this.startMs, this.durationMs);
      this.endMs = wasFull ? this.durationMs : Math.min(this.endMs, this.durationMs);
    }
  }

  get lengthMs() {
    return Math.max(0, this.endMs - this.startMs);
  }
  /** null when nothing is cut */
  get range(): TrimRange | null {
    if (this.startMs <= 0 && this.endMs >= this.durationMs) return null;
    return { startMs: Math.round(this.startMs), endMs: Math.round(this.endMs) };
  }

  private snapshot(): TrimRange {
    return { startMs: this.startMs, endMs: this.endMs };
  }

  beginDrag() {
    this.dragBefore = this.snapshot();
  }
  moveGrip(which: 'start' | 'end', ms: number) {
    const min = Math.min(MIN_TRIM_MS, this.durationMs);
    if (which === 'start') this.startMs = Math.max(0, Math.min(ms, this.endMs - min));
    else this.endMs = Math.min(this.durationMs, Math.max(ms, this.startMs + min));
  }
  endDrag() {
    const before = this.dragBefore;
    this.dragBefore = null;
    if (!before) return;
    if (before.startMs === this.startMs && before.endMs === this.endMs) return;
    this.history.push(before);
    this.sync();
  }
  /** One-step change (keyboard nudge). */
  set(which: 'start' | 'end', ms: number) {
    this.beginDrag();
    this.moveGrip(which, ms);
    this.endDrag();
  }
  private sync() {
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    this.version++;
  }
  undo() {
    const prev = this.history.undo(this.snapshot());
    if (!prev) return;
    this.startMs = prev.startMs;
    this.endMs = prev.endMs;
    this.sync();
  }
  redo() {
    const next = this.history.redo(this.snapshot());
    if (!next) return;
    this.startMs = next.startMs;
    this.endMs = next.endMs;
    this.sync();
  }
}

/**
 * Events inside the kept range (J-227). `t0` is the epoch ms of the recording start; event
 * times are epoch ms. The server applies the same cut at finalize; the editor uses this for
 * AI steps and markers.
 */
export function eventsInRange<T extends { t: number }>(events: T[], t0: number, range: TrimRange | null): T[] {
  if (!range) return events;
  const a = t0 + range.startMs;
  const b = t0 + range.endMs;
  return events.filter((e) => e.t >= a && e.t <= b);
}
