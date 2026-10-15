// MAIN world entry, run at document_start. Installs the page hooks and relays events
// to the isolated world over the private MessageChannel.
import { createEmitter, documentToken, type CaptureEvent } from '@toolbar/shared/events';
import { createMainBridge } from './bridge.ts';
import { DEFAULT_HOOKS } from './hooks/index.ts';
import { navCause } from './hooks/history.ts';
import { learnOwnFile } from './hooks/util.ts';
import { installMetadata } from './metadata.ts';
import { installLocatorMain } from './locator-main.ts';
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

/** Frame context id: "top" for the top document, a random "f…" id for each frame. */
export function frameCtx(win: Window): string {
  try {
    if (win.top === win) return 'top';
  } catch {
    /* cross-origin top */
  }
  return `f${Math.random().toString(36).slice(2, 7)}`;
}

export function startMainWorld(opts: StartMainOptions = {}) {
  const win = opts.win ?? (window as Window & typeof globalThis);
  const existing = (win as unknown as Record<symbol, MainBoot | undefined>)[BOOT_MARKER];
  if (existing) return { boot: existing, stop: () => {} };
  try {
    learnOwnFile();
  } catch {
    /* ignore */
  }

  const ctx = opts.ctx ?? frameCtx(win);
  let post = opts.post;
  if (!post) {
    const bridge = createMainBridge(win);
    post = (e) => bridge.post(e);
    try {
      installMetadata(win, bridge);
    } catch {
      /* optional */
    }
    try {
      installLocatorMain(win, bridge);
    } catch {
      /* optional */
    }
  }
  const send = post;
  const make = createEmitter(ctx, undefined, documentToken());
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

  // First event of every document: where we are and why it loaded. Also proves the bridge end to end.
  if (win.location)
    emit('nav', {
      type: 'load',
      url: win.location.href,
      ...(win.document.title ? { title: win.document.title } : {}),
      ...(win.performance ? { cause: navCause(win) } : {}),
      ...(win.document.referrer ? { from: win.document.referrer } : {}),
    });

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
