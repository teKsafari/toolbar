// Stub. The capture area agent fills this in: wraps error, unhandledrejection, securitypolicyviolation (error events).
// Rules: keep toString and property shapes, never block the page, never throw into page code.
import type { HookInstaller } from '../transport.ts';

export const installErrorsHook: HookInstaller = (_emit, _win) => {
  return () => {};
};
