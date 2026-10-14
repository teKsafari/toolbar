import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '@toolbar/shared';
import { BOOT_MARKER, DEFAULT_HOOKS, MemoryTransport, startMainWorld, type HookInstaller } from '../src/index.ts';

function fakeWin() {
  const w: Record<string | symbol, unknown> = { document: { readyState: 'loading' } };
  w.top = w;
  return w as unknown as Window & typeof globalThis;
}

describe('startMainWorld', () => {
  it('installs every hook once, stamps envelopes and marks boot', () => {
    const win = fakeWin();
    const out: CaptureEvent[] = [];
    let calls = 0;
    const probe: HookInstaller = (emit) => {
      calls++;
      emit('marker', { type: 'mark', label: 'probe' });
      return () => {};
    };
    const { boot, stop } = startMainWorld({ win, post: (e) => out.push(e), hooks: { probe } });
    expect(calls).toBe(1);
    expect(boot).toMatchObject({ ctx: 'top', readyState: 'loading', hooks: ['probe'], failed: [] });
    expect(out[0]).toMatchObject({ v: 1, id: 'top:0', kind: 'marker' });
    expect((win as unknown as Record<symbol, unknown>)[BOOT_MARKER]).toBe(boot);

    startMainWorld({ win, post: (e) => out.push(e), hooks: { probe } });
    expect(calls).toBe(1);
    stop();
    expect((win as unknown as Record<symbol, unknown>)[BOOT_MARKER]).toBeUndefined();
  });

  it('keeps going when one installer throws', () => {
    const bad: HookInstaller = () => {
      throw new Error('nope');
    };
    const { boot } = startMainWorld({ win: fakeWin(), post: () => {}, hooks: { bad, ...DEFAULT_HOOKS } });
    expect(boot.failed).toEqual(['bad']);
    expect(boot.hooks).toEqual(Object.keys(DEFAULT_HOOKS));
  });
});

describe('MemoryTransport', () => {
  it('collects batches and relays commands', () => {
    const t = new MemoryTransport();
    const seen: string[] = [];
    t.onCommand((c) => seen.push(c.type));
    t.send([]);
    t.command({ type: 'snapshot' });
    expect(seen).toEqual(['snapshot']);
  });
});

describe('boot event', () => {
  it('emits nav load first when the window has a location', () => {
    const w = { document: { readyState: 'loading', title: '' }, location: { href: 'http://localhost:5173/' } } as unknown as Window & typeof globalThis;
    (w as unknown as { top: unknown }).top = w;
    const out: CaptureEvent[] = [];
    startMainWorld({ win: w, post: (e) => out.push(e), hooks: {} });
    expect(out[0]).toMatchObject({ kind: 'nav', data: { type: 'load', url: 'http://localhost:5173/' } });
  });
});
