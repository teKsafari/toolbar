// The extension's ReviewPlatform (D-212): the reviewer toolbar's requests go to the service worker
// (lib/bg/review.ts, bg/locator.ts, bg/trace.ts), its settings to chrome.storage.local, and the
// success toast's Open to a tab next to the reviewer's. Crops come from captureVisibleTab.
import { browser } from 'wxt/browser';
import type { ReviewPlatform } from '@toolbar/review/platform';
import { send } from '../entrypoints/capture.content/ui/send';

export const extensionPlatform: ReviewPlatform = {
  // the reviewer's requests are BgRequestMap entries of the same names, with narrower results
  request: (type, req) => send(type, req) as never,
  storage: {
    async get<T>(key: string) {
      return (await browser.storage.local.get(key))[key] as T | undefined;
    },
    async set(key, value) {
      await browser.storage.local.set({ [key]: value });
    },
    onChange(key, fn) {
      const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area === 'local' && changes[key]) fn(changes[key].newValue);
      };
      browser.storage.onChanged.addListener(listener);
      return () => browser.storage.onChanged.removeListener(listener);
    },
  },
  assetUrl: (file) => (browser.runtime.getURL as (path: string) => string)(`/fonts/${file}`),
  openCapture: (result) => void send('tab.open', { url: result.url }),
  caps: { canScreenshot: true },
};
