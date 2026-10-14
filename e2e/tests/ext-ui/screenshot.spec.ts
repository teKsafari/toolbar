// Screenshot mode: J-180, J-025, J-003, J-250, J-026, J-005.
import { expect, test } from '../../fixtures/extension.ts';
import { freshState, labPage, openPopup, session, stats } from './helpers.ts';
import { budget } from '../../fixtures/budget.ts';

const UI = 'toolbar-root';

test.beforeEach(async ({ sw }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  await freshState(sw);
});

test('J-180 J-025: the screenshot chord arms screenshot mode with a trailing cursor pill and no dimming', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  const t0 = Date.now();
  await sw.evaluate((id) => __tbUi.command('screenshot-mode', id), tabId);
  await expect.poll(async () => (await session(sw)).state).toBe('arming-screenshot');
  expect(Date.now() - t0).toBeLessThan(budget(500));

  // the pill appears once the mouse moves, about 5 px right and 20 px below the pointer
  await expect(page.locator(`${UI} [data-nb-cursor-pill]`)).toHaveCount(0);
  await page.mouse.move(300, 300);
  await page.mouse.move(320, 310);
  const pill = page.locator(`${UI} [data-nb-cursor-pill]`);
  await expect(pill).toBeVisible();
  const box = (await pill.boundingBox())!;
  expect(Math.round(box.x)).toBe(325);
  expect(Math.round(box.y)).toBe(330);
  expect(box.width).toBeGreaterThan(120);
  expect(box.width).toBeLessThan(260);
  // not dimmed: the overlay is transparent
  const bg = await page.locator(`${UI} [data-nb-shot-overlay]`).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgba(0, 0, 0, 0)');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(sw)).state).toBe('idle');
  await page.close();
});

test('J-003 J-250: a drag shows a tinted box with a live size and takes exactly that crop; the page sees nothing', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await page.evaluate(() => {
    const w = window as unknown as { __hits: Record<string, number> };
    w.__hits = { pointerdown: 0, click: 0, mousedown: 0, pointerup: 0 };
    for (const t of Object.keys(w.__hits)) document.addEventListener(t, () => w.__hits[t]!++, true);
  });
  await sw.evaluate((id) => __tbUi.command('screenshot-mode', id), tabId);
  await expect.poll(async () => (await session(sw)).state).toBe('arming-screenshot');

  await page.mouse.move(100, 150);
  await page.mouse.down();
  await page.mouse.move(250, 250, { steps: 4 });
  await page.mouse.move(400, 350, { steps: 4 });
  const rect = page.locator(`${UI} [data-nb-shot-rect]`);
  await expect(rect).toBeVisible();
  const rb = (await rect.boundingBox())!;
  expect([rb.x, rb.y, rb.width, rb.height]).toEqual([100, 150, 300, 200]);
  await expect(page.locator(`${UI} [data-nb-shot-size]`)).toHaveText('300 × 200');
  await page.mouse.up();

  await expect.poll(async () => (await stats(sw)).shots.length).toBe(1);
  expect((await stats(sw)).shots[0]!.rect).toEqual({ x: 100, y: 150, w: 300, h: 200 });
  await expect.poll(async () => (await session(sw)).state).toBe('draft');
  const hits = await page.evaluate(() => (window as unknown as { __hits: Record<string, number> }).__hits);
  expect(hits).toEqual({ pointerdown: 0, click: 0, mousedown: 0, pointerup: 0 });
  await page.close();
});

test('J-250: clicking a real button in screenshot mode takes a full shot and the button does not fire', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await page.evaluate(() => {
    const w = window as unknown as { __hits: number };
    w.__hits = 0;
    document.addEventListener('pointerdown', () => w.__hits++, true);
    document.addEventListener('click', () => w.__hits++, true);
  });
  await sw.evaluate((id) => __tbUi.command('screenshot-mode', id), tabId);
  await expect.poll(async () => (await session(sw)).state).toBe('arming-screenshot');
  const save = page.getByTestId('works');
  const b = (await save.boundingBox())!;
  await page.mouse.move(b.x + 5, b.y + 5);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(async () => (await stats(sw)).shots.length).toBe(1);
  expect((await stats(sw)).shots[0]!.rect).toBeNull();
  await page.waitForTimeout(300);
  await expect(page.getByText('saved 0 times')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __hits: number }).__hits)).toBe(0);
  await page.close();
});

