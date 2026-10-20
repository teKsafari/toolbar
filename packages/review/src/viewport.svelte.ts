// The part of the page a person can see, for the reviewer's floating UI (pill, launcher, composer,
// notes list, previews). It follows window resizes, DevTools docking, zoom, orientation changes and
// pinch zoom (the visual viewport), so a layer placed once never ends up off screen (D-199).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Margin kept between a floating layer and the edge of the visible area. */
export const EDGE = 8;

function read(): Box {
  const v = typeof visualViewport === 'undefined' ? null : visualViewport;
  // clientWidth leaves out the page's scrollbar, as position: fixed does
  const lw = document.documentElement.clientWidth || innerWidth;
  const lh = document.documentElement.clientHeight || innerHeight;
  if (!v) return { x: 0, y: 0, w: lw, h: lh };
  return { x: v.offsetLeft, y: v.offsetTop, w: Math.min(v.width, lw), h: Math.min(v.height, lh) };
}

class Viewport {
  /** the visible area in layout-viewport coordinates (the space of position: fixed) */
  box: Box = $state({ x: 0, y: 0, w: 1024, h: 768 });
  /** the layout viewport: what right and bottom of a fixed element are measured from */
  layout = $state({ w: 1024, h: 768 });

  update = () => {
    const b = read();
    const c = this.box;
    if (b.x !== c.x || b.y !== c.y || b.w !== c.w || b.h !== c.h) this.box = b;
    const lw = document.documentElement.clientWidth || innerWidth;
    const lh = document.documentElement.clientHeight || innerHeight;
    if (lw !== this.layout.w || lh !== this.layout.h) this.layout = { w: lw, h: lh };
  };

  private watching = 0;
  private stop: (() => void) | null = null;

  /** Start following the viewport; returns the stop function. Nested calls share one watcher. */
  watch(): () => void {
    if (this.watching++ === 0) {
      this.update();
      const u = this.update;
      addEventListener('resize', u, { passive: true });
      addEventListener('orientationchange', u, { passive: true });
      visualViewport?.addEventListener('resize', u, { passive: true });
      visualViewport?.addEventListener('scroll', u, { passive: true });
      // a scrollbar that appears or goes changes clientWidth without a resize event
      const ro = new ResizeObserver(u);
      ro.observe(document.documentElement);
      this.stop = () => {
        removeEventListener('resize', u);
        removeEventListener('orientationchange', u);
        visualViewport?.removeEventListener('resize', u);
        visualViewport?.removeEventListener('scroll', u);
        ro.disconnect();
      };
    }
    return () => {
      if (--this.watching === 0) {
        this.stop?.();
        this.stop = null;
      }
    };
  }
}

export const viewport = new Viewport();

/**
 * How far a box must move to sit inside the visible area, EDGE px from each side. A box larger
 * than the area keeps its top left corner on screen, where its close and grip controls are.
 */
export function shiftInto(r: { left: number; top: number; right: number; bottom: number }, area: Box = viewport.box, m = EDGE): { x: number; y: number } {
  const minX = area.x + m;
  const maxX = area.x + area.w - m;
  const minY = area.y + m;
  const maxY = area.y + area.h - m;
  let x = 0;
  let y = 0;
  if (r.right - r.left > maxX - minX || r.left < minX) x = minX - r.left;
  else if (r.right > maxX) x = maxX - r.right;
  if (r.bottom - r.top > maxY - minY || r.top < minY) y = minY - r.top;
  else if (r.bottom > maxY) y = maxY - r.bottom;
  return { x, y };
}

/**
 * Svelte action: keeps an element (position: fixed) fully inside the visible area by moving it
 * with the CSS `translate` property, re-checked when the viewport or the element's size changes.
 * The parameter is any value whose change means "the element moved, check again".
 */
export function fitIn(node: HTMLElement, _key?: unknown) {
  let shift = { x: 0, y: 0 };
  let frame = 0;
  const run = () => {
    frame = 0;
    if (!node.isConnected) return;
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) return;
    // where it would be without our shift
    const base = { left: r.left - shift.x, top: r.top - shift.y, right: r.right - shift.x, bottom: r.bottom - shift.y };
    const next = shiftInto(base);
    if (next.x === shift.x && next.y === shift.y) return;
    shift = next;
    node.style.translate = shift.x || shift.y ? `${Math.round(shift.x)}px ${Math.round(shift.y)}px` : '';
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(run);
  };
  const stopWatch = viewport.watch();
  const ro = new ResizeObserver(schedule);
  ro.observe(node);
  const off = $effect.root(() => {
    $effect(() => {
      void viewport.box;
      schedule();
    });
  });
  run();
  return {
    update() {
      schedule();
    },
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      off();
      stopWatch();
    },
  };
}
