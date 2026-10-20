// State and actions of the in-page reviewer toolbar (Part 2). The view components read this one
// object; every change of the tab's items goes through the platform (platform.ts, D-212): the
// extension's service worker (lib/bg/review.ts) or the embed's page store, which keep them across
// reloads until the reviewer sends them.
import { toasts } from '@toolbar/ui';
import type { Rect, TargetRef } from '@toolbar/shared';
import { DRAW_COLORS, autoFeedbackTitle, type FeedbackAnchor, type FeedbackIntent, type FeedbackKind, type FeedbackSeverity, type FeedbackShape, type ShapeType } from '@toolbar/shared/areas/reviewer';
import type { LocatorTarget, NewReviewItem, ReviewItem } from '@toolbar/shared/ext';
import type { LocatorPacket } from '@toolbar/shared/locator';
import { TOOLBAR_CLOSED_KEY, toolbarClosedOn } from '@toolbar/shared/areas/ext-ui';
import { errorText } from './errors';
import { platform, type ReviewFailure, type ReviewRequestMap, type ReviewRequestType, type ReviewResult, type ReviewTrace } from './platform';
import { docPlacement, place, resolve } from './track';
import { anchorOf, elementAt, frameAt, frameOf, labelOf, marksBox, pageInfo, painted, pageSelection, selectionElement, shapesBox, targetOf, visibleRect } from './page';

export type Tool = 'comment' | 'shot' | ShapeType;
export type Corner = 'br' | 'bl' | 'tr' | 'tl';

/**
 * Where the launcher and pill sit: the corner they are anchored to (the side they grow away
 * from) and their distance in px from its two edges. Kept per origin (D-199).
 */
export interface DockPos {
  h: 'l' | 'r';
  v: 't' | 'b';
  x: number;
  y: number;
}
export const DOCK_DEFAULT: DockPos = { h: 'r', v: 'b', x: 20, y: 20 };

function validPos(p: unknown): p is DockPos {
  const o = p as DockPos | null;
  return !!o && (o.h === 'l' || o.h === 'r') && (o.v === 't' || o.v === 'b') && Number.isFinite(o.x) && Number.isFinite(o.y) && o.x >= 0 && o.y >= 0 && o.x < 20000 && o.y < 20000;
}

export interface Draft {
  /** set when editing an item already in the list */
  id: string | null;
  kind: FeedbackKind;
  label: string;
  target?: TargetRef;
  anchor?: FeedbackAnchor;
  shapes: FeedbackShape[];
  quote?: string;
  marks?: Rect[];
  cropBlobId?: string;
  cropPreview?: string;
  cropRect?: Rect;
  /** the crop was taken by itself for the agent's folder (element and text notes), not by the reviewer */
  cropAuto?: boolean;
  voiceBlobId?: string;
  voiceDurationMs?: number;
  /** the locator packet in flight (D-164): asked for when the note is made, awaited when it is added */
  locatorP?: Promise<LocatorPacket | undefined>;
  comment: string;
  intent: FeedbackIntent;
  severity: FeedbackSeverity;
  /** viewport point the composer opens next to */
  at: { x: number; y: number };
}

export type TraceView = ReviewTrace;

export interface Hover {
  rect: { x: number; y: number; w: number; h: number };
  label: string;
}

export interface Chip {
  x: number;
  y: number;
  text: string;
  marks: Rect[];
  target: TargetRef | null;
  anchor: FeedbackAnchor;
  box: Rect;
}

/** A request through the platform; a missing handler answers not_implemented. */
function send<K extends ReviewRequestType>(type: K, req: ReviewRequestMap[K]['req']): Promise<ReviewResult<K>> {
  return platform().request(type, req);
}

/** origin -> DockPos, in the platform's storage (the extension's, never the page's) */
const POS_KEY = 'tb:review-pos';
/** How long adding a note waits for its locator packet (source maps can be slow to fetch). */
const LOCATOR_WAIT_MS = 8000;

/**
 * Ask the worker for the note's locator packet (D-164): route files from the app's route table,
 * Svelte's dev source, the errors of the last minute with mapped stacks. The note has its own
 * crop, so the packet takes none. Never rejects: a page that does not answer gives no packet.
 */
