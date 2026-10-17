// Page helpers for the reviewer toolbar: what is under the pointer, how to name it, where a pin
// sits after scrolling or a layout change, and the page facts each item carries.
import { describeNode } from '@toolbar/capture';
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import type { Rect, TargetRef } from '@toolbar/shared';
import type { FeedbackAnchor, FeedbackFrame, FeedbackPage, FeedbackShape } from '@toolbar/shared/areas/reviewer';
import type { ReviewItem } from '@toolbar/shared/ext';
import { place, remember } from './track';

/** The page element under a viewport point, never our own host, html or body. */
export function elementAt(x: number, y: number): Element | null {
  const el = document.elementFromPoint(x, y);
  if (!el || el.localName === UI_HOST_TAG || el === document.documentElement || el === document.body) return null;
  return el;
}

/** The locator packet of an element (selector, role, name, test id, text, landmarks, heading). */
export function targetOf(el: Element): TargetRef | null {
  return describeNode(el);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The short name an agent gets for the element: role and accessible name, else the selector. */
export function labelOf(t: TargetRef | null | undefined): string {
  if (!t) return 'Page';
  const what = t.role ?? t.tag;
  if (t.name) return `${what} "${clip(t.name, 40)}"`;
  if (t.testId) return `${what} [${t.testId}]`;
  if (t.text && t.text.length <= 40) return `${what} "${t.text}"`;
  return clip(t.selector, 60);
}

export function shortSelector(t: TargetRef | null | undefined): string {
  if (!t) return '';
  const parts = t.selector.split('>').map((p) => p.trim());
  return clip(parts.slice(-2).join(' > '), 70);
}

function isFixed(el: Element): boolean {
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    const p = getComputedStyle(e).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

/** Where a click on `el` sits: a fraction of its box, plus the document point as a fallback. */
export function anchorOf(el: Element | null, clientX: number, clientY: number): FeedbackAnchor {
  const fixed = el ? isFixed(el) : false;
  const r = el?.getBoundingClientRect();
  const fx = r && r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0.5;
  const fy = r && r.height ? Math.min(1, Math.max(0, (clientY - r.top) / r.height)) : 0.5;
  return { fx, fy, x: fixed ? clientX : clientX + scrollX, y: fixed ? clientY : clientY + scrollY, ...(fixed ? { fixed } : {}) };
}

/** The element and its ancestors up to (not including) body, crossing shadow roots. */
function chain(el: Element | null): Element[] {
  const out: Element[] = [];
  for (let e = el; e && e !== document.body && e !== document.documentElement; ) {
    if (e.localName !== UI_HOST_TAG) out.push(e);
    const root = e.parentElement ? null : e.getRootNode();
    e = e.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return out;
}

function overlap(a: Rect, b: DOMRect): number {
  const w = Math.min(a.x + a.w, b.right) - Math.max(a.x, b.left);
  const h = Math.min(a.y + a.h, b.bottom) - Math.max(a.y, b.top);
  if (w <= 0 || h <= 0) return 0;
  const i = w * h;
  return i / (a.w * a.h + b.width * b.height - i);
}

/**
 * The element a drawing is attached to (D-204), from its box in viewport coordinates. A rectangle
 * or a ring drawn around an element (their boxes overlap by 60 % or more) fits that element and
 * stretches with it; otherwise the drawing follows the element under its start point (an arrow's
 * tail), or the smallest element that holds its box when it starts on the page background.
 */
export function frameAt(type: FeedbackShape['type'], start: { x: number; y: number }, box: Rect): FeedbackFrame | null {
  const first = elementAt(start.x, start.y);
  const centre = elementAt(box.x + box.w / 2, box.y + box.h / 2);
  let el: Element | null = null;
  let fit = false;
  if (type !== 'arrow' && box.w > 0 && box.h > 0) {
    let best = 0.6;
    for (const e of new Set([...chain(centre), ...chain(first)])) {
      const o = overlap(box, e.getBoundingClientRect());
      if (o >= best) {
        best = o;
        el = e;
        fit = true;
      }
    }
  }
  if (!el && first) el = first;
  if (!el) {
    const holds = chain(centre).find((e) => {
      const r = e.getBoundingClientRect();
      return r.left <= box.x + 2 && r.top <= box.y + 2 && r.right >= box.x + box.w - 2 && r.bottom >= box.y + box.h - 2;
    });
    el = holds ?? centre;
  }
  return el ? frameOf(el, fit) : null;
}

/** The frame of an element as it is now: how to find it again and its box in document coordinates. */
export function frameOf(el: Element, fit = false): FeedbackFrame | null {
  const t = targetOf(el);
  if (!t) return null;
  const r = el.getBoundingClientRect();
  remember(t, el);
  return {
    selector: t.selector,
    ...(t.testId ? { testId: t.testId } : {}),
    ...(t.elId ? { elId: t.elId } : {}),
    box: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height },
    ...(fit ? { fit } : {}),
  };
}

/** Viewport point of an item's pin now, or null when it is off this page or has none. */
export function pinPoint(it: ReviewItem): { x: number; y: number } | null {
  if (!samePage(it.page.url)) return null;
  return place(it).pin;
}

/** Same document, ignoring the hash. */
export function samePage(url: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(location.href);
    return a.origin === b.origin && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

export function pageInfo(): FeedbackPage {
  return {
    url: location.href,
    title: document.title,
    viewport: { w: innerWidth, h: innerHeight },
    scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
    dpr: devicePixelRatio,
  };
}

/** Viewport rect of an element, clipped to the viewport. */
export function visibleRect(r: { left: number; top: number; width: number; height: number }, pad = 0): Rect | null {
  const x = Math.max(0, r.left - pad);
  const y = Math.max(0, r.top - pad);
  const x2 = Math.min(innerWidth, r.left + r.width + pad);
  const y2 = Math.min(innerHeight, r.top + r.height + pad);
  if (x2 - x < 2 || y2 - y < 2) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Bounding box of shapes in document coordinates. */
export function shapesBox(shapes: FeedbackShape[]): Rect | null {
  const pts = shapes.flatMap((s) => s.points);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Bounding box of text highlight boxes, in document coordinates. */
export function marksBox(marks: Rect[]): Rect | null {
  if (!marks.length) return null;
  const x = Math.min(...marks.map((m) => m.x));
  const y = Math.min(...marks.map((m) => m.y));
  return { x, y, w: Math.max(...marks.map((m) => m.x + m.w)) - x, h: Math.max(...marks.map((m) => m.y + m.h)) - y };
}

let ownRoot: ShadowRoot | null = null;
/** Our shadow root. In release builds it is closed, so a window listener's composedPath() stops at the host. */
export function setOwnRoot(r: ShadowRoot | null) {
  ownRoot = r;
}

/** True when a key event comes from a field the person types in (page or ours). */
/**
 * True when a pointer event lands in `el`, one of our elements. A listener on window sees only
 * the host of a closed shadow root in the event's path, so the root says what is under the point.
 */
export function pointerIn(e: PointerEvent, el: Element): boolean {
  const path = e.composedPath?.() ?? [];
  if (path.includes(el)) return true;
  if (ownRoot && path[0] === ownRoot.host) return el.contains(ownRoot.elementFromPoint(e.clientX, e.clientY));
  return false;
}

export function typingIn(e: Event): boolean {
  let el = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null;
  // inside a closed shadow root the path ends at the host: ask the root what has focus
  if (el && ownRoot && el === ownRoot.host) el = (ownRoot.activeElement as HTMLElement | null) ?? el;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file'].includes((el as HTMLInputElement).type);
  return !!el.isContentEditable;
}

/** The current text selection, when it is page text (not ours, not a field). */
export function pageSelection(): { text: string; range: Range; rects: Rect[]; box: DOMRect } | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const text = sel.toString().trim();
  if (!text) return null;
  const node = range.commonAncestorContainer;
  const el = (node.nodeType === 1 ? node : node.parentElement) as Element | null;
  if (!el || el.closest(UI_HOST_TAG) || el.closest('input,textarea,[contenteditable=""],[contenteditable="true"]')) return null;
  const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1).map((r) => ({ x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }));
  return { text: text.slice(0, 5000), range, rects, box: range.getBoundingClientRect() };
}

/** The element a selection lives in, for its locator. */
export function selectionElement(range: Range): Element | null {
  const n = range.commonAncestorContainer;
  return (n.nodeType === 1 ? n : n.parentElement) as Element | null;
}

/** Two animation frames: our UI changes reach the screen before a screenshot. */
export const painted = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
