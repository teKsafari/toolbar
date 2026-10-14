import type { HookInstaller } from '../transport.ts';
import { installConsoleHook } from './console.ts';
import { installNetworkHook } from './network.ts';
import { installWebSocketHook } from './websocket.ts';
import { installEventSourceHook } from './eventsource.ts';
import { installErrorsHook } from './errors.ts';
import { installHistoryHook } from './history.ts';

export {
  installConsoleHook,
  installNetworkHook,
  installWebSocketHook,
  installEventSourceHook,
  installErrorsHook,
  installHistoryHook,
};

/** Install order matters: errors first so a failing installer is still reported. */
export const DEFAULT_HOOKS: Record<string, HookInstaller> = {
  errors: installErrorsHook,
  console: installConsoleHook,
  network: installNetworkHook,
  websocket: installWebSocketHook,
  eventsource: installEventSourceHook,
  history: installHistoryHook,
};