function locate(target: LocatorTarget, quote?: string): Promise<LocatorPacket | undefined> {
  return send('locator.capture', { ...target, crop: false }).then(
    (r) => {
      if (!r.ok) return undefined;
      const p = r.locator;
      // the selection is gone by the time the page answers; the note keeps the quote
      if (quote && p.masking !== 'production') p.selection = quote.slice(0, 2000);
      return p;
    },
    () => undefined,
  );
}

function within<T>(p: Promise<T | undefined>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
}

export class Review {
  awake = $state(false);
  tool: Tool | null = $state(null);
  color: string = $state(DRAW_COLORS[0]);
  items: ReviewItem[] = $state([]);
  draft: Draft | null = $state(null);
  hover: Hover | null = $state(null);
  /** a drawing in progress, in document coordinates */
  drawing: FeedbackShape | null = $state(null);
  pointer: { x: number; y: number } | null = $state(null);
  chip: Chip | null = $state(null);
  pinsHidden = $state(false);
  listOpen = $state(false);
  /** our UI is hidden for a screenshot; only the draft's drawing stays */
  hiding = $state(false);
  /** Keys typed while a note's quiet crop is in flight, before its composer opens (D-160). */
  typeahead: string | null = null;
  /** Enter (add) or Escape (cancel) pressed during the type-ahead, applied once the composer opens. */
  typeaheadEnd: 'add' | 'cancel' | null = null;
  busy = $state(false);
  voice: { for: 'draft' | 'standalone'; startedAt: number } | null = $state(null);
  trace: TraceView | null = $state(null);
  /** traces exist in this build (the trace work package answers trace.get) */
  traceAvailable = $state(true);
  context = $state({ errors: 0, failed: 0 });
  /** the browser refuses the extension's screenshots of this tab until its menu is opened here (D-185) */
  shotsBlocked = $state(false);
  pos: DockPos = $state({ ...DOCK_DEFAULT });
  /** the dock's height, for the notes list that opens beside it */
  dockH = $state(44);
  /** a composer Add or Enter is stopping the voice note before it saves (one click does both) */
  adding = $state(false);
  /** D-205: the person closed the toolbar on this origin (the pill's X); the extension icon shows it again */
  closed = $state(false);
  /** D-205: the X found a running trace or voice note and asks "Stop trace?" */
  confirmClose = $state(false);
  /** the title row above the pill is open (Send asks for a title first); `title` is what is typed */
  naming = $state(false);
  title = $state('');
  /** bumps on scroll, resize and a slow timer, so pins follow the page */
  tick = $state(0);
  now = $state(Date.now());
  /** the platform asks who leaves the notes (the embed): the composer shows a name field until it is saved once */
  askName = $state(false);
  reviewerName = $state('');

  /** the platform can crop the page (the extension always; the embed through its DOM rasteriser) */
  get canScreenshot(): boolean {
    return platform().caps.canScreenshot;
  }

  // ---------- lifecycle ----------

  private initDone: () => void = () => {};
  /** resolves once init has read the stored state (the embed's show and hide wait for it) */
  readonly ready = new Promise<void>((resolve) => (this.initDone = resolve));

  async init() {
    const { storage, reviewer } = platform();
    try {
      const got = await storage.get<Record<string, unknown>>(POS_KEY);
      const p = got?.[location.origin];
      if (validPos(p)) this.pos = { h: p.h, v: p.v, x: p.x, y: p.y };
    } catch {
      /* storage unavailable */
    }
    // D-205: closed on this origin, in any tab, until the extension icon is clicked here
    try {
      this.closed = toolbarClosedOn(await storage.get(TOOLBAR_CLOSED_KEY), location.origin);
    } catch {
      /* storage unavailable */
    }
    storage.onChange(TOOLBAR_CLOSED_KEY, (value) => {
      const closed = toolbarClosedOn(value, location.origin);
      if (closed && !this.closed) this.sleep();
      this.closed = closed;
    });
    if (reviewer) {
      try {
        const who = await reviewer.load();
        this.reviewerName = who.name;
        this.askName = who.ask;
      } catch {
        /* storage unavailable: the composer asks */
      }
    }
    await this.refresh();
    await this.refreshTrace();
    // a tab with unsent notes or a running trace wakes on load, so its pins stay on the page
    if ((this.items.length || this.trace) && !this.closed) this.awake = true;
    this.initDone();
  }

