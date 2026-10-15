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

/** Spans of a stored trace: every event, sorted, through one engine, closed at the end. */
export function deriveTrace(events: readonly CaptureEvent[], opts: Omit<EngineOptions, 'onSpan' | 'onKeyframe'> & { endedAt?: number } = {}): DerivedTrace {
  const sorted = [...events].sort(compareEvents);
  const engine = new SpanEngine(opts);
  for (const e of sorted) engine.push(e);
  engine.finish(opts.endedAt);
  const spans = [...engine.closed].sort((a, b) => a.t0 - b.t0 || a.id.localeCompare(b.id));
  return { spans, keyframes: engine.keyframes, summary: summarize(spans, engine) };
}

function summarize(spans: Span[], engine: SpanEngine): TraceSummary {
  const outcomes = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const s of spans) outcomes[s.outcome]++;
  const first = (o: Outcome) => spans.filter((s) => s.outcome === o).map((s) => s.id);
  return {
    startedAt: engine.startedAt ?? 0,
    endedAt: engine.endedAt ?? engine.startedAt ?? 0,
    spans: spans.length,
    outcomes,
    attention: [...first('dead'), ...first('stuck'), ...first('silent'), ...first('error')],
    unattributed: engine.unattributed,
  };
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
