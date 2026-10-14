// Screenshot annotation state and pointer logic (J-038 to J-052). The component feeds it pointer
// events in image coordinates; everything else (tools, selection, history, clipboard) lives here
// so unit tests drive the same code the editor runs.
import { annotationColors } from '../tokens.ts';
import { History } from './history.ts';
import {
  approxMeasure,
  bendFor,
  bounds,
  centerOf,
  duplicate,
  handlePoint,
  HANDLES,
  lineMid,
  newId,
  normBox,
  resize,
  rotate,
  rotates,
  rotationFor,
  shapeAt,
  shapesInBox,
  translate,
  worldBounds,
  type Box,
  type Handle,
  type LineShape,
  type Measure,
  type Pt,
  type Shape,
  type TextShape,
  type Tool,
} from './shapes.ts';

/** Six swatches; the accent ink is the default for every new draft (J-045). */
export const SWATCHES = [annotationColors[4], annotationColors[0], annotationColors[1], annotationColors[2], annotationColors[3], annotationColors[5]] as const;
export const DEFAULT_COLOR = SWATCHES[0];
export const SWATCH_NAMES: Record<string, string> = {
  [annotationColors[4]]: 'Ink',
  [annotationColors[0]]: 'Red',
  [annotationColors[1]]: 'Amber',
  [annotationColors[2]]: 'Green',
  [annotationColors[3]]: 'Sky',
  [annotationColors[5]]: 'Black',
};

/** Tools with a single-key shortcut (J-038, J-043, J-046). */
export const TOOL_KEYS: Partial<Record<Tool, string>> = { pen: 'D', text: 'T', select: 'V' };

/** Paste offset in image pixels (J-052). */
export const PASTE_OFFSET = 10;

type Drag =
  | { kind: 'create'; shape: Shape; start: Pt }
  | { kind: 'move'; start: Pt; before: Shape[]; ids: string[]; moved: boolean }
  | { kind: 'resize'; handle: Handle; before: Shape[]; id: string }
  | { kind: 'rotate'; start: Pt; startRot: number; before: Shape[]; id: string }
  | { kind: 'end'; which: 1 | 2; before: Shape[]; id: string }
  | { kind: 'bend'; before: Shape[]; id: string }
  | { kind: 'marquee'; start: Pt; box: Box; additive: boolean; base: string[] };

export type HitTarget =
  | { kind: 'handle'; handle: Handle; id: string }
  | { kind: 'rotate'; id: string }
  | { kind: 'end'; which: 1 | 2; id: string }
  | { kind: 'bend'; id: string }
  | { kind: 'shape'; id: string }
  | null;

let clipboard: Shape[] = [];

export interface AnnotatorInit {
  width: number;
  height: number;
  shapes?: Shape[];
  measure?: Measure;
}

export class AnnotatorState {
  width: number;
  height: number;
  shapes: Shape[] = $state([]);
  selected: string[] = $state([]);
  tool: Tool = $state('pen');
  color: string = $state(DEFAULT_COLOR);
  /** text callout being typed into, if any */
  editing: string | null = $state(null);
  /** select-all when the editor opens (double-click edit, J-043) */
  editSelectAll = $state(false);
  marquee: Box | null = $state(null);
  /** the shape being drawn right now (pen strokes render live from it) */
  draft: Shape | null = $state(null);
  canUndo = $state(false);
  canRedo = $state(false);
  /** bumps on every committed change; the editor autosaves on it */
  version = $state(0);
  /** image pixels per screen pixel, for hit tolerances and handle sizes */
  unitPerPx = $state(1);
  measure: Measure;

  private history = new History<Shape[]>();
  private drag: Drag | null = null;
  private pasteCount = 0;

  constructor(init: AnnotatorInit) {
    this.width = init.width;
    this.height = init.height;
    this.shapes = init.shapes ?? [];
    this.measure = init.measure ?? approxMeasure;
  }

  /** Base stroke width in image pixels: about 4 screen px on a 1000 px wide preview. */
  get unit(): number {
    return Math.max(1, this.width / 1000);
  }
  get strokeWidth() {
    return 4 * this.unit;
  }
  get textSize() {
    return 18 * this.unit;
  }
  get blurRadius() {
    return 10 * this.unit;
  }

  selectedShapes(): Shape[] {
    const ids = new Set(this.selected);
    return this.shapes.filter((s) => ids.has(s.id));
  }

