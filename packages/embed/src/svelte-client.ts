// Svelte's client runtime with one change: component styles go to constructed style sheets in the
// toolbar's shadow root (css.ts) instead of <style> elements, which a strict CSP would block. The
// build resolves 'svelte/internal/client' to this module for every importer but this one.
// A local export takes precedence over the star export of the same name.
export * from 'svelte/internal/client';
import { registerCss } from './css.ts';

export function append_styles(_anchor: unknown, css: { hash: string; code: string }): void {
  registerCss(css.hash, css.code);
}
