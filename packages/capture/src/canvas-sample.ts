// Canvas pixels around reviewer actions (Part 2 traces, `canvas.sample`). A canvas redraw is no
// DOM change, so a span would call it dead; the span engine compares these samples instead. At
// pointerdown or an action key (capture phase, before the page's handlers run) the visible
// canvases are drawn small into a scratch canvas and hashed ("before"); the same canvases are
// sampled again a few times while the span can still be open ("after", with the share of
// pixels that differ). Runs only while a recording or trace is attached.
import type { CanvasSample, Rect } from '@toolbar/shared';
import { UI_HOST_TAG } from '@toolbar/shared/constants';

export interface CanvasWatchOptions {
  /** After-sample delays from the action (ms); the last one should fall inside the 2.5 s no-effect window. */
  afterMs?: number[];
  /** At most this many canvases per action (largest visible first). */
  maxCanvases?: number;
  /** Longest side of the scaled sample (px). */
  maxSide?: number;
}

interface Sampled {
  hash: string | null;
  blank: boolean;
  data: Uint8ClampedArray | null;
}

/** FNV-1a over the bytes, as 8 hex digits. */
export function fnv1a(data: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Share of pixels whose RGBA differs by more than a little between two samples of one size. */
export function pixelDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  if (a.length !== b.length || !a.length) return 1;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) + Math.abs(a[i + 3]! - b[i + 3]!);
    if (d > 24) changed++;
  }
  return changed / (a.length / 4);
}

function selectorOf(el: Element): string {
  if (el.id) return `canvas#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let n: Element | null = el;
  while (n && n.nodeType === 1 && parts.length < 6) {
    const tag = n.tagName.toLowerCase();
    const parent: Element | null = n.parentElement;
    const same = parent ? Array.from(parent.children).filter((c) => c.tagName === n!.tagName) : [];
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(n) + 1})` : tag);
    if (tag === 'body') break;
    n = parent;
  }
  return parts.join(' > ');
}

export function watchCanvases(emit: (s: CanvasSample) => void, win: Window & typeof globalThis = window, opts: CanvasWatchOptions = {}) {
  const afterMs = opts.afterMs ?? [150, 600, 1500, 2300];
  const maxCanvases = opts.maxCanvases ?? 4;
  const maxSide = opts.maxSide ?? 480;
  const doc = win.document;
  let running = false;
  let scratch: HTMLCanvasElement | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const visibleCanvases = (): { el: HTMLCanvasElement; rect: Rect }[] => {
    const out: { el: HTMLCanvasElement; rect: Rect; area: number }[] = [];
    for (const el of Array.from(doc.querySelectorAll('canvas'))) {
      if (el.closest(UI_HOST_TAG) || !el.width || !el.height) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.right < 0 || r.top > win.innerHeight || r.left > win.innerWidth) continue;
      out.push({ el, rect: { x: Math.round(r.x + win.scrollX), y: Math.round(r.y + win.scrollY), w: Math.round(r.width), h: Math.round(r.height) }, area: r.width * r.height });
    }
    return out.sort((a, b) => b.area - a.area).slice(0, maxCanvases);
  };

  const sample = (el: HTMLCanvasElement): Sampled => {
    try {
      const scale = Math.min(1, maxSide / Math.max(el.width, el.height));
      const w = Math.max(1, Math.round(el.width * scale));
      const h = Math.max(1, Math.round(el.height * scale));
      scratch ??= doc.createElement('canvas');
      scratch.width = w;
      scratch.height = h;
      const ctx = scratch.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { hash: null, blank: false, data: null };
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(el, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let blank = true;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) {
          blank = false;
          break;
        }
      }
      return { hash: fnv1a(data), blank, data };
    } catch {
      // a canvas tainted by cross-origin images cannot be read
      return { hash: null, blank: false, data: null };
    }
  };

  const onAction = (e: Event) => {
    if (!running || !e.isTrusted) return;
    if (e.composedPath().some((n) => (n as Element).tagName?.toLowerCase?.() === UI_HOST_TAG)) return;
    if (e.type === 'keydown') {
      const k = e as KeyboardEvent;
      const chord = k.ctrlKey || k.metaKey;
      if (k.repeat || !(k.key === 'Enter' || k.key === 'Escape' || k.key === ' ' || chord)) return;
    }
    const list = visibleCanvases();
    if (!list.length) return;
    const at = win.performance.timeOrigin + win.performance.now();
    const before = new Map<HTMLCanvasElement, { key: string; s: Sampled }>();
    for (const { el, rect } of list) {
      const s = sample(el);
      const key = selectorOf(el);
      before.set(el, { key, s });
      emit({ phase: 'before', key, rect, hash: s.hash, ...(s.blank ? { blank: true } : {}), at });
    }
    for (const ms of afterMs) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!running) return;
        for (const [el, b] of before) {
          if (!el.isConnected) continue;
          const s = sample(el);
          const r = el.getBoundingClientRect();
          const rect = { x: Math.round(r.x + win.scrollX), y: Math.round(r.y + win.scrollY), w: Math.round(r.width), h: Math.round(r.height) };
          const diff = b.s.data && s.data ? pixelDiff(b.s.data, s.data) : undefined;
          emit({ phase: 'after', key: b.key, rect, hash: s.hash, ...(s.blank ? { blank: true } : {}), ...(diff !== undefined ? { diff: Math.round(diff * 1e5) / 1e5 } : {}), at });
        }
      }, ms);
      timers.add(timer);
    }
  };

  const listeners: [string, EventListener][] = [
    ['pointerdown', onAction],
    ['keydown', onAction],
  ];
  return {
    start() {
      if (running) return;
      running = true;
      for (const [type, fn] of listeners) doc.addEventListener(type, fn, true);
    },
    stop() {
      if (!running) return;
      running = false;
      for (const [type, fn] of listeners) doc.removeEventListener(type, fn, true);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      scratch = null;
    },
    get running() {
      return running;
    },
  };
}
