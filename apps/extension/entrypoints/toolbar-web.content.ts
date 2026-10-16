// Isolated world, top frame of every page; does nothing unless the page is this extension's
// server. There it marks <html data-tb-extension> so the web app knows the extension is
// installed, and turns the dashboard's new-capture event into a worker request (J-018).
import { browser } from 'wxt/browser';
import { EXTENSION_MARK_ATTR, NEW_CAPTURE_EVENT } from '@toolbar/shared/areas/dashboard-ext';
import { serverUrl } from '../lib/server-url';

async function serverOrigin(): Promise<string | null> {
  try {
    return new URL(await serverUrl()).origin;
  } catch {
    return null;
  }
}

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  async main() {
    if ((await serverOrigin()) !== location.origin) return;
    document.documentElement.setAttribute(EXTENSION_MARK_ATTR, browser.runtime.getManifest().version);
    window.addEventListener(NEW_CAPTURE_EVENT, () => {
      browser.runtime.sendMessage({ type: 'dashboard.newCapture', from: 'dashboard' }).catch(() => {
        /* worker asleep or reloading; the next click retries */
      });
    });
  },
});