  /**
   * The pill's X (D-205): hide the toolbar and the launcher on this origin, in every tab and after
   * reloads. A running trace or voice note is never stopped silently: the first call asks, then
   * `stop` true stops both, false keeps the trace running (a voice note is saved either way).
   */
  async close(stop?: boolean) {
    if (stop === undefined && (this.trace || this.voice)) {
      this.confirmClose = true;
      return;
    }
    this.confirmClose = false;
    if (this.voice) await this.stopVoice();
    if (stop && this.trace) {
      await this.toggleTrace();
      if (this.trace) return; // the notes or the trace did not go: stay open
    }
    this.sleep();
    this.closed = true;
    const origin = location.origin;
    const { storage } = platform();
    try {
      const all = { ...(await storage.get<Record<string, number>>(TOOLBAR_CLOSED_KEY)) };
      all[origin] = Date.now();
      await storage.set(TOOLBAR_CLOSED_KEY, all);
    } catch {
      /* storage unavailable: closed on this page only */
    }
  }

  /** Ctrl or Cmd+Shift+. on a closed origin: the person asked for the toolbar, so it is open again there. */
  async reopen() {
    this.closed = false;
    const origin = location.origin;
    const { storage } = platform();
    try {
      const all = { ...(await storage.get<Record<string, number>>(TOOLBAR_CLOSED_KEY)) };
      delete all[origin];
      await storage.set(TOOLBAR_CLOSED_KEY, all);
    } catch {
      /* storage unavailable */
    }
  }

  async refresh() {
    const r = await send('review.get', {});
    if (r.ok) this.items = r.items;
  }

  async refreshTrace() {
    const r = await send('trace.get', {});
    if (r.ok) {
      this.traceAvailable = true;
      this.trace = r.trace ? { recordingId: r.trace.recordingId, startedAt: r.trace.startedAt, spans: r.trace.spans } : null;
    } else if (r.error === 'not_implemented') {
      this.traceAvailable = false;
      this.trace = null;
    }
  }

  async refreshContext() {
    const r = await send('review.context', {});
    if (r.ok) {
      this.context = { errors: r.context.errors.length, failed: r.context.failedRequests.length };
      this.shotsBlocked = r.shots === 'blocked';
    }
  }

  wake() {
    this.awake = true;
    void this.refresh();
    void this.refreshTrace();
    void this.refreshContext();
  }

  sleep() {
    this.confirmClose = false;
    this.naming = false;
    if (this.voice) void this.cancelVoice();
    this.tool = null;
    this.draft = null;
    this.hover = null;
    this.drawing = null;
    this.chip = null;
    this.listOpen = false;
    this.awake = false;
  }

  get corner(): Corner {
    return `${this.pos.v}${this.pos.h}`;
  }

  /** Move the dock and remember the spot for this origin. */
  setPos(p: DockPos) {
    const pos = { h: p.h, v: p.v, x: Math.max(0, Math.round(p.x)), y: Math.max(0, Math.round(p.y)) };
    this.pos = pos;
    const origin = location.origin;
    const { storage } = platform();
    void storage
      .get<Record<string, DockPos>>(POS_KEY)
      .then((got) => storage.set(POS_KEY, { ...got, [origin]: pos }))
      .catch(() => undefined);
  }

  /** Esc: one level back. */
  back() {
    if (this.naming) return void (this.naming = false);
    if (this.voice) return void this.cancelVoice();
    if (this.draft) return this.cancelDraft();
    if (this.drawing) {
      this.drawing = null;
      return;
    }
    if (this.chip) {
      this.chip = null;
      return;
    }
    if (this.tool) {
      this.setTool(null);
      return;
    }
    if (this.listOpen) {
      this.listOpen = false;
      return;
    }
    this.sleep();
  }

