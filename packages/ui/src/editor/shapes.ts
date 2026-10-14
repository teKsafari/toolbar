// Annotation shapes for the screenshot editor: types, geometry, hit tests and transforms.
// Coordinates are image pixels of the screenshot the editor shows (the crop for area shots).
// Pure functions only, so the same model drives the live SVG layer, the flattened PNG and tests.

export type Tool = 'select' | 'pen' | 'rect' | 'ellipse' | 'arrow' | 'line' | 'text' | 'blur';
export type ShapeType = Exclude<Tool, 'select'>;

export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Base {
  id: string;
  color: string;
  /** rotation in radians around the centre of the unrotated bounds */
  rot: number;
}
export interface BoxShape extends Base {
  type: 'rect' | 'ellipse' | 'blur';
  x: number;
  y: number;
  w: number;
  h: number;
  /** stroke width (rect, ellipse) or blur radius (blur) */
  sw: number;
}
export interface PenShape extends Base {
  type: 'pen';
  /** [x, y, pressure] */
  pts: [number, number, number][];
  sw: number;
}
export interface LineShape extends Base {
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** signed offset of the curve's midpoint from the straight line, along its left normal */
  bend: number;
  sw: number;
}
export interface TextShape extends Base {
  type: 'text';
  /** top-left of the callout box */
  x: number;
  y: number;
  text: string;
  size: number;
}
export type Shape = BoxShape | PenShape | LineShape | TextShape;

/** Measures one line of bold callout text at a font size; the browser passes a canvas-backed one. */
export type Measure = (line: string, size: number) => number;

/** Rough measure for tests and SSR: bold sans glyphs average about 0.6 em. */
export const approxMeasure: Measure = (line, size) => line.length * size * 0.6;

export const TEXT_LINE = 1.25;
export const textPad = (size: number) => ({ x: size * 0.5, y: size * 0.3 });

export function textBox(s: TextShape, measure: Measure): Box {
  const lines = s.text.split('\n');
  const pad = textPad(s.size);
  const w = Math.max(s.size, ...lines.map((l) => measure(l, s.size))) + pad.x * 2;
  const h = lines.length * s.size * TEXT_LINE + pad.y * 2;
  return { x: s.x, y: s.y, w, h };
}

// ---------- line and arrow curves ----------

/** Unit left normal of p1 -> p2 (zero for a degenerate line). */
function normal(s: LineShape): Pt {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** The point the curve passes through halfway: the bend handle. */
export function lineMid(s: LineShape): Pt {
  const n = normal(s);
  return { x: (s.x1 + s.x2) / 2 + n.x * s.bend, y: (s.y1 + s.y2) / 2 + n.y * s.bend };
}

/** Quadratic control point that makes the curve pass through lineMid at t = 0.5. */
export function lineControl(s: LineShape): Pt {
  const m = lineMid(s);
  return { x: 2 * m.x - (s.x1 + s.x2) / 2, y: 2 * m.y - (s.y1 + s.y2) / 2 };
}

/** Signed bend for a dragged middle handle. */
export function bendFor(s: LineShape, p: Pt): number {
  const n = normal(s);
  return (p.x - (s.x1 + s.x2) / 2) * n.x + (p.y - (s.y1 + s.y2) / 2) * n.y;
}

export function quadAt(p0: Pt, c: Pt, p1: Pt, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}

/** Points along the line or curve, enough for hit tests and bounds. */
export function linePoints(s: LineShape, steps = 24): Pt[] {
  const p0 = { x: s.x1, y: s.y1 };
  const p1 = { x: s.x2, y: s.y2 };
  if (s.bend === 0) return [p0, p1];
  const c = lineControl(s);
  return Array.from({ length: steps + 1 }, (_, i) => quadAt(p0, c, p1, i / steps));
}

// ---------- bounds and transforms ----------

function boxOf(pts: Pt[]): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Unrotated bounds in image coordinates (the frame the shape is drawn in before rotation). */
export function bounds(s: Shape, measure: Measure = approxMeasure): Box {
  switch (s.type) {
    case 'rect':
    case 'ellipse':
    case 'blur':
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    case 'pen':
      return boxOf(s.pts.map(([x, y]) => ({ x, y })));
    case 'line':
    case 'arrow':
      return boxOf(linePoints(s));
    case 'text':
      return textBox(s, measure);
  }
}

export const centerOf = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function rotate(p: Pt, c: Pt, a: number): Pt {
  if (!a) return { x: p.x, y: p.y };
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Line and arrow shapes carry their direction in their end points, so they never rotate. */
export const rotates = (s: Shape) => s.type !== 'line' && s.type !== 'arrow';

/** World corners of the rotated bounds, for marquee tests and group bounds. */
export function corners(s: Shape, measure: Measure = approxMeasure): Pt[] {
  const b = bounds(s, measure);
  const c = centerOf(b);
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ].map((p) => rotate(p, c, s.rot));
}

export function worldBounds(shapes: Shape[], measure: Measure = approxMeasure): Box {
  return boxOf(shapes.flatMap((s) => corners(s, measure)));
}

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distToPolyline(p: Pt, pts: Pt[]): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y);
  let d = Infinity;
  for (let i = 1; i < pts.length; i++) d = Math.min(d, distToSeg(p, pts[i - 1]!, pts[i]!));
  return d;
}

