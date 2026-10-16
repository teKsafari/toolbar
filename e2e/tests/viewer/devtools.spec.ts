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
  // future rows step their text down a token and keep full opacity, so they still pass 4.5:1 (D-180)
  const fut = await page.locator('[data-testid="console-list"] .vp-row.future').evaluateAll((rows) =>
    rows.map((r) => ({ opacity: getComputedStyle(r).opacity, faint: getComputedStyle(r).getPropertyValue('--nb-text-faint').trim(), text: getComputedStyle(r).getPropertyValue('--nb-text').trim() })),
  );
  for (const f of fut) expect(f).toEqual({ opacity: '1', faint: f.faint, text: f.faint });
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

/** Left x of each header cell and of the first row's cell of the same column, by data-col. */
async function columnEdges(page: Page) {
  return page.getByTestId('network-list').evaluate((list) => {
    const head = [...list.querySelectorAll<HTMLElement>('.hrow [data-col]')];
    const row = list.querySelector<HTMLElement>('.nrow');
    return head.map((h) => {
      const cell = row?.querySelector<HTMLElement>(`[data-col="${h.dataset.col}"]`);
      return { col: h.dataset.col!, head: h.getBoundingClientRect().left, cell: cell ? cell.getBoundingClientRect().left : null, label: h.textContent?.trim() ?? '', clipped: h.scrollWidth > h.clientWidth + 1 };
    });
  });
}

function expectAligned(edges: Awaited<ReturnType<typeof columnEdges>>, cols: number) {
  expect(edges.map((e) => e.col)).toHaveLength(cols);
  for (const e of edges) {
    expect(e.cell, `${e.col}: body cell`).not.toBeNull();
    expect(Math.abs(e.head - e.cell!), `${e.col}: header x ${e.head} vs body x ${e.cell}`).toBeLessThanOrEqual(1);
  }
}

test('J-058 J-105 network header cells start at their body columns at 1440 and 390', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await tab(page, 'network');
  const wide = await columnEdges(page);
  expectAligned(wide, 10);
  // every label reads in full at the default panel width ("Domain" used to run into "Type")
  expect(wide.filter((e) => e.clipped).map((e) => e.label)).toEqual([]);
  // the desktop recording's extra Tab column and the two-column list beside the detail pane
  await open(page, captureUrl(IDS.desktop));
  await ready(page);
  await tab(page, 'network');
  expectAligned(await columnEdges(page), 11);
  await page.getByTestId('network-list').locator('.nrow').first().click();
  expectAligned(await columnEdges(page), 2);
  // phone width: the panel scrolls sideways and the columns still line up
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, captureUrl(IDS.video));
  await ready(page);
  if (await page.getByTestId('narrow-devtools').isVisible()) await page.getByTestId('narrow-devtools').click();
  await tab(page, 'network');
  const narrow = await columnEdges(page);
  expectAligned(narrow, 10);
  expect(narrow.filter((e) => e.clipped).map((e) => e.label)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});

test('J-055 J-056 an expanded console row shows its call-site frames, not the arguments again', async ({ page }) => {
  await open(page, captureUrl(IDS.consoleArgs));
  await tab(page, 'console');
  const list = page.getByTestId('console-list');
  const at = '2026-10-15T03:38:35.057Z';
  const obj = list.locator('.vp-row').filter({ hasText: 'info: object' });
  await expect(obj.locator('.msg')).toHaveText(`info: object {user: {id: 7, roles: ["admin", "editor"]}, at: ${at}}`);
  await expect(list.locator('.vp-row').filter({ hasText: 'log: map' }).locator('.msg')).toHaveText(`log: map Map(1) {"since" => ${at}} /a+/g`);
  await expect(list).not.toContainText('$t');
  for (const [text, fn, col] of [['info: object', 'logObject', 2371], ['warn: deprecated call', 'logArray', 2402], ['log: map', 'logMap', 2450]] as const) {
    const row = list.locator('.vp-row').filter({ hasText: text });
    await row.locator('.main').click();
    const detail = row.locator('.detail');
    await expect(detail).toBeVisible();
    // the frames only: no block repeating the arguments, no wire encoding
    await expect(detail.locator('pre')).toHaveCount(0);
    await expect(detail).not.toContainText('$t');
    await expect(detail).not.toContainText(text);
    const frames = detail.getByTestId('stack-frames').locator('li');
    await expect(frames).toHaveCount(2);
    await expect(frames.nth(0)).toHaveText(`${fn} @ 2.DulX4mly.js:1:${col}`);
    await expect(frames.nth(1)).toHaveText('HTMLButtonElement.onclick @ 0.CDHttRas.js:1:23744');
    await expect(frames.nth(0).locator('a')).toHaveAttribute('href', 'http://localhost:5173/_app/immutable/chunks/2.DulX4mly.js');
    // the opened message wraps in full on its one line
    await expect(row.locator('.msg')).toHaveClass(/wrap/);
  }
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
  await expect(page.getByTestId('frame')).toHaveCount(4);
  await page.getByTestId('close-detail').click();
  await expect(pane).toHaveCount(0);
});

test('J-062 J-066 socket frames: length, regex and direction filters, detail, binary placeholder', async ({ page }) => {
  await open(page, captureUrl(IDS.video));
  await ready(page);
  await tab(page, 'network');
  await page.locator('[data-rid="ws:top:ws-0"]').click();
  await page.getByTestId('sub-response').click();
  const frames = page.getByTestId('frame');
  await expect(frames).toHaveCount(4);
  await expect(frames.nth(1).locator('.op')).toHaveAttribute('aria-label', 'sent'); // the list shows an arrow, its label names the direction
  await expect(frames.nth(1).getByTestId('frame-length')).toHaveText('16 B');
  // binary frame: size only
  await expect(frames.nth(3).getByTestId('frame-data')).toHaveText('Binary frame, 2.0 kB');
  await expect(frames.nth(3).getByTestId('frame-length')).toHaveText('2.0 kB');
  await page.getByTestId('frame-dir-send').click();
  await expect(frames).toHaveCount(1);
  await page.getByTestId('frame-dir-recv').click();
  await expect(frames).toHaveCount(2);
  await page.getByTestId('frame-dir-all').click();
  await page.getByTestId('frame-filter').fill('"n":\\s*\\d');
  await expect(frames).toHaveCount(1);
  await expect(page.getByTestId('frame-count')).toHaveText('1 of 4');
  await page.getByTestId('frame-filter').fill('(');
  await expect(page.getByTestId('frame-filter')).toHaveClass(/bad/);
  await page.getByTestId('frame-filter').fill('');
  await frames.nth(2).locator('button').click();
  await expect(page.getByTestId('frame-detail').locator('pre')).toContainText('"type": "tick"');
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
