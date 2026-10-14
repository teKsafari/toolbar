// Dev tools panel: J-101, J-102, J-233, J-103, J-104, J-105, J-106, J-243, J-107, J-185, J-108,
// J-109, J-224, J-231, J-206, J-154.
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { allowClipboard, captureUrl, clipboard, IDS, open, ready, reseed, signIn, videoTime } from './helpers.ts';
import { budget } from '../../fixtures/budget.ts';

test.beforeAll(() => reseed());
test.beforeEach(async ({ context }) => {
  await signIn(context);
  await allowClipboard(context);
});

async function tab(page: Page, id: string) {
  await page.getByTestId(`tab-${id}`).click();
  await expect(page.getByTestId(`tab-${id}`)).toHaveAttribute('aria-selected', 'true');
}

test('J-101 info tab with zone menu and custom logs setup', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await tab(page, 'info');
  const info = page.getByTestId('info-tab');
  for (const text of ['http://localhost:5173/checkout', 'Linux', 'Chrome 141.0.7390.54', '1280 x 720', '4G, 10 Mbps, 50 ms latency', 'Africa/Nairobi', '0.0.1']) await expect(info).toContainText(text);
  const ts = page.getByTestId('timestamp');
  await expect(ts).toContainText('17:00:00'); // 14:00 UTC in Nairobi (UTC+3)
  await page.getByTestId('zone-menu').click();
  await page.getByRole('menuitemradio', { name: 'UTC' }).click();
  await expect(ts).toContainText('14:00:00');
  await expect(ts).toContainText('UTC');
  await page.getByTestId('custom-logs-setup').click();
  await expect(info).toContainText('setMetadata');
  await page.getByTestId('zone-menu').click();
  await page.getByRole('menuitemradio', { name: /Capture/ }).click();
});

test('J-102 J-233 console: merged rows, text filter, level menu, kind chips', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await tab(page, 'console');
  const list = page.getByTestId('console-list');
  for (const t of ['Page load to', 'Video started', 'cart loaded {items: 3, total: 45.75}', 'POST http://localhost:5173/api/orders 500', 'Uncaught TypeError', 'Navigated to', 'Click on <button', 'Typed masked text', 'Video stopped']) await expect(list).toContainText(t);
  await page.getByTestId('console-filter').fill('profile');
  await expect(list.locator('.vp-row')).toHaveCount(2);
  await page.getByTestId('console-filter').fill('');
  await page.getByTestId('level-menu').click();
  await page.getByRole('checkbox', { name: 'Warnings' }).check();
  await page.keyboard.press('Escape');
  await expect(list.locator('.vp-row.kind-console, .vp-row.kind-error')).toHaveCount(1);
  await expect(list.locator('.vp-row.kind-console')).toContainText('Slow render');
  await page.getByTestId('chip-user').click();
  await expect(list.locator('.kind-click')).toHaveCount(0);
  await page.getByTestId('chip-navigation').click();
  await page.getByTestId('chip-network').click();
  await expect(list.locator('.kind-navigation, .kind-network')).toHaveCount(0);
  // video paused row between started and stopped
  await open(page, captureUrl(IDS.commented));
  await ready(page);
  await tab(page, 'console');
  const media = await page.getByTestId('console-list').locator('.kind-media .msg').allTextContents();
  expect(media).toEqual(['Video started', 'Video paused', 'Video resumed', 'Video stopped']);
});

test('J-103 gutter triangle seeks and arms a comment; row click expands; time shows wall clock', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await tab(page, 'console');
  const row = page.locator('[data-id="top:20"]'); // uncaught TypeError at 5.21 s
  await row.hover();
  await expect(row.locator('.vp-gutter')).toHaveCSS('opacity', '1');
  await row.locator('.vp-gutter').click();
  await expect.poll(() => videoTime(page)).toBeCloseTo(5.19, 1);
  await expect(page.getByTestId('send')).toContainText('at 0:05');
  await row.locator('.main').click();
  await expect(row.locator('.detail')).toContainText('renderProfile');
  await expect(row.locator('.vp-time')).toHaveAttribute('title', /\d\d:\d\d:\d\d\.\d{3}/);
});

