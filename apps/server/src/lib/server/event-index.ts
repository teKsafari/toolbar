// Event index for captureDetailSchema.index: counts and timeline markers, computed once at
// finalize so lists and the info header need no event fetch. Also the trim filter (J-227) and the
// video offset (architecture s4 "Clock"). Pure functions; finalize-recording calls them.
import type { CaptureEvent, ConsoleLevel, EventKind } from '@toolbar/shared';
import type { EventIndex, TimelineMarker } from '@toolbar/shared/api';

const MERGE_MS = 250;

/** Stable time order: t, then context, then seq. */
export function sortEvents(events: CaptureEvent[]): CaptureEvent[] {
  return [...events].sort((a, b) => a.t - b.t || (a.ctx < b.ctx ? -1 : a.ctx > b.ctx ? 1 : 0) || a.seq - b.seq);
}

/** Drop repeats of the same `ctx:seq` (a chunk retried after a lost response). */
export function dedupeEvents(events: CaptureEvent[]): CaptureEvent[] {
  const seen = new Set<string>();
  const out: CaptureEvent[] = [];
  for (const e of events) {
    const k = `${e.ctx}:${e.seq}:${e.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}

/** First video or screen `media start`, as ms after the capture start; 0 when there is none. */
export function videoOffsetOf(events: CaptureEvent[], startedAt: number): number {
  const m = events.find((e) => e.kind === 'media' && e.data.op === 'start' && (e.data.stream === 'video' || e.data.stream === 'screen'));
  return m ? Math.max(0, Math.round(m.t - startedAt)) : 0;
}

/**
 * Keep the events inside the trimmed range. The trim is in video time (what the draft player
 * shows); capture time = video time + videoOffset. `env` events are kept whatever their time.
 * Returns the new capture start so offsets line up with the trimmed video.
 */
export function trimEvents(
  events: CaptureEvent[],
  startedAt: number,
  videoOffsetMs: number,
  trim: { startMs: number; endMs: number },
): { events: CaptureEvent[]; startedAt: number } {
  const from = startedAt + videoOffsetMs + trim.startMs;
  const to = startedAt + videoOffsetMs + trim.endMs;
  const kept = events.filter((e) => e.kind === 'env' || (e.t >= from && e.t <= to));
  return { events: kept, startedAt: startedAt + trim.startMs };
}

const statusClass = (s: number) => (s >= 500 ? '5xx' : s >= 400 ? '4xx' : s >= 300 ? '3xx' : s >= 200 ? '2xx' : '1xx') as '1xx' | '2xx' | '3xx' | '4xx' | '5xx';

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return u.pathname;
  } catch {
    return url;
  }
}

export function computeEventIndex(events: CaptureEvent[], startedAt: number): EventIndex {
  const counts: Partial<Record<EventKind, number>> = {};
  const consoleCounts: Partial<Record<ConsoleLevel, number>> = {};
  let errors = 0;
  const user = { clicks: 0, inputs: 0, keys: 0, navigations: 0 };
  const reqs = new Map<string, { url: string; method: string; t: number }>();
  const done = new Map<string, number>();
  const failed = new Set<string>();
  const byClass: Partial<Record<'1xx' | '2xx' | '3xx' | '4xx' | '5xx', number>> = {};
  const raw: Omit<TimelineMarker, 'count'>[] = [];
  const off = (t: number) => Math.max(0, Math.round(t - startedAt));

  for (const e of events) {
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    switch (e.kind) {
      case 'console':
        consoleCounts[e.data.level] = (consoleCounts[e.data.level] ?? 0) + 1;
        if (e.data.level === 'error' || e.data.level === 'assert')
          raw.push({ kind: 'error', offsetMs: off(e.t), label: firstText(e.data.args) || 'console.error', ref: e.id, status: null });
        break;
      case 'error':
        errors++;
        raw.push({ kind: 'error', offsetMs: off(e.t), label: e.data.message.slice(0, 120), ref: e.id, status: null });
        break;
      case 'net.req':
        if (!reqs.has(e.data.rid)) reqs.set(e.data.rid, { url: e.data.url, method: e.data.method, t: e.t });
        break;
      case 'net.res': {
        if (done.has(e.data.rid)) break;
        done.set(e.data.rid, e.data.status);
        const c = statusClass(e.data.status);
        byClass[c] = (byClass[c] ?? 0) + 1;
        if (e.data.status >= 400) {
          failed.add(e.data.rid);
          const r = reqs.get(e.data.rid);
          raw.push({ kind: 'net-fail', offsetMs: off(e.t), label: `${r?.method ?? ''} ${r ? pathOf(r.url) : ''}`.trim(), ref: e.id, status: e.data.status });
        }
        break;
      }
      case 'net.fail': {
        if (done.has(e.data.rid)) break;
        done.set(e.data.rid, 0);
        failed.add(e.data.rid);
        const r = reqs.get(e.data.rid);
        raw.push({ kind: 'net-fail', offsetMs: off(e.t), label: `${r?.method ?? ''} ${r ? pathOf(r.url) : ''} ${e.data.error}`.trim(), ref: e.id, status: null });
        break;
      }
      case 'nav':
        user.navigations++;
        raw.push({ kind: 'nav', offsetMs: off(e.t), label: pathOf(e.data.url), ref: e.id, status: null });
        break;
      case 'user':
        if (e.data.type === 'click' || e.data.type === 'dblclick' || e.data.type === 'contextmenu') user.clicks++;
        else if (e.data.type === 'input') user.inputs++;
        else if (e.data.type === 'key') user.keys++;
        else if (e.data.type === 'visibility' && e.data.visible === false)
          raw.push({ kind: 'blur', offsetMs: off(e.t), label: 'Tab hidden', ref: e.id, status: null });
        break;
      case 'media':
        if (e.data.op === 'pause' || e.data.op === 'resume')
          raw.push({ kind: e.data.op, offsetMs: off(e.t), label: e.data.op === 'pause' ? 'Paused' : 'Resumed', ref: e.id, status: null });
        break;
      case 'annotation':
        if (e.data.op === 'create') raw.push({ kind: 'pen', offsetMs: off(e.t), label: 'Drawing', ref: e.data.annotationId, status: null });
        break;
      case 'marker':
        raw.push({
          kind: e.data.type === 'mark' ? 'mark' : 'voice',
          offsetMs: off(e.t),
          label: e.data.label ?? (e.data.type === 'mark' ? 'Marked moment' : e.data.type === 'voice.start' ? 'Voice on' : 'Voice off'),
          ref: e.id,
          status: null,
        });
        break;
    }
  }

  let pending = 0;
  for (const rid of reqs.keys()) if (!done.has(rid)) pending++;

  return {
    counts,
    console: consoleCounts,
    errors,
    network: { total: reqs.size, failed: failed.size, pending, byClass },
    user,
    markers: mergeMarkers(raw),
    firstT: events.length ? events[0]!.t : null,
    lastT: events.length ? events[events.length - 1]!.t : null,
  };
}

/** Markers of one kind closer than 250 ms collapse into one with a count. */
export function mergeMarkers(raw: Omit<TimelineMarker, 'count'>[]): TimelineMarker[] {
  const sorted = [...raw].sort((a, b) => a.offsetMs - b.offsetMs);
  const out: TimelineMarker[] = [];
  const lastOfKind = new Map<string, TimelineMarker>();
  for (const m of sorted) {
    const prev = lastOfKind.get(m.kind);
    if (prev && m.offsetMs - prev.offsetMs <= MERGE_MS && prev.status === m.status) {
      prev.count++;
      continue;
    }
    const next = { ...m, count: 1 };
    out.push(next);
    lastOfKind.set(m.kind, next);
  }
  return out;
}

function firstText(args: unknown[]): string {
  for (const a of args) {
    if (typeof a === 'string') return a.slice(0, 120);
    if (a && typeof a === 'object' && 'message' in a && typeof (a as { message: unknown }).message === 'string')
      return ((a as { message: string }).message).slice(0, 120);
  }
  return '';
}

/** Parse NDJSON text into events, skipping blank and broken lines (counted). */
export function parseNdjson(text: string): { events: CaptureEvent[]; bad: number } {
  const events: CaptureEvent[] = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const v = JSON.parse(s);
      if (Array.isArray(v)) events.push(...(v as CaptureEvent[]));
      else if (v && typeof v === 'object' && typeof v.kind === 'string' && typeof v.t === 'number') events.push(v as CaptureEvent);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { events, bad };
}
