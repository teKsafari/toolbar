// Registers the two capture content scripts at runtime (architecture section 10). Part 2: in the
// strict mode (D-126) the matches are the project origins the user granted; in `all` mode (D-200)
// every http(s) site once Chrome granted them, less the server and the blocked sites
// (lib/scope.ts). No script runs anywhere else; test builds in Part 1 mode pass <all_urls>.
import { browser } from 'wxt/browser';
import { excludesOf, inScope, patternsOf, scope } from './scope';

export const CAPTURE_SCRIPTS = [
  { id: 'capture-main', js: ['content-scripts/capture-main.js'], world: 'MAIN' as const },
  { id: 'capture', js: ['content-scripts/capture.js'], world: 'ISOLATED' as const },
];

export async function registerCaptureScripts(matches: string[], excludeMatches: string[] = []) {
  const existing = new Set((await browser.scripting.getRegisteredContentScripts()).map((s) => s.id));
  if (!matches.length) {
    const ids = CAPTURE_SCRIPTS.map((s) => s.id).filter((id) => existing.has(id));
    if (ids.length) await browser.scripting.unregisterContentScripts({ ids });
    return browser.scripting.getRegisteredContentScripts();
  }
  const scripts = CAPTURE_SCRIPTS.map((s) => ({
    ...s,
    matches,
    excludeMatches,
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
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab || !inScope(await scope(), tab.url)) return false; // D-126, D-200: never outside the scope
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

/** On install, update or a new grant: give every open tab in scope the capture scripts (see ensureContent). */
export async function injectIntoOpenTabs() {
  const s = await scope();
  const tabs = (await browser.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => [])).filter((t) => inScope(s, t.url));
  await Promise.all(tabs.map((t) => (t.id != null && !t.discarded ? ensureContent(t.id) : Promise.resolve(false))));
}

let last = '';
let chain: Promise<unknown> = Promise.resolve();

/**
 * Registers the capture scripts for the current scope, and on a change injects them into the
 * open tabs that just came into scope. Serialized: storage and permission events arrive in bursts.
 */
export function syncRegistration(): Promise<string[]> {
  const run = chain.then(async () => {
    const s = await scope();
    const patterns = patternsOf(s);
    const excludes = excludesOf(s);
    const key = `${patterns.join(' ')}|${excludes.join(' ')}`;
    await registerCaptureScripts(patterns, excludes);
    if (key !== last) {
      const [lastPatterns = '', lastExcludes = ''] = last.split('|');
      const grew = patterns.some((p) => !lastPatterns.split(' ').includes(p)) || lastExcludes.split(' ').some((x) => x && !excludes.includes(x));
      last = key;
      if (grew) await injectIntoOpenTabs().catch(() => undefined);
    }
    return patterns;
  });
  chain = run.catch(() => undefined);
  return run;
}