  setTool(t: Tool) {
    this.commitText();
    this.tool = t;
    if (t !== 'select') this.selected = [];
  }

  /** Pick a swatch: recolours the selection (one undo step) and sets the colour for new shapes. */
  setColor(c: string) {
    this.color = c;
    const sel = new Set(this.selected);
    if (!sel.size) return;
    if (this.shapes.every((s) => !sel.has(s.id) || s.color === c)) return;
    this.change(() => {
      this.shapes = this.shapes.map((s) => (sel.has(s.id) ? { ...s, color: c } : s));
    });
  }

  // ---------- history ----------

  private sync() {
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
    this.version++;
  }
  /** Run a mutation as one undo step. */
  change(fn: () => void) {
    const before = $state.snapshot(this.shapes) as Shape[];
    fn();
    this.history.push(before);
    this.sync();
  }
  private pushBefore(before: Shape[]) {
    this.history.push(before);
    this.sync();
  }
  undo() {
    this.commitText();
    const prev = this.history.undo($state.snapshot(this.shapes) as Shape[]);
    if (!prev) return;
    this.shapes = prev;
    this.pruneSelection();
    this.sync();
  }
  redo() {
    this.commitText();
    const next = this.history.redo($state.snapshot(this.shapes) as Shape[]);
    if (!next) return;
    this.shapes = next;
    this.pruneSelection();
    this.sync();
  }
  private pruneSelection() {
    const ids = new Set(this.shapes.map((s) => s.id));
    this.selected = this.selected.filter((id) => ids.has(id));
  }

  // ---------- selection commands ----------

  deleteSelected() {
    if (!this.selected.length) return;
    const sel = new Set(this.selected);
    this.change(() => {
      this.shapes = this.shapes.filter((s) => !sel.has(s.id));
    });
    this.selected = [];
  }
  copy() {
    const sel = this.selectedShapes();
    if (!sel.length) return false;
    clipboard = $state.snapshot(sel) as Shape[];
    this.pasteCount = 0;
    return true;
  }
  paste() {
    if (!clipboard.length) return false;
    this.pasteCount++;
    const copies = duplicate(clipboard, PASTE_OFFSET * this.pasteCount);
    this.change(() => {
      this.shapes = [...this.shapes, ...copies];
    });
    this.tool = 'select';
    this.selected = copies.map((s) => s.id);
    return true;
  }
  selectAll() {
    this.tool = 'select';
    this.selected = this.shapes.map((s) => s.id);
  }

  // ---------- text ----------

  startText(at: Pt) {
    const s: TextShape = { id: newId(), type: 'text', color: this.color, rot: 0, x: at.x, y: at.y - this.textSize * 0.8, text: '', size: this.textSize };
    // the new callout is part of the next undo step, recorded at commit
    this.textBefore = $state.snapshot(this.shapes) as Shape[];
    this.shapes = [...this.shapes, s];
    this.editing = s.id;
    this.editSelectAll = false;
    this.selected = [s.id];
  }
  editText(id: string) {
    const s = this.shapes.find((x) => x.id === id);
    if (!s || s.type !== 'text') return;
    this.textBefore = $state.snapshot(this.shapes) as Shape[];
    this.editing = id;
    this.editSelectAll = true;
    this.selected = [id];
  }
  private textBefore: Shape[] | null = null;
  setText(id: string, text: string) {
    this.shapes = this.shapes.map((s) => (s.id === id && s.type === 'text' ? { ...s, text } : s));
  }
  /** Finish typing: an empty callout disappears; a changed one is one undo step. */
  commitText() {
    const id = this.editing;
    if (!id) return;
    this.editing = null;
    const s = this.shapes.find((x) => x.id === id) as TextShape | undefined;
    const before = this.textBefore;
    this.textBefore = null;
    if (s && !s.text.trim()) {
      this.shapes = this.shapes.filter((x) => x.id !== id);
      this.selected = this.selected.filter((x) => x !== id);
    }
    if (before && JSON.stringify(before) !== JSON.stringify($state.snapshot(this.shapes))) this.pushBefore(before);
    if (this.tool === 'text') this.tool = 'select';
  }

  // ---------- pointer ----------

