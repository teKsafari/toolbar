// Keeps the reviewer's notes on the content they were made on (D-204). A drawing or a text
// highlight is attached to one element (its frame: selector, test id or id, and the element's box
// when the note was made, in the same document coordinates as the shapes); a pin is attached to
// its target element. Every animation frame in which something moved, the page asks each element
// for its box and draws the note at the same offset from it. "Something moved" is any scroll (a
// capture listener on window sees the scroll of every container in the document; containers in
// a shadow root, whose scroll never reaches window, get their own listener), a resize, a resize
// of a tracked element (ResizeObserver), or a DOM change (a banner that pushes content down).
// An element that is gone, or no longer laid out, leaves its notes where they last were, marked
// detached.
import type { Rect, TargetRef } from '@toolbar/shared';
import type { FeedbackFrame } from '@toolbar/shared/areas/reviewer';
import type { ReviewItem } from '@toolbar/shared/ext';

type Ref = Pick<TargetRef, 'selector' | 'testId' | 'elId'>;

/** How to draw shapes kept in document coordinates now: client = point * s + d. */
export interface Placement {
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  /** the element is gone: the shapes stay where they were last seen */
  detached: boolean;
}

/** An item's pin and, for drawings and highlights, where its shapes go. */
export interface Placed {
  pin: { x: number; y: number } | null;
  shapes: Placement | null;
  detached: boolean;
}

const keyOf = (r: Ref) => `${r.selector}\u0000${r.testId ?? ''}\u0000${r.elId ?? ''}`;

/** element found for a ref (dropped when it leaves the document) */
const cache = new Map<string, Element>();
/** last box seen for a ref, in document coordinates, for when its element goes away */
const lastBox = new Map<string, Rect>();
const watchedScrollers = new WeakSet<EventTarget>();

let onChange: (() => void) | null = null;
let raf = 0;
let resizeObs: ResizeObserver | null = null;
let mutationObs: MutationObserver | null = null;

/** Ask for one redraw on the next animation frame, however many events arrive before it. */
export function schedule() {
  if (raf || !onChange) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    onChange?.();
  });
}

/** Start following the page; `cb` runs at most once per animation frame. Returns the stop. */
export function startTracking(cb: () => void): () => void {
  onChange = cb;
  addEventListener('scroll', schedule, { capture: true, passive: true });
  addEventListener('resize', schedule, { passive: true });
  visualViewport?.addEventListener('resize', schedule, { passive: true });
  return () => {
    setActive(false);
    onChange = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    removeEventListener('scroll', schedule, { capture: true });
    removeEventListener('resize', schedule);
    visualViewport?.removeEventListener('resize', schedule);
  };
}

/**
 * Watch element sizes and DOM changes only while notes are on this page: a page without notes
 * pays nothing for the reviewer toolbar.
 */
export function setActive(on: boolean) {
  if (on && !resizeObs) {
    resizeObs = new ResizeObserver(schedule);
    for (const el of cache.values()) resizeObs.observe(el);
    mutationObs = new MutationObserver(schedule);
    mutationObs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
  } else if (!on && resizeObs) {
    resizeObs.disconnect();
    mutationObs?.disconnect();
    resizeObs = null;
    mutationObs = null;
  }
}

