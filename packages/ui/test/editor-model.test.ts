import { describe, expect, it } from 'vitest';
import {
  AnnotatorState,
  DEFAULT_COLOR,
  PASTE_OFFSET,
  SWATCHES,
  TrimState,
  aiToMarkdown,
  bounds,
  clock,
  draftToHtml,
  draw,
  eventsInRange,
  fieldToDraft,
  hitTest,
  lineMid,
  listRuleFor,
  resize,
  rotate,
  shapesInBox,
  spellDuration,
  type BoxShape,
  type LineShape,
  type TextShape,
} from '../src/editor/index.ts';
import { annotationColors } from '../src/tokens.ts';

const rect = (over: Partial<BoxShape> = {}): BoxShape => ({ id: 'r1', type: 'rect', color: '#000', rot: 0, x: 100, y: 100, w: 200, h: 100, sw: 4, ...over });

function drag(st: AnnotatorState, from: [number, number], to: [number, number], steps = 4) {
  st.pointerDown({ x: from[0], y: from[1] });
  for (let i = 1; i <= steps; i++) st.pointerMove({ x: from[0] + ((to[0] - from[0]) * i) / steps, y: from[1] + ((to[1] - from[1]) * i) / steps });
  st.pointerUp({ x: to[0], y: to[1] });
}

