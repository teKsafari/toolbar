// @toolbar/trace: interaction spans and keyframes of a trace (PLAN "What a trace is").
import { compareEvents, type CaptureEvent } from '@toolbar/shared';
import { SpanEngine, type EngineOptions } from './engine.ts';
import { OUTCOMES, type KeyframeRequest, type Outcome, type Span, type TraceSummary } from './types.ts';

export * from './types.ts';
export { SpanEngine, ERROR_TEXT_RE, isActionKey, type EngineOptions } from './engine.ts';
export { classifyRequest, requestLabel, type RequestLike } from './classify.ts';
export { KeyframePlanner, dHash, hamming, isNearDuplicate, nearDuplicateBits, dedupeKeyframes, KEYFRAME_HASH_SIZE, NEAR_DUPLICATE_SHARE } from './keyframes.ts';
export { LiveTrace, type LiveTraceOptions } from './live.ts';

export interface DerivedTrace {
  spans: Span[];
  keyframes: KeyframeRequest[];
  summary: TraceSummary;
}

/** A trace of a session (D-214): the window from its Start trace to its Stop trace, epoch ms. */
export interface TraceWindow {
  n: number;
  startedAt: number;
  endedAt: number;
}

/** Events this long before a window's start belong to it (the extension reads its ring from there). */
export const TRACE_LEAD_MS = 250;

type DeriveOptions = Omit<EngineOptions, 'onSpan' | 'onKeyframe' | 'trace' | 'firstSeq'> & {
  endedAt?: number;
  /** The capture's traces: one engine per window, so no span runs from one trace into the next. */
  traces?: readonly TraceWindow[] | null;
};

/**
 * Spans of a stored trace: every event, sorted, through one engine, closed at the end. With
 * `traces`, each window gets its own engine, closed at the window's end; span ids and offsets
 * run on across the windows, and each span carries its trace's `n`.
 */
export function deriveTrace(events: readonly CaptureEvent[], opts: DeriveOptions = {}): DerivedTrace {
  const sorted = [...events].sort(compareEvents);
  const { traces, ...rest } = opts;
  if (!traces?.length) {
    const engine = new SpanEngine(rest);
    for (const e of sorted) engine.push(e);
    engine.finish(rest.endedAt);
    return result([engine]);
  }
  const startedAt = rest.startedAt ?? traces[0]!.startedAt;
  const engines: SpanEngine[] = [];
  let seq = 0;
  for (const w of traces) {
    const engine = new SpanEngine({ ...rest, startedAt, trace: w.n, firstSeq: seq });
    // the page and viewport as the window opens: the newest env event before it
    const env = sorted.findLast((e) => e.kind === 'env' && e.t < w.startedAt - TRACE_LEAD_MS);
    if (env) engine.push({ ...env, t: w.startedAt - TRACE_LEAD_MS });
    for (const e of sorted) if (e.t >= w.startedAt - TRACE_LEAD_MS && e.t <= w.endedAt) engine.push(e);
    engine.finish(w.endedAt);
    seq += engine.closed.length;
    engines.push(engine);
  }
  return result(engines, { startedAt, endedAt: traces[traces.length - 1]!.endedAt });
}

function result(engines: SpanEngine[], range?: { startedAt: number; endedAt: number }): DerivedTrace {
  const spans = engines.flatMap((e) => e.closed).sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const s of spans) outcomes[s.outcome]++;
  const first = (o: Outcome) => spans.filter((s) => s.outcome === o).map((s) => s.id);
  const e0 = engines[0]!;
  const summary: TraceSummary = {
    startedAt: range?.startedAt ?? e0.startedAt ?? 0,
    endedAt: range?.endedAt ?? e0.endedAt ?? e0.startedAt ?? 0,
    spans: spans.length,
    outcomes,
    attention: [...first('dead'), ...first('stuck'), ...first('silent'), ...first('error')],
    unattributed: engines.reduce((n, e) => n + e.unattributed, 0),
  };
  return { spans, keyframes: engines.flatMap((e) => e.keyframes), summary };
}

/** spans.jsonl: one span per line. */
export function spansJsonl(spans: readonly Span[]): string {
  return spans.map((s) => JSON.stringify(s)).join('\n') + (spans.length ? '\n' : '');
}

/** One line per span for a text timeline: offset, outcome, summary. */
export function timelineLines(spans: readonly Span[]): string[] {
  return spans.map((s) => {
    const sec = (s.startMs / 1000).toFixed(1).padStart(6);
    const out = s.outcome === 'silent' ? `silent ${s.silent}` : s.outcome;
    return `${sec}s  ${s.id}  ${out.padEnd(11)} ${s.summary}`;
  });
}
