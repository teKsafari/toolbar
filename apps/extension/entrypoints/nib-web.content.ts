// Isolated world, top frame of every page; does nothing unless the page is this extension's
// server. There it marks <html data-nib-extension> so the web app knows the extension is
// installed, and turns the dashboard's new-capture event into a worker request (J-018).
import { browser } from 'wxt/browser';
import { DEFAULT_SERVER_URL } from '@toolbar/shared/constants';
import type { STORAGE } from '@toolbar/shared/ext';
import { EXTENSION_MARK_ATTR, NEW_CAPTURE_EVENT } from '@toolbar/shared/areas/dashboard-ext';

// Typed against the storage contract; a value import would bundle zod into every page.
const SERVER_URL_KEY: (typeof STORAGE)['serverUrl']['key'] = 'nib:server-url';

async function serverOrigin(): Promise<string | null> {
  let override: unknown = null;
  try {
    override = (await browser.storage.local.get(SERVER_URL_KEY))[SERVER_URL_KEY];
  } catch {
    /* storage unavailable to content scripts: use the build's server */
  }
  const built = (import.meta.env as Record<string, string | undefined>).WXT_SERVER_URL;
  try {
    return new URL(String(override || built || DEFAULT_SERVER_URL)).origin;
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
