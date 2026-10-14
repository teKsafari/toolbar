// ISOLATED world, document_start, all frames. Bridges page events to the service worker
// and, in the top frame, mounts the toolbar host <toolbar-root> in a shadow root.
import { mount, unmount } from 'svelte';
import { browser } from 'wxt/browser';
import { startIsolatedWorld, type Transport, type Command } from '@toolbar/capture';
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import { CAPTURE_PORT, type PortMessage } from '../../lib/messages';
import { SHADOW_MODE } from '../../lib/flags';
import Toolbar from './Toolbar.svelte';
import './style.css';

/** chrome.runtime port transport; reconnects when the service worker restarts. */
function portTransport(): Transport {
  let port: ReturnType<typeof browser.runtime.connect> | null = null;
  const handlers: ((c: Command) => void)[] = [];
  const connect = () => {
    port = browser.runtime.connect({ name: CAPTURE_PORT });
    port.onMessage.addListener((c: Command) => handlers.forEach((h) => h(c)));
    port.onDisconnect.addListener(() => {
      port = null;
    });
    port.postMessage({ type: 'hello', url: location.href, top: window.top === window } satisfies PortMessage);
  };
  return {
    send(batch) {
      if (!port) connect();
      try {
        port!.postMessage({ type: 'events', batch } satisfies PortMessage);
      } catch {
        connect();
        port!.postMessage({ type: 'events', batch } satisfies PortMessage);
      }
    },
    onCommand(fn) {
      handlers.push(fn);
    },
  };
}

/**
 * Shadow host reset (spikes S4). WXT adds `:host { all: initial !important }`; the host also
 * needs a fixed, zero-size box so the page cannot hide or move it and children can use
 * position: fixed against the viewport.
 */
const HOST_CSS = `:host {
  display: block !important; position: fixed !important; top: 0 !important; left: 0 !important;
  width: 0 !important; height: 0 !important; overflow: visible !important;
  z-index: 2147483647 !important; pointer-events: none !important;
}`;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_start',
  allFrames: true,
  registration: 'runtime',
  cssInjectionMode: 'ui',
  noScriptStartedPostMessage: true,
  async main(ctx) {
    startIsolatedWorld({ transport: portTransport() });
    if (window.top !== window) return;

    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
    const ui = await createShadowRootUi(ctx, {
      name: UI_HOST_TAG,
      mode: SHADOW_MODE,
      position: 'inline',
      anchor: 'html',
      append: 'last',
      css: HOST_CSS,
      isolateEvents: ['keydown', 'keyup', 'keypress'],
      onMount: (container) => mount(Toolbar, { target: container }),
      onRemove: (app) => app && unmount(app),
    });
    ui.mount();
  },
});