  /** What sits under a point in select mode: handles first, then shapes. */
  hit(p: Pt): HitTarget {
    const tol = 6 * this.unitPerPx;
    const sel = this.selectedShapes();
    if (sel.length === 1) {
      const s = sel[0]!;
      if (s.type === 'line' || s.type === 'arrow') {
        const near = (q: Pt) => Math.hypot(q.x - p.x, q.y - p.y) <= tol + 2 * this.unitPerPx;
        if (near({ x: s.x2, y: s.y2 })) return { kind: 'end', which: 2, id: s.id };
        if (near({ x: s.x1, y: s.y1 })) return { kind: 'end', which: 1, id: s.id };
        if (s.type === 'arrow' && near(lineMid(s))) return { kind: 'bend', id: s.id };
      } else {
        const b = bounds(s, this.measure);
        const c = centerOf(b);
        const local = rotate(p, c, -s.rot);
        for (const h of HANDLES) {
          const hp = handlePoint(b, h);
          if (Math.abs(local.x - hp.x) <= tol && Math.abs(local.y - hp.y) <= tol) return { kind: 'handle', handle: h, id: s.id };
        }
        if (rotates(s)) {
          // a ring just outside each corner rotates (J-046)
          for (const h of ['nw', 'ne', 'se', 'sw'] as Handle[]) {
            const hp = handlePoint(b, h);
            const d = Math.hypot(local.x - hp.x, local.y - hp.y);
            const outside = (h.includes('w') ? local.x < b.x : local.x > b.x + b.w) || (h.includes('n') ? local.y < b.y : local.y > b.y + b.h);
            if (outside && d > tol && d <= tol + 16 * this.unitPerPx) return { kind: 'rotate', id: s.id };
          }
        }
      }
    }
    const s = shapeAt(this.shapes, p, tol, this.measure);
    return s ? { kind: 'shape', id: s.id } : null;
  }

  pointerDown(p: Pt, opts: { shift?: boolean; alt?: boolean } = {}) {
    if (this.editing) {
      this.commitText();
      if (this.tool !== 'select') return;
    }
    const t = this.tool;
    if (t === 'text') {
      this.startText(p);
      return;
    }
    if (t !== 'select') {
      const base = { id: newId(), color: this.color, rot: 0 };
      let shape: Shape;
      if (t === 'pen') shape = { ...base, type: 'pen', pts: [[p.x, p.y, 0.5]], sw: this.strokeWidth * 1.6 };
      else if (t === 'line' || t === 'arrow') shape = { ...base, type: t, x1: p.x, y1: p.y, x2: p.x, y2: p.y, bend: 0, sw: this.strokeWidth * 1.5 };
      else shape = { ...base, type: t, x: p.x, y: p.y, w: 0, h: 0, sw: t === 'blur' ? this.blurRadius : this.strokeWidth };
      this.draft = shape;
      this.drag = { kind: 'create', shape, start: p };
      this.selected = [];
      return;
    }
    const target = this.hit(p);
    const before = $state.snapshot(this.shapes) as Shape[];
    if (!target) {
      this.drag = { kind: 'marquee', start: p, box: { x: p.x, y: p.y, w: 0, h: 0 }, additive: !!opts.shift, base: opts.shift ? [...this.selected] : [] };
      if (!opts.shift) this.selected = [];
      this.marquee = { x: p.x, y: p.y, w: 0, h: 0 };
      return;
    }
    if (target.kind === 'handle') this.drag = { kind: 'resize', handle: target.handle, before, id: target.id };
    else if (target.kind === 'rotate') {
      const s = this.shapes.find((x) => x.id === target.id)!;
      this.drag = { kind: 'rotate', start: p, startRot: s.rot, before, id: target.id };
    } else if (target.kind === 'end') this.drag = { kind: 'end', which: target.which, before, id: target.id };
    else if (target.kind === 'bend') this.drag = { kind: 'bend', before, id: target.id };
    else {
      if (opts.shift) {
        this.selected = this.selected.includes(target.id) ? this.selected.filter((x) => x !== target.id) : [...this.selected, target.id];
      } else if (!this.selected.includes(target.id)) this.selected = [target.id];
      this.drag = { kind: 'move', start: p, before, ids: [...this.selected], moved: false };
    }
  }

