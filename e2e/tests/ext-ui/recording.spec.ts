// Recording UI: J-181, J-027, J-028, J-029, J-238, J-030, J-031, J-036, J-033, J-239, J-013, J-200.
// The capture driver is the test fake (lib/bg/ui.ts), so media starts at once; the UI and the
// session flow are real.
import type { Page, Worker } from '@playwright/test';
import { expect, test } from '../../fixtures/extension.ts';
import { calls, freshState, labPage, mockServer, openPopup, session, stats } from './helpers.ts';
import { budget } from '../../fixtures/budget.ts';

const UI = 'toolbar-root';
const bar = (page: Page) => page.locator(`${UI} [data-nb-bar]`);

test.beforeEach(async ({ sw }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  await freshState(sw);
});

async function startLive(sw: Worker, page: Page, tabId: number) {
  await sw.evaluate((id) => __tbUi.command('record-tab', id), tabId);
  await expect.poll(async () => (await session(sw)).state, { timeout: 8000 }).toBe('recording');
  await expect(bar(page)).toHaveAttribute('data-state', 'recording');
}

test('J-181 J-027: the record chord shows a veil and a 3-2-1 count, goes live under 6.4 s, and the same chord stops', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  const t0 = Date.now();
  await sw.evaluate((id) => __tbUi.command('record-tab', id), tabId);
  const veil = page.locator(`${UI} [data-nb-veil]`);
  await expect(veil).toBeVisible();
  const veilBg = await veil.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(veilBg).toBe('rgba(18, 18, 17, 0.5)');
  const count = page.locator(`${UI} [data-nb-count]`);
  await expect(count).toHaveText('3');
  await expect(count).toHaveText('2', { timeout: 2000 });
  // the bar sits at bottom centre during the count
  const b = (await bar(page).boundingBox())!;
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  expect(Math.abs(b.x + b.width / 2 - vw / 2)).toBeLessThan(2);
  await expect.poll(async () => (await session(sw)).state, { timeout: 6400 }).toBe('recording');
  expect(Date.now() - t0).toBeLessThan(budget(6400));
  await expect(veil).toHaveCount(0);
  await expect(page.locator(`${UI} [data-nb-timer]`)).toHaveText(/^0:0\d$/);

  await sw.evaluate((id) => __tbUi.command('record-tab', id), tabId);
  await expect.poll(async () => (await session(sw)).state).toBe('draft');
  expect((await calls(sw)).map((c) => c.fn)).toEqual(['prepare', 'start', 'stop']);
  await expect(bar(page)).toHaveCount(0);
  await page.close();
});

test('J-027: a click on the veil pauses the count and a second click resumes it', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await sw.evaluate((id) => __tbUi.command('record-tab', id), tabId);
  const veil = page.locator(`${UI} [data-nb-veil]`);
  await expect(veil).toBeVisible();
  await veil.click({ position: { x: 50, y: 50 } });
  await expect.poll(async () => (await session(sw)).paused).toBe(true);
  await expect(page.locator(`${UI} [data-nb-veil]`)).toContainText('Countdown paused');
  await page.waitForTimeout(3500);
  expect((await session(sw)).state).toBe('countdown');
  await veil.click({ position: { x: 50, y: 50 } });
  await expect.poll(async () => (await session(sw)).state, { timeout: 5000 }).toBe('recording');
  await page.close();
});