  setTool(t: Tool | null) {
    if (t === 'shot' && !this.canScreenshot) return;
    if (this.draft) this.cancelDraft();
    this.tool = this.tool === t ? null : t;
    this.hover = null;
    this.drawing = null;
    this.chip = null;
    if (this.tool) this.listOpen = false;
  }

  // ---------- picking and drawing ----------

  hoverAt(x: number, y: number) {
    this.pointer = { x, y };
    if (this.tool !== 'comment' && this.tool !== 'shot') return;
    const el = elementAt(x, y);
    if (!el) {
      this.hover = null;
      return;
    }
    const r = el.getBoundingClientRect();
    this.hover = { rect: { x: r.left, y: r.top, w: r.width, h: r.height }, label: labelOf(targetOf(el)) };
  }

  /** A click on an element while picking (comment or screenshot). */
  async pick(x: number, y: number) {
    const el = elementAt(x, y);
    if (!el) return;
    const target = targetOf(el) ?? undefined;
    const anchor = anchorOf(el, x, y);
    const kind: FeedbackKind = this.tool === 'shot' ? 'shot' : 'element';
    this.hover = null;
    const draft: Draft = { id: null, kind, label: labelOf(target), target, anchor, shapes: [], comment: '', intent: 'fix', severity: 'important', at: { x, y } };
    draft.locatorP = locate({ kind: 'element', at: { x, y } });
    const r = el.getBoundingClientRect();
    const rect = visibleRect(r);
    // a comment gets a quiet crop of its element too: the folder's annotations/aNN.png (D-160)
    const end = rect ? await this.quietly(kind !== 'shot', () => this.shoot(draft, rect, { x: rect.x + scrollX, y: rect.y + scrollY, w: rect.w, h: rect.h }, { quiet: kind !== 'shot' }), draft) : null;
    if (kind === 'shot') draft.at = { x: r.right, y: r.top };
    this.openDraft(draft);
    this.finishTypeahead(end);
  }

  startShape(x: number, y: number) {
    if (this.tool !== 'rect' && this.tool !== 'arrow' && this.tool !== 'freehand') return;
    const p: [number, number, number] = [x + scrollX, y + scrollY, 0.5];
    this.drawing = { type: this.tool, points: this.tool === 'freehand' ? [p] : [p, [p[0], p[1], 0.5]], color: this.color, width: this.tool === 'freehand' ? 6 : 3 };
  }

  moveShape(x: number, y: number, pressure = 0.5) {
    const d = this.drawing;
    if (!d) return;
    const p: [number, number, number] = [x + scrollX, y + scrollY, pressure || 0.5];
    if (d.type === 'freehand') d.points.push(p);
    else d.points[1] = p;
  }

  async endShape(x: number, y: number) {
    const d = this.drawing;
    if (!d) return;
    this.moveShape(x, y);
    const box = shapesBox([d]);
    this.drawing = null;
    if (!box || (box.w < 6 && box.h < 6)) return;
    const shape = $state.snapshot(d) as FeedbackShape;
    const draft: Draft = {
      id: null,
      kind: 'draw',
      label: shape.type === 'rect' ? 'Rectangle' : shape.type === 'arrow' ? 'Arrow' : 'Drawing',
      shapes: [shape],
      comment: '',
      intent: 'fix',
      severity: 'important',
      at: { x, y },
    };
    // what the drawing points at: the element under its end (arrow head, rectangle centre)
    const tip = shape.type === 'arrow' ? shape.points[1]! : [box.x + box.w / 2, box.y + box.h / 2];
    const el = elementAt(tip[0]! - scrollX, tip[1]! - scrollY);
    if (el) {
      draft.target = targetOf(el) ?? undefined;
      draft.anchor = anchorOf(el, tip[0]! - scrollX, tip[1]! - scrollY);
    } else draft.anchor = { fx: 0.5, fy: 0.5, x: tip[0]!, y: tip[1]! };
    // what the drawing stays on while the page scrolls, a container scrolls or the layout moves (D-204)
    const s0 = shape.points[0]!;
    const frame = frameAt(shape.type, { x: s0[0] - scrollX, y: s0[1] - scrollY }, { x: box.x - scrollX, y: box.y - scrollY, w: box.w, h: box.h });
    if (frame) draft.anchor.frame = frame;
    const pad = 16;
    draft.locatorP = locate({ kind: 'area', rect: { x: box.x - scrollX, y: box.y - scrollY, w: box.w, h: box.h } });
    const rect = visibleRect({ left: box.x - scrollX, top: box.y - scrollY, width: box.w, height: box.h }, pad);
    this.draft = draft; // the drawing stays on screen for the crop
    if (rect) await this.shoot(draft, rect, { x: rect.x + scrollX, y: rect.y + scrollY, w: rect.w, h: rect.h });
    this.openDraft(draft);
  }