  pointerMove(p: Pt, opts: { shift?: boolean } = {}) {
    const d = this.drag;
    if (!d) return;
    switch (d.kind) {
      case 'create': {
        const s = d.shape;
        if (s.type === 'pen') {
          const last = s.pts[s.pts.length - 1]!;
          if (Math.hypot(last[0] - p.x, last[1] - p.y) < 0.5 * this.unitPerPx) return;
          s.pts.push([p.x, p.y, 0.5]);
          this.draft = { ...s, pts: [...s.pts] };
        } else if (s.type === 'line' || s.type === 'arrow') {
          let q = p;
          if (opts.shift) {
            // snap to 15 degree steps
            const a = Math.round(Math.atan2(p.y - d.start.y, p.x - d.start.x) / (Math.PI / 12)) * (Math.PI / 12);
            const len = Math.hypot(p.x - d.start.x, p.y - d.start.y);
            q = { x: d.start.x + Math.cos(a) * len, y: d.start.y + Math.sin(a) * len };
          }
          d.shape = { ...s, x2: q.x, y2: q.y };
          this.draft = d.shape;
        } else if (s.type === 'rect' || s.type === 'ellipse' || s.type === 'blur') {
          let w = p.x - d.start.x;
          let h = p.y - d.start.y;
          if (opts.shift) {
            const m = Math.max(Math.abs(w), Math.abs(h));
            w = Math.sign(w || 1) * m;
            h = Math.sign(h || 1) * m;
          }
          const nb = normBox({ x: d.start.x, y: d.start.y, w, h });
          d.shape = { ...s, ...nb };
          this.draft = d.shape;
        }
        return;
      }
      case 'move': {
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) < 2 * this.unitPerPx) return;
        d.moved = true;
        const ids = new Set(d.ids);
        this.shapes = d.before.map((s) => (ids.has(s.id) ? translate(s, dx, dy) : s));
        return;
      }
      case 'resize': {
        const orig = d.before.find((s) => s.id === d.id)!;
        const next = resize(orig, d.handle, p, this.measure, 2 * this.unitPerPx);
        this.shapes = d.before.map((s) => (s.id === d.id ? next : s));
        return;
      }
      case 'rotate': {
        const orig = d.before.find((s) => s.id === d.id)!;
        const rot = rotationFor(orig, d.startRot, d.start, p, this.measure, !!opts.shift);
        this.shapes = d.before.map((s) => (s.id === d.id ? { ...s, rot } : s));
        return;
      }
      case 'end': {
        this.shapes = d.before.map((s) => {
          if (s.id !== d.id) return s;
          const l = s as LineShape;
          return d.which === 1 ? { ...l, x1: p.x, y1: p.y } : { ...l, x2: p.x, y2: p.y };
        });
        return;
      }
      case 'bend': {
        this.shapes = d.before.map((s) => (s.id === d.id ? { ...(s as LineShape), bend: bendFor(s as LineShape, p) } : s));
        return;
      }
      case 'marquee': {
        d.box = { x: d.start.x, y: d.start.y, w: p.x - d.start.x, h: p.y - d.start.y };
        this.marquee = normBox(d.box);
        // a click on empty space is not a marquee (and must not pick the shape it sits inside)
        if (Math.max(Math.abs(d.box.w), Math.abs(d.box.h)) < 3 * this.unitPerPx) {
          this.selected = [...d.base];
          return;
        }
        const hit = shapesInBox(this.shapes, d.box, this.measure).map((s) => s.id);
        this.selected = [...new Set([...d.base, ...hit])];
        return;
      }
    }
  }

  pointerUp(p?: Pt) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (p) this.pointerMove(p);
    switch (d.kind) {
      case 'create': {
        const s = (this.draft ?? d.shape) as Shape;
        this.draft = null;
        const tiny = 3 * this.unitPerPx;
        const b = bounds(s, this.measure);
        if (s.type !== 'pen' && Math.max(b.w, b.h) < tiny) return;
        this.change(() => {
          this.shapes = [...this.shapes, s];
        });
        if (s.type === 'pen') return; // the pen stays active (J-038)
        this.tool = 'select';
        this.selected = [s.id];
        return;
      }
      case 'marquee':
        this.marquee = null;
        return;
      case 'move':
        if (d.moved) this.pushBefore(d.before);
        return;
      default:
        if (JSON.stringify(d.before) !== JSON.stringify($state.snapshot(this.shapes))) this.pushBefore(d.before);
    }
  }

  /** Abort the current drag, restoring shapes (pointer cancel). */
  cancelDrag() {
    const d = this.drag;
    this.drag = null;
    this.draft = null;
    this.marquee = null;
    if (d && 'before' in d) this.shapes = d.before;
  }

  get dragging() {
    return this.drag !== null;
  }

  /** World bounds of the selection, for the group outline. */
  selectionBounds(): Box | null {
    const sel = this.selectedShapes();
    return sel.length ? worldBounds(sel, this.measure) : null;
  }
}
