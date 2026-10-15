// User events from the isolated world (J-067, J-068, J-069, J-187, J-190): clicks, double and
// right clicks, committed input values (one row per field), special keys and chords, scroll,
// text selection, resize and tab visibility. Better than the reference: scrolls and clicks in
// iframes are kept. Only trusted events count; events inside the toolbar UI are ignored.
import type { MaskingPreset, UserEvent } from '@toolbar/shared';
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import { scrubText, typedValue } from '@toolbar/shared/redact';
import { describeNode } from './target.ts';

export interface UserEventOptions {
  emit: (e: UserEvent) => void;
  /** Called when the page is about to go away, so batches are flushed now. */
  onHide?: () => void;
  frame?: string;
  win?: Window & typeof globalThis;
}

export interface UserEventRecorder {
  setEnabled(on: boolean): void;
  setPreset(p: MaskingPreset): void;
  /** Commits values of fields typed in but not yet changed (at capture time). */
  flushInputs(): void;
  stop(): void;
}

const SPECIAL_KEYS = new Set(['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12']);

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;

export function recordUserEvents(opts: UserEventOptions): UserEventRecorder {
  const win = opts.win ?? (window as Window & typeof globalThis);
  const doc = win.document;
  let enabled = true;
  let preset: MaskingPreset = 'staging';
  const dirty = new Set<Field>();
  const describe = (n: Node | null) => describeNode(n, { preset, frame: opts.frame });

  const fromOurUi = (e: Event) => e.composedPath().some((n) => (n as Element).tagName?.toLowerCase?.() === UI_HOST_TAG);
  const ok = (e: Event) => enabled && e.isTrusted && !fromOurUi(e);
  const targetOf = (e: Event) => (e.composedPath()[0] as Node | undefined) ?? (e.target as Node | null);

  const mods = (e: MouseEvent | KeyboardEvent): UserEvent['mods'] => {
    const m: NonNullable<UserEvent['mods']> = [];
    if (e.ctrlKey) m.push('ctrl');
    if (e.shiftKey) m.push('shift');
    if (e.altKey) m.push('alt');
    if (e.metaKey) m.push('meta');
    return m.length ? m : undefined;
  };

  const onMouse = (type: 'click' | 'dblclick' | 'contextmenu') => (e: MouseEvent) => {
    if (!ok(e)) return;
    const target = describe(targetOf(e));
    opts.emit({ type, ...(target ? { target } : {}), x: Math.round(e.clientX), y: Math.round(e.clientY), ...(mods(e) ? { mods: mods(e) } : {}) });
  };

  const fieldValue = (el: Field): string => {
    if (el instanceof win.HTMLSelectElement) return Array.from(el.selectedOptions, (o) => o.label || o.value).join(', ');
    if (el instanceof win.HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? 'checked' : 'unchecked';
      if (el.type === 'file') return Array.from(el.files ?? [], (f) => f.name).join(', ');
      return el.value;
    }
    if (el instanceof win.HTMLTextAreaElement) return el.value;
    return (el as HTMLElement).innerText ?? '';
  };

  const commit = (el: Field) => {
    dirty.delete(el);
    if (!enabled) return;
    const raw = fieldValue(el);
    const info = { tag: el.tagName.toLowerCase(), type: el.getAttribute('type') ?? undefined, name: el.getAttribute('name') ?? undefined, id: el.id || undefined, autocomplete: el.getAttribute('autocomplete') ?? undefined };
    const { value, masked } = el.isContentEditable ? { value: scrubText(raw).slice(0, 2000), masked: false } : typedValue(raw.slice(0, 2000), info, preset);
    const target = describe(el);
    opts.emit({ type: 'input', ...(target ? { target } : {}), value, ...(masked ? { masked: true } : {}) });
  };

  const isField = (n: unknown): n is Field => {
    const el = n as HTMLElement;
    return !!el && (el instanceof win.HTMLInputElement || el instanceof win.HTMLTextAreaElement || el instanceof win.HTMLSelectElement || el.isContentEditable === true);
  };

  const onInput = (e: Event) => {
    if (!ok(e)) return;
    const t = targetOf(e);
    if (!isField(t)) return;
    const el = (t as HTMLElement).isContentEditable ? ((t as HTMLElement).closest('[contenteditable]') as HTMLElement) ?? (t as HTMLElement) : (t as Field);
    // Checkboxes, radios, selects and files commit at once; text commits on change or blur.
    if (el instanceof win.HTMLSelectElement || (el instanceof win.HTMLInputElement && ['checkbox', 'radio', 'file', 'range', 'color', 'date', 'time'].includes(el.type))) return;
    dirty.add(el);
  };
  const onChange = (e: Event) => {
    if (!ok(e)) return;
    const t = targetOf(e);
    if (isField(t)) commit(t as Field);
  };
  const onBlur = (e: FocusEvent) => {
    const t = targetOf(e);
    if (t && dirty.has(t as Field) && (t as HTMLElement).isContentEditable) commit(t as Field);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!ok(e) || e.repeat) return;
    const m = mods(e);
    const chord = !!m && m.some((x) => x !== 'shift');
    if (!SPECIAL_KEYS.has(e.key) && !chord) return;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    const t = targetOf(e);
    // Enter in a dirty text field commits it first, so the value row precedes the key row.
    if (e.key === 'Enter' && t && dirty.has(t as Field)) commit(t as Field);
    const target = describe(t);
    opts.emit({ type: 'key', key: e.key.length === 1 ? e.key.toUpperCase() : e.key, ...(m ? { mods: m } : {}), ...(target ? { target } : {}) });
  };

  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollTarget: EventTarget | null = null;
  const onScroll = (e: Event) => {
    if (!enabled || fromOurUi(e)) return;
    scrollTarget = e.target;
    if (scrollTimer) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      const t = scrollTarget;
      if (!t) return;
      if (t === doc || t === doc.documentElement || t === doc.scrollingElement) {
        opts.emit({ type: 'scroll', scroll: { x: Math.round(win.scrollX), y: Math.round(win.scrollY) } });
      } else {
        const el = t as Element;
        const target = describe(el);
        opts.emit({ type: 'scroll', ...(target ? { target } : {}), scroll: { x: Math.round(el.scrollLeft), y: Math.round(el.scrollTop) } });
      }
    }, 400);
  };

  let lastSel = '';
  const onSelectEnd = (e: Event) => {
    if (!ok(e)) return;
    const sel = win.getSelection?.();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    if (!text || text === lastSel) return;
    lastSel = text;
    const anchor = sel?.anchorNode ?? null;
    const t = anchor && isField((anchor as Element).nodeType === 1 ? anchor : anchor.parentElement) ? null : describe(anchor);
    opts.emit({ type: 'select', value: scrubText(text.slice(0, 200)), ...(t ? { target: t } : {}) });
  };

  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  const onResize = () => {
    if (!enabled || resizeTimer) return;
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      opts.emit({ type: 'resize', value: `${win.innerWidth}x${win.innerHeight}`, x: win.innerWidth, y: win.innerHeight });
    }, 300);
  };

  // Tab visibility is a fact about the tab, so only the top document reports it: a frame that
  // unloads on a SPA change, or a page that unloads on a navigation, is not the tab going hidden
  // (G3 bug 7, J-190).
  const reportsVisibility = !opts.frame || opts.frame === 'top';
  let visible = doc.visibilityState !== 'hidden';
  const onVisibility = () => {
    const v = doc.visibilityState !== 'hidden';
    if (v === visible) return;
    visible = v;
    if (!v) for (const el of [...dirty]) commit(el);
    if (reportsVisibility) opts.emit({ type: 'visibility', visible: v });
    if (!v) opts.onHide?.();
  };
  const onPageHide = () => {
    for (const el of [...dirty]) commit(el);
    visible = false;
    opts.onHide?.();
  };

  const listeners: [EventTarget, string, EventListener, boolean | AddEventListenerOptions][] = [
    [doc, 'click', onMouse('click') as EventListener, true],
    [doc, 'dblclick', onMouse('dblclick') as EventListener, true],
    [doc, 'contextmenu', onMouse('contextmenu') as EventListener, true],
    [doc, 'input', onInput, true],
    [doc, 'change', onChange, true],
    [doc, 'focusout', onBlur as EventListener, true],
    [doc, 'keydown', onKey as EventListener, true],
    [doc, 'scroll', onScroll, { capture: true, passive: true }],
    [doc, 'mouseup', onSelectEnd, true],
    [doc, 'keyup', ((e: KeyboardEvent) => e.shiftKey && onSelectEnd(e)) as EventListener, true],
    [win, 'resize', onResize, { passive: true }],
    [doc, 'visibilitychange', onVisibility, true],
    [win, 'pagehide', onPageHide, true],
  ];
  for (const [t, type, fn, o] of listeners) t.addEventListener(type, fn, o);

  return {
    setEnabled(on) {
      enabled = on;
    },
    setPreset(p) {
      preset = p;
    },
    flushInputs() {
      for (const el of [...dirty]) commit(el);
    },
    stop() {
      for (const [t, type, fn, o] of listeners) t.removeEventListener(type, fn, o);
    },
  };
}
