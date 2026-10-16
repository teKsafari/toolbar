// The card image a DOM replay or a trace sends with it (D-184): a captureVisibleTab still of the
// page, scaled to the dashboard's thumbnail width, and masked like the recording under the
// production preset. rrweb masks every text node, input and media element there (D-125), so the
// still paints a bar over each text line and a plain box over each input and media element, with
// rects read from the page. When the page cannot be read (scripting refused), the whole still is
// pixelated instead, coarse enough that no text survives. Staging and no-project stills are only
// scaled: their recordings carry the text anyway.
import type { MaskingPreset } from '@toolbar/shared';

/** Width of every card image, as the server's thumbnails (ffmpeg `min(640, iw)`). */
export const CARD_W = 640;

/** CSS-pixel rects of what production masking hides: text lines, form fields, media. */
export interface MaskRects {
  viewport: { w: number; h: number };
  /** [x, y, w, h] of each line box of a text node */
  text: [number, number, number, number][];
  /** inputs, textareas, selects, contenteditable */
  fields: [number, number, number, number][];
  /** img, picture, video, audio, canvas, object, embed, iframe, svg */
  media: [number, number, number, number][];
}

/**
 * Runs in the page (chrome.scripting.executeScript, isolated world): the rects production masking
 * covers, in the viewport only, capped so a huge page answers fast. Self-contained on purpose.
 */
export function pageMaskRects(cap = 4000): MaskRects {
  const W = innerWidth;
  const H = innerHeight;
  const out: MaskRects = { viewport: { w: W, h: H }, text: [], fields: [], media: [] };
  const visible = (r: DOMRect) => r.width >= 1 && r.height >= 1 && r.bottom > 0 && r.right > 0 && r.top < H && r.left < W;
  const box = (r: DOMRect): [number, number, number, number] => [r.left, r.top, r.width, r.height];
  const ours = (el: Element | null) => !!el?.closest('toolbar-root');
  const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n && out.text.length < cap; n = walker.nextNode()) {
    if (!n.textContent?.trim() || ours(n.parentElement)) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (visible(r)) out.text.push(box(r));
  }
  for (const el of document.querySelectorAll('input:not([type=hidden]), textarea, select, [contenteditable=""], [contenteditable="true"]')) {
    const r = el.getBoundingClientRect();
    if (!ours(el) && visible(r)) out.fields.push(box(r));
  }
  for (const el of document.querySelectorAll('img, picture, video, audio, canvas, object, embed, iframe, svg')) {
    const r = el.getBoundingClientRect();
    if (!ours(el) && visible(r)) out.media.push(box(r));
  }
  return out;
}

/** Card size for a bitmap: CARD_W wide (never upscaled), height in proportion. */
export function cardSize(bw: number, bh: number): { w: number; h: number; scale: number } {
  const w = Math.min(CARD_W, bw);
  const scale = w / bw;
  return { w, h: Math.max(1, Math.round(bh * scale)), scale };
}

export interface MaskFill {
  x: number;
  y: number;
  w: number;
  h: number;
  /** bar: a text line (rounded, inset); box: a field or media element */
  kind: 'bar' | 'box';
}

/** The fills that mask `rects` on a card of width `cardW` (CSS rects scaled to card pixels). */
export function maskFills(rects: MaskRects, cardW: number): MaskFill[] {
  const s = cardW / Math.max(1, rects.viewport.w);
  const px = ([x, y, w, h]: [number, number, number, number], kind: MaskFill['kind']): MaskFill => {
    // a text bar keeps the line's length and sits on its x-height, so the layout still reads
    const inset = kind === 'bar' ? Math.min(h * 0.18, 3) : 0;
    return { x: Math.floor(x * s), y: Math.floor((y + inset) * s), w: Math.max(1, Math.ceil(w * s)), h: Math.max(1, Math.ceil((h - 2 * inset) * s)), kind };
  };
  return [...rects.media.map((r) => px(r, 'box')), ...rects.fields.map((r) => px(r, 'box')), ...rects.text.map((r) => px(r, 'bar'))];
}

/** Block size of the fallback pixelation, in card pixels: text at any size becomes a few blocks. */
export const PIXELATE_BLOCK = 12;

/**
 * The card still as WebP: the screenshot scaled to CARD_W; under the production preset masked by
 * `rects`, or pixelated when the page's rects are not known.
 */
export async function cardStill(png: Blob, preset: MaskingPreset, rects: MaskRects | null): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(png);
  try {
    const { w, h } = cardSize(bmp.width, bmp.height);
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    if (preset === 'production' && !rects) {
      // pixelate: draw tiny, then scale back up without smoothing
      const sw = Math.max(1, Math.round(w / PIXELATE_BLOCK));
      const sh = Math.max(1, Math.round(h / PIXELATE_BLOCK));
      const small = new OffscreenCanvas(sw, sh);
      small.getContext('2d')!.drawImage(bmp, 0, 0, sw, sh);
      g.imageSmoothingEnabled = false;
      g.drawImage(small, 0, 0, w, h);
    } else {
      g.drawImage(bmp, 0, 0, w, h);
      if (preset === 'production' && rects) {
        for (const f of maskFills(rects, w)) {
          g.fillStyle = f.kind === 'bar' ? '#c7cbd1' : '#e5e7eb';
          if (f.kind === 'bar' && f.h > 3) {
            g.beginPath();
            g.roundRect(f.x, f.y, f.w, f.h, Math.min(4, f.h / 2));
            g.fill();
          } else g.fillRect(f.x, f.y, f.w, f.h);
        }
      }
    }
    return { blob: await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 }), width: w, height: h };
  } finally {
    bmp.close();
  }
}
