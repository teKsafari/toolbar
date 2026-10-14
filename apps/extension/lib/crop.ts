// Screenshot crop (docs/spikes.md section 5). captureVisibleTab returns the viewport at
// device pixels times page zoom. Take the scale from bitmap.width / innerWidth (covers DPR and
// zoom), floor the start and ceil the end, clamp to the bitmap. Output at 1x CSS pixels on
// request (Part 2 folders, J-002 check).
import type { Rect } from '@toolbar/shared';

export interface PixelRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Crop rectangle in bitmap pixels for a CSS-pixel viewport rect. */
export function cropRect(rect: Rect, bitmap: { width: number; height: number }, innerWidth: number): PixelRect & { scale: number } {
  const scale = bitmap.width / innerWidth;
  const sx = Math.max(0, Math.floor(rect.x * scale));
  const sy = Math.max(0, Math.floor(rect.y * scale));
  const ex = Math.min(bitmap.width, Math.ceil((rect.x + rect.w) * scale));
  const ey = Math.min(bitmap.height, Math.ceil((rect.y + rect.h) * scale));
  return { sx, sy, sw: Math.max(1, ex - sx), sh: Math.max(1, ey - sy), scale };
}

/** Output size of a crop: device pixels, or CSS pixels when `cssPixels` is set. */
export function outputSize(p: PixelRect & { scale: number }, cssPixels: boolean): { w: number; h: number } {
  if (!cssPixels || p.scale === 1) return { w: p.sw, h: p.sh };
  return { w: Math.max(1, Math.round(p.sw / p.scale)), h: Math.max(1, Math.round(p.sh / p.scale)) };
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}

/** Crops (or just rescales, with rect null) a PNG. Works in service workers (OffscreenCanvas). */
export async function cropImage(png: Blob, rect: Rect | null, innerWidth: number, opts: { cssPixels?: boolean } = {}): Promise<{ blob: Blob; width: number; height: number; scale: number }> {
  const bmp = await createImageBitmap(png);
  try {
    const full: Rect = { x: 0, y: 0, w: innerWidth, h: bmp.height / (bmp.width / innerWidth) };
    const p = cropRect(rect ?? full, bmp, innerWidth);
    const { w, h } = outputSize(p, opts.cssPixels ?? false);
    if (!rect && w === bmp.width && h === bmp.height) return { blob: png, width: w, height: h, scale: p.scale };
    const canvas = new OffscreenCanvas(w, h);
    const g = canvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, p.sx, p.sy, p.sw, p.sh, 0, 0, w, h);
    return { blob: await canvas.convertToBlob({ type: 'image/png' }), width: w, height: h, scale: p.scale };
  } finally {
    bmp.close();
  }
}

/**
 * Chrome allows two captureVisibleTab calls per second; calls go through this queue so
 * back-to-back screenshots wait instead of failing.
 */
export class CaptureQueue {
  private last = 0;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private minGapMs = 520) {}
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.last = Date.now();
      }
    });
    this.chain = next.catch(() => {});
    return next;
  }
}