  /** Text selected on the page: offer a comment chip beside it. */
  checkSelection() {
    if (!this.awake || this.draft || this.tool) return;
    const s = pageSelection();
    if (!s) {
      this.chip = null;
      return;
    }
    const el = selectionElement(s.range);
    // the highlight follows the element that holds the text (D-204)
    const frame = el ? frameOf(el) : null;
    const end = s.rects[s.rects.length - 1];
    const ax = end ? end.x + end.w - scrollX : s.box.right;
    const ay = end ? end.y + end.h / 2 - scrollY : s.box.bottom;
    this.chip = {
      x: Math.min(innerWidth - 120, s.box.right + 6),
      y: Math.min(innerHeight - 40, s.box.bottom + 6),
      text: s.text,
      marks: s.rects,
      target: el ? targetOf(el) : null,
      anchor: { ...anchorOf(el, ax, ay), ...(frame ? { frame } : {}) },
      box: { x: s.box.left, y: s.box.top, w: s.box.width, h: s.box.height },
    };
  }

  async commentOnSelection(): Promise<void> {
    const c = this.chip;
    if (!c) {
      this.checkSelection();
      if (!this.chip) return void toasts.show('Select some text on the page first');
      return this.commentOnSelection();
    }
    this.chip = null;
    getSelection()?.removeAllRanges();
    const draft: Draft = {
      id: null,
      kind: 'text',
      label: `Text "${c.text.length > 40 ? c.text.slice(0, 39) + '…' : c.text}"`,
      target: c.target ?? undefined,
      anchor: c.anchor,
      quote: c.text,
      marks: c.marks,
      shapes: [],
      comment: '',
      intent: 'fix',
      severity: 'important',
      at: { x: c.box.x + c.box.w, y: c.box.y + c.box.h },
      locatorP: locate({ kind: 'text', rect: c.box }, c.text),
    };
    // a quiet crop of the selected text, 8 px around it, for the folder (D-160)
    const rect = visibleRect({ left: c.box.x, top: c.box.y, width: c.box.w, height: c.box.h }, 8);
    const end = rect ? await this.quietly(true, () => this.shoot(draft, rect, { x: rect.x + scrollX, y: rect.y + scrollY, w: rect.w, h: rect.h }, { quiet: true }), draft) : null;
    this.openDraft(draft);
    this.finishTypeahead(end);
  }

  // ---------- screenshots ----------

  /**
   * Run a quiet crop before the composer opens. A person starts typing right after the click, so
   * the keys typed meanwhile are kept (Review.svelte's key handler) and become the comment's start.
   */
  async quietly(on: boolean, run: () => Promise<void>, draft: Draft): Promise<'add' | 'cancel' | null> {
    if (!on) {
      await run();
      return null;
    }
    this.typeahead = '';
    this.typeaheadEnd = null;
    try {
      await run();
    } finally {
      draft.comment = (this.typeahead ?? '') + draft.comment;
      this.typeahead = null;
    }
    const end = this.typeaheadEnd;
    this.typeaheadEnd = null;
    return end;
  }

  /** Apply an Enter or Escape typed before the composer opened. */
  finishTypeahead(end: 'add' | 'cancel' | null) {
    if (end === 'add') void this.saveDraft();
    else if (end === 'cancel') this.cancelDraft();
  }

