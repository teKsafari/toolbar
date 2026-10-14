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
