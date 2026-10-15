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

/**
 * Drop repeats of one event (a chunk retried after a lost response). A page context restarts its
 * seq on each document load, so `ctx:seq` alone is not unique across a navigation (G3 bug 1:
 * clicks, typing and nav rows after a navigation were dropped as repeats); the id, kind and time
 * together are.
 */
export function dedupeEvents(events: CaptureEvent[]): CaptureEvent[] {
  const seen = new Set<string>();
  const out: CaptureEvent[] = [];
  for (const e of events) {
    const k = `${e.id}|${e.kind}|${e.t}`;
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
        // a GraphQL reply with errors failed too, whatever its status (J-064, J-072)
        if (e.data.status >= 400 || e.data.graphqlErrors) {
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
        if (e.data.type === 'screenshot' || e.data.type === 'blur') break;
        if (e.data.type === 'pen') {
          raw.push({ kind: 'pen', offsetMs: off(e.t), label: e.data.label ?? 'Drawing', ref: e.id, status: null });
          break;
        }
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

// ---------- rrweb trim (J-227) ----------

/** One rrweb event as the capture stream stores it (NDJSON line): epoch-ms `timestamp`, numeric `type`. */
export interface RrwebEvent {
  type: number;
  timestamp: number;
  data?: unknown;
  [k: string]: unknown;
}

const RR_FULL_SNAPSHOT = 2;
const RR_META = 4;

/** Parse rrweb NDJSON text, skipping lines that are not rrweb events. */
export function parseRrwebNdjson(text: string): RrwebEvent[] {
  const out: RrwebEvent[] = [];
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const v = JSON.parse(s) as RrwebEvent;
      if (v && typeof v === 'object' && typeof v.type === 'number' && typeof v.timestamp === 'number') out.push(v);
    } catch {
      // a broken line is dropped, as parseNdjson does for capture events
    }
  }
  return out;
}

/**
 * Keep the rrweb events of the trimmed range [from, to] (capture clock, epoch ms). A DOM replay
 * needs a full snapshot to start from, so the last Meta and FullSnapshot at or before `from` and
 * the incremental events between them and `from` are kept as a lead-in with their timestamps moved
 * to `from`: the replayer applies them at once and the replay starts at the trim start. Running it
 * again on its own output gives the same events (finalize may run twice after a crash).
 */
export function trimRrweb(events: RrwebEvent[], from: number, to: number): RrwebEvent[] {
  const sorted = events.map((e, i) => ({ e, i })).sort((a, b) => a.e.timestamp - b.e.timestamp || a.i - b.i).map((x) => x.e);
  let snap = -1;
  for (let i = 0; i < sorted.length && sorted[i]!.timestamp <= from; i++) if (sorted[i]!.type === RR_FULL_SNAPSHOT) snap = i;
  let start = snap;
  if (snap > 0) {
    for (let i = snap - 1; i >= 0; i--) {
      if (sorted[i]!.type === RR_META) {
        start = i;
        break;
      }
      if (sorted[i]!.type === RR_FULL_SNAPSHOT) break;
    }
  }
  const out: RrwebEvent[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i]!;
    if (e.timestamp <= from) {
      if (start >= 0 && i >= start) out.push(e.timestamp === from ? e : { ...e, timestamp: from });
    } else if (e.timestamp <= to) out.push(e);
  }
  return out;
}

/** Split rrweb events into NDJSON texts of at most `maxRaw` characters each (one per chunk). */
export function rrwebNdjsonParts(events: RrwebEvent[], maxRaw = 4 * 1024 * 1024): { text: string; t0: number; t1: number }[] {
  const parts: { text: string; t0: number; t1: number }[] = [];
  let buf: string[] = [];
  let size = 0;
  let t0 = 0;
  let t1 = 0;
  const flush = () => {
    if (buf.length) parts.push({ text: buf.join('\n') + '\n', t0, t1 });
    buf = [];
    size = 0;
  };
  for (const e of events) {
    const line = JSON.stringify(e);
    if (size + line.length > maxRaw && buf.length) flush();
    if (!buf.length) t0 = e.timestamp;
    t1 = e.timestamp;
    buf.push(line);
    size += line.length + 1;
  }
  flush();
  return parts;
}
