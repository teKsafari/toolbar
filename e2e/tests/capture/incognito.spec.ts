// Incognito windows and local files (J-021). The profile allows the extension in private
// windows and on file URLs (the two switches on chrome://extensions), written into its
// Preferences before launch.
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DISPLAY, EXT_DIR, EXT_ID } from '../../fixtures/extension.ts';
import { expect, signIn, sleep, svc, test } from './helpers.ts';
import { browserEnv } from '../../fixtures/browser-env.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

let ctx: BrowserContext;
let sw: Worker;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-e2e-private-'));
const file = path.join(dir, 'lab-page.html');

test.beforeAll(async () => {
  fs.mkdirSync(path.join(dir, 'profile', 'Default'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'profile', 'Default', 'Preferences'),
    JSON.stringify({ extensions: { pinned_extensions: [EXT_ID], settings: { [EXT_ID]: { incognito: true, newAllowFileAccess: true } } } }),
  );
  fs.writeFileSync(file, '<!doctype html><title>Local lab page</title><h1>Local file</h1><button id="b" onclick="console.warn(\'local click\')">Click</button>');
  ctx = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
    headless: false,
    env: browserEnv(DISPLAY),
    viewport: null,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, `--allowlisted-extension-id=${EXT_ID}`, '--window-size=1280,800', '--force-device-scale-factor=1'],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
});

test.afterAll(async () => {
  await ctx?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('screenshot of a local file and of a page in a private window (J-021)', async ({ mockServer }) => {
  await signIn(sw, mockServer.url);
  const access = await sw.evaluate(async () => ({ file: await chrome.extension.isAllowedFileSchemeAccess(), incognito: await chrome.extension.isAllowedIncognitoAccess() }));
  expect(access).toEqual({ file: true, incognito: true });

  const page = await ctx.newPage();
  await page.goto(`file://${file}`);
  await page.click('#b');
  await sleep(500);
  const fileTab = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id ?? -1, `file://${file}`);
  const d1 = await svc<{ id: string; pageUrl: string; incognito: boolean }>(sw, 'takeScreenshot', null, { tabId: fileTab, openEditor: false });
  expect(d1).toMatchObject({ pageUrl: `file://${file}`, incognito: false });
  await svc(sw, 'discardDraft', d1.id);

  // a private window, opened by the extension (Playwright's persistent context has no incognito pages)
  const tabId = await sw.evaluate(async () => {
    const w = await chrome.windows.create({ incognito: true, url: 'http://localhost:5173/', focused: true });
    return w.tabs[0].id as number;
  });
  await sleep(2500);
  const d2 = await svc<{ id: string; incognito: boolean; env: { incognito: boolean } | null }>(sw, 'takeScreenshot', null, { tabId, openEditor: false });
  expect(d2.incognito).toBe(true);
  expect(d2.env?.incognito).toBe(true);
  await svc(sw, 'discardDraft', d2.id);
  await page.close();
});