  /** Hides our UI (the draft's drawing stays), takes the viewport rect, keeps it on the draft. */
  async shoot(draft: Draft, rect: Rect, docRect: Rect, opts: { quiet?: boolean } = {}) {
    if (!this.canScreenshot) return;
    this.hiding = true;
    try {
      await painted();
      const r = await send('review.shot', { rect, vw: innerWidth });
      if (r.ok) {
        draft.cropBlobId = r.blobId;
        draft.cropPreview = opts.quiet ? undefined : r.preview;
        draft.cropRect = docRect;
        draft.cropAuto = !!opts.quiet;
      } else if (!opts.quiet) toasts.error(errorText(r));
    } finally {
      this.hiding = false;
    }
  }

  /** The composer's camera: a screenshot of the draft's element, selection or drawing. */
  async attachShot() {
    const d = this.draft;
    if (!d) return;
    let rect: Rect | null = null;
    // drawings and highlights are kept in the coordinates they were made in; their element may
    // have moved since (a scrolled container), so the crop is taken where they are drawn now and
    // its rect given back in their coordinates, for the folder's aNN.shapes.json (D-204)
    const t = place(d).shapes ?? docPlacement();
    const marked = d.shapes.length ? shapesBox(d.shapes) : d.marks?.length ? marksBox(d.marks) : null;
    if (marked) {
      rect = visibleRect({ left: marked.x * t.sx + t.dx, top: marked.y * t.sy + t.dy, width: marked.w * t.sx, height: marked.h * t.sy }, d.shapes.length ? 16 : 8);
      if (!rect) return void toasts.show('Scroll the element into view first');
      return void (await this.shoot(d, rect, { x: (rect.x - t.dx) / t.sx, y: (rect.y - t.dy) / t.sy, w: rect.w / t.sx, h: rect.h / t.sy }));
    }
    if (d.target) {
      const el = resolve(d.target);
      if (el) rect = visibleRect(el.getBoundingClientRect());
    }
    if (!rect) return void toasts.show('Scroll the element into view first');
    await this.shoot(d, rect, { x: rect.x + scrollX, y: rect.y + scrollY, w: rect.w, h: rect.h });
  }

  // ---------- composer ----------

  openDraft(d: Draft) {
    this.draft = d;
    void this.refreshContext();
  }

  edit(it: ReviewItem, at: { x: number; y: number }) {
    this.setTool(null);
    this.draft = {
      id: it.id,
      kind: it.kind,
      label: it.kind === 'voice' ? 'Voice note' : it.kind === 'text' ? `Text "${(it.quote ?? '').slice(0, 39)}"` : labelOf(it.target),
      target: it.target,
      anchor: it.anchor,
      shapes: it.shapes,
      quote: it.quote,
      marks: it.marks,
      cropRect: it.cropRect,
      cropBlobId: it.cropBlobId,
      voiceBlobId: it.voiceBlobId,
      voiceDurationMs: it.voiceDurationMs,
      comment: it.comment,
      intent: it.intent,
      severity: it.severity,
      at,
    };
  }

  cancelDraft() {
    if (this.voice?.for === 'draft') void this.cancelVoice();
    this.draft = null;
  }

  /** Adds and edits in flight, one after another; submit waits for them. */
  private saving: Promise<unknown> = Promise.resolve();