test('J-104 panels follow playback and highlight within 100 ms', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await tab(page, 'console');
  // the 500 row sits at player 2630 ms: measure how long after the frame the row is marked
  await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 2.3));
  const lag = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const v = document.querySelector<HTMLVideoElement>('[data-testid="video"]')!;
        let crossed = 0;
        const check = () => {
          const now = performance.now();
          if (!crossed && v.currentTime * 1000 >= 2630) crossed = now;
          const cur = document.querySelector('[data-testid="console-list"] .vp-row.current');
          if (crossed && cur?.getAttribute('data-id') === 'net:top-2') return resolve(now - crossed);
          if (crossed && now - crossed > 1000) return resolve(9999);
          requestAnimationFrame(check);
        };
        void v.play();
        requestAnimationFrame(check);
      }),
  );
  expect(lag).toBeLessThan(budget(100));
  await expect(page.locator('[data-testid="console-list"] .vp-row.future').first()).toBeVisible();
  // the list scrolls with playback: with a short panel the current row stays in view
  await page.setViewportSize({ width: 1440, height: 520 });
  await page.getByTestId('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 0; void v.play(); });
  await page.waitForTimeout(7000);
  await expect(page.locator('[data-testid="console-list"] .vp-row.current')).toBeInViewport();
});

test('J-105 network table: chips, filter, errors only, sort, pink failed rows', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await tab(page, 'network');
  const rows = page.getByTestId('network-list').locator('.nrow');
  await expect(rows).toHaveCount(6);
  for (const h of ['Name', 'Method', 'Status', 'Domain', 'Type', 'Frame', 'Size', 'Time', 'Waterfall']) await expect(page.getByRole('columnheader', { name: h })).toBeVisible();
  await page.getByTestId('type-fetch').click();
  await expect(rows).toHaveCount(4);
  await page.getByTestId('type-ws').click();
  await expect(rows).toHaveCount(1);
  await page.getByTestId('type-all').click();
  await page.getByTestId('network-filter').fill('pen.jpg');
  await expect(rows).toHaveCount(1);
  await page.getByTestId('network-filter').fill('');
  await page.getByTestId('errors-only').check();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveClass(/failed/);
  expect(await rows.first().evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  await page.getByTestId('errors-only').uncheck();
  await page.getByRole('columnheader', { name: 'Status' }).click();
  await page.getByRole('columnheader', { name: /Status/ }).click();
  await expect(rows.first().locator('.c-s')).toHaveText('500');
  await expect(rows.filter({ hasText: '/api/sync' }).locator('.c-s')).toHaveText('pending');
});

test('J-106 J-185 detail pane: two-column list, sub-tabs, status dot, masked headers, sockets', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await tab(page, 'network');
  await page.locator('[data-rid="top-2"]').click();
  const pane = page.getByTestId('request-detail');
  await expect(pane).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Method' })).toHaveCount(0);
  await expect(page.getByTestId('detail-status')).toHaveText('500');
  expect(await pane.locator('header .dot').evaluate((el) => el.className)).toContain('bad');
  await expect(page.getByTestId('masked-cookie')).toBeVisible();
  await expect(page.getByTestId('masked-authorization')).toBeVisible();
  await page.getByTestId('sub-payload').click();
  await expect(page.getByTestId('detail-body')).toContainText('"cart": 42');
  await page.getByTestId('sub-response').click();
  await expect(page.getByTestId('response-body')).toContainText('inventory_unavailable');
  await page.getByTestId('sub-timing').click();
  await expect(page.getByTestId('detail-body')).toContainText('Waiting (TTFB)');
  await page.locator('[data-rid="ws:top:ws-0"]').click();
  await expect(page.getByTestId('sub-response')).toHaveText('Messages');
  await expect(page.getByTestId('sub-payload')).toHaveCount(0);
  await page.getByTestId('sub-response').click();
  await expect(page.getByTestId('frames').locator('li')).toHaveCount(3);
  await page.getByTestId('close-detail').click();
  await expect(pane).toHaveCount(0);
});