test('J-028 J-029 J-033: the bar is a dark pill about 295x40 at bottom centre with stop, pause, timer, mic, pen, blur; pause freezes the timer; the icon is a red camera', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  const b = (await bar(page).boundingBox())!;
  const vp = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: innerHeight }));
  expect(b.height).toBe(40);
  expect(b.width).toBeGreaterThan(240);
  expect(b.width).toBeLessThan(330);
  expect(Math.abs(b.x + b.width / 2 - vp.w / 2)).toBeLessThan(2);
  expect(Math.round(vp.h - (b.y + b.height))).toBe(70);
  const bg = await bar(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(26, 25, 24)');
  for (const sel of ['[data-nb-stop]', '[data-nb-pause]', '[data-nb-timer]', '[data-nb-mic]', '[data-nb-tool="pen"]', '[data-nb-tool="blur"]'])
    await expect(bar(page).locator(sel)).toBeVisible();
  // in a shadow root: the page cannot select it
  expect(await page.evaluate(() => document.querySelector('[data-nb-bar]'))).toBeNull();
  expect((await stats(sw)).icon).toBe('camera');

  await bar(page).locator('[data-nb-pause]').click();
  await expect.poll(async () => (await session(sw)).pausedAt).not.toBeNull();
  const frozen = await bar(page).locator('[data-nb-timer]').textContent();
  await page.waitForTimeout(1500);
  expect(await bar(page).locator('[data-nb-timer]').textContent()).toBe(frozen);
  await expect(bar(page).locator('[data-nb-pause]')).toHaveAttribute('aria-label', 'Resume recording');
  await bar(page).locator('[data-nb-pause]').click();
  await expect.poll(async () => (await session(sw)).pausedAt).toBeNull();

  await bar(page).locator('[data-nb-stop]').click();
  await expect.poll(async () => (await session(sw)).state).toBe('draft');
  await expect.poll(async () => (await stats(sw)).icon).toBe('default');
  await page.close();
});

test('J-238: dragging the bar by its timer moves it; it stays there and the timer keeps counting', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  const timer = bar(page).locator('[data-nb-timer]');
  const t = (await timer.boundingBox())!;
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
  await page.mouse.down();
  await page.mouse.move(vp.w / 2 - 100, vp.h / 2, { steps: 8 });
  await page.mouse.up();
  const b1 = (await bar(page).boundingBox())!;
  expect(b1.y).toBeLessThan(vp.h / 2 + 10);
  expect(b1.y).toBeGreaterThan(vp.h / 2 - 60);
  const before = await timer.textContent();
  await page.waitForTimeout(1600);
  expect(await timer.textContent()).not.toBe(before);
  const b2 = (await bar(page).boundingBox())!;
  expect([b2.x, b2.y]).toEqual([b1.x, b1.y]);
  await page.close();
});

test('J-030: the pen shows 12 colour dots with red first, strokes fade after 2 to 3 s and leave a pen mark', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  await bar(page).locator('[data-nb-tool="pen"]').click();
  // count page pointer events from here on: drawing must not reach the page
  await page.evaluate(() => {
    (window as unknown as { __downs: number }).__downs = 0;
    document.addEventListener('pointerdown', () => (window as unknown as { __downs: number }).__downs++, true);
  });
  const sw12 = bar(page).locator('[data-nb-swatch]');
  await expect(sw12).toHaveCount(12);
  await expect(sw12.first()).toHaveAttribute('aria-checked', 'true');
  expect(await sw12.first().getAttribute('data-nb-swatch')).toBe('#e0402f');
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(300, 260, { steps: 10 });
  await page.mouse.move(380, 220, { steps: 10 });
  await page.mouse.up();
  const strokes = page.locator(`${UI} [data-nb-stroke]`);
  await expect(strokes).toHaveCount(1);
  expect(await strokes.first().getAttribute('fill')).toBe('#e0402f');
  expect(await page.evaluate(() => (window as unknown as { __downs: number }).__downs)).toBe(0);
  await expect.poll(async () => (await stats(sw)).marks).toContain('pen');
  await page.waitForTimeout(1500);
  await expect(strokes).toHaveCount(1);
  await expect(strokes).toHaveCount(0, { timeout: 3000 });
  await bar(page).locator('[data-nb-tool-done]').click();
  await expect(bar(page).locator('[data-nb-stop]')).toBeVisible();
  await page.close();
});

