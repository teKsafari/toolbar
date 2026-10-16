// The span engine (PLAN "What a trace is"): turns the capture event stream of one tab into
// interaction spans. A span starts at one reviewer action, collects what follows, closes on the
// quiet, no-effect or max-open rule, and ends with one outcome. The same engine runs live in
// the extension worker (to time keyframes) and over the stored events on the server (spans.jsonl).
import type { CanvasSample, CaptureEvent, EventOf, Rect, TargetRef } from '@toolbar/shared';
import { classifyRequest, requestLabel } from './classify.ts';
import { KeyframePlanner } from './keyframes.ts';
import {
  DEFAULT_CONFIG,
  type ActionType,
  type CausedBy,
  type KeyframeRequest,
  type Outcome,
  type SilentClass,
  type Span,
  type SpanAction,
  type SpanRequest,
  type SpanTarget,
  type TraceConfig,
} from './types.ts';

/** Text in a changed region that tells the reviewer something failed. */
export const ERROR_TEXT_RE =
  /\b(errors?|fail(?:ed|s|ure)?|could ?n[o']?t|cannot|can't|unable|invalid|denied|forbidden|not allowed|went wrong|problem|try again|exception|unavailable|timed? ?out|rejected|hitilafu|kosa|imeshindikana|imeshindwa)\b/i;

/** Chords that only move text around (copy, paste, cut, select all) are not actions. */
const CLIPBOARD_KEYS = new Set(['C', 'V', 'X', 'A']);

const INTERACTIVE_TAGS = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary', 'label', 'option', 'details', 'video', 'audio', 'canvas']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'combobox', 'textbox', 'searchbox', 'slider', 'spinbutton', 'treeitem', 'gridcell']);
const FIELD_TAGS = new Set(['input', 'textarea', 'select']);
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton']);

interface Req {
  key: string;
  rid: string;
  method: string;
  url: string;
  t: number;
  source: 'page' | 'webRequest';
  owner: Open | null;
  status: number | null;
  state: 'pending' | 'done' | 'failed';
  error?: string;
  end: number | null;
  ignored: boolean;
  twin: string | null;
  headers?: Record<string, string>;
}

interface Open {
  span: Span;
  note: boolean;
  lastActivity: number;
  effectCount: number;
  reqs: Req[];
  /** some dom summary in the span carried `texts` (captures before Part 2 have none) */
  sawTexts: boolean;
  firstFailure: number | null;
  textsAfterFailure: string[];
  canvasAt: number | null;
  canvasBefore: Map<string, CanvasSample>;
  canvasSeen: { changed: boolean; unreadable: boolean; compared: boolean };
  sockets: number;
  /** workers the span posted to that have not answered yet: they hold it open (D-189) */
  workers: Set<string>;
  targetSel: string | null;
}

export interface EngineOptions {
  config?: Partial<TraceConfig>;
  /** Trace start; offsets in spans count from here (default: the first event). */
  startedAt?: number;
  /** Called as each span closes. */
  onSpan?: (s: Span) => void;
  /** Called when a keyframe is due (live use); also collected in `keyframes`. */
  onKeyframe?: (k: KeyframeRequest) => void;
  /** Viewport size for the DOM-burst rule; read from `env` events when absent. */
  viewport?: { w: number; h: number };
}

const pad = (n: number) => String(n).padStart(3, '0');

function targetOf(t: TargetRef | undefined): SpanTarget | undefined {
  if (!t) return undefined;
  const out: SpanTarget = { selector: t.selector, tag: t.tag };
  if (t.role) out.role = t.role;
  if (t.name) out.name = t.name;
  if (t.text) out.text = t.text;
  if (t.testId) out.testId = t.testId;
  if (t.elId) out.elId = t.elId;
  if (t.rect) out.rect = t.rect;
  return out;
}

function quoted(t: SpanTarget | undefined): string {
  if (!t) return 'the page';
  const words = (t.name || t.text || '').replace(/\s+/g, ' ').trim();
  if (words) return `"${words.length > 60 ? words.slice(0, 57) + '...' : words}"`;
  if (t.testId) return `[data-testid=${t.testId}]`;
  return t.selector.length > 60 ? t.tag : t.selector;
}

function isInteractive(t: TargetRef | undefined): boolean {
  if (!t) return false;
  return INTERACTIVE_TAGS.has(t.tag) || (!!t.role && INTERACTIVE_ROLES.has(t.role));
}

function isField(t: SpanTarget | undefined): boolean {
  if (!t) return false;
  return FIELD_TAGS.has(t.tag) || (!!t.role && FIELD_ROLES.has(t.role));
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function keyLabel(key: string, mods: string[] | undefined): string {
  const order = ['ctrl', 'alt', 'shift', 'meta'];
  const m = (mods ?? []).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((x) => (x === 'ctrl' ? 'Ctrl' : x === 'meta' ? 'Meta' : x === 'alt' ? 'Alt' : 'Shift'));
  return [...m, key].join('+');
}

/** Is this user key event an action (Enter, Escape, a chord), or typing? */
export function isActionKey(key: string | undefined, mods: string[] | undefined): boolean {
  if (!key) return false;
  if (key === 'Enter' || key === 'Escape') return true;
  const chord = (mods ?? []).some((m) => m === 'ctrl' || m === 'meta');
  return chord && !CLIPBOARD_KEYS.has(key.toUpperCase());
}

function emptyEffects(): Span['effects'] {
  return {
    requests: 0,
    failedRequests: 0,
    pendingRequests: 0,
    dom: { added: 0, removed: 0, attrs: 0, text: 0 },
    domAfterFailure: null,
    console: { error: 0, warn: 0, other: 0 },
    errors: 0,
    nav: [],
    scroll: false,
    selection: false,
    canvas: null,
    value: false,
    focus: false,
    shots: 0,
  };
}

const HOLD_EXEMPT = (r: Req) => r.ignored;

export class SpanEngine {
  readonly config: TraceConfig;
  readonly closed: Span[] = [];
  readonly keyframes: KeyframeRequest[] = [];
  /** Effects that came while no span was open. */
  unattributed = 0;
  /** Time of the last text selection the page reported: a drag ends with mouseup, then click. */
  private lastSelect = -Infinity;
  startedAt: number | null;
  endedAt: number | null = null;

  private open: Open[] = [];
  private reqs = new Map<string, Req>();
  private twinned = new Set<string>();
  private recentBefore: CanvasSample[] = [];
  private lastResponse: { span: Open; t: number } | null = null;
  private url = '';
  private seq = 0;
  private planner: KeyframePlanner;
  private viewport: { w: number; h: number } | null;
  private now = -Infinity;

  constructor(private opts: EngineOptions = {}) {
    this.config = { ...DEFAULT_CONFIG, ...(opts.config ?? {}) };
    this.startedAt = opts.startedAt ?? null;
    this.planner = new KeyframePlanner(this.config.keyframeGapMs);
    this.viewport = opts.viewport ?? null;
  }

  /** Feed one event. Events should come in time order (sort a batch first). */
  push(e: CaptureEvent) {
    if (this.startedAt === null) this.startedAt = e.t;
    this.advance(e.t);
    this.endedAt = Math.max(this.endedAt ?? e.t, e.t);
    switch (e.kind) {
      case 'env':
        if (e.data.url) this.url = e.data.url;
        if (e.data.viewport) this.viewport = e.data.viewport;
        return;
      case 'user':
        return this.onUser(e);
      case 'nav':
        return this.onNav(e);
      case 'annotation':
        if (e.data.op === 'create') {
          const o = this.start(e, { type: 'annotation', label: 'Annotation', eventId: e.id }, true);
          this.wantKeyframe({ t: e.t, reason: 'annotation', span: o.span.id });
          this.close(o, e.t, 'note');
        }
        return;
      case 'marker':
        return this.onMarker(e);
      case 'net.req':
        return this.onRequest(e);
      case 'net.res':
      case 'net.fail':
        return this.onResponse(e);
      case 'console': {
        const o = this.targetFor(e.t);
        if (!o) return void this.unattributed++;
        const lvl = e.data.level;
        const failedAssert = lvl === 'assert';
        if (lvl === 'error' || failedAssert) o.span.effects.console.error++;
        else if (lvl === 'warn') o.span.effects.console.warn++;
        else o.span.effects.console.other++;
        if (o.span.console.length < 20) o.span.console.push({ level: lvl, text: consoleText(e), t: e.t });
        this.touch(o, e.t);
        return;
      }
      case 'error': {
        const o = this.targetFor(e.t);
        if (!o) return void this.unattributed++;
        if (e.data.type === 'error' || e.data.type === 'unhandledrejection') o.span.effects.errors++;
        if (o.span.errors.length < 10) o.span.errors.push({ type: e.data.type, message: e.data.message.slice(0, 300), t: e.t });
        this.touch(o, e.t);
        return;
      }
      case 'dom':
        return this.onDom(e);
      case 'canvas.sample':
        return this.onCanvas(e);
      case 'ws':
      case 'sse': {
        if (e.data.op !== 'send' && e.data.op !== 'message' && e.data.op !== 'recv') return;
        const o = this.targetFor(e.t);
        if (!o) return void this.unattributed++;
        o.sockets++;
        this.touch(o, e.t);
        return;
      }
      case 'worker': {
        // a post to a worker holds the span until the worker answers (a code run, D-189)
        if (e.data.op === 'send') {
          const o = this.targetFor(e.t);
          if (!o) return void this.unattributed++;
          o.workers.add(e.data.wid);
          this.touch(o, e.t);
          return;
        }
        for (const o of this.open) {
          if (!o.workers.delete(e.data.wid)) continue;
          this.touch(o, e.t);
        }
        return;
      }
      case 'shot': {
        // a screenshot shows the page after everything up to it: the newest action's span
        const span = this.newestSpanBefore(e.t);
        if (!span) return;
        if (e.data.reason === 'keyframe') span.keyframes.push(e.data.assetId);
        else {
          span.shots.push(e.data.assetId);
          span.effects.shots++;
        }
        return;
      }
      default:
        return;
    }
  }

  /** Close every span whose deadline has passed at `now`, and release due keyframes. */
  advance(now: number) {
    if (now < this.now) now = this.now;
    this.now = now;
    for (;;) {
      let first: Open | null = null;
      let at = Infinity;
      for (const o of this.open) {
        const d = this.deadline(o);
        if (d < at) {
          at = d;
          first = o;
        }
      }
      if (!first || at > now) break;
      this.close(first, at, this.reasonAt(first, at));
    }
    for (const k of this.planner.due(now)) this.emitKeyframe(k);
  }

  /** The trace stopped at `t`: close what is open (pending requests make it `stuck`). */
  finish(t?: number): Span[] {
    // without a stop time, open spans run their course (the 10 s limit at most)
    const end = t ?? Math.max(this.endedAt ?? this.now, this.now) + this.config.maxOpenMs;
    this.advance(end);
    for (const o of [...this.open]) this.close(o, Math.max(end, o.span.t0), o.note ? 'note' : 'end');
    for (const k of this.planner.flush()) this.emitKeyframe(k);
    if (t !== undefined) this.endedAt = Math.max(this.endedAt ?? t, t);
    return this.closed;
  }

  /** Spans still open (live display). */
  openSpans(): readonly Span[] {
    return this.open.map((o) => o.span);
  }

  // ---------- actions ----------

  private onUser(e: EventOf<'user'>) {
    const d = e.data;
    switch (d.type) {
      case 'click':
      case 'dblclick':
      case 'contextmenu': {
        const target = targetOf(d.target);
        const prev = this.newestPage();
        // Enter or Space on a button fires a click too: one action
        if (prev && e.t - prev.span.t0 <= this.config.doubleFireMs && prev.targetSel && prev.targetSel === d.target?.selector) return;
        // Enter in a form field submits it with a click on its submit button: one action (D-188)
        if (d.type === 'click' && prev && prev.span.action.key === 'Enter' && e.t - prev.span.t0 <= this.config.doubleFireMs && (d.target?.tag === 'button' || d.target?.tag === 'input')) return;
        const o = this.start(e, { type: d.type, label: `${d.type === 'click' ? 'Click' : d.type === 'dblclick' ? 'Double-click' : 'Right-click'} ${quoted(target)}`, eventId: e.id, ...(target ? { target } : {}), interactive: isInteractive(d.target) });
        this.adopt(o, d.target?.link ?? d.target?.attrs?.['href']);
        if (d.type === 'click' && isField(target)) {
          o.span.effects.focus = true;
          this.touch(o, e.t);
        }
        // a drag that selected text reports the selection on mouseup, just before its click (D-161)
        if (d.type === 'click' && e.t - this.lastSelect <= 50) {
          o.span.effects.selection = true;
          this.touch(o, e.t);
        }
        return;
      }
      case 'input': {
        const target = targetOf(d.target);
        const prev = this.newestPage();
        // a checkbox, radio or select changed by the click that is still open; a field that
        // Enter just submitted and the page cleared (D-188)
        if (prev && (prev.span.action.type === 'click' || prev.span.action.key === 'Enter') && prev.targetSel && prev.targetSel === d.target?.selector && e.t - prev.span.t0 <= this.config.clickInputMs) {
          prev.span.effects.value = true;
          this.touch(prev, e.t);
          return;
        }
        const o = this.start(e, {
          type: 'input',
          label: `Type in ${quoted(target)}`,
          eventId: e.id,
          ...(target ? { target } : {}),
          ...(d.value !== undefined ? { value: d.value } : {}),
          ...(d.masked ? { masked: true } : {}),
        });
        // the committed value is itself a visible change of the field
        o.span.effects.value = true;
        this.touch(o, e.t);
        return;
      }
      case 'key': {
        if (!isActionKey(d.key, d.mods)) return;
        const target = targetOf(d.target);
        const key = keyLabel(d.key!, d.mods);
        const k = this.start(e, { type: 'key', label: `Press ${key}${target ? ` in ${quoted(target)}` : ''}`, eventId: e.id, key, ...(target ? { target } : {}) });
        this.adopt(k);
        return;
      }
      case 'scroll':
      case 'select': {
        if (d.type === 'select') this.lastSelect = e.t;
        const o = this.targetFor(e.t);
        if (!o) return void this.unattributed++;
        if (d.type === 'scroll') o.span.effects.scroll = true;
        else o.span.effects.selection = true;
        this.touch(o, e.t);
        return;
      }
      default:
        return;
    }
  }

  private onNav(e: EventOf<'nav'>) {
    const to = e.data.url;
    const o = this.targetFor(e.t);
    // an iframe loading or changing its route is activity of the open action, never the page's
    // own route change and never an action of its own (D-161)
    if (e.ctx && !e.ctx.startsWith('top')) {
      if (o) this.touch(o, e.t);
      return;
    }
    this.wantKeyframe({ t: e.t + this.config.keyframeNavDelayMs, reason: 'nav', ...(o ? { span: o.span.id } : {}) });
    if (o) {
      // a route change the open action caused
      if (o.span.effects.nav.length < 10) o.span.effects.nav.push(to);
      this.touch(o, e.t);
      this.url = to;
      return;
    }
    // back and forward, a typed URL, a redirect on a timer: an action of its own
    const label = e.data.type === 'popstate' ? `Back or forward to ${pathOf(to)}` : e.data.type === 'load' ? `Load ${pathOf(to)}` : `Navigate to ${pathOf(to)}`;
    this.url = to;
    const n = this.start(e, { type: 'nav', label, eventId: e.id, url: to });
    n.span.effects.nav.push(to);
    this.touch(n, e.t);
  }

  private onMarker(e: EventOf<'marker'>) {
    const d = e.data;
    if (d.type === 'voice.start') {
      this.start(e, { type: 'voice', label: d.label ? `Voice note: ${d.label}` : 'Voice note', eventId: e.id }, true);
      return;
    }
    if (d.type === 'voice.end') {
      const v = [...this.open].reverse().find((o) => o.note && o.span.action.type === 'voice');
      if (v) this.close(v, e.t, 'note');
      return;
    }
    if (d.type === 'mark') {
      const o = this.start(e, { type: 'mark', label: d.label ? `Marked: ${d.label}` : 'Marked this moment', eventId: e.id }, true);
      this.close(o, e.t, 'note');
    }
  }

  private start(e: CaptureEvent, action: SpanAction, note = false): Open {
    const t0 = e.t;
    const id = `s${pad(++this.seq)}`;
    const causedBy: CausedBy[] = [];
    if (!note) {
      for (const p of this.open) {
        if (p.note) continue;
        const inFlight = p.reqs.some((r) => r.state === 'pending' && !HOLD_EXEMPT(r));
        const same = !!p.targetSel && p.targetSel === (action.target?.selector ?? null);
        causedBy.push(
          same
            ? { span: p.span.id, confidence: 0.6, reason: 'repeat' }
            : inFlight
              ? { span: p.span.id, confidence: 0.5, reason: 'requests_in_flight' }
              : { span: p.span.id, confidence: 0.25, reason: 'settling' },
        );
      }
    }
    const span: Span = {
      id,
      t0,
      t1: t0,
      startMs: Math.round(t0 - (this.startedAt ?? t0)),
      durationMs: 0,
      url: this.url,
      action,
      outcome: note ? 'note' : 'dead',
      closeReason: note ? 'note' : 'no_effect',
      summary: '',
      effects: emptyEffects(),
      requests: [],
      console: [],
      errors: [],
      rects: [],
      texts: [],
      causedBy,
      keyframes: [],
      shots: [],
    };
    const o: Open = {
      span,
      note,
      lastActivity: t0,
      effectCount: 0,
      reqs: [],
      sawTexts: false,
      firstFailure: null,
      textsAfterFailure: [],
      canvasAt: null,
      canvasBefore: new Map(),
      canvasSeen: { changed: false, unreadable: false, compared: false },
      sockets: 0,
      workers: new Set(),
      targetSel: action.target?.selector ?? null,
    };
    if (!note) {
      // the page sampled its canvases at pointerdown or keydown, just before this event
      const before = this.recentBefore.filter((s) => s.at >= t0 - 1500 && s.at <= t0 + 50);
      if (before.length) {
        const at = before[before.length - 1]!.at;
        o.canvasAt = at;
        for (const s of before) if (s.at === at) o.canvasBefore.set(s.key, s);
      }
    }
    this.open.push(o);
    return o;
  }

  /**
   * Pending requests no span owns that belong to this action (D-188): one for the clicked link's
   * URL started up to `adoptLinkMs` before (a prefetch on hover that the click then waits for),
   * or any started up to `adoptMs` before (work begun on pointerdown or keydown).
   */
  private adopt(o: Open, href?: string) {
    const t0 = o.span.t0;
    let path: string | null = null;
    if (href) {
      try {
        path = new URL(href, this.url || 'http://x/').pathname;
      } catch {
        path = null;
      }
    }
    for (const r of this.reqs.values()) {
      if (r.owner || r.ignored || r.twin || r.state !== 'pending' || r.t > t0) continue;
      const ago = t0 - r.t;
      let same = false;
      if (path !== null && ago <= this.config.adoptLinkMs) {
        try {
          same = new URL(r.url).pathname === path;
        } catch {
          same = false;
        }
      }
      if (!same && ago > this.config.adoptMs) continue;
      r.owner = o;
      o.reqs.push(r);
      this.unattributed = Math.max(0, this.unattributed - 1);
      this.touch(o, t0);
    }
  }

  // ---------- effects ----------

  private newestPage(): Open | null {
    for (let i = this.open.length - 1; i >= 0; i--) if (!this.open[i]!.note) return this.open[i]!;
    return null;
  }

  /** The span an effect at `t` belongs to: the one whose response just came, else the newest. */
  private targetFor(t: number): Open | null {
    const lr = this.lastResponse;
    if (lr && t - lr.t <= this.config.responseAttributionMs && this.open.includes(lr.span)) return lr.span;
    for (let i = this.open.length - 1; i >= 0; i--) {
      const o = this.open[i]!;
      if (!o.note && o.span.t0 <= t) return o;
    }
    return null;
  }

  private newestSpanBefore(t: number): Span | null {
    let best: Span | null = null;
    for (const o of this.open) if (!o.note && o.span.t0 <= t && (!best || o.span.t0 > best.t0)) best = o.span;
    for (let i = this.closed.length - 1; i >= 0; i--) {
      const s = this.closed[i]!;
      if (s.outcome === 'note' || s.t0 > t) continue;
      if (!best || s.t0 > best.t0) best = s;
      break;
    }
    return best;
  }

  private touch(o: Open, t: number) {
    o.effectCount++;
    o.lastActivity = Math.max(o.lastActivity, t);
  }

  private onRequest(e: EventOf<'net.req'>) {
    const d = e.data;
    const key = `${e.ctx}|${d.rid}`;
    const source = d.source === 'webRequest' ? 'webRequest' : 'page';
    // the same request seen by the page hook and by webRequest is one request
    const twin = this.findTwin(source, d.method, d.url, e.t);
    if (twin) {
      this.twinned.add(twin.key);
      this.reqs.set(key, { ...twin, key, twin: twin.key });
      return;
    }
    const ignored = this.config.ignoreInitiators.includes(d.initiator ?? '');
    const owner = ignored ? null : this.targetFor(e.t);
    const r: Req = { key, rid: d.rid, method: d.method.toUpperCase(), url: d.url, t: e.t, source, owner, status: null, state: 'pending', end: null, ignored, twin: null, ...(d.headers ? { headers: d.headers } : {}) };
    this.reqs.set(key, r);
    if (ignored) return;
    if (!owner) return void this.unattributed++;
    owner.reqs.push(r);
    this.touch(owner, e.t);
  }

  private findTwin(source: 'page' | 'webRequest', method: string, url: string, t: number): Req | null {
    let best: Req | null = null;
    for (const r of this.reqs.values()) {
      if (r.twin || r.source === source || r.method !== method.toUpperCase() || r.url !== url) continue;
      // webRequest sees a request a little after the page hook (up to 1.5 s under load)
      const lag = source === 'webRequest' ? t - r.t : r.t - t;
      if (lag < -50 || lag > 1500) continue;
      if (this.twinned.has(r.key)) continue;
      if (!best || Math.abs(t - r.t) < Math.abs(t - best.t)) best = r;
    }
    return best;
  }

  private onResponse(e: EventOf<'net.res'> | EventOf<'net.fail'>) {
    const key = `${e.ctx}|${e.data.rid}`;
    let r = this.reqs.get(key);
    if (!r) return;
    if (r.twin) {
      const primary = this.reqs.get(r.twin);
      if (!primary || primary.state !== 'pending') return;
      r = primary;
    }
    if (r.state !== 'pending') return;
    if (e.kind === 'net.res') {
      r.status = e.data.status;
      r.state = 'done';
    } else {
      r.state = 'failed';
      r.error = e.data.error;
    }
    r.end = e.t;
    const o = r.owner;
    if (!o || !this.open.includes(o)) return;
    const failed = r.state === 'failed' || (r.status ?? 0) >= 400;
    if (failed && o.firstFailure === null) o.firstFailure = e.t;
    this.lastResponse = { span: o, t: e.t };
    this.touch(o, e.t);
  }

  private onDom(e: EventOf<'dom'>) {
    const d = e.data;
    const nodes = d.added + d.removed;
    const o = this.targetFor(e.t);
    if (nodes >= this.config.domBurstNodes || this.coversViewport(d.rects)) this.wantKeyframe({ t: e.t + 300, reason: 'dom-burst', ...(o ? { span: o.span.id } : {}) });
    if (!o) return void this.unattributed++;
    const dom = o.span.effects.dom;
    dom.added += d.added;
    dom.removed += d.removed;
    dom.attrs += d.attrs;
    dom.text += d.text;
    for (const r of d.rects) if (o.span.rects.length < 5) o.span.rects.push(r);
    if (d.texts) {
      o.sawTexts = true;
      for (const t of d.texts) if (o.span.texts.length < 5 && !o.span.texts.includes(t)) o.span.texts.push(t);
    }
    if (o.firstFailure !== null && e.t >= o.firstFailure) {
      o.span.effects.domAfterFailure = (o.span.effects.domAfterFailure ?? 0) + d.added + d.removed + d.attrs + d.text;
      if (d.texts) o.textsAfterFailure.push(...d.texts);
    }
    this.touch(o, e.t);
  }

  private coversViewport(rects: Rect[]): boolean {
    const v = this.viewport;
    if (!v || !rects.length) return false;
    const area = rects.reduce((a, r) => a + r.w * r.h, 0);
    return area >= this.config.domBurstArea * v.w * v.h;
  }

  private onCanvas(e: EventOf<'canvas.sample'>) {
    const s = e.data;
    if (s.phase === 'before') {
      this.recentBefore.push(s);
      if (this.recentBefore.length > 40) this.recentBefore.splice(0, this.recentBefore.length - 40);
      return;
    }
    const o = this.open.find((x) => !x.note && x.canvasAt === s.at);
    if (!o) return;
    const before = o.canvasBefore.get(s.key);
    if (!before) return;
    o.canvasSeen.compared = true;
    if (before.hash === null || s.hash === null || (before.blank && s.blank)) {
      o.canvasSeen.unreadable = true;
      return;
    }
    if (before.hash !== s.hash || (s.diff ?? 0) > 0) {
      if (!o.canvasSeen.changed) {
        o.canvasSeen.changed = true;
        for (const r of [s.rect]) if (o.span.rects.length < 5) o.span.rects.push(r);
      }
      this.touch(o, e.t);
    }
  }

  // ---------- closing ----------

  private pending(o: Open): Req[] {
    return o.reqs.filter((r) => r.state === 'pending' && !HOLD_EXEMPT(r));
  }

  private deadline(o: Open): number {
    if (o.note) return o.span.action.type === 'voice' ? o.span.t0 + 30 * 60_000 : o.span.t0;
    const cap = o.span.t0 + this.config.maxOpenMs;
    if (this.pending(o).length || o.workers.size) return cap;
    if (o.effectCount === 0) return o.span.t0 + this.config.noEffectMs;
    return Math.min(o.lastActivity + this.config.quietMs, cap);
  }

  private reasonAt(o: Open, at: number): Span['closeReason'] {
    if (o.note) return 'note';
    if (at >= o.span.t0 + this.config.maxOpenMs) return 'max_open';
    return o.effectCount === 0 ? 'no_effect' : 'quiet';
  }

  private close(o: Open, at: number, reason: Span['closeReason']) {
    const i = this.open.indexOf(o);
    if (i < 0) return;
    this.open.splice(i, 1);
    const s = o.span;
    s.t1 = Math.max(at, s.t0);
    s.durationMs = Math.round(s.t1 - s.t0);
    s.closeReason = reason;
    s.requests = o.reqs.map((r) => toSpanRequest(r));
    const fx = s.effects;
    fx.requests = s.requests.length;
    fx.failedRequests = s.requests.filter((r) => r.state === 'failed' || (r.status ?? 0) >= 400).length;
    fx.pendingRequests = s.requests.filter((r) => r.state === 'pending').length;
    fx.canvas = o.canvasSeen.changed ? 'changed' : o.canvasSeen.unreadable ? 'unreadable' : o.canvasSeen.compared ? 'unchanged' : null;
    if (!o.note) {
      const { outcome, silent, caveat } = decideOutcome(o);
      s.outcome = outcome;
      if (silent) s.silent = silent;
      if (caveat) s.caveat = caveat;
    }
    s.summary = summarize(s);
    if (this.lastResponse?.span === o) this.lastResponse = null;
    this.closed.push(s);
    if (s.outcome === 'changed') this.wantKeyframe({ t: s.t1, reason: 'changed', span: s.id });
    this.opts.onSpan?.(s);
  }

  private wantKeyframe(k: KeyframeRequest) {
    this.planner.want(k);
  }

  private emitKeyframe(k: KeyframeRequest) {
    this.keyframes.push(k);
    this.opts.onKeyframe?.(k);
  }
}

function toSpanRequest(r: Req): SpanRequest {
  const name = classifyRequest({ method: r.method, url: r.url, ...(r.headers ? { headers: r.headers } : {}) });
  return {
    rid: r.rid,
    method: r.method,
    url: r.url,
    t: r.t,
    status: r.status,
    state: r.state,
    ...(r.error ? { error: r.error } : {}),
    ms: r.end === null ? null : Math.round(r.end - r.t),
    ...(name ? { name } : {}),
  };
}

function consoleText(e: EventOf<'console'>): string {
  const parts = e.data.args.map((a) => {
    if (typeof a === 'string') return a;
    if (a && typeof a === 'object' && !Array.isArray(a) && (a as Record<string, unknown>)['$t'] === 'error') {
      const x = a as Record<string, unknown>;
      return `${String(x['name'] ?? 'Error')}: ${String(x['message'] ?? '')}`;
    }
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  });
  const text = parts.join(' ');
  return text.length > 200 ? text.slice(0, 197) + '...' : text;
}

function silentClassOf(reqs: Req[]): SilentClass | null {
  let worst: SilentClass | null = null;
  const rank: Record<SilentClass, number> = { '2xx': 0, '4xx': 1, network: 2, '5xx': 3 };
  for (const r of reqs) {
    const c: SilentClass | null = r.state === 'failed' ? 'network' : r.status === null ? null : r.status >= 500 ? '5xx' : r.status >= 400 ? '4xx' : '2xx';
    if (c && (!worst || rank[c] > rank[worst])) worst = c;
  }
  return worst;
}

/**
 * The outcome rules, in order: error, stuck, a failed request the page did not show (silent
 * 4xx/5xx), changed, silent 2xx, dead. A failure counts as shown when changed text after it
 * reads like an error; captures without changed text fall back to "any DOM change after it".
 */
function decideOutcome(o: Open): { outcome: Outcome; silent?: SilentClass; caveat?: string } {
  const fx = o.span.effects;
  if (fx.errors > 0 || fx.console.error > 0) return { outcome: 'error' };
  const live = o.reqs.filter((r) => !r.ignored);
  if (live.some((r) => r.state === 'pending')) return { outcome: 'stuck' };
  const failed = live.filter((r) => r.state === 'failed' || (r.status ?? 0) >= 400);
  const domChanged = fx.dom.added + fx.dom.removed + fx.dom.attrs + fx.dom.text > 0;
  const changed = domChanged || fx.nav.length > 0 || fx.scroll || fx.selection || fx.canvas === 'changed' || fx.value || fx.focus;
  if (failed.length) {
    const shown = o.sawTexts ? o.textsAfterFailure.some((t) => ERROR_TEXT_RE.test(t)) : (fx.domAfterFailure ?? 0) > 0;
    if (!shown) return { outcome: 'silent', silent: silentClassOf(failed) ?? '5xx', ...(domChanged ? { caveat: 'the page changed but showed no error for the failed request' } : {}) };
    return { outcome: 'changed' };
  }
  if (changed) return { outcome: 'changed' };
  if (live.length || o.sockets > 0) return { outcome: 'silent', silent: silentClassOf(live) ?? '2xx' };
  if (fx.canvas === 'unreadable') return { outcome: 'dead', caveat: 'a canvas on the page could not be read, so a redraw may have been missed' };
  return { outcome: 'dead' };
}

/** Longest summary the hand-off README shows on one timeline line before it cuts (handoff.ts entryLine). */
export const SUMMARY_BUDGET = 230;

function summarize(s: Span): string {
  const reqText = (r: Span['requests'][number], max = Infinity) => {
    const name = r.name?.label ?? requestLabel(r);
    const st = r.state === 'pending' ? 'pending' : r.state === 'failed' ? (r.error ?? 'failed') : String(r.status);
    return `${name.length > max ? `${name.slice(0, Math.max(8, max - 1))}…` : name} ${st}`;
  };
  const tail: string[] = [];
  if (s.errors[0]) tail.push(`${s.errors[0].type === 'unhandledrejection' ? 'unhandled rejection' : 'uncaught'}: ${s.errors[0].message.slice(0, 80)}`);
  else if (s.console.find((c) => c.level === 'error')) tail.push(`console error: ${s.console.find((c) => c.level === 'error')!.text.slice(0, 80)}`);
  if (s.effects.nav.length) tail.push(`went to ${pathOf(s.effects.nav[s.effects.nav.length - 1]!)}`);
  if (s.effects.canvas === 'changed' && !(s.effects.dom.added + s.effects.dom.removed + s.effects.dom.attrs + s.effects.dom.text)) tail.push('canvas redrawn');
  // the requests give way first: long third-party URLs must not push the navigation, the error
  // and the outcome past the end of the README line (docs/real-world/second-app.md)
  const outcomeLen = 70;
  const room = SUMMARY_BUDGET - s.action.label.length - tail.reduce((n, t) => n + t.length + 4, 0) - outcomeLen;
  let reqs = '';
  const count = s.requests.length === 1 ? '1 request' : `${s.requests.length} requests`;
  for (let n = Math.min(3, s.requests.length); n > 0; n--) {
    const more = s.requests.length - n;
    const line = (max?: number) => s.requests.slice(0, n).map((r) => reqText(r, max)).join(', ') + (more ? ` and ${more} more` : '');
    const full = line();
    if (full.length <= room) {
      reqs = full;
      break;
    }
    if (n === 1) {
      const cut = line(Math.max(24, room - 12 - (more ? 12 : 0)));
      reqs = cut.length <= room ? cut : count;
      break;
    }
    const cut = line(48);
    if (cut.length <= room) {
      reqs = cut;
      break;
    }
  }
  const parts: string[] = [s.action.label, ...(reqs ? [reqs] : []), ...tail];
  const what =
    s.outcome === 'silent'
      ? s.silent === '2xx'
        ? 'silent: the request worked and the page did not change'
        : `silent ${s.silent}: the request failed and the page showed no error`
      : s.outcome === 'dead'
        ? 'dead: nothing happened'
        : s.outcome === 'stuck'
          ? 'stuck: a request never returned'
          : s.outcome;
  if (s.outcome !== 'note') parts.push(what);
  return parts.join(' -> ');
}

export type { ActionType };
