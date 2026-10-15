// Isolated-world half of the locator (D-128): resolves what the reviewer pointed at (a point,
// a selector, the text selection or an area), describes it with the TargetRef fields, asks the
// MAIN world for Svelte's dev location, and lists the page's SvelteKit entry modules so the
// service worker can read the route table. Route-table reads, source maps and the crop happen in
// the service worker, whose fetches never enter a capture.
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import type { MaskingPreset, Rect } from '@toolbar/shared/events';
import { candidateRouteFiles, KIT_ENTRY_PATTERN, LOCATOR_VERSION, type LocatorKind, type LocatorPacket } from '@toolbar/shared/locator';
import { scrubText } from '@toolbar/shared/redact';
import { LOCATE_EVENT, type LocateReply } from './locator-main.ts';
import { describeNode } from './target.ts';

export interface LocateRequest {
  kind?: LocatorKind;
  /** viewport CSS px: the element under this point */
  at?: { x: number; y: number };
  /** the first element matching this selector */
  selector?: string;
  /** viewport CSS px: an area; the element under its centre describes it */
  rect?: Rect;
  /** use the current text selection */
  selection?: boolean;
}

export interface PageLocator {
  packet: LocatorPacket;
  /** what to crop, in viewport CSS px, clamped to the viewport; null when nothing is visible */
  cropRect: Rect | null;
  /** URLs of SvelteKit entry modules on this page (prod `entry/app.*.js`, dev `generated/client/app.js`) */
  kitEntries: string[];
}

export type LocateMain = (el: Element) => Promise<Omit<LocateReply, 'reply' | 'id'> | null>;

/** The topmost page element at a point, looking through our own toolbar host. */
export function elementAt(doc: Document, x: number, y: number): Element | null {
  const all = typeof doc.elementsFromPoint === 'function' ? doc.elementsFromPoint(x, y) : [doc.elementFromPoint(x, y)].filter((e): e is Element => !!e);
  return all.find((e) => e.tagName.toLowerCase() !== UI_HOST_TAG && !e.closest(UI_HOST_TAG)) ?? null;
}

/** Entry module URLs of a SvelteKit app, from modulepreload links, script tags and inline imports. */
export function findKitEntries(doc: Document): string[] {
  const out = new Set<string>();
  const add = (u: string | null | undefined) => {
    if (!u) return;
    try {
      const abs = new URL(u, doc.baseURI).href;
      if (KIT_ENTRY_PATTERN.test(abs)) out.add(abs);
    } catch {
      /* ignore */
    }
  };
  doc.querySelectorAll('link[rel="modulepreload"][href], script[src]').forEach((n) => add(n.getAttribute('href') ?? n.getAttribute('src')));
  doc.querySelectorAll('script:not([src])').forEach((s) => {
    const text = s.textContent ?? '';
    if (text.length > 100_000) return;
    for (const m of text.matchAll(/import\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) add(m[1]);
  });
  return [...out].slice(0, 4);
}

/** Whole CSS pixels that cover the rect, inside the visible viewport; null when nothing shows. */
function clampToViewport(r: { left: number; top: number; width: number; height: number }, vw: number, vh: number): Rect | null {
  const x = Math.floor(Math.max(0, r.left));
  const y = Math.floor(Math.max(0, r.top));
  const right = Math.ceil(Math.min(vw, r.left + r.width));
  const bottom = Math.ceil(Math.min(vh, r.top + r.height));
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, w: right - x, h: bottom - y };
}

function cleanText(s: string, max: number): string | undefined {
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? scrubText(t.length > max ? t.slice(0, max) : t) : undefined;
}

export interface LocateOptions {
  preset?: MaskingPreset;
  win?: Window & typeof globalThis;
  locateMain?: LocateMain;
  now?: () => number;
}

