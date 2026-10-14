// Registers the two capture content scripts at runtime (architecture section 10).
// Part 1 passes <all_urls>; Part 2 passes the project origins after permissions.request().
import { browser } from 'wxt/browser';

export const CAPTURE_SCRIPTS = [
  { id: 'capture-main', js: ['content-scripts/capture-main.js'], world: 'MAIN' as const },
  { id: 'capture', js: ['content-scripts/capture.js'], world: 'ISOLATED' as const },
];

export async function registerCaptureScripts(matches: string[] = ['<all_urls>']) {
  const existing = new Set((await browser.scripting.getRegisteredContentScripts()).map((s) => s.id));
  const scripts = CAPTURE_SCRIPTS.map((s) => ({
    ...s,
    matches,
    runAt: 'document_start' as const,
    allFrames: true,
    persistAcrossSessions: true,
  }));
  const toUpdate = scripts.filter((s) => existing.has(s.id));
  const toAdd = scripts.filter((s) => !existing.has(s.id));
  if (toUpdate.length) await browser.scripting.updateContentScripts(toUpdate);
  if (toAdd.length) await browser.scripting.registerContentScripts(toAdd);
  return browser.scripting.getRegisteredContentScripts();
}

/** True when the tab's top frame runs our isolated script (it answers page.geometry). */
async function hasContent(tabId: number): Promise<boolean> {
  try {
    const r = (await browser.tabs.sendMessage(tabId, { type: 'page.geometry' }, { frameId: 0 })) as { viewport?: unknown } | undefined;
    return !!r?.viewport;
  } catch {
    return false;
  }
}

/**
 * Registered scripts run only in documents loaded after registration. A tab that was open
 * when the extension was installed, updated or reloaded has none (or an orphan from the old
 * version), so a capture there would arm with no in-page UI. Inject both worlds into the top
 * frame and wait for the isolated script to answer. A MAIN world left by an older version
 * keeps its hooks and hands the new isolated script a fresh port (architecture section 10).
 */
export async function ensureContent(tabId: number): Promise<boolean> {
  if (await hasContent(tabId)) return true;
  try {
    for (const s of CAPTURE_SCRIPTS) await browser.scripting.executeScript({ target: { tabId }, files: [s.world === 'MAIN' ? '/content-scripts/capture-main.js' : '/content-scripts/capture.js'], world: s.world, injectImmediately: true });
  } catch {
    return false; // restricted page, or the tab went away
  }
  for (let i = 0; i < 40; i++) {
    if (await hasContent(tabId)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/** On install or update: give every open web tab the capture scripts (see ensureContent). */
export async function injectIntoOpenTabs() {
  const tabs = await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  await Promise.all(tabs.map((t) => (t.id != null && !t.discarded ? ensureContent(t.id) : Promise.resolve(false))));
}