test('J-026: Escape leaves screenshot mode; the popup shows a red exit row with the other rows greyed', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await sw.evaluate((id) => __tbUi.command('screenshot-mode', id), tabId);
  await page.mouse.move(200, 200);
  await page.mouse.move(210, 210);
  await expect(page.locator(`${UI} [data-nb-cursor-pill]`)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(`${UI} [data-nb-cursor-pill]`)).toHaveCount(0);
  await expect.poll(async () => (await session(sw)).state).toBe('idle');

  await sw.evaluate((id) => __tbUi.command('screenshot-mode', id), tabId);
  await expect.poll(async () => (await session(sw)).state).toBe('arming-screenshot');
  const popup = await openPopup(context, tabId);
  const exit = popup.locator('[data-row="exit-screenshot"]');
  await expect(exit).toHaveAttribute('data-tone', 'danger');
  await expect(popup.locator('[data-row="record"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(popup.locator('[data-row="link"]')).toHaveAttribute('aria-disabled', 'true');
  await popup.locator('[data-row-main="exit-screenshot"]').click();
  await expect.poll(async () => (await session(sw)).state).toBe('idle');
  await page.close();
});

test('J-005: a 3 s delay from the chevron runs a bottom-left badge and a cancel pill, fires at zero, and resets', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await popup.locator('[data-row-chevron="screenshot"]').click();
  await popup.locator('[data-row-options="screenshot"] [data-value="3"]').click();
  await expect(popup.locator('[data-row-main="screenshot"]')).toContainText('3 s');
  await popup.locator('[data-row-main="screenshot"]').click().catch(() => undefined); // popup closes itself
  await expect.poll(async () => (await session(sw)).state).toBe('arming-screenshot');
  expect((await session(sw)).delaySec).toBe(3);
  // the choice is off next time
  const saved = await sw.evaluate(async () => (await chrome.storage.local.get('nib:settings'))['nib:settings'] as { screenshotDelaySec: number });
  expect(saved.screenshotDelaySec).toBe(0);

  await page.bringToFront();
  await page.mouse.move(300, 300);
  await page.mouse.move(310, 305);
  await expect(page.locator(`${UI} [data-nb-cursor-pill]`)).toContainText('3 s');
  await page.mouse.click(310, 305);
  const badge = page.locator(`${UI} [data-nb-delay-badge]`);
  await expect(badge).toHaveText('3');
  const bb = (await badge.boundingBox())!;
  const vp = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  expect(bb.x).toBeLessThan(40);
  expect(bb.y + bb.height).toBeGreaterThan(vp.height - 40);
  const cancel = page.locator(`${UI} [data-nb-delay-cancel]`);
  const cb = (await cancel.boundingBox())!;
  expect(cb.x + cb.width).toBeGreaterThan(vp.width - 40);
  expect((await stats(sw)).shots.length).toBe(0);
  await expect(badge).toHaveText('1', { timeout: 4000 });
  await expect.poll(async () => (await stats(sw)).shots.length, { timeout: 4000 }).toBe(1);
  await page.close();
});

test('J-005: cancel during the delay leaves screenshot mode with no shot', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await sw.evaluate(async (id) => {
    await __tbUi.setSettings({ screenshotDelaySec: 3 });
    await __tbUi.command('screenshot-mode', id);
  }, tabId);
  await page.mouse.move(300, 300);
  await page.mouse.click(300, 300);
  await page.locator(`${UI} [data-nb-delay-cancel]`).click({ delay: 700 });
  await expect.poll(async () => (await session(sw)).state).toBe('idle');
  await page.waitForTimeout(3500);
  expect((await stats(sw)).shots.length).toBe(0);
  await page.close();
});
