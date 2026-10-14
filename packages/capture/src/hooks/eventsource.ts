// Stub. The capture area agent fills this in: wraps EventSource (sse events).
// Rules: keep toString and property shapes, never block the page, never throw into page code.
import type { HookInstaller } from '../transport.ts';

export const installEventSourceHook: HookInstaller = (_emit, _win) => {
  return () => {};
};
