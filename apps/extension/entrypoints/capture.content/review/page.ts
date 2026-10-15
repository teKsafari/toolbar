// Page helpers for the reviewer toolbar: what is under the pointer, how to name it, where a pin
// sits after scrolling or a layout change, and the page facts each item carries.
import { describeNode } from '@toolbar/capture';
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import type { Rect, TargetRef } from '@toolbar/shared';
import type { FeedbackAnchor, FeedbackPage, FeedbackShape } from '@toolbar/shared/areas/reviewer';
import type { ReviewItem } from '@toolbar/shared/ext';

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

function findTarget(t: TargetRef): Element | null {
  try {
    const el = document.querySelector(t.selector);
    if (el) return el;
  } catch {
    /* not a valid selector here */
  }
  if (t.testId) return document.querySelector(`[data-testid="${CSS.escape(t.testId)}"]`);
  if (t.elId) return document.getElementById(t.elId);
  return null;
}

/** Viewport point of an item's pin now, or null when it is off this page. */
export function pinPoint(it: ReviewItem): { x: number; y: number } | null {
  if (!samePage(it.page.url)) return null;
  // a drawing lives in page coordinates: its pin sits where it starts (arrow tail, rectangle
  // corner), so it never covers what the drawing points at
  const s = it.shapes[0];
  if (it.kind === 'draw' && s) {
    const [a, b] = [s.points[0]!, s.points[1] ?? s.points[0]!];
    const x = s.type === 'rect' ? Math.min(a[0], b[0]) : a[0];
    const y = s.type === 'rect' ? Math.min(a[1], b[1]) : a[1];
    return { x: x - scrollX, y: y - scrollY };
  }
  if (it.target && it.anchor) {
    const el = findTarget(it.target);
    const r = el?.getBoundingClientRect();
    if (r && (r.width || r.height)) return { x: r.left + it.anchor.fx * r.width, y: r.top + it.anchor.fy * r.height };
  }
  if (it.anchor) return it.anchor.fixed ? { x: it.anchor.x, y: it.anchor.y } : { x: it.anchor.x - scrollX, y: it.anchor.y - scrollY };
  return null;
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

let ownRoot: ShadowRoot | null = null;
/** Our shadow root. In release builds it is closed, so a window listener's composedPath() stops at the host. */
export function setOwnRoot(r: ShadowRoot | null) {
  ownRoot = r;
}

/** True when a key event comes from a field the person types in (page or ours). */
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