  /**
   * Enter in the composer: the card closes at once, so the next keys (another tool, another
   * note) reach the toolbar while the worker stores the note. A failure reopens the card.
   */
  async saveDraft() {
    const d = this.draft;
    if (!d || this.adding) return;
    if (this.voice?.for === 'draft') {
      // one click stops the voice note, attaches it and adds the note; a second click or Enter
      // meanwhile does nothing, so the clip is never dropped or the note added twice (D-199)
      this.adding = true;
      let stopped: Awaited<ReturnType<Review['stopVoice']>>;
      try {
        stopped = await this.stopVoice();
      } finally {
        this.adding = false;
      }
      // cancelled meanwhile, or the clip failed to save: the composer stays for the person to decide
      if (this.draft !== d || stopped === 'failed') return;
    }
    if (!d.comment.trim() && !d.voiceBlobId && d.kind !== 'shot' && d.kind !== 'draw') return void toasts.show('Write a comment or record a voice note');
    this.draft = null;
    const job = this.saving.then(async () => {
      let r: { ok: true } | ReviewFailure;
      if (d.id) {
        r = await send('review.update', { id: d.id, patch: { comment: d.comment, intent: d.intent, severity: d.severity, voiceBlobId: d.voiceBlobId, voiceDurationMs: d.voiceDurationMs } });
      } else {
        const locator = d.locatorP ? await within(d.locatorP, LOCATOR_WAIT_MS) : undefined;
        const item: NewReviewItem = {
          kind: d.kind,
          comment: d.comment,
          shapes: $state.snapshot(d.shapes) as FeedbackShape[],
          page: pageInfo(),
          intent: d.intent,
          severity: d.severity,
          ...(d.quote ? { quote: d.quote } : {}),
          ...(d.marks ? { marks: $state.snapshot(d.marks) as Rect[] } : {}),
          ...(d.target ? { target: $state.snapshot(d.target) as TargetRef } : {}),
          ...(locator ? { locator } : {}),
          ...(d.anchor ? { anchor: $state.snapshot(d.anchor) as FeedbackAnchor } : {}),
          ...(d.cropBlobId ? { cropBlobId: d.cropBlobId, cropRect: $state.snapshot(d.cropRect) as Rect } : {}),
          ...(d.voiceBlobId ? { voiceBlobId: d.voiceBlobId, voiceDurationMs: d.voiceDurationMs } : {}),
        };
        r = await send('review.add', { item, trace: !!this.trace });
      }
      if (!r.ok) {
        toasts.error(errorText(r));
        if (!this.draft) this.draft = d;
        return;
      }
      if (this.askName) await this.saveName();
      await this.refresh();
    });
    this.saving = job.catch(() => undefined);
    await job;
  }

  /** Keep the name typed in the composer's first note; the composer stops asking. */
  private async saveName() {
    this.askName = false;
    try {
      await platform().reviewer?.save(this.reviewerName.trim().slice(0, 80));
    } catch {
      /* storage unavailable: asked again on the next page */
    }
  }

  async remove(id: string) {
    const r = await send('review.remove', { id });
    if (!r.ok) toasts.error(errorText(r));
    if (this.draft?.id === id) this.draft = null;
    await this.refresh();
  }

  // ---------- voice ----------

  async startVoice(target: 'draft' | 'standalone') {
    if (this.voice) return;
    const r = await send('review.voice', { op: 'start' });
    if (!r.ok) {
      if (r.error === 'permission_denied') toasts.error(errorText(r), { action: { label: 'Allow', run: () => void send('mic.request', {}) } });
      else toasts.error(errorText(r));
      return;
    }
    this.voice = { for: target, startedAt: Date.now() };
  }

  /** Stop the microphone; a draft's clip goes on the draft that was open when it started. */
  async stopVoice(): Promise<'saved' | 'empty' | 'failed' | undefined> {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    const draft = v.for === 'draft' ? this.draft : null;
    // a standalone note opens its composer only once the worker has saved the clip, which can take a
    // while on a busy machine: keys typed meanwhile (a comment, Enter, Escape) are kept, as for a
    // quiet crop, instead of falling on the page (D-181)
    const standalone = v.for === 'standalone';
    if (standalone) {
      this.typeahead = '';
      this.typeaheadEnd = null;
    }
    const r = await send('review.voice', { op: 'stop' });
    const typed = standalone ? (this.typeahead ?? '') : '';
    const end = standalone ? this.typeaheadEnd : null;
    if (standalone) {
      this.typeahead = null;
      this.typeaheadEnd = null;
    }
    if (!r.ok) {
      toasts.error(errorText(r));
      return 'failed';
    }
    if (!r.blobId) {
      toasts.show('No sound was recorded');
      return 'empty';
    }
    if (draft) {
      draft.voiceBlobId = r.blobId;
      draft.voiceDurationMs = r.durationMs;
    } else if (v.for === 'standalone') {
      this.openDraft({
        id: null,
        kind: 'voice',
        label: this.trace ? 'Voice note on the trace' : 'Voice note on this page',
        shapes: [],
        voiceBlobId: r.blobId,
        voiceDurationMs: r.durationMs,
        locatorP: locate({ kind: 'page' }),
        comment: typed,
        intent: 'fix',
        severity: 'important',
        at: { x: innerWidth - 340, y: innerHeight - 260 },
      });
      this.finishTypeahead(end);
    }
    return 'saved';
  }

