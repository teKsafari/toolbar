// Custom metadata SDK (J-073), with no package to install: the page calls
//   window.toolbar.setMetadata(() => ({ plan: 'pro', userId: 7 }))
// The callback runs when a capture is made; its JSON must be
// at most 10 KB, larger objects are rejected.
import type { MainCommand, MainReply } from './bridge.ts';

export const METADATA_MAX_BYTES = 10 * 1024;

type Source = (() => unknown) | Record<string, unknown>;

export function evaluateMetadata(src: Source | null): { value?: Record<string, unknown> | null; error?: string } {
  if (!src) return { value: null };
  try {
    const v = typeof src === 'function' ? src() : src;
    if (v === null || v === undefined) return { value: null };
    if (typeof v !== 'object' || Array.isArray(v)) return { error: 'not_object' };
    const json = JSON.stringify(v);
    if (new TextEncoder().encode(json).length > METADATA_MAX_BYTES) return { error: 'too_large' };
    return { value: JSON.parse(json) as Record<string, unknown> };
  } catch (e) {
    return { error: `callback_failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Installs setMetadata in the MAIN world and answers metadata commands from the isolated world. */
export function installMetadata(win: Window & typeof globalThis, bridge: { onCommand(fn: (c: MainCommand) => void): void; post(m: unknown): void }) {
  let source: Source | null = null;
  const api = {
    setMetadata(fn: Source | null) {
      if (fn !== null && typeof fn !== 'function' && typeof fn !== 'object') throw new TypeError('setMetadata expects a function or an object');
      source = fn;
    },
  };
  const define = (target: object | null | undefined) => {
    if (!target) return;
    try {
      Object.defineProperty(target, 'setMetadata', { value: api.setMetadata, enumerable: false, configurable: true, writable: true });
    } catch {
      /* frozen */
    }
  };
  try {
    define((win as unknown as { toolbar?: object }).toolbar);
  } catch {
    /* no BarProp */
  }
  bridge.onCommand((c) => {
    if (c.cmd !== 'metadata') return;
    bridge.post({ reply: 'metadata', id: c.id, ...evaluateMetadata(source) } satisfies MainReply);
  });
}
