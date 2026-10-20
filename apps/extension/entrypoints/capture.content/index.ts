// ISOLATED world, document_start, all frames. Bridges page events to the service worker
// and, in the top frame, mounts the toolbar host <toolbar-root> in a shadow root.
import { mount, unmount } from 'svelte';
import { browser } from 'wxt/browser';
import { startIsolatedWorld, type Transport, type Command, type IsolatedHandle } from '@toolbar/capture';
import { UI_HOST_TAG } from '@toolbar/shared/constants';
import { CAPTURE_PORT, type PortMessage, type PortCommand, type ContentCommand } from '../../lib/messages';
import type { PageGeometry } from '@toolbar/shared/ext';
import { SHADOW_MODE } from '../../lib/flags';
import { registerFonts } from '@toolbar/ui/fonts';
import { setPlatform } from '@toolbar/review/platform';
import { extensionPlatform } from '../../lib/review-platform';
import Toolbar from './Toolbar.svelte';
import { installEditorHost } from './editor/host';
import './style.css';

/**
 * chrome.runtime port transport; reconnects when the service worker restarts. Port commands
 * from the worker (attach, detach, ring, checkout, config) become Transport commands.
 */
/** Events posted on this frame's port; the worker waits for this many after a flush. */
let sentEvents = 0;
/** Removes this script's UI; set once the shadow root is mounted. */
let teardown: () => void = () => {};

/** The extension was reloaded or removed: this script is an orphan and its UI must go (J-218). */
function contextGone(): boolean {
  try {
    return !browser.runtime?.id;
  } catch {
    return true;
  }
}

function portTransport(): Transport {
  let port: ReturnType<typeof browser.runtime.connect> | null = null;
  const handlers: ((c: Command) => void)[] = [];
  const connect = () => {
    port = browser.runtime.connect({ name: CAPTURE_PORT });
    port.onMessage.addListener((c: PortCommand) => handlers.forEach((h) => h(c as Command)));
    port.onDisconnect.addListener(() => {
      port = null;
      if (contextGone()) {
        teardown();
        return;
      }
      // The worker restarted: reconnect so commands (ring, attach) resume.
      setTimeout(() => {
        if (contextGone()) return teardown();
        if (!port) {
          try {
            connect();
          } catch {
            /* extension context gone */
          }
        }
      }, 250);
    });
    port.postMessage({ type: 'hello', url: location.href, top: window.top === window, title: document.title || undefined, loadId: performance.timeOrigin } satisfies PortMessage);
  };
  const post = (m: PortMessage) => {
    if (m.type === 'events') sentEvents += m.batch.length;
    if (!port) connect();
    try {
      port!.postMessage(m);
    } catch {
      connect();
      port!.postMessage(m);
    }
  };
  connect();
  return {
    send(batch) {
      post({ type: 'events', batch });
    },
    sendRrweb(batch, full) {
      post({ type: 'rrweb', batch, full });
    },
    sendPageWeight(w) {
      post({ type: 'page-weight', nodes: w.nodes, mutationsPerSec: w.mutationsPerSec });
    },
    onCommand(fn) {
      handlers.push(fn);
    },
  };
}

/** Replies to the worker's capture commands (geometry, env, metadata, flush) from the top frame. */
function answerWorker(iso: IsolatedHandle, transport: Transport & { command?: (c: Command) => void }, flushAll: () => void) {
  browser.runtime.onMessage.addListener((msg: ContentCommand, _sender, reply) => {
    switch (msg?.type) {
      case 'page.geometry':
        reply({
          viewport: { w: window.innerWidth, h: window.innerHeight },
          scroll: { x: window.scrollX, y: window.scrollY },
          dpr: window.devicePixelRatio,
          url: location.href,
          title: document.title,
        } satisfies PageGeometry);
        return false;
      case 'capture.metadata':
        void iso.metadata().then(reply);
        return true;
      case 'capture.env':
        void iso.env().then(
          (env) => reply({ env }),
          () => reply({ env: null }),
        );
        return true;
      case 'locator.describe':
        // D-128: the page's part of a locator packet
        void iso.locate(msg.target).then(reply, (e: unknown) => reply({ error: e instanceof Error ? e.message : String(e) }));
        return true;
      case 'capture.flush':
        flushAll();
        reply({ ok: true, sent: sentEvents });
        return false;
      default:
        return false;
    }
  });
  void transport;
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
    const transport = portTransport();
    let commandAll: (c: Command) => void = () => {};
    const t: Transport = {
      send: (b) => transport.send(b),
      sendRrweb: (b, f) => transport.sendRrweb?.(b, f),
      sendPageWeight: (w) => transport.sendPageWeight?.(w),
      onCommand: (fn) => {
        transport.onCommand(fn);
        const prev = commandAll;
        commandAll = (c) => {
          prev(c);
          fn(c);
        };
      },
    };
    const iso = startIsolatedWorld({ transport: t, extVersion: browser.runtime.getManifest().version, awaitConfig: true });
    if (window.top !== window) return;
    answerWorker(iso, t, () => commandAll({ type: 'flush' }));

    if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r, { once: true }));
    const ui = await createShadowRootUi(ctx, {
      name: UI_HOST_TAG,
      mode: SHADOW_MODE,
      position: 'inline',
      anchor: 'html',
      append: 'last',
      css: HOST_CSS,
      isolateEvents: ['keydown', 'keyup', 'keypress'],
      onMount: (container) => {
        installEditorHost(container);
        setPlatform(extensionPlatform);
        return mount(Toolbar, { target: container });
      },
      onRemove: (app) => app && unmount(app),
    });
    ui.mount();
    // @font-face does not apply inside a shadow root: the bundled faces (D-175) go on the page's
    // document instead, from the extension's own files (fonts/, web-accessible). Under the tb-*
    // names they never replace a face of the page; if the page blocks them the fallback stack shows.
    registerFonts(document, extensionPlatform.assetUrl);
    teardown = () => {
      try {
        ui.remove();
      } catch {
        /* already gone */
      }
    };
    ctx.onInvalidated(teardown);
  },
});