/**
 * Hit test against the visible outline (J-046: select by clicking the outline, not the inside).
 * Filled shapes (text callouts, blur boxes) hit anywhere inside.
 */
export function hitTest(s: Shape, world: Pt, tol: number, measure: Measure = approxMeasure): boolean {
  const b = bounds(s, measure);
  const p = rotate(world, centerOf(b), -s.rot);
  switch (s.type) {
    case 'text':
    case 'blur':
      return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    case 'rect': {
      const inside = p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
      const deep = p.x > b.x + tol && p.x < b.x + b.w - tol && p.y > b.y + tol && p.y < b.y + b.h - tol;
      return inside && !deep;
    }
    case 'ellipse': {
      const rx = b.w / 2;
      const ry = b.h / 2;
      if (rx < 1 || ry < 1) return distToSeg(p, { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h }) <= tol + s.sw;
      const c = centerOf(b);
      // distance along the ray from the centre, scaled to the ellipse
      const k = Math.hypot((p.x - c.x) / rx, (p.y - c.y) / ry);
      const r = Math.min(rx, ry);
      return Math.abs(k - 1) * r <= tol + s.sw / 2;
    }
    case 'pen':
      return distToPolyline(p, s.pts.map(([x, y]) => ({ x, y }))) <= tol + s.sw / 2;
    case 'line':
    case 'arrow':
      return distToPolyline(world, linePoints(s)) <= tol + s.sw / 2;
  }
}

/** Topmost shape under a point. */
export function shapeAt(shapes: Shape[], p: Pt, tol: number, measure: Measure = approxMeasure): Shape | null {
  for (let i = shapes.length - 1; i >= 0; i--) if (hitTest(shapes[i]!, p, tol, measure)) return shapes[i]!;
  return null;
}

/** Shapes the marquee box touches (J-047). */
export function shapesInBox(shapes: Shape[], box: Box, measure: Measure = approxMeasure): Shape[] {
  const nb = normBox(box);
  return shapes.filter((s) => {
    const wb = worldBounds([s], measure);
    return wb.x <= nb.x + nb.w && wb.x + wb.w >= nb.x && wb.y <= nb.y + nb.h && wb.y + wb.h >= nb.y;
  });
}

export function normBox(b: Box): Box {
  return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) };
}

