// Live element blur during a recording (J-031, J-036). The blur is a CSS filter on the page
// element itself, so it shows in the tab video and in the DOM record. Undo pops the last toggle;
// clear() puts every element back when the recording ends.

const BLUR = 'blur(10px)';
const ATTR = 'data-tb-blurred';

interface Saved {
  el: HTMLElement;
  value: string;
  priority: string;
}

const blurred = new Map<HTMLElement, Saved>();
const history: { el: HTMLElement; op: 'blur' | 'unblur' }[] = [];

export function isBlurred(el: Element): boolean {
  return blurred.has(el as HTMLElement);
}

function apply(el: HTMLElement) {
  blurred.set(el, { el, value: el.style.getPropertyValue('filter'), priority: el.style.getPropertyPriority('filter') });
  el.style.setProperty('filter', BLUR, 'important');
  el.setAttribute(ATTR, '');
}

function restore(el: HTMLElement) {
  const saved = blurred.get(el);
  if (!saved) return;
  if (saved.value) el.style.setProperty('filter', saved.value, saved.priority);
  else el.style.removeProperty('filter');
  el.removeAttribute(ATTR);
  blurred.delete(el);
}

/** Toggle one element. Returns the new state. */
export function toggle(el: HTMLElement): boolean {
  if (blurred.has(el)) {
    restore(el);
    history.push({ el, op: 'unblur' });
    return false;
  }
  apply(el);
  history.push({ el, op: 'blur' });
  return true;
}

export function undo(): boolean {
  const last = history.pop();
  if (!last) return false;
  if (last.op === 'blur') restore(last.el);
  else apply(last.el);
  return true;
}

export function canUndo(): boolean {
  return history.length > 0;
}

export function count(): number {
  return blurred.size;
}

export function clear() {
  for (const el of [...blurred.keys()]) restore(el);
  history.length = 0;
}

/** The page element a blur click should hit: never the document roots or our own host. */
export function blurTarget(target: EventTarget | null, host: Element | null): HTMLElement | null {
  if (!(target instanceof HTMLElement) && !(target instanceof SVGElement)) return null;
  if (target === host || target === document.documentElement || target === document.body) return null;
  // inside an <svg>, blur the whole drawing rather than one path
  const el = target instanceof SVGElement ? (target.ownerSVGElement ?? target) : target;
  return el as unknown as HTMLElement;
}
