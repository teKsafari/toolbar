// Stub. The capture area agent fills this in: wraps fetch, XMLHttpRequest, navigator.sendBeacon (net.req/net.res/net.fail, bodies from clone()).
// Rules: keep toString and property shapes, never block the page, never throw into page code.
import type { HookInstaller } from '../transport.ts';

export const installNetworkHook: HookInstaller = (_emit, _win) => {
  return () => {};
};
