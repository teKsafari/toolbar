// Toast queue. Ergonomics: toasts slide in bottom-right, a spinner state can turn into a
// success state in place (create-link flow), and they leave after about 4 s.
export type ToastKind = 'info' | 'success' | 'error' | 'loading';
export interface ToastAction {
  label: string;
  run: () => void;
}
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  /** ms; 0 keeps it until dismissed. Loading toasts default to 0. */
  duration: number;
}

let next = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

class Toasts {
  items: Toast[] = $state([]);

  show(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}): number {
    const kind = opts.kind ?? 'info';
    const t: Toast = { id: next++, kind, message, action: opts.action, duration: opts.duration ?? (kind === 'loading' ? 0 : 4000) };
    this.items.push(t);
    this.arm(t);
    return t.id;
  }
  success(message: string, opts: Partial<Omit<Toast, 'id' | 'message' | 'kind'>> = {}) {
    return this.show(message, { ...opts, kind: 'success' });
  }
  error(message: string, opts: Partial<Omit<Toast, 'id' | 'message' | 'kind'>> = {}) {
    return this.show(message, { ...opts, kind: 'error', duration: opts.duration ?? 6000 });
  }
  loading(message: string) {
    return this.show(message, { kind: 'loading' });
  }
  /** Change a toast in place, e.g. loading -> success. */
  update(id: number, patch: Partial<Omit<Toast, 'id'>>) {
    const t = this.items.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    if (patch.kind && patch.kind !== 'loading' && patch.duration === undefined) t.duration = 4000;
    this.arm(t);
  }
  dismiss(id: number) {
    clearTimeout(timers.get(id));
    timers.delete(id);
    this.items = this.items.filter((x) => x.id !== id);
  }
  clear() {
    for (const t of this.items) clearTimeout(timers.get(t.id));
    timers.clear();
    this.items = [];
  }
  private arm(t: Toast) {
    clearTimeout(timers.get(t.id));
    if (t.duration > 0) timers.set(t.id, setTimeout(() => this.dismiss(t.id), t.duration));
  }
}

export const toasts = new Toasts();