export function translate<S extends Shape>(s: S, dx: number, dy: number): S {
  switch (s.type) {
    case 'pen':
      return { ...s, pts: s.pts.map(([x, y, p]) => [x + dx, y + dy, p] as [number, number, number]) };
    case 'line':
    case 'arrow':
      return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    default:
      return { ...s, x: (s as BoxShape).x + dx, y: (s as BoxShape).y + dy };
  }
}

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Local (unrotated) position of a handle on a box. */
export function handlePoint(b: Box, h: Handle): Pt {
  const x = h.includes('w') ? b.x : h.includes('e') ? b.x + b.w : b.x + b.w / 2;
  const y = h.includes('n') ? b.y : h.includes('s') ? b.y + b.h : b.y + b.h / 2;
  return { x, y };
}

const OPPOSITE: Record<Handle, Handle> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };

/**
 * Resize a shape by dragging one of its handles to a world point. The opposite handle stays
 * fixed in world space, also for rotated shapes. Text callouts scale their font (J-046).
 */
export function resize<S extends Shape>(s: S, h: Handle, world: Pt, measure: Measure = approxMeasure, min = 4): S {
  const b = bounds(s, measure);
  const c = centerOf(b);
  const anchorLocal = handlePoint(b, OPPOSITE[h]);
  const anchorWorld = rotate(anchorLocal, c, s.rot);
  const p = rotate(world, c, -s.rot);
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  if (h.includes('w')) x0 = Math.min(p.x, x1 - min);
  if (h.includes('e')) x1 = Math.max(p.x, x0 + min);
  if (h.includes('n')) y0 = Math.min(p.y, y1 - min);
  if (h.includes('s')) y1 = Math.max(p.y, y0 + min);
  const nb: Box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  let out = mapBox(s, b, nb, measure, h);
  // keep the anchor fixed in world space
  const ob = bounds(out, measure);
  const after = rotate(handlePoint(ob, OPPOSITE[h]), centerOf(ob), s.rot);
  out = translate(out, anchorWorld.x - after.x, anchorWorld.y - after.y);
  return out;
}

/** Map a shape from one local box to another. */
export function mapBox<S extends Shape>(s: S, from: Box, to: Box, measure: Measure = approxMeasure, h?: Handle): S {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const mx = (x: number) => to.x + (x - from.x) * sx;
  const my = (y: number) => to.y + (y - from.y) * sy;
  switch (s.type) {
    case 'rect':
    case 'ellipse':
    case 'blur':
      return { ...s, x: to.x, y: to.y, w: to.w, h: to.h };
    case 'pen':
      return { ...s, pts: s.pts.map(([x, y, p]) => [mx(x), my(y), p] as [number, number, number]) };
    case 'line':
    case 'arrow':
      return { ...s, x1: mx(s.x1), y1: my(s.y1), x2: mx(s.x2), y2: my(s.y2), bend: s.bend * Math.sqrt(Math.abs(sx * sy)) };
    case 'text': {
      // corner handles scale uniformly; side handles scale by the axis they move
      const k = h === 'e' || h === 'w' ? sx : h === 'n' || h === 's' ? sy : Math.max(sx, sy);
      const size = Math.max(6, s.size * k);
      const t = { ...s, size };
      void measure;
      return { ...t, x: to.x, y: to.y };
    }
  }
}

/** Rotation for a drag from `start` to `world` around the shape's centre. */
export function rotationFor(s: Shape, startRot: number, start: Pt, world: Pt, measure: Measure = approxMeasure, snap = false): number {
  const c = centerOf(bounds(s, measure));
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const a1 = Math.atan2(world.y - c.y, world.x - c.x);
  let r = startRot + (a1 - a0);
  if (snap) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
  return r;
}

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1e6;
  return `s${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Copies for paste: new ids, offset by `d` image pixels (J-052). */
export function duplicate(shapes: Shape[], d: number): Shape[] {
  return shapes.map((s) => ({ ...translate(structuredClone(s), d, d), id: newId() }));
}
