// Stub. The capture area agent fills this in: wraps WebSocket (ws events).
// Rules: keep toString and property shapes, never block the page, never throw into page code.
import type { HookInstaller } from '../transport.ts';

export const installWebSocketHook: HookInstaller = (_emit, _win) => {
  return () => {};
};
