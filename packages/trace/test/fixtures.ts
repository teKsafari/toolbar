// Fixture event streams for the span engine, shaped like the lab app's buttons.
import type { CaptureEvent, EventDataMap, EventKind, TargetRef } from '@toolbar/shared';

export class Stream {
  readonly events: CaptureEvent[] = [];
  private seq = new Map<string, number>();
  private rid = 0;

  add<K extends EventKind>(t: number, kind: K, data: EventDataMap[K], ctx = defaultCtx(kind)): this {
    const s = this.seq.get(ctx) ?? 0;
    this.seq.set(ctx, s + 1);
    this.events.push({ v: 1, id: `${ctx}:${s}`, ctx, seq: s, t, kind, data } as CaptureEvent);
    return this;
  }

  click(t: number, target: Partial<TargetRef> = {}) {
    return this.add(t, 'user', { type: 'click', target: button(target) });
  }

  /** A request with its response (status) at `end`, or pending when `end` is null. */
  request(t: number, method: string, url: string, end: number | null, status = 200, extra: Partial<EventDataMap['net.req']> = {}) {
    const rid = `r${++this.rid}`;
    this.add(t, 'net.req', { rid, method, url, source: 'page', initiator: 'fetch', ...extra });
    if (end !== null) this.add(end, 'net.res', { rid, status, source: 'page' });
    return this;
  }

  dom(t: number, d: Partial<EventDataMap['dom']> = {}) {
    return this.add(t, 'dom', { added: 0, removed: 0, attrs: 0, text: 1, rects: [{ x: 10, y: 10, w: 100, h: 20 }], ...d });
  }
}

function defaultCtx(kind: EventKind): string {
  return kind === 'user' || kind === 'dom' || kind === 'env' || kind === 'canvas.sample' ? 'top-i' : 'top';
}

export function button(t: Partial<TargetRef> = {}): TargetRef {
  return { selector: 'button[data-testid="x"]', tag: 'button', role: 'button', name: 'Button', rect: { x: 0, y: 0, w: 80, h: 24 }, ...t };
}

export const SAVE = button({ selector: 'button[data-testid="works"]', name: 'Save (works)', testId: 'works' });
export const EXPORT = button({ selector: 'button[data-testid="dead"]', name: 'Export (does nothing)', testId: 'dead' });
export const SYNC = button({ selector: 'button[data-testid="hangs"]', name: 'Sync (never returns)', testId: 'hangs' });
export const SUBMIT = button({ selector: 'button[data-testid="hidden-500"]', name: 'Submit order (hidden 500)', testId: 'hidden-500' });
export const PROFILE = button({ selector: 'button[data-testid="throws"]', name: 'Show profile (throws)', testId: 'throws' });
export const REDRAW = button({ selector: 'button[data-testid="redraw"]', name: 'Run again (redraws the canvas only)', testId: 'redraw' });
