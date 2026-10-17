// Event guard for the in-page tools (screenshot mode J-250, live pen J-030, live blur J-031).
// Listeners go on window in the capture phase when this module loads, at document_start,
// before any page script registers its own. While a handler is set, every pointer, mouse and
// touch event goes to the handler first; when it returns true the event is stopped there, so
// page listeners on window (registered later), document and every element never see it.
// Events over our own interactive UI (the bar's buttons) pass through untouched.

export type GuardHandler = (e: Event) => boolean;

const POINTER_TYPES = [
  'pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
  'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
  'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
  'dragstart', 'selectstart',
] as const;
const KEY_TYPES = ['keydown', 'keyup', 'keypress'] as const;
const CLICKISH = new Set(['click', 'dblclick', 'auxclick', 'mouseup', 'pointerup', 'contextmenu', 'touchend']);

let handler: GuardHandler | null = null;
let swallowUntil = 0;
/** swallow the rest of the current press: its pointerup, mouseup and click */
let swallowingPress = false;
let uiRoot: ShadowRoot | null = null;
let uiHost: Element | null = null;

export const guardStats = { swallowed: 0 };

/** The in-page UI root, so events over our own interactive elements can pass. */
export function setUiRoot(root: ShadowRoot | null) {
  uiRoot = root;
  uiHost = root?.host ?? null;
}

export function setGuard(h: GuardHandler | null) {
  handler = h;
}

/** Keep swallowing the click that trails a pointerup after a tool finished (J-250). */
export function swallowClicksFor(ms: number) {
  swallowUntil = performance.now() + ms;
}

/**
 * Swallow the rest of the press now going on (its pointerup, mouseup and click), whatever the
 * handler: a press that only dismissed one of our popups must not also pick an element.
 */
export function swallowPress() {
  swallowingPress = true;
}

/** True when the event lands on one of our elements marked data-nb-interactive. */
export function overOurUi(e: Event): boolean {
  if (!uiRoot || !uiHost) return false;
  const target = e.target as Node | null;
  if (target !== uiHost) return false;
  const p = e as MouseEvent;
  if (typeof p.clientX !== 'number') return false;
  const el = uiRoot.elementFromPoint(p.clientX, p.clientY);
  return !!el?.closest('[data-nb-interactive]');
}

function onPointer(e: Event) {
  if (swallowingPress && (e.type === 'pointerup' || e.type === 'pointercancel')) {
    swallowingPress = false;
    swallowClicksFor(80);
  }
  if (overOurUi(e)) return;
  const trailing = CLICKISH.has(e.type) && performance.now() < swallowUntil;
  if (!trailing && !(handler && handler(e))) return;
  guardStats.swallowed++;
  e.stopImmediatePropagation();
  if (e.cancelable) e.preventDefault();
}

function onKey(e: Event) {
  if (!handler) return;
  if (handler(e)) {
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  }
}

if (typeof window !== 'undefined') {
  for (const t of POINTER_TYPES) window.addEventListener(t, onPointer, { capture: true, passive: false });
  for (const t of KEY_TYPES) window.addEventListener(t, onKey, { capture: true });
}