  async cancelVoice() {
    if (!this.voice) return;
    this.voice = null;
    await send('review.voice', { op: 'cancel' });
  }

  toggleVoice() {
    if (this.voice) return void this.stopVoice();
    void this.startVoice(this.draft ? 'draft' : 'standalone');
  }

  // ---------- trace and submit ----------

  async toggleTrace() {
    if (!this.traceAvailable) return void toasts.show('Traces are not available in this build');
    if (this.trace) {
      const t = this.trace;
      if (this.items.length) {
        const ok = await this.submit();
        if (!ok) return;
      }
      const r = await send('trace.stop', { open: true });
      if (!r.ok) return void toasts.error(r.message ?? 'The trace did not stop');
      this.trace = null;
      toasts.success(r.result.spans != null ? `Trace saved: ${r.result.spans} actions` : 'Trace sent');
      void t;
      return;
    }
    const r = await send('trace.start', {});
    if (!r.ok) return void toasts.error(r.error === 'not_signed_in' ? 'Sign in to start a trace' : (r.message ?? 'The trace did not start'));
    this.trace = { recordingId: r.trace.recordingId, startedAt: r.trace.startedAt, spans: 0 };
  }

  /** The title the capture gets when none is typed (the title row's placeholder). */
  get autoTitle(): string {
    return autoFeedbackTitle(this.items);
  }

  /**
   * Send from the pill or the list: notes for a new capture first ask for a title in one row
   * above the pill (Enter sends, Esc or Skip sends with the automatic title, a click elsewhere
   * cancels). Notes that go onto a running trace send at once: the trace has its own title.
   */
  async send() {
    if (this.busy) return;
    if (this.trace) return void (await this.submit());
    if (this.naming) return void (await this.submit(this.title));
    if (!(await this.flush())) return;
    this.listOpen = false;
    this.hover = null;
    this.title = '';
    this.naming = true;
  }

  /** Esc or Skip in the title row: send with the automatic title. */
  skipTitle() {
    void this.submit('');
  }

  /** A note still in the composer or the microphone goes with the rest. False when nothing is left to send. */
  private async flush(): Promise<boolean> {
    if (this.voice) await this.stopVoice();
    if (this.draft) await this.saveDraft();
    await this.saving;
    if (!this.items.length) {
      toasts.show('Nothing to send yet');
      return false;
    }
    return true;
  }

  async submit(title?: string): Promise<boolean> {
    if (this.busy) return false;
    this.naming = false;
    if (!(await this.flush())) return false;
    this.busy = true;
    const toast = toasts.loading(`Sending ${this.items.length} ${this.items.length === 1 ? 'note' : 'notes'}`);
    try {
      const r = await send('review.submit', { traceRecordingId: this.trace?.recordingId ?? null, ...(title?.trim() ? { title: title.trim() } : {}) });
      if (!r.ok) {
        toasts.update(toast, { kind: 'error', message: errorText(r), duration: 6000 });
        return false;
      }
      const n = r.result.count;
      const result = r.result;
      const { openCapture } = platform();
      toasts.update(toast, {
        kind: 'success',
        message: result.trace ? `Added ${n} ${n === 1 ? 'note' : 'notes'} to the trace` : `Sent ${n} ${n === 1 ? 'note' : 'notes'}`,
        ...(result.trace || !openCapture ? {} : { action: { label: 'Open', run: () => openCapture(result) } }),
      });
      this.listOpen = false;
      await this.refresh();
      return true;
    } finally {
      this.busy = false;
    }
  }

  async clearAll() {
    await send('review.clear', {});
    this.draft = null;
    await this.refresh();
  }
}

export const review = new Review();
