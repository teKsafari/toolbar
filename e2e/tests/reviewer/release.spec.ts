// The reviewer toolbar in the release build, whose shadow root is closed (spikes S4): typing in
// the composer must stay in the composer, even though a page-level key listener cannot see inside
// a closed root. Launches its own browser with apps/extension/.output/chrome-mv3; skips when that
// build is missing (pnpm --filter @toolbar/extension build).
import { chromium, expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DISPLAY, EXT_ID, LAB_URL } from '../../fixtures/extension.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const RELEASE = path.resolve(import.meta.dirname, '../../..', 'apps/extension/.output/chrome-mv3');

test('release build: keys typed in the composer stay there; single-key tools still work outside it', async () => {
  test.skip(!fs.existsSync(path.join(RELEASE, 'manifest.json')), 'no release build at apps/extension/.output/chrome-mv3');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-e2e-rel-'));
  const context = await chromium.launchPersistentContext(dir, {
    headless: false,
    env: { ...process.env, DISPLAY },
    viewport: null,
    args: [`--disable-extensions-except=${RELEASE}`, `--load-extension=${RELEASE}`, `--allowlisted-extension-id=${EXT_ID}`, '--window-size=1280,800', '--force-device-scale-factor=1'],
  });
  try {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    // the worker registers the content scripts at install; a page opened before that has none
    await expect.poll(() => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length), { timeout: 15_000 }).toBeGreaterThan(0);
    const page = await context.newPage();
    await page.goto(LAB_URL);
    await page.bringToFront();
    const closed = await page.locator('toolbar-root').evaluate((h) => h.shadowRoot === null, undefined, { timeout: 15_000 });
    expect(closed, 'the release build mounts a closed shadow root').toBe(true);
    await page.waitForTimeout(500);

    await page.keyboard.press('Control+Shift+Period'); // wake
    await page.keyboard.press('c');
    await page.getByTestId('works').hover();
    await page.getByTestId('works').click();
    await page.waitForTimeout(300);
    // letters that are tools (a, s, l, h, r, f, v, x) and spaces that would press the page's button
    await page.keyboard.type('a shaky save, really slow');
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => sw.evaluate(async () => Object.values(((await chrome.storage.session.get('tb:review'))['tb:review'] ?? {}) as Record<string, { items: { comment: string }[] }>).flatMap((t) => t.items.map((i) => i.comment))))
      .toEqual(['a shaky save, really slow']);
    await expect(page.getByTestId('status')).toContainText('idle');
  } finally {
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