test('J-031: blur pauses the recording, blurs and unblurs a clicked element, undo works, done resumes', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  await bar(page).locator('[data-nb-tool="blur"]').click();
  await expect.poll(async () => (await session(sw)).pausedAt).not.toBeNull();
  const card = page.locator('section.card').first();
  const filter = () => card.evaluate((el) => (el as HTMLElement).style.getPropertyValue('filter'));
  const cb = (await card.boundingBox())!;
  await page.mouse.move(cb.x + 8, cb.y + 8);
  await expect(page.locator(`${UI} [data-nb-blur-hover]`)).toBeVisible();
  await page.mouse.click(cb.x + 8, cb.y + 8);
  expect(await filter()).toBe('blur(10px)');
  await page.mouse.click(cb.x + 8, cb.y + 8);
  expect(await filter()).toBe('');
  await page.mouse.click(cb.x + 8, cb.y + 8);
  expect(await filter()).toBe('blur(10px)');
  await bar(page).locator('[data-nb-blur-undo]').click();
  expect(await filter()).toBe('');
  await page.mouse.click(cb.x + 8, cb.y + 8);
  await expect.poll(async () => (await stats(sw)).marks).toContain('blur');
  await bar(page).locator('[data-nb-tool-done]').click();
  await expect.poll(async () => (await session(sw)).pausedAt).toBeNull();
  expect(await filter()).toBe('blur(10px)');
  // a click on the page reaches it again after done
  await expect(page.getByText('saved 0 times')).toBeVisible();
  // blurs are cleared when the recording ends
  await bar(page).locator('[data-nb-stop]').click();
  await expect.poll(filter).toBe('');
  await page.close();
});

test('J-036: blur during the countdown holds the count, and the element is blurred from the first frame', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await sw.evaluate((id) => __tbUi.command('record-tab', id), tabId);
  await expect(page.locator(`${UI} [data-nb-veil]`)).toBeVisible();
  await bar(page).locator('[data-nb-tool="blur"]').click();
  await expect(page.locator(`${UI} [data-nb-veil]`)).toHaveCount(0);
  await expect.poll(async () => (await session(sw)).paused).toBe(true);
  const h1 = page.locator('h1');
  const b = (await h1.boundingBox())!;
  await page.mouse.move(b.x + 5, b.y + 5);
  await page.mouse.click(b.x + 5, b.y + 5);
  expect(await h1.evaluate((el) => (el as HTMLElement).style.getPropertyValue('filter'))).toBe('blur(10px)');
  await page.locator(`${UI} [data-nb-tool="blur"]`).click();
  await expect.poll(async () => (await session(sw)).state, { timeout: 6000 }).toBe('recording');
  expect(await h1.evaluate((el) => (el as HTMLElement).style.getPropertyValue('filter'))).toBe('blur(10px)');
  await bar(page).locator('[data-nb-stop]').click();
  await page.close();
});

test('J-239: during a recording the popup greys the screenshot row, turns record into stop with its mic pill, keeps the link row, and stop opens the draft', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  const popup = await openPopup(context, tabId);
  await expect(popup.locator('[data-row="screenshot"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(popup.locator('[data-row="stop"]')).toHaveAttribute('data-tone', 'danger');
  await expect(popup.locator('[data-row="stop"] [data-mic-pill]')).toHaveText(/Mic off/);
  await expect(popup.locator('[data-row="link"]')).toHaveAttribute('aria-disabled', 'false');
  // the record-mode chevron does not apply to a stop row
  await expect(popup.locator('[data-row-chevron="stop"]')).toHaveCount(0);
  await popup.locator('[data-row-main="stop"]').click().catch(() => undefined);
  await expect.poll(async () => (await session(sw)).state).toBe('draft');
  expect((await stats(sw)).transitions).toEqual(expect.arrayContaining(['recording>stopping', 'stopping>draft']));
  await page.close();
});

test('J-013: with a cap the timer shows it, turns orange then red, and the recording stops at the cap', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      'tb:bootstrap': {
        at: Date.now(),
        data: { limits: { chunkBytes: 1, maxRecordingMs: 13_000, aiAvailable: false }, user: null, workspaces: [], activeWorkspaceId: null, folders: [], integrations: [], settings: null, serverVersion: 'test' },
      },
    });
  });
  await startLive(sw, page, tabId);
  await expect(bar(page)).toHaveAttribute('data-stage', 'warn');
  await expect(bar(page).locator('[data-nb-cap]')).toHaveText(' / 0:13');
  const warn = await bar(page).locator('[data-nb-timer]').evaluate((el) => getComputedStyle(el).color);
  expect(warn).toBe('rgb(245, 165, 36)');
  await expect(bar(page)).toHaveAttribute('data-stage', 'danger', { timeout: 6000 });
  const danger = await bar(page).locator('[data-nb-timer]').evaluate((el) => getComputedStyle(el).color);
  expect(danger).toBe('rgb(240, 103, 90)');
  await expect.poll(async () => (await stats(sw)).stops, { timeout: 15000 }).toContain('cap');
  await expect.poll(async () => (await session(sw)).state).toBe('draft');
  await sw.evaluate(() => chrome.storage.local.remove('tb:bootstrap'));
  await page.close();
});

