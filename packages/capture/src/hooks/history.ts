// Stub. The capture area agent fills this in: wraps history.pushState/replaceState, popstate, hashchange (nav events).
// Rules: keep toString and property shapes, never block the page, never throw into page code.
import type { HookInstaller } from '../transport.ts';

export const installHistoryHook: HookInstaller = (_emit, _win) => {
  return () => {};
};
