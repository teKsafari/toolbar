// State and actions of the in-page reviewer toolbar (Part 2). The view components read this one
// object; every change of the tab's items goes through the service worker (lib/bg/review.ts),
// which keeps them across reloads until the reviewer sends them.
import { browser } from 'wxt/browser';
import { toasts } from '@toolbar/ui';
import type { Rect, TargetRef } from '@toolbar/shared';
import { DRAW_COLORS, type FeedbackAnchor, type FeedbackIntent, type FeedbackKind, type FeedbackSeverity, type FeedbackShape, type ShapeType } from '@toolbar/shared/areas/reviewer';
import type { BgError, BgRequest, NewReviewItem, ReviewItem } from '@toolbar/shared/ext';
import { send, errorText } from '../ui/send';
import { anchorOf, elementAt, labelOf, pageInfo, painted, pageSelection, selectionElement, shapesBox, targetOf, visibleRect } from './page';

export type Tool = 'comment' | 'shot' | ShapeType;
export type Corner = 'br' | 'bl' | 'tr' | 'tl';

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
  voiceBlobId?: string;
  voiceDurationMs?: number;
  comment: string;
  intent: FeedbackIntent;
  severity: FeedbackSeverity;
  /** viewport point the composer opens next to */
  at: { x: number; y: number };
}

export interface TraceView {
  recordingId: string;
  startedAt: number;
  spans?: number;
}

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

/** Requests of other work packages (traces) that may be missing from this build. */
async function sendLoose<T>(type: string, req: Record<string, unknown> = {}): Promise<({ ok: true } & T) | { ok: false; error: string; message?: string }> {
  try {
    const r = (await browser.runtime.sendMessage({ type, ...req })) as ({ ok: true } & T) | { ok: false; error: string; message?: string } | undefined;
    return r ?? { ok: false, error: 'not_implemented' };
  } catch (e) {
    return { ok: false, error: 'not_implemented', message: e instanceof Error ? e.message : String(e) };
  }
}