function parentOrHost(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function watch(el: Element) {
  resizeObs?.observe(el);
  // scroll events do not bubble and do not leave a shadow root: window's capture listener sees
  // every container in the document, a container inside a shadow root needs its own
  for (let e: Element | null = el; e; e = parentOrHost(e)) {
    const root = e.getRootNode();
    if (root instanceof ShadowRoot && !watchedScrollers.has(e)) {
      const s = getComputedStyle(e);
      if (s.overflowY !== 'visible' || s.overflowX !== 'visible') {
        e.addEventListener('scroll', schedule, { passive: true });
        watchedScrollers.add(e);
      }
    }
  }
}

function query(r: Ref): Element | null {
  try {
    const el = document.querySelector(r.selector);
    if (el) return el;
  } catch {
    /* not a valid selector here */
  }
  if (r.testId) return document.querySelector(`[data-testid="${CSS.escape(r.testId)}"]`);
  if (r.elId) return document.getElementById(r.elId);
  return null;
}

/** The element of a ref: the one seen before while it stays in the document, else found again. */
export function resolve(r: Ref): Element | null {
  const key = keyOf(r);
  const had = cache.get(key);
  if (had?.isConnected) return had;
  if (had) {
    resizeObs?.unobserve(had);
    cache.delete(key);
  }
  const el = query(r);
  if (el) {
    cache.set(key, el);
    watch(el);
  }
  return el;
}

/** The element a note was just made on, so the first lookups need no query. */
export function remember(r: Ref, el: Element) {
  cache.set(keyOf(r), el);
  watch(el);
}

/** The element's box now in client coordinates, or null when it is gone or not laid out. */
function liveBox(r: Ref): Rect | null {
  const el = resolve(r);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  if (!b.width && !b.height) return null;
  lastBox.set(keyOf(r), { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height });
  return { x: b.left, y: b.top, w: b.width, h: b.height };
}

/** Where shapes kept in document coordinates go now, following their frame element. */
export function placeFrame(f: FeedbackFrame): Placement {
  let cur = liveBox(f);
  const detached = !cur;
  if (!cur) {
    const l = lastBox.get(keyOf(f)) ?? f.box;
    cur = { x: l.x - scrollX, y: l.y - scrollY, w: l.w, h: l.h };
  }
  const sx = f.fit && f.box.w > 0 && cur.w > 0 ? cur.w / f.box.w : 1;
  const sy = f.fit && f.box.h > 0 && cur.h > 0 ? cur.h / f.box.h : 1;
  return { sx, sy, dx: cur.x - f.box.x * sx, dy: cur.y - f.box.y * sy, detached };
}

/** Shapes without a frame (notes from 0.1.4 and older) stay in document coordinates. */
export const docPlacement = (): Placement => ({ sx: 1, sy: 1, dx: -scrollX, dy: -scrollY, detached: false });

/** Viewport point of an item's pin now and where its shapes go; null pin when it has none. */
export function place(it: Pick<ReviewItem, 'kind' | 'shapes' | 'target' | 'anchor'>): Placed {
  const frame = it.anchor?.frame;
  const shapes = frame ? placeFrame(frame) : it.shapes.length || it.kind === 'text' ? docPlacement() : null;
  // a drawing's pin sits where it starts (arrow tail, rectangle corner), so it never covers what
  // the drawing points at; it moves with the drawing
  const s = it.shapes[0];
  if (it.kind === 'draw' && s && shapes) {
    const [a, b] = [s.points[0]!, s.points[1] ?? s.points[0]!];
    const x = s.type === 'rect' ? Math.min(a[0], b[0]) : a[0];
    const y = s.type === 'rect' ? Math.min(a[1], b[1]) : a[1];
    return { pin: { x: x * shapes.sx + shapes.dx, y: y * shapes.sy + shapes.dy }, shapes, detached: shapes.detached };
  }
  if (it.target && it.anchor) {
    const r = liveBox(it.target);
    if (r) return { pin: { x: r.x + it.anchor.fx * r.w, y: r.y + it.anchor.fy * r.h }, shapes, detached: false };
    // the element is gone: its last place, else the document point it was made at
    const l = lastBox.get(keyOf(it.target));
    const pin = l ? { x: l.x - scrollX + it.anchor.fx * l.w, y: l.y - scrollY + it.anchor.fy * l.h } : it.anchor.fixed ? { x: it.anchor.x, y: it.anchor.y } : { x: it.anchor.x - scrollX, y: it.anchor.y - scrollY };
    return { pin, shapes, detached: true };
  }
  if (it.anchor) return { pin: it.anchor.fixed ? { x: it.anchor.x, y: it.anchor.y } : { x: it.anchor.x - scrollX, y: it.anchor.y - scrollY }, shapes, detached: false };
  return { pin: null, shapes, detached: false };
}

/** Bring a note's element into view in whatever container scrolls it (the notes list). */
export function reveal(it: Pick<ReviewItem, 'target' | 'anchor'>): boolean {
  const ref = it.anchor?.frame ?? it.target;
  const el = ref ? resolve(ref) : null;
  if (!el) return false;
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  return true;
}
