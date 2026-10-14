// MAIN world entry, run at document_start. Installs the page hooks and relays events
// to the isolated world over the private MessageChannel.
import { createEmitter, type CaptureEvent } from '@toolbar/shared';
import { createMainBridge } from './bridge.ts';
import { DEFAULT_HOOKS } from './hooks/index.ts';
import type { Emit, HookInstaller, Uninstall } from './transport.ts';

/** Marker on window, non-enumerable, so tests can tell that the hooks ran. */
export const BOOT_MARKER = Symbol.for('toolbar.capture.main');

export interface MainBoot {
  ctx: string;
  t: number;
  readyState: DocumentReadyState;
  hooks: string[];
  failed: string[];
}

export interface StartMainOptions {
  ctx?: string;
  hooks?: Record<string, HookInstaller>;
  /** Override for tests; defaults to the MessageChannel bridge. */
  post?: (e: CaptureEvent) => void;
  win?: Window & typeof globalThis;
}

export function startMainWorld(opts: StartMainOptions = {}) {
  const win = opts.win ?? (window as Window & typeof globalThis);
  const existing = (win as unknown as Record<symbol, MainBoot | undefined>)[BOOT_MARKER];
  if (existing) return { boot: existing, stop: () => {} };

  const ctx = opts.ctx ?? (win.top === win ? 'top' : 'frame');
  let post = opts.post;
  if (!post) {
    const bridge = createMainBridge(win);
    post = (e) => bridge.post(e);
  }
  const send = post;
  const make = createEmitter(ctx);
  const emit: Emit = (kind, data) => send(make(kind, data as never) as CaptureEvent);

  const hooks = opts.hooks ?? DEFAULT_HOOKS;
  const installed: string[] = [];
  const failed: string[] = [];
  const undo: Uninstall[] = [];
  for (const [name, install] of Object.entries(hooks)) {
    try {
      undo.push(install(emit, win));
      installed.push(name);
    } catch {
      failed.push(name);
    }
  }

  const boot: MainBoot = { ctx, t: Date.now(), readyState: win.document.readyState, hooks: installed, failed };
  Object.defineProperty(win, BOOT_MARKER, { value: boot, enumerable: false, configurable: true });
  return {
    boot,
    stop() {
      for (const u of undo.reverse()) u();
      delete (win as unknown as Record<symbol, unknown>)[BOOT_MARKER];
    },
  };
}
