// Flow F: open a received link logged out and find the failing request. Hover the red marker
// (0 clicks), then the network tab, the failing row and the response sub-tab (3 clicks).
import { chromium } from '@playwright/test';
import { expect, saveShot, test } from './fixture.ts';
import { recordLabErrors } from './journeys.ts';

test('F: logged out, the marker names the failure and the network pane shows the 500 body', async ({ nib }) => {
  const made = await recordLabErrors(nib);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(made.shareUrl).origin });
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(made.shareUrl);
  await page.locator('[data-hydrated]').waitFor();
  console.log('F: share page interactive after', Date.now() - t0, 'ms');
  await expect(page.getByText(made.title).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).or(page.getByRole('button', { name: 'Sign in' })).first()).toBeVisible();

  // 0 clicks: hover the failed-request marker above the seek bar
  const fail = page.getByTestId('marker-net-fail').first();
  await expect(fail).toBeVisible();
  await expect(fail).toHaveText('500');
  await fail.hover();
  await expect(page.getByTestId('marker-tip')).toContainText(/database_unavailable|connection refused/);
  await page.screenshot({ path: saveShot('f-marker') });

  // 3 clicks: network tab, the failing row, the response sub-tab
  await page.getByTestId('tab-network').click();
  const row = page.getByTestId('network-list').locator('.nrow', { hasText: '/api/fail' });
  await expect(row).toHaveCount(1);
  await expect(row.locator('.c-s')).toHaveText('500');
  await row.click();
  await expect(page.getByTestId('detail-status')).toHaveText('500');
  await page.getByTestId('sub-response').click();
  await expect(page.getByTestId('response-body')).toContainText('database_unavailable');
  await page.screenshot({ path: saveShot('f-response') });

  // copy as cURL
  await page.getByTestId('copy-curl').click();
  await expect(page.getByRole('status').filter({ hasText: 'cURL copied' })).toBeVisible();
  const curl = await page.evaluate(() => navigator.clipboard.readText());
  expect(curl).toContain('/api/fail');
  expect(curl).toContain('-X POST');

  // Up and Down step through requests and keep the response sub-tab
  const rows = page.getByTestId('network-list').locator('.nrow');
  const n = await rows.count();
  const i = await row.evaluate((el) => [...el.parentElement!.querySelectorAll('.nrow')].indexOf(el));
  if (n > 1) {
    await page.keyboard.press(i < n - 1 ? 'ArrowDown' : 'ArrowUp');
    await expect(row).not.toHaveClass(/sel/);
    await expect(rows.nth(i < n - 1 ? i + 1 : i - 1)).toHaveClass(/sel/);
    await expect(page.getByTestId('sub-response')).toHaveAttribute('aria-selected', 'true');
  }

  // the console holds the uncaught error and the rejection
  await page.getByTestId('tab-console').click();
  const list = page.getByTestId('console-list');
  await expect(list).toContainText(/profile|TypeError|Cannot read/i);
  await expect(list).toContainText(/reject|refresh/i);
  await browser.close();
});
