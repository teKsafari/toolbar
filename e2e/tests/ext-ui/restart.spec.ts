// J-177: the popup menu's restart reloads the extension, which reopens its popup. Runs in its
// own browser, since a reload replaces the service worker the shared fixture holds.
import { chromium, test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DISPLAY, EXT_DIR, EXT_ID, LAB_URL } from '../../fixtures/extension.ts';

base('J-177: restart from the menu reloads the extension and reopens the popup', async () => {
  base.skip(DISPLAY === ':99', 'never on the shared display');
  // developer mode: without it Chromium disables an unpacked extension when it reloads itself
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-e2e-restart-'));
  fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({ extensions: { pinned_extensions: [EXT_ID], ui: { developer_mode: true } } }));
  const context = await chromium.launchPersistentContext(dir, {
    headless: false,
    env: { ...process.env, DISPLAY },
    viewport: null,
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, '--window-size=1280,800'],
  });
  try {
    const sw1 = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await sw1.evaluate(() => chrome.storage.local.set({ 'nib:auth': { serverUrl: 'http://localhost:1', token: 'tb_dev_x', tokenId: 'x', user: { id: null, name: 'T', email: null, image: null }, activeWorkspaceId: null, signedInAt: 0 } }));
    const lab = await context.newPage();
    await lab.goto(LAB_URL);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
    await popup.locator('[data-popup][data-loading="false"]').waitFor();
    await popup.locator('[data-menu-button]').click();
    await expect(popup.locator('[data-menu-item="docs"]')).toBeVisible();
    await expect(popup.locator('[data-menu-item="report"]')).toBeVisible();
    await popup.locator('[data-menu-item="restart"]').click();
    // the reload ends the old worker and the popup page; a fresh worker starts
    await expect.poll(() => sw1.evaluate(() => 1).catch(() => 0), { timeout: 10000 }).toBe(0);
    // read through an extension page: the old worker handle is gone
    const check = await context.newPage();
    await expect
      .poll(
        async () => {
          await check.goto(`chrome-extension://${EXT_ID}/options.html`).catch(() => undefined);
          return check
            .evaluate(async () => {
              const got = await chrome.storage.local.get('nib:reopen-popup');
              return got['nib:reopen-popup'] === undefined ? 'consumed' : 'pending';
            })
            .catch(() => 'down');
        },
        { timeout: 15000, intervals: [500] },
      )
      .toBe('consumed');
    // the new worker answers requests
    const r = await check.evaluate(() => chrome.runtime.sendMessage({ type: 'status' }));
    expect(r).toMatchObject({ ok: true });
    // and the new worker opened the popup again
    const sw2 = context.serviceWorkers().find((w) => w !== sw1)!;
    await expect
      .poll(() => sw2.evaluate(() => (globalThis as unknown as { __tbUi: { stats(): { popupOpens: number } } }).__tbUi.stats().popupOpens), { timeout: 8000 })
      .toBeGreaterThan(0);
  } finally {
    await context.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