test('J-200: without mic permission the bar mic button is greyed with a missing-permission tooltip', async ({ context, sw }) => {
  await freshState(sw, { mic: 'denied' });
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  const mic = bar(page).locator('[data-nb-mic]');
  await expect(mic).toHaveAttribute('data-nb-mic', 'denied');
  await expect(mic).toHaveAttribute('aria-disabled', 'true');
  await expect(mic).toHaveAttribute('data-tip', 'Microphone permission is missing');
  expect(Number(await mic.evaluate((el) => getComputedStyle(el).opacity))).toBeLessThan(0.6);
  await mic.click({ force: true });
  expect((await calls(sw)).some((c) => c.fn === 'mic')).toBe(false);
  await bar(page).locator('[data-nb-stop]').click();
  await page.close();
});

test('J-028: mute and unmute from the bar', async ({ context, sw }) => {
  await freshState(sw, { settings: { mic: true } });
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  const mic = bar(page).locator('[data-nb-mic]');
  await expect(mic).toHaveAttribute('data-nb-mic', 'on');
  await mic.click();
  await expect(mic).toHaveAttribute('data-nb-mic', 'muted');
  await mic.click();
  await expect(mic).toHaveAttribute('data-nb-mic', 'on');
  await bar(page).locator('[data-nb-stop]').click();
  await page.close();
});

test('J-008 groundwork: after a navigation mid-recording the bar comes back on the new page', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  await page.goto('http://localhost:5173/form');
  await expect(bar(page)).toHaveAttribute('data-state', 'recording');
  await bar(page).locator('[data-nb-stop]').click();
  await page.close();
});

test('error state: a capture that fails to start shows a toast in the page and leaves no bar', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await sw.evaluate(() => __tbUi.useFakeDriver({ failStart: 'The tab could not be captured' }));
  await sw.evaluate((id) => __tbUi.command('record-tab', id), tabId);
  const toast = page.locator(`${UI} .nb-toast[data-kind="error"]`);
  await expect(toast).toContainText('The tab could not be captured', { timeout: 8000 });
  await expect.poll(async () => (await session(sw)).state).toBe('idle');
  await expect(bar(page)).toHaveCount(0);
  const tb = (await toast.boundingBox())!;
  const vp = await page.evaluate(() => ({ w: document.documentElement.clientWidth, h: innerHeight }));
  expect(tb.x + tb.width).toBeGreaterThan(vp.w - 40);
  expect(tb.y + tb.height).toBeGreaterThan(vp.h - 40);
  await page.close();
});

test('closing the tab mid-recording ends the recording into the Drafts list and frees the session', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  await page.close();
  await expect.poll(async () => (await calls(sw)).map((c) => c.fn)).toContain('stop');
  await expect.poll(async () => (await session(sw)).state).toBe('idle');
  expect((await stats(sw)).transitions.slice(-3)).toEqual(['recording>stopping', 'stopping>draft', 'draft>idle']);
});

test('J-013: a recording started by its chord, with no bootstrap cached, gets the cap from a bootstrap the worker fetches', async ({ context, sw }) => {
  const server = await mockServer({
    'GET /api/v1/ext/bootstrap': () => ({
      user: null, workspaces: [], activeWorkspaceId: null, folders: [], integrations: [], settings: null, serverVersion: 'mock',
      limits: { chunkBytes: 1, maxRecordingMs: 12_000, aiAvailable: false },
    }),
  });
  await freshState(sw, { auth: { serverUrl: server.url } });
  const { page, tabId } = await labPage(context);
  await startLive(sw, page, tabId);
  expect(server.hits.some((h) => h.path === '/api/v1/ext/bootstrap')).toBe(true);
  await expect(bar(page)).toHaveAttribute('data-stage', 'warn');
  await expect(bar(page).locator('[data-nb-cap]')).toHaveText(' / 0:12');
  await expect.poll(async () => (await stats(sw)).stops, { timeout: 15000 }).toContain('cap');
  await sw.evaluate(() => chrome.storage.local.remove('tb:bootstrap'));
  await page.close();
  await server.close();
});
