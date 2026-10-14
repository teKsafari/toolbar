// Shape -> drawing primitives. The live SVG layer and the flattened PNG (J-051) both draw from
// these, so what you see in the editor is what lands in the capture.
import { getStroke } from 'perfect-freehand';
import {
  approxMeasure,
  bounds,
  centerOf,
  lineControl,
  textBox,
  textPad,
  TEXT_LINE,
  type LineShape,
  type Measure,
  type PenShape,
  type Shape,
} from './shapes.ts';

export type Prim =
  | { t: 'path'; d: string; fill?: string; stroke?: string; sw?: number; shadow?: boolean }
  | { t: 'text'; x: number; y: number; lines: string[]; size: number; lineHeight: number; fill: string }
  | { t: 'blur'; x: number; y: number; w: number; h: number; r: number };

export interface Drawn {
  id: string;
  prims: Prim[];
  /** rotation (radians) around (cx, cy) */
  rot: number;
  cx: number;
  cy: number;
}

export const TEXT_FONT = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', Arial, sans-serif";
export const TEXT_COLOR = '#ffffff';

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** SVG path data for a closed polygon (perfect-freehand outline), smoothed with quadratic midpoints. */
export function outlinePath(pts: number[][]): string {
  if (pts.length < 2) return '';
  const len = pts.length;
  let d = `M${f(pts[0]![0]!)} ${f(pts[0]![1]!)}`;
  for (let i = 0; i < len; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % len]!;
    d += ` Q${f(a[0]!)} ${f(a[1]!)} ${f((a[0]! + b[0]!) / 2)} ${f((a[1]! + b[1]!) / 2)}`;
  }
  return d + ' Z';
}

/** Pen: a smoothed stroke with a slight taper at both ends (J-038). */
export function penPath(s: PenShape, live = false): string {
  if (s.pts.length === 1) {
    const [x, y] = s.pts[0]!;
    const r = s.sw / 2;
    return `M${f(x - r)} ${f(y)} a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0 a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0 Z`;
  }
  const outline = getStroke(
    s.pts.map(([x, y]) => [x, y]),
    {
      size: s.sw,
      thinning: 0.45,
      smoothing: 0.6,
      streamline: 0.45,
      simulatePressure: true,
      start: { taper: s.sw * 2, cap: true },
      end: { taper: s.sw * 2, cap: true },
      last: !live,
    },
  );
  return outlinePath(outline);
}

export function roundRectPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  return (
    `M${f(x + rr)} ${f(y)} H${f(x + w - rr)} A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w)} ${f(y + rr)} ` +
    `V${f(y + h - rr)} A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w - rr)} ${f(y + h)} H${f(x + rr)} ` +
    `A${f(rr)} ${f(rr)} 0 0 1 ${f(x)} ${f(y + h - rr)} V${f(y + rr)} A${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr)} ${f(y)} Z`
  );
}

export function ellipsePath(x: number, y: number, w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  const cy = y + ry;
  return `M${f(x)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(x + w)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(x)} ${f(cy)} Z`;
}

export function linePath(s: LineShape): string {
  if (s.bend === 0) return `M${f(s.x1)} ${f(s.y1)} L${f(s.x2)} ${f(s.y2)}`;
  const c = lineControl(s);
  return `M${f(s.x1)} ${f(s.y1)} Q${f(c.x)} ${f(c.y)} ${f(s.x2)} ${f(s.y2)}`;
}

/** Open V head at the arrow tip, following the curve's tangent there (J-041). */
export function arrowHeadPath(s: LineShape): string {
  const from = s.bend === 0 ? { x: s.x1, y: s.y1 } : lineControl(s);
  const a = Math.atan2(s.y2 - from.y, s.x2 - from.x);
  const length = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  const head = Math.min(s.sw * 4.5, Math.max(s.sw * 2, length * 0.4));
  const spread = Math.PI / 6.5;
  const l = { x: s.x2 - head * Math.cos(a - spread), y: s.y2 - head * Math.sin(a - spread) };
  const r = { x: s.x2 - head * Math.cos(a + spread), y: s.y2 - head * Math.sin(a + spread) };
  return `M${f(l.x)} ${f(l.y)} L${f(s.x2)} ${f(s.y2)} L${f(r.x)} ${f(r.y)}`;
}

export function draw(s: Shape, measure: Measure = approxMeasure, live = false): Drawn {
  const b = bounds(s, measure);
  const c = centerOf(b);
  const base = { id: s.id, rot: s.rot, cx: c.x, cy: c.y };
  switch (s.type) {
    case 'pen':
      return { ...base, prims: [{ t: 'path', d: penPath(s, live), fill: s.color }] };
    case 'rect':
      return { ...base, prims: [{ t: 'path', d: roundRectPath(s.x, s.y, s.w, s.h, s.sw * 2), stroke: s.color, sw: s.sw }] };
    case 'ellipse':
      return { ...base, prims: [{ t: 'path', d: ellipsePath(s.x, s.y, s.w, s.h), stroke: s.color, sw: s.sw }] };
    case 'blur':
      return { ...base, prims: [{ t: 'blur', x: s.x, y: s.y, w: s.w, h: s.h, r: s.sw }] };
    case 'line':
      return { ...base, prims: [{ t: 'path', d: linePath(s), stroke: s.color, sw: s.sw }] };
    case 'arrow':
      return {
        ...base,
        prims: [
          { t: 'path', d: linePath(s), stroke: s.color, sw: s.sw },
          { t: 'path', d: arrowHeadPath(s), stroke: s.color, sw: s.sw },
        ],
      };
    case 'text': {
      const box = textBox(s, measure);
      const pad = textPad(s.size);
      return {
        ...base,
        prims: [
          { t: 'path', d: roundRectPath(box.x, box.y, box.w, box.h, s.size * 0.4), fill: s.color, shadow: true },
          {
            t: 'text',
            x: box.x + pad.x,
            y: box.y + pad.y,
            lines: s.text.split('\n'),
            size: s.size,
            lineHeight: s.size * TEXT_LINE,
            fill: TEXT_COLOR,
          },
        ],
      };
    }
  }
}

/** Baseline of line i of a text prim, the same in SVG and canvas. */
export const textBaseline = (p: Extract<Prim, { t: 'text' }>, i: number) => p.y + i * p.lineHeight + (p.lineHeight + p.size * 0.7) / 2;

/** Canvas-backed measure for the browser. */
export function canvasMeasure(): Measure {
  let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  try {
    ctx = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1).getContext('2d') : document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  if (!ctx || typeof ctx.measureText !== 'function') return approxMeasure;
  const cache = new Map<string, number>();
  return (line, size) => {
    const key = `${size}|${line}`;
    let w = cache.get(key);
    if (w === undefined) {
      ctx!.font = `700 ${size}px ${TEXT_FONT}`;
      w = ctx!.measureText(line).width;
      if (!Number.isFinite(w) || (w === 0 && line.length)) w = approxMeasure(line, size);
      if (cache.size > 2000) cache.clear();
      cache.set(key, w);
    }
    return w;
  };
}
