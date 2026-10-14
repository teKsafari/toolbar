// Service-worker handler for the dashboard's request in BgRequestMap: dashboard.newCapture
// (J-018). background.ts registers it with one line: registerDashboard().
import { browser } from 'wxt/browser';
import type { BgResult, BgRequest } from '@toolbar/shared/ext';
import { TEST_HOOKS } from '../flags';

const seen: { at: number; tabId: number | null; opened: boolean; error: string | null }[] = [];

async function openCaptureMenu(windowId: number | undefined): Promise<void> {
  // chrome.action.openPopup works without a toolbar click from Chrome 127; it needs the
  // window to be focused, which it is right after the click on the page.
  await browser.action.openPopup(windowId === undefined ? undefined : { windowId });
}

export function registerDashboard() {
  browser.runtime.onMessage.addListener(((msg: BgRequest, sender: { tab?: { id?: number; windowId?: number } }, reply: (r: BgResult<'dashboard.newCapture'>) => void) => {
    if (msg?.type !== 'dashboard.newCapture') return false;
    const entry = { at: Date.now(), tabId: sender.tab?.id ?? null, opened: false, error: null as string | null };
    if (TEST_HOOKS) seen.push(entry);
    openCaptureMenu(sender.tab?.windowId).then(
      () => {
        entry.opened = true;
        reply({ ok: true, opened: 'popup' });
      },
      (e: unknown) => {
        entry.error = (e as Error)?.message ?? String(e);
        reply({ ok: false, error: 'server', message: entry.error });
      },
    );
    return true;
  }) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

  if (TEST_HOOKS) (globalThis as unknown as { __tbDashboard: unknown }).__tbDashboard = { newCaptures: () => seen.slice() };
}
