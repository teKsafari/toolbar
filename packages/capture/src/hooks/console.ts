// Stub. The capture area agent fills this in: wraps console.* (every level, args through serialize()).
// Rules: keep toString and property shapes, never block the page, never throw into page code.
import type { HookInstaller } from '../transport.ts';

export const installConsoleHook: HookInstaller = (_emit, _win) => {
  return () => {};
};