const CORNER_KEY = 'tb:review-corner';

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
  busy = $state(false);
  voice: { for: 'draft' | 'standalone'; startedAt: number } | null = $state(null);
  trace: TraceView | null = $state(null);
  /** traces exist in this build (the trace work package answers trace.get) */
  traceAvailable = $state(true);
  context = $state({ errors: 0, failed: 0 });
  corner: Corner = $state('br');
  /** bumps on scroll, resize and a slow timer, so pins follow the page */
  tick = $state(0);
  now = $state(Date.now());

  // ---------- lifecycle ----------

  async init() {
    try {
      const got = await browser.storage.local.get(CORNER_KEY);
      const c = got[CORNER_KEY];
      if (c === 'br' || c === 'bl' || c === 'tr' || c === 'tl') this.corner = c;
    } catch {
      /* storage unavailable */
    }
    await this.refresh();
    await this.refreshTrace();
    // a tab with unsent notes or a running trace wakes on load, so its pins stay on the page
    if (this.items.length || this.trace) this.awake = true;
  }

  async refresh() {
    const r = await send('review.get', {});
    if (r.ok) this.items = r.items;
  }

  async refreshTrace() {
    const r = await sendLoose<{ trace: TraceView | null }>('trace.get');
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
    if (r.ok) this.context = { errors: r.context.errors.length, failed: r.context.failedRequests.length };
  }

  wake() {
    this.awake = true;
    void this.refresh();
    void this.refreshTrace();
    void this.refreshContext();
  }

  sleep() {
    if (this.voice) void this.cancelVoice();
    this.tool = null;
    this.draft = null;
    this.hover = null;
    this.drawing = null;
    this.chip = null;
    this.listOpen = false;
    this.awake = false;
  }

  setCorner(c: Corner) {
    this.corner = c;
    void browser.storage.local.set({ [CORNER_KEY]: c }).catch(() => undefined);
  }

  /** Esc: one level back. */
  back() {
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
    if (kind === 'shot') {
      const r = el.getBoundingClientRect();
      const rect = visibleRect(r);
      if (rect) await this.shoot(draft, rect, { x: rect.x + scrollX, y: rect.y + scrollY, w: rect.w, h: rect.h });
      draft.at = { x: r.right, y: r.top };
    }
    this.openDraft(draft);
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
    const pad = 16;
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
    const end = s.rects[s.rects.length - 1];
    const ax = end ? end.x + end.w - scrollX : s.box.right;
    const ay = end ? end.y + end.h / 2 - scrollY : s.box.bottom;
    this.chip = {
      x: Math.min(innerWidth - 120, s.box.right + 6),
      y: Math.min(innerHeight - 40, s.box.bottom + 6),
      text: s.text,
      marks: s.rects,
      target: el ? targetOf(el) : null,
      anchor: anchorOf(el, ax, ay),
      box: { x: s.box.left, y: s.box.top, w: s.box.width, h: s.box.height },
    };
  }

  commentOnSelection(): void {
    const c = this.chip;
    if (!c) {
      this.checkSelection();
      if (!this.chip) return void toasts.show('Select some text on the page first');
      return this.commentOnSelection();
    }
    this.chip = null;
    getSelection()?.removeAllRanges();
    this.openDraft({
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
    });
  }

  // ---------- screenshots ----------

  /** Hides our UI (the draft's drawing stays), takes the viewport rect, keeps it on the draft. */
  async shoot(draft: Draft, rect: Rect, docRect: Rect) {
    this.hiding = true;
    try {
      await painted();
      const r = await send('review.shot', { rect, vw: innerWidth });
      if (r.ok) {
        draft.cropBlobId = r.blobId;
        draft.cropPreview = r.preview;
        draft.cropRect = docRect;
      } else toasts.error(errorText(r));
    } finally {
      this.hiding = false;
    }
  }

  /** The composer's camera: a screenshot of the draft's element, selection or drawing. */
  async attachShot() {
    const d = this.draft;
    if (!d) return;
    let rect: Rect | null = null;
    if (d.shapes.length) {
      const b = shapesBox(d.shapes);
      if (b) rect = visibleRect({ left: b.x - scrollX, top: b.y - scrollY, width: b.w, height: b.h }, 16);
    } else if (d.marks?.length) {
      const xs = d.marks.map((m) => m.x);
      const ys = d.marks.map((m) => m.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const x2 = Math.max(...d.marks.map((m) => m.x + m.w));
      const y2 = Math.max(...d.marks.map((m) => m.y + m.h));
      rect = visibleRect({ left: x - scrollX, top: y - scrollY, width: x2 - x, height: y2 - y }, 8);
    } else if (d.target) {
      let el: Element | null = null;
      try {
        el = document.querySelector(d.target.selector);
      } catch {
        /* invalid selector */
      }
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
    if (!d) return;
    if (this.voice?.for === 'draft') await this.stopVoice();
    if (!d.comment.trim() && !d.voiceBlobId && d.kind !== 'shot' && d.kind !== 'draw') return void toasts.show('Write a comment or record a voice note');
    this.draft = null;
    const job = this.saving.then(async () => {
      let r: { ok: true } | { ok: false; error: BgError; message?: string };
      if (d.id) {
        r = await send('review.update', { id: d.id, patch: { comment: d.comment, intent: d.intent, severity: d.severity, voiceBlobId: d.voiceBlobId, voiceDurationMs: d.voiceDurationMs } });
      } else {
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
      await this.refresh();
    });
    this.saving = job.catch(() => undefined);
    await job;
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

  async stopVoice() {
    const v = this.voice;
    if (!v) return;
    this.voice = null;
    const r = await send('review.voice', { op: 'stop' });
    if (!r.ok) return void toasts.error(errorText(r));
    if (!r.blobId) return void toasts.show('No sound was recorded');
    if (v.for === 'draft' && this.draft) {
      this.draft.voiceBlobId = r.blobId;
      this.draft.voiceDurationMs = r.durationMs;
    } else if (v.for === 'standalone') {
      this.openDraft({
        id: null,
        kind: 'voice',
        label: this.trace ? 'Voice note on the trace' : 'Voice note on this page',
        shapes: [],
        voiceBlobId: r.blobId,
        voiceDurationMs: r.durationMs,
        comment: '',
        intent: 'fix',
        severity: 'important',
        at: { x: innerWidth - 340, y: innerHeight - 260 },
      });
    }
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
      const r = await sendLoose<{ result: { recordingId: string; shareUrl: string; spans: number } }>('trace.stop', { open: true });
      if (!r.ok) return void toasts.error(r.message ?? 'The trace did not stop');
      this.trace = null;
      toasts.success(`Trace saved: ${r.result.spans} actions`);
      void t;
      return;
    }
    const r = await sendLoose<{ trace: TraceView }>('trace.start', {});
    if (!r.ok) return void toasts.error(r.error === 'not_signed_in' ? 'Sign in to start a trace' : (r.message ?? 'The trace did not start'));
    this.trace = { recordingId: r.trace.recordingId, startedAt: r.trace.startedAt, spans: 0 };
  }

  async submit(): Promise<boolean> {
    if (this.busy) return false;
    // a note still in the composer or the microphone goes with the rest
    if (this.voice) await this.stopVoice();
    if (this.draft) await this.saveDraft();
    await this.saving;
    if (!this.items.length) {
      toasts.show('Nothing to send yet');
      return false;
    }
    this.busy = true;
    const toast = toasts.loading(`Sending ${this.items.length} ${this.items.length === 1 ? 'note' : 'notes'}`);
    try {
      const r = await send('review.submit', { traceRecordingId: this.trace?.recordingId ?? null });
      if (!r.ok) {
        toasts.update(toast, { kind: 'error', message: errorText(r), duration: 6000 });
        return false;
      }
      const n = r.result.count;
      const open: BgRequest = { type: 'tab.open', url: r.result.url };
      toasts.update(toast, {
        kind: 'success',
        message: r.result.trace ? `Added ${n} ${n === 1 ? 'note' : 'notes'} to the trace` : `Sent ${n} ${n === 1 ? 'note' : 'notes'}`,
        ...(r.result.trace ? {} : { action: { label: 'Open', run: () => void browser.runtime.sendMessage(open) } }),
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