/** Builds the page's part of a locator packet. Never throws for a missing target: kind becomes `page`. */
export async function locateInPage(req: LocateRequest, opts: LocateOptions = {}): Promise<PageLocator> {
  const win = opts.win ?? (window as Window & typeof globalThis);
  const doc = win.document;
  const preset = opts.preset ?? 'staging';
  const vw = doc.documentElement.clientWidth || win.innerWidth;
  const vh = doc.documentElement.clientHeight || win.innerHeight;

  let kind: LocatorKind = req.kind ?? 'page';
  let el: Element | null = null;
  let cropRect: Rect | null = null;
  let pageRect: Rect | undefined;
  let selection: string | undefined;

  if (req.selection) {
    const sel = win.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const anc = range.commonAncestorContainer;
      el = anc.nodeType === 1 ? (anc as Element) : anc.parentElement;
      const r = range.getBoundingClientRect();
      cropRect = clampToViewport(r, vw, vh);
      pageRect = { x: Math.round(r.left + win.scrollX), y: Math.round(r.top + win.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
      selection = cleanText(sel.toString(), 2000);
      kind = req.kind ?? 'text';
    }
  } else if (req.rect) {
    const r = req.rect;
    el = elementAt(doc, r.x + r.w / 2, r.y + r.h / 2);
    cropRect = clampToViewport({ left: r.x, top: r.y, width: r.w, height: r.h }, vw, vh);
    pageRect = { x: Math.round(r.x + win.scrollX), y: Math.round(r.y + win.scrollY), w: Math.round(r.w), h: Math.round(r.h) };
    kind = req.kind ?? 'area';
  } else if (req.selector) {
    try {
      el = doc.querySelector(req.selector);
    } catch {
      el = null;
    }
    if (el) kind = req.kind ?? 'element';
  } else if (req.at) {
    el = elementAt(doc, req.at.x, req.at.y);
    if (el) kind = req.kind ?? 'element';
  }
  if (el && (el === doc.documentElement || el === doc.body) && kind === 'element') kind = 'page';

  const target = el && kind !== 'page' ? describeNode(el, { preset }) : null;
  if (el && kind === 'element') {
    cropRect = clampToViewport(el.getBoundingClientRect(), vw, vh);
  }

  const loc = new URL(win.location.href);
  const masked = preset === 'production';
  const packet: LocatorPacket = {
    v: LOCATOR_VERSION,
    kind,
    at: opts.now?.() ?? Date.now(),
    url: win.location.href,
    route: loc.pathname,
    routeFiles: [],
    // innerWidth includes the scrollbar, as the tab screenshot does: crops scale against it
    viewport: { w: win.innerWidth || vw, h: win.innerHeight || vh, scrollX: Math.round(win.scrollX), scrollY: Math.round(win.scrollY), dpr: win.devicePixelRatio || 1 },
    masking: preset,
  };
  if (doc.title && !masked) packet.title = cleanText(doc.title, 300);
  if (target) {
    const { rect, frame: _frame, xpath: _x, rrwebId: _r, ...rest } = target;
    Object.assign(packet, rest);
    packet.rect = pageRect ?? rect;
    if (masked) {
      delete packet.text;
      delete packet.name;
      delete packet.heading;
    }
  } else if (pageRect) packet.rect = pageRect;
  if (selection && !masked) packet.selection = selection;

  // Svelte dev location and SvelteKit presence, from the MAIN world
  const main = el && opts.locateMain ? await opts.locateMain(el).catch(() => null) : null;
  const kitEntries = findKitEntries(doc);
  const dev = !!doc.querySelector('script[src*="/@vite/client"]') || kitEntries.some((u) => /\/generated\/(?:dev\/)?client\//.test(u));
  const svelte = main?.svelte ?? null;
  if (main?.kit || kitEntries.length) packet.framework = { name: 'sveltekit', dev, ...(main?.kit?.base ? { base: main.kit.base } : {}) };
  else if (svelte) packet.framework = { name: 'svelte', dev: true };
  const base = main?.kit?.base;
  if (base) packet.route = loc.pathname === base ? '/' : loc.pathname.startsWith(base + '/') ? loc.pathname.slice(base.length) : loc.pathname;
  if (svelte) {
    packet.source = { file: svelte.file, line: svelte.line, column: svelte.column, via: 'svelte-meta', depth: svelte.depth };
    if (svelte.chain.length) packet.components = svelte.chain.slice(0, 30);
  }
  // route files the page alone can tell (dev meta, or guesses); the worker adds the route table
  const svelteFiles = svelte ? [svelte.file, ...svelte.chain.map((c) => c.file).filter((f): f is string => !!f)] : [];
  const cand = candidateRouteFiles({ pathname: packet.route, svelteFiles });
  packet.routeFiles = cand.files;
  if (packet.framework && cand.routeId && svelteFiles.length) packet.framework.routeId = cand.routeId;

  return { packet, cropRect: kind === 'page' ? null : cropRect, kitEntries };
}

/** The isolated world's LocateMain: dispatches LOCATE_EVENT on the element and waits for the reply. */
export function createLocateMain(
  command: { send(el: Element, id: number): boolean },
  waiting: Map<number, (r: LocateReply) => void>,
  nextId: () => number,
  timeoutMs = 300,
): LocateMain {
  return (el) =>
    new Promise((resolve) => {
      const id = nextId();
      const t = setTimeout(() => {
        waiting.delete(id);
        resolve(null);
      }, timeoutMs);
      waiting.set(id, (r) => {
        clearTimeout(t);
        resolve({ svelte: r.svelte ?? null, kit: r.kit ?? null });
      });
      if (!command.send(el, id)) {
        clearTimeout(t);
        waiting.delete(id);
        resolve(null);
      }
    });
}

/** Sends the locate request to the MAIN world as a DOM event on the element. */
export function dispatchLocate(el: Element, id: number): boolean {
  try {
    return el.dispatchEvent(new CustomEvent(LOCATE_EVENT, { detail: String(id), bubbles: false, cancelable: false })) || true;
  } catch {
    return false;
  }
}