describe('shapes geometry', () => {
  it('hits a rectangle on its outline, not deep inside (J-046)', () => {
    const r = rect();
    expect(hitTest(r, { x: 100, y: 150 }, 4)).toBe(true);
    expect(hitTest(r, { x: 200, y: 150 }, 4)).toBe(false);
    expect(hitTest(r, { x: 50, y: 150 }, 4)).toBe(false);
  });

  it('hits a rotated rectangle on its rotated outline', () => {
    const r = rect({ rot: Math.PI / 2 });
    // rotated 90 degrees around (200,150): the left edge x=100 maps to y=50
    expect(hitTest(r, { x: 200, y: 50 }, 4)).toBe(true);
    expect(hitTest(r, { x: 100, y: 150 }, 4)).toBe(false);
  });

  it('resizes from a corner keeping the opposite corner fixed', () => {
    const r = resize(rect(), 'se', { x: 400, y: 300 });
    expect(bounds(r)).toEqual({ x: 100, y: 100, w: 300, h: 200 });
    const r2 = resize(rect(), 'nw', { x: 50, y: 50 });
    expect(bounds(r2)).toEqual({ x: 50, y: 50, w: 250, h: 150 });
  });

  it('keeps the anchor fixed in world space for rotated shapes', () => {
    const r0 = rect({ rot: 0.6 });
    const b0 = bounds(r0);
    const c0 = { x: b0.x + b0.w / 2, y: b0.y + b0.h / 2 };
    const anchor = rotate({ x: b0.x, y: b0.y }, c0, 0.6);
    const r1 = resize(r0, 'se', { x: 420, y: 380 });
    const b1 = bounds(r1);
    const anchor1 = rotate({ x: b1.x, y: b1.y }, { x: b1.x + b1.w / 2, y: b1.y + b1.h / 2 }, 0.6);
    expect(anchor1.x).toBeCloseTo(anchor.x, 6);
    expect(anchor1.y).toBeCloseTo(anchor.y, 6);
  });

  it('scales a text callout font when resized (J-046)', () => {
    const t: TextShape = { id: 't', type: 'text', color: '#000', rot: 0, x: 0, y: 0, text: 'Hello', size: 20 };
    const b = bounds(t);
    const out = resize(t, 'se', { x: b.w * 2, y: b.h * 2 });
    expect(out.size).toBeCloseTo(40, 0);
  });

  it('bends an arrow through the middle handle (J-041)', () => {
    const a: LineShape = { id: 'a', type: 'arrow', color: '#000', rot: 0, x1: 0, y1: 0, x2: 200, y2: 0, bend: 50, sw: 4 };
    const m = lineMid(a);
    expect(m.x).toBeCloseTo(100);
    expect(Math.abs(m.y)).toBeCloseTo(50);
    const d = draw(a);
    expect(d.prims[0]).toMatchObject({ t: 'path' });
    expect((d.prims[0] as { d: string }).d).toMatch(/Q/);
    // the head follows the tangent at the tip, so it is not symmetric about the x axis
    const head = (d.prims[1] as { d: string }).d;
    expect(head).toMatch(/^M[-\d.]+ [-\d.]+ L200 0 L/);
  });

  it('ellipse fills a wide box (J-040)', () => {
    const e: BoxShape = { ...rect(), type: 'ellipse', w: 300, h: 80 };
    const p = draw(e).prims[0] as { d: string };
    expect(p.d).toContain('A150 40');
  });

  it('marquee picks every shape the box touches (J-047)', () => {
    const a = rect({ id: 'a', x: 0, y: 0, w: 50, h: 50 });
    const b = rect({ id: 'b', x: 100, y: 100, w: 50, h: 50 });
    const c = rect({ id: 'c', x: 400, y: 400, w: 50, h: 50 });
    expect(shapesInBox([a, b, c], { x: 40, y: 40, w: 70, h: 70 }).map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('AnnotatorState', () => {
  const make = () => new AnnotatorState({ width: 1000, height: 600 });

  it('opens with the pen and the default ink colour (J-038, J-045)', () => {
    const st = make();
    expect(st.tool).toBe('pen');
    expect(st.color).toBe(DEFAULT_COLOR);
    expect(SWATCHES).toHaveLength(6);
    expect(new Set(SWATCHES)).toEqual(new Set(annotationColors));
  });

  it('pen strokes keep the pen active', () => {
    const st = make();
    drag(st, [10, 10], [200, 120], 10);
    expect(st.shapes).toHaveLength(1);
    expect(st.shapes[0]!.type).toBe('pen');
    expect(st.tool).toBe('pen');
  });

  it('rectangle returns to select with the new shape selected (J-039)', () => {
    const st = make();
    st.setTool('rect');
    drag(st, [100, 100], [300, 200]);
    expect(st.tool).toBe('select');
    expect(st.selected).toEqual([st.shapes[0]!.id]);
    expect(bounds(st.shapes[0]!)).toEqual({ x: 100, y: 100, w: 200, h: 100 });
  });

  it('a click without a drag creates no box', () => {
    const st = make();
    st.setTool('ellipse');
    drag(st, [100, 100], [101, 100]);
    expect(st.shapes).toHaveLength(0);
  });

  it('recolours the selection and later shapes as one undo step (J-045)', () => {
    const st = make();
    st.setTool('rect');
    drag(st, [100, 100], [300, 200]);
    st.setColor(SWATCHES[1]);
    expect(st.shapes[0]!.color).toBe(SWATCHES[1]);
    st.setTool('ellipse');
    drag(st, [400, 100], [500, 200]);
    expect(st.shapes[1]!.color).toBe(SWATCHES[1]);
    st.undo(); // ellipse
    st.undo(); // recolour
    expect(st.shapes[0]!.color).toBe(DEFAULT_COLOR);
  });

  it('create, move, recolour, delete are four undo steps; redo replays them (J-049)', () => {
    const st = make();
    expect(st.canUndo).toBe(false);
    st.setTool('rect');
    drag(st, [100, 100], [300, 200]);
    const id = st.shapes[0]!.id;
    // move by its outline
    drag(st, [100, 150], [150, 180]);
    expect(bounds(st.shapes[0]!).x).toBe(150);
    st.setColor(SWATCHES[2]);
    st.deleteSelected();
    expect(st.shapes).toHaveLength(0);
    st.undo();
    expect(st.shapes[0]!.color).toBe(SWATCHES[2]);
    st.undo();
    expect(st.shapes[0]!.color).toBe(DEFAULT_COLOR);
    st.undo();
    expect(bounds(st.shapes[0]!).x).toBe(100);
    st.undo();
    expect(st.shapes).toHaveLength(0);
    expect(st.canUndo).toBe(false);
    expect(st.canRedo).toBe(true);
    st.redo();
    st.redo();
    st.redo();
    st.redo();
    expect(st.shapes).toHaveLength(0);
    expect(st.canRedo).toBe(false);
    void id;
  });

  it('marquee selects two shapes, they move together, Delete removes both, one undo restores (J-047, J-048)', () => {
    const st = make();
    st.setTool('rect');
    drag(st, [100, 100], [200, 200]);
    st.setTool('rect');
    drag(st, [300, 100], [400, 200]);
    st.setTool('select');
    drag(st, [50, 50], [450, 120]);
    expect(st.selected).toHaveLength(2);
    drag(st, [100, 150], [110, 160]);
    expect(st.shapes.map((s) => bounds(s).x)).toEqual([110, 310]);
    st.deleteSelected();
    expect(st.shapes).toHaveLength(0);
    st.undo();
    expect(st.shapes).toHaveLength(2);
  });

  it('resizes from a corner handle and rotates from just outside it (J-046)', () => {
    const st = make();
    st.unitPerPx = 1;
    st.setTool('rect');
    drag(st, [100, 100], [300, 200]);
    drag(st, [300, 200], [350, 260]);
    expect(bounds(st.shapes[0]!)).toEqual({ x: 100, y: 100, w: 250, h: 160 });
    // 14 px outside the bottom-right corner, then swing around the centre
    drag(st, [360, 270], [225, 330]);
    expect(Math.abs(st.shapes[0]!.rot)).toBeGreaterThan(0.3);
  });

  it('text: click and type, empty callouts vanish, double-click edit is one step (J-043)', () => {
    const st = make();
    st.setTool('text');
    st.pointerDown({ x: 100, y: 100 });
    expect(st.editing).not.toBeNull();
    st.setText(st.editing!, 'Broken button');
    st.commitText();
    expect(st.shapes).toHaveLength(1);
    expect((st.shapes[0] as TextShape).text).toBe('Broken button');
    expect(st.tool).toBe('select');
    expect(st.canUndo).toBe(true);
    st.editText(st.shapes[0]!.id);
    expect(st.editSelectAll).toBe(true);
    st.setText(st.shapes[0]!.id, 'Fixed');
    st.commitText();
    st.undo();
    expect((st.shapes[0] as TextShape).text).toBe('Broken button');
    st.setTool('text');
    st.pointerDown({ x: 500, y: 300 });
    st.commitText();
    expect(st.shapes).toHaveLength(1);
  });

  it('copy and paste offset the copy by 10 px as one undo step (J-052)', () => {
    const st = make();
    st.setTool('rect');
    drag(st, [100, 100], [200, 200]);
    expect(st.copy()).toBe(true);
    expect(st.paste()).toBe(true);
    expect(st.shapes).toHaveLength(2);
    expect(bounds(st.shapes[1]!).x).toBe(100 + PASTE_OFFSET);
    expect(st.shapes[1]!.id).not.toBe(st.shapes[0]!.id);
    expect(st.selected).toEqual([st.shapes[1]!.id]);
    st.undo();
    expect(st.shapes).toHaveLength(1);
  });

  it('arrow middle handle bends the arrow (J-041)', () => {
    const st = make();
    st.setTool('arrow');
    drag(st, [100, 300], [500, 300]);
    expect(st.tool).toBe('select');
    drag(st, [300, 300], [300, 200]);
    const a = st.shapes[0] as LineShape;
    expect(Math.abs(a.bend)).toBeCloseTo(100, 0);
  });

  it('blur box moves like any shape (J-044)', () => {
    const st = make();
    st.setTool('blur');
    drag(st, [100, 100], [200, 160]);
    expect(st.shapes[0]!.type).toBe('blur');
    drag(st, [150, 130], [450, 330]);
    expect(bounds(st.shapes[0]!)).toMatchObject({ x: 400, y: 300 });
  });
});

describe('trim', () => {
  it('drags are undo steps, the length updates, grips keep a minimum gap (J-085)', () => {
    const t = new TrimState(12_000);
    expect(t.range).toBeNull();
    t.beginDrag();
    t.moveGrip('start', 2000);
    t.endDrag();
    t.beginDrag();
    t.moveGrip('end', 9000);
    t.endDrag();
    expect(t.range).toEqual({ startMs: 2000, endMs: 9000 });
    expect(spellDuration(t.lengthMs)).toBe('7 seconds');
    t.undo();
    expect(t.range).toEqual({ startMs: 2000, endMs: 12000 });
    t.redo();
    expect(t.endMs).toBe(9000);
    t.beginDrag();
    t.moveGrip('start', 8900);
    t.endDrag();
    expect(t.startMs).toBe(8500);
  });

  it('spells lengths and clocks', () => {
    expect(spellDuration(0)).toBe('0 seconds');
    expect(spellDuration(1000)).toBe('1 second');
    expect(spellDuration(65_000)).toBe('1 minute 5 seconds');
    expect(spellDuration(120_000)).toBe('2 minutes');
    expect(clock(65_000)).toBe('1:05');
  });

  it('cuts events outside the kept range (J-227)', () => {
    const ev = [{ t: 1000 }, { t: 3000 }, { t: 9000 }];
    expect(eventsInRange(ev, 1000, { startMs: 1000, endMs: 5000 })).toEqual([{ t: 3000 }]);
    expect(eventsInRange(ev, 1000, null)).toHaveLength(3);
  });
});

describe('rich text', () => {
  it('first line is the title, the rest Markdown (J-077, J-078)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div>Checkout fails</div><div>Steps <b>below</b></div><ul><li>open cart</li><li>pay</li></ul><ol><li>one</li><li>two</li></ol>';
    expect(fieldToDraft(root)).toEqual({ title: 'Checkout fails', description: 'Steps **below**\n- open cart\n- pay\n1. one\n2. two' });
  });

  it('round-trips through draftToHtml', () => {
    const md = 'Line one with **bold**\n- a\n- b\n1. x';
    const root = document.createElement('div');
    root.innerHTML = draftToHtml('Title', md);
    expect(fieldToDraft(root)).toEqual({ title: 'Title', description: md });
  });

  it('an empty field is an empty title', () => {
    const root = document.createElement('div');
    root.innerHTML = draftToHtml('', '');
    expect(fieldToDraft(root)).toEqual({ title: '', description: '' });
  });

  it('input rules', () => {
    expect(listRuleFor('- ')).toBe('ul');
    expect(listRuleFor('1. ')).toBe('ol');
    expect(listRuleFor('x ')).toBeNull();
  });

  it('formats accepted AI text with numbered steps and time links', () => {
    const md = aiToMarkdown({ title: 'Order fails', summary: 'Pay returns 500.', steps: [{ text: 'Open cart', tMs: 1000 }, { text: 'Pay', tMs: null }], result: 'Error toast' }, clock);
    expect(md.title).toBe('Order fails');
    expect(md.description).toContain('1. Open cart (0:01)');
    expect(md.description).toContain('2. Pay');
  });
});
