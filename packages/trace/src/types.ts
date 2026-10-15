// Types of a trace: interaction spans, their outcomes and keyframe requests (PLAN "What a trace is").
import type { Ms, Rect } from '@toolbar/shared';

/**
 * How one reviewer action ended.
 * - `changed`: the page changed and no error happened
 * - `error`: a console error, an uncaught exception or an unhandled rejection
 * - `dead`: no request, no DOM change, no scroll or selection change, no pixel change
 * - `stuck`: a request the action started was still pending when the span closed
 * - `silent`: a request returned and the page did not change, or did not show the failure
 * - `note`: a reviewer note (annotation, voice segment, marked moment), not a page action
 */
export type Outcome = 'changed' | 'error' | 'dead' | 'stuck' | 'silent' | 'note';
export const OUTCOMES: readonly Outcome[] = ['changed', 'error', 'dead', 'stuck', 'silent', 'note'];

/** `silent` split by what the requests returned: all 2xx/3xx, or the worst failure. */
export type SilentClass = '2xx' | '4xx' | '5xx' | 'network';

export type ActionType = 'click' | 'dblclick' | 'contextmenu' | 'input' | 'key' | 'nav' | 'annotation' | 'voice' | 'mark';

/** Why a span closed. */
export type CloseReason =
  /** 500 ms with no effect and no request in flight, after at least one effect */
  | 'quiet'
  /** 2.5 s and nothing happened */
  | 'no_effect'
  /** 10 s (configurable) with requests open or effects still coming */
  | 'max_open'
  /** the trace stopped */
  | 'end'
  /** notes close at once (voice: at the end of the segment) */
  | 'note';

export interface SpanTarget {
  selector: string;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  elId?: string;
  rect?: Rect;
}

export interface SpanAction {
  type: ActionType;
  /** Short words for the timeline, e.g. `Click "Save"`. */
  label: string;
  /** Id of the capture event that started the span. */
  eventId: string;
  target?: SpanTarget;
  key?: string;
  /** Committed input value (already masked at the source). */
  value?: string;
  masked?: boolean;
  url?: string;
  /** Clicks: the target looks interactive (button, link, field, role). A dead click elsewhere is often noise. */
  interactive?: boolean;
}

/** A request named after the framework convention it follows (SvelteKit, Next.js). */
export interface RequestName {
  framework: 'sveltekit' | 'next';
  /** SvelteKit `load` (`__data.json`), form `action`, `remote` function; Next.js `rsc`, `prefetch`, `server-action`. */
  type: 'load' | 'action' | 'remote' | 'rsc' | 'prefetch' | 'server-action';
  /** The page route the request belongs to. */
  route: string;
  /** Form action name (`default` for the unnamed one), or the remote function id. */
  name?: string;
  /** Words for the timeline, e.g. `SvelteKit load /lessons/1`. */
  label: string;
}

export interface SpanRequest {
  rid: string;
  method: string;
  url: string;
  t: Ms;
  /** HTTP status, null while pending or after a network failure */
  status: number | null;
  state: 'pending' | 'done' | 'failed';
  error?: string;
  /** Duration in ms, null while pending */
  ms: number | null;
  name?: RequestName;
}

export interface SpanEffects {
  requests: number;
  failedRequests: number;
  pendingRequests: number;
  dom: { added: number; removed: number; attrs: number; text: number };
  /** DOM changes that came after the first failed response (null when no request failed). */
  domAfterFailure: number | null;
  console: { error: number; warn: number; other: number };
  errors: number;
  nav: string[];
  scroll: boolean;
  selection: boolean;
  /** Canvas pixels: changed, unchanged, unreadable (tainted or blank), or null when no canvas was sampled. */
  canvas: 'changed' | 'unchanged' | 'unreadable' | null;
  /** A field's value changed (a checkbox ticked by the click). */
  value: boolean;
  /** The click moved focus into a field. */
  focus: boolean;
  shots: number;
}

export interface CausedBy {
  span: string;
  /** 0 to 1: how likely the effects of this span came from that earlier action. */
  confidence: number;
  reason: 'requests_in_flight' | 'settling' | 'repeat';
}

export interface Span {
  /** `s001`, in start order. */
  id: string;
  t0: Ms;
  t1: Ms;
  /** Offset of t0 from the start of the trace. */
  startMs: number;
  durationMs: number;
  /** Page URL when the action happened. */
  url: string;
  action: SpanAction;
  outcome: Outcome;
  /** For `silent`: what the requests returned. */
  silent?: SilentClass;
  closeReason: CloseReason;
  /** One line for the timeline: action, the requests that matter, outcome. */
  summary: string;
  effects: SpanEffects;
  requests: SpanRequest[];
  console: { level: string; text: string; t: Ms }[];
  errors: { type: string; message: string; t: Ms }[];
  /** Changed-region rects (page coordinates), at most five. */
  rects: Rect[];
  /** Changed text snippets as captured (scrubbed at the source), at most five. */
  texts: string[];
  causedBy: CausedBy[];
  /** Asset ids of keyframe screenshots taken for this span. */
  keyframes: string[];
  /** Asset ids of screenshots the reviewer took during the span. */
  shots: string[];
  /** Why the outcome may be wrong, e.g. a canvas that could not be read. */
  caveat?: string;
}

export interface TraceConfig {
  /** Close after this much quiet with nothing in flight (ms). */
  quietMs: number;
  /** Close an action with no effect at all after this long (ms). */
  noEffectMs: number;
  /** Close at the latest after this long; requests still open make the span `stuck` (ms). */
  maxOpenMs: number;
  /** An effect this close after a response belongs to the span that sent the request (ms). */
  responseAttributionMs: number;
  /** A second action this soon on the same target is the same action fired twice (Enter then click). */
  doubleFireMs: number;
  /** A committed input this soon after a click on the same field is the click's effect (ms). */
  clickInputMs: number;
  /** Request initiators that never hold a span open (long-lived or fire and forget). */
  ignoreInitiators: readonly string[];
  /** Keyframes: at most one per this many ms (1 to 2 s). */
  keyframeGapMs: number;
  /** Keyframes: wait this long after a route change before the screenshot (ms). */
  keyframeNavDelayMs: number;
  /** Keyframes: a DOM summary with this many added plus removed nodes is a burst. */
  domBurstNodes: number;
  /** Keyframes: or one whose rects cover this share of the viewport. */
  domBurstArea: number;
}

export const DEFAULT_CONFIG: TraceConfig = {
  quietMs: 500,
  noEffectMs: 2500,
  maxOpenMs: 10_000,
  responseAttributionMs: 150,
  doubleFireMs: 80,
  clickInputMs: 500,
  ignoreInitiators: ['websocket', 'eventsource', 'beacon', 'ping', 'media'],
  keyframeGapMs: 1500,
  keyframeNavDelayMs: 600,
  domBurstNodes: 20,
  domBurstArea: 0.25,
};

export type KeyframeReason = 'annotation' | 'nav' | 'changed' | 'dom-burst' | 'start';

export interface KeyframeRequest {
  /** When the screenshot should be taken. */
  t: Ms;
  reason: KeyframeReason;
  span?: string;
}

export interface TraceSummary {
  startedAt: Ms;
  endedAt: Ms;
  spans: number;
  outcomes: Record<Outcome, number>;
  /** Spans worth reading first: dead, stuck and silent ("what did not happen"), then errors. */
  attention: string[];
  /** Effects that came while no span was open (background polling, timers). */
  unattributed: number;
}