test('J-243 Up and Down step through requests and keep the sub-tab', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await tab(page, 'network');
  await page.locator('[data-rid="top-1"]').click();
  await page.getByTestId('sub-response').click();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-rid="top-2"]')).toHaveClass(/sel/);
  await expect(page.getByTestId('sub-response')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('response-body')).toContainText('inventory_unavailable');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-rid="top-0"]')).toHaveClass(/sel/);
  await expect(page.getByTestId('response-body')).toContainText('nb-1');
});

test('J-107 J-154 copy as cURL with a cookie placeholder; it reproduces the 500', async ({ page }) => {
  await open(page, captureUrl(IDS.desktop));
  await ready(page);
  await tab(page, 'network');
  await page.getByTestId('network-list').locator('.nrow', { hasText: '/api/fail' }).click();
  await page.getByTestId('copy-curl').click();
  const toast = page.getByRole('status').filter({ hasText: 'cURL copied' });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Set up your agent' })).toBeVisible();
  const curl = await clipboard(page);
  expect(curl).toContain("curl 'http://localhost:5173/api/fail'");
  expect(curl).toContain('-X POST');
  expect(curl).toContain("-H 'cookie: <cookie>'");
  expect(curl).toContain(`--data-raw '{"cart":42}'`);
  expect(curl.split('\n').length).toBeGreaterThanOrEqual(4);
  const out = execFileSync('bash', ['-c', `${curl} -s -o /dev/null -w '%{http_code}'`]).toString();
  expect(out).toBe('500');
});

test('J-108 actions tab: no filter bar, attribute chip expands', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await tab(page, 'actions');
  const list = page.getByTestId('actions-list');
  await expect(list).toContainText('Click on <button data-testid="submit-order">Submit order</button>');
  await expect(list).toContainText('Typed "Ada Lovelace" into');
  await expect(list).toContainText('Navigated to http://localhost:5173/checkout/details');
  await expect(page.locator('.vp-bar')).toHaveCount(0);
  await page.getByTestId('attr-chip').first().click();
  await expect(page.getByTestId('attr-list').first()).toContainText('data-testid');
});

test('J-109 tab dots and the last used tab', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await expect(page.getByTestId('dot-console')).toHaveAttribute('data-state', 'error');
  await expect(page.getByTestId('dot-network')).toHaveAttribute('data-state', 'error');
  await expect(page.getByTestId('dot-actions')).toHaveAttribute('data-state', 'ok');
  await tab(page, 'network');
  await open(page, captureUrl(IDS.commented));
  await expect(page.getByTestId('tab-network')).toHaveAttribute('aria-selected', 'true');
  await tab(page, 'console');
});

test('J-224 desktop recording adds a Tab column; tab recordings do not', async ({ page }) => {
  await open(page, captureUrl(IDS.desktop));
  await ready(page);
  await tab(page, 'network');
  await expect(page.getByTestId('tab-column')).toBeVisible();
  const cells = await page.getByTestId('network-list').locator('.nrow .c-tab').allTextContents();
  expect(cells).toEqual(['101', '102']);
  const headers = await page.getByRole('columnheader').allTextContents();
  expect(headers.indexOf('Tab')).toBe(headers.findIndex((h) => h.startsWith('Type')) + 1);
  expect(headers.indexOf('Frame')).toBe(headers.indexOf('Tab') + 1);
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await expect(page.getByTestId('tab-column')).toHaveCount(0);
  await tab(page, 'console');
});

test('J-231 empty network and actions tabs', async ({ page }) => {
  await open(page, captureUrl(IDS.empty));
  await ready(page);
  await tab(page, 'network');
  await expect(page.getByTestId('network-empty')).toContainText('Not a single request');
  await tab(page, 'actions');
  await expect(page.getByTestId('actions-empty')).toContainText('Nobody clicked');
  await tab(page, 'console');
});

test('J-206 recording-link capture without logs', async ({ page }) => {
  await open(page, captureUrl(IDS.link));
  await tab(page, 'console');
  await expect(page.getByTestId('empty')).toContainText('No logs for recording-link captures');
  await expect(page.getByTestId('empty').getByRole('link')).toBeVisible();
  await tab(page, 'network');
  await expect(page.getByTestId('empty')).toContainText('No network logs');
  await tab(page, 'actions');
  await expect(page.getByTestId('rl-banner')).toBeVisible();
  await tab(page, 'console');
});
