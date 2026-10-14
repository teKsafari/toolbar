// Burn annotations into the screenshot (J-051): one PNG, no editable layer left.
import { draw, TEXT_FONT, textBaseline, type Prim } from './render.ts';
import type { Box, Measure, Shape } from './shapes.ts';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface FlattenOptions {
  /** where the annotated image sits inside `image`, in `image` pixels (area shot on the full viewport) */
  place?: Box;
  measure: Measure;
}

function drawPrim(ctx: Ctx, p: Prim, source: CanvasImageSource, srcW: number, srcH: number, base: DOMMatrix, scale: number) {
  if (p.t === 'path') {
    const path = new Path2D(p.d);
    ctx.save();
    if (p.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
    }
    if (p.fill) {
      ctx.fillStyle = p.fill;
      ctx.fill(path);
    }
    if (p.stroke) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.sw ?? 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
    }
    ctx.restore();
  } else if (p.t === 'text') {
    ctx.save();
    ctx.fillStyle = p.fill;
    ctx.font = `700 ${p.size}px ${TEXT_FONT}`;
    ctx.textBaseline = 'alphabetic';
    p.lines.forEach((line, i) => ctx.fillText(line, p.x, textBaseline(p, i)));
    ctx.restore();
  } else {
    // blur: clip to the (possibly rotated) box, then draw the blurred source in image space
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.setTransform(base);
    ctx.filter = `blur(${p.r * scale}px)`;
    ctx.drawImage(source, 0, 0, srcW, srcH);
    ctx.restore();
  }
}

/**
 * Draw `shapes` (in annotated-image coordinates) over `image` and return the canvas.
 * With `place`, the shapes are scaled into that box of `image` (the full viewport of an area shot).
 */
export function flattenToCanvas(
  image: CanvasImageSource & { width: number; height: number },
  shapes: Shape[],
  annotatedSize: { w: number; h: number },
  opts: FlattenOptions,
): HTMLCanvasElement | OffscreenCanvas {
  const W = image.width;
  const H = image.height;
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as Ctx;
  ctx.drawImage(image, 0, 0, W, H);
  const place = opts.place ?? { x: 0, y: 0, w: W, h: H };
  const sx = place.w / annotatedSize.w;
  const sy = place.h / annotatedSize.h;
  // the source for blur is the image under the annotation frame, mapped back into shape space
  const base = new DOMMatrix([sx, 0, 0, sy, place.x, place.y]);
  const imageBase = new DOMMatrix();
  for (const s of shapes) {
    const d = draw(s, opts.measure);
    ctx.save();
    ctx.setTransform(base);
    if (d.rot) {
      ctx.translate(d.cx, d.cy);
      ctx.rotate(d.rot);
      ctx.translate(-d.cx, -d.cy);
    }
    for (const p of d.prims) drawPrim(ctx, p, image, W, H, imageBase, Math.sqrt(sx * sy));
    ctx.restore();
  }
  return canvas;
}

export async function canvasToPng(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

/** Flatten and encode in one step. */
export async function flattenPng(
  src: string,
  shapes: Shape[],
  annotatedSize: { w: number; h: number },
  opts: FlattenOptions,
): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await loadImage(src);
  const canvas = flattenToCanvas(img, shapes, annotatedSize, opts);
  return { blob: await canvasToPng(canvas), width: canvas.width, height: canvas.height };
}
