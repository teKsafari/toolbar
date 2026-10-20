// Element crops in the page (D-212). A page cannot read its own pixels without a prompt, so the
// embed rasterises the DOM instead (modern-screenshot, MIT, bundled): it renders the smallest
// element that holds the rect and cuts the rect out at 1x CSS pixels. It misses what a DOM
// rasteriser cannot draw (cross-origin images without CORS, tainted canvases, iframes, video) and
// our own layer, so drawings are not in the crop; the note keeps them as shapes. Any failure gives
// no crop, never a failed note. Images and fonts are read with the fetch saved before the capture
// hooks, so they stay out of the reviewer's network log.
import { domToCanvas } from 'modern-screenshot';
import type { Rect } from '@toolbar/shared';
import { UI_HOST_TAG } from '@toolbar/shared/constants';

/** Largest element the rasteriser renders, in CSS pixels (a canvas holds about 268 M pixels). */
const MAX_AREA = 4096 * 8192;
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export interface Shot {
  blob: Blob;
  width: number;
  height: number;
}

const ours = (n: Node) => n instanceof Element && n.localName === UI_HOST_TAG;

/** The smallest element of the page whose box holds `rect` (viewport CSS px). */
export function elementForRect(rect: Rect, doc: Document = document): Element {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let el: Element | null = (doc.elementsFromPoint?.(cx, cy) ?? []).find((e) => !ours(e) && !e.closest(UI_HOST_TAG)) ?? null;
  while (el && el !== doc.documentElement) {
    const b = el.getBoundingClientRect();
    if (b.left <= rect.x + 1 && b.top <= rect.y + 1 && b.right >= rect.x + rect.w - 1 && b.bottom >= rect.y + rect.h - 1) return el;
    el = el.parentElement;
  }
  return doc.body ?? doc.documentElement;
}

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function createShooter(nativeFetch: typeof fetch) {
  const fetchFn = async (url: string): Promise<string | false> => {
    if (url.startsWith('data:')) return false;
    try {
      const res = await nativeFetch(url, { cache: 'force-cache', credentials: 'same-origin' });
      if (!res.ok) return BLANK;
      return await toDataUrl(await res.blob());
    } catch {
      return BLANK;
    }
  };

  return async function shoot(rect: Rect): Promise<Shot | null> {
    try {
      const w = Math.round(rect.w);
      const h = Math.round(rect.h);
      if (w < 1 || h < 1) return null;
      const el = elementForRect(rect);
      const box = el.getBoundingClientRect();
      if (box.width * box.height > MAX_AREA) return null;
      const bg = getComputedStyle(document.body ?? document.documentElement).backgroundColor;
      const canvas = await domToCanvas(el, {
        scale: 1,
        filter: (n) => !ours(n),
        fetchFn,
        timeout: 5000,
        backgroundColor: bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff',
      });
      const k = box.width ? canvas.width / box.width : 1;
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(canvas, (rect.x - box.left) * k, (rect.y - box.top) * k, rect.w * k, rect.h * k, 0, 0, w, h);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
      return blob ? { blob, width: w, height: h } : null;
    } catch {
      return null;
    }
  };
}

export { toDataUrl };
