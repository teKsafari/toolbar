// Capture page layout and media: J-090, J-091, J-092, J-093, J-094, J-072, J-095, J-096, J-097,
// J-098, J-099, J-209, J-100, J-229, J-236, J-115, J-198.
import { expect, test } from '@playwright/test';
import { allowClipboard, captureUrl, open, clipboard, IDS, ready, reseed, shareUrl, signIn, videoTime } from './helpers.ts';
import { budget } from '../../fixtures/budget.ts';

test.beforeAll(() => reseed());

/** Chapters are an AI feature, paused unless the server runs with FEATURE_AI=1 (docs/scope.md). */
const AI = process.env.E2E_FEATURE_AI === '1';

test.describe('member page', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context);
    await allowClipboard(context);
  });

  test('J-090 two columns, tabs, splitter', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, captureUrl(IDS.video));
    await expect(page.getByTestId('video-card')).toBeVisible();
    await expect(page.getByTestId('title')).toHaveText('Submit order does nothing');
    await expect(page.getByTestId('description')).toContainText('Clicked Submit order');
    await expect(page.getByTestId('byline')).toContainText('Dana Reviewer');
    await expect(page.getByTestId('comments')).toBeVisible();
    for (const t of ['info', 'console', 'network', 'actions', 'agent']) await expect(page.getByTestId(`tab-${t}`)).toBeVisible();
    const main = (await page.locator('main.layout').boundingBox())!;
    const right = (await page.getByTestId('right-panel').boundingBox())!;
    const ratio = right.width / main.width;
    expect(ratio).toBeGreaterThan(0.32);
    expect(ratio).toBeLessThan(0.44);
    const media = (await page.getByTestId('media').boundingBox())!;
    expect(media.x).toBeLessThan(right.x);
    // splitter drags
    const sp = (await page.getByTestId('splitter').boundingBox())!;
    await page.mouse.move(sp.x + 4, sp.y + 200);
    await page.mouse.down();
    await page.mouse.move(sp.x - 200, sp.y + 200, { steps: 5 });
    await page.mouse.up();
    const right2 = (await page.getByTestId('right-panel').boundingBox())!;
    expect(right2.width).toBeGreaterThan(right.width + 150);
  });

  test('J-091 hide and show the dev tools panel', async ({ page }) => {
    await open(page, captureUrl(IDS.video));
    await page.getByTestId('hide-devtools').click();
    await expect(page.getByTestId('right-panel')).toHaveCount(0);
    const main = (await page.locator('main.layout').boundingBox())!;
    const inner = (await page.locator('.leftin').boundingBox())!;
    expect(Math.abs(inner.x - main.x - (main.x + main.width - inner.x - inner.width))).toBeLessThan(40);
    await page.getByTestId('show-devtools').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
  });

  test('J-092 player controls, speed remembered, replay prompt', async ({ page }) => {
    await open(page, captureUrl(IDS.video));
    await expect(page.getByTestId('big-play')).toContainText('0:08');
    await expect(page.getByTestId('time')).toHaveText('0:00 / 0:08');
    for (const id of ['play', 'download', 'fullscreen', 'quality', 'speed', 'share-at-time']) await expect(page.getByTestId(id)).toBeVisible();
    // J-092 review: the chapters pill is an AI feature and stays hidden while FEATURE_AI is off
    if (AI) await expect(page.getByTestId('chapter-pill')).toBeVisible();
    else {
      await expect(page.getByTestId('chapter-pill')).toHaveCount(0);
      await expect(page.getByTestId('chapter-split')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Forward 5 seconds' }).click();
    await expect.poll(() => videoTime(page)).toBeCloseTo(5, 0);
    await page.getByRole('button', { name: 'Back 5 seconds' }).click();
    await expect.poll(() => videoTime(page)).toBeCloseTo(0, 0);
    await page.getByRole('button', { name: 'Mute' }).click();
    expect(await page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    await page.getByTestId('speed').click();
    await page.getByRole('menuitem', { name: '1.5x' }).click();
    expect(await page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
    await page.getByTestId('quality').click();
    await expect(page.getByRole('menuitem', { name: 'Original' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByTestId('speed')).toHaveText('1.5x');
    expect(await page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
    // end of the video: replay prompt
    await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = v.duration - 0.3));
    await page.getByTestId('play').click();
    await expect(page.getByTestId('replay-prompt')).toBeVisible({ timeout: 5000 });
    await page.getByTestId('replay-prompt').click();
    await expect.poll(() => videoTime(page)).toBeLessThan(2);
  });

  test('J-054 quality menu lists the renditions on the member and share pages, and 240p plays', async ({ page }) => {
    const labels = ['Original', '480p', '360p', '240p', 'Auto'];
    for (const url of [captureUrl(IDS.video), shareUrl(IDS.video)]) {
      // the seed queues the renditions job; the worker needs a few seconds after a reseed
      await expect
        .poll(
          async () => {
            await open(page, url);
            await page.getByTestId('quality').click();
            return page.getByRole('menuitem').allTextContents();
          },
          { timeout: budget(60_000), intervals: [2000] },
        )
        .toEqual(labels);
      await page.getByRole('menuitem', { name: '240p' }).click();
      const video = page.getByTestId('video');
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toMatch(/\/media\/video-240$/);
      await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoHeight), { timeout: budget(10_000) }).toBe(240);
    }
  });

  test('J-093 keyboard: k, space, m, f, arrows, digits', async ({ page }) => {
    await open(page, captureUrl(IDS.video));
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('k');
    await expect.poll(() => page.getByTestId('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    await page.keyboard.press('k');
    await expect.poll(() => page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(() => page.getByTestId('video').evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    await page.keyboard.press('Space');
    await page.keyboard.press('m');
    expect(await page.getByTestId('video').evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
    await page.keyboard.press('5');
    await expect.poll(() => videoTime(page)).toBeCloseTo(4, 0);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => videoTime(page)).toBeCloseTo(0, 0);
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => videoTime(page)).toBeCloseTo(5, 0);
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await page.keyboard.press('f');
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    // i asks for picture-in-picture; headless may refuse it, but the key must not break playback
    await page.keyboard.press('i');
    await expect(page.getByTestId('video-card')).toBeVisible();
  });

  test('J-094 seek bar hover preview with time and chapter', async ({ page }) => {
    await open(page, captureUrl(IDS.video));
    await ready(page);
    const bar = (await page.getByTestId('seekbar').boundingBox())!;
    await page.mouse.move(bar.x + bar.width * 0.8, bar.y + bar.height / 2);
    const pv = page.getByTestId('seek-preview');
    await expect(pv).toBeVisible();
    await expect(pv).toContainText('0:06');
    if (AI) await expect(pv).toContainText('Your details');
    else await expect(pv).not.toContainText('Your details');
    await expect(pv.locator('canvas')).toBeVisible();
  });

  test('J-072 J-095 markers above the seek bar; 500 pill opens the console row', async ({ page }) => {
    await open(page, captureUrl(IDS.video));
    await ready(page);
    const fail = page.getByTestId('marker-net-fail');
    await expect(fail).toHaveText('500');
    const bar = (await page.getByTestId('seekbar').boundingBox())!;
    const fb = (await fail.boundingBox())!;
    const pos = (fb.x + fb.width / 2 - bar.x) / bar.width;
    expect(pos).toBeGreaterThan(0.3);
    expect(pos).toBeLessThan(0.36); // 2.63 s of 8 s
    await expect(page.getByTestId('marker-error')).toBeVisible();
    await fail.hover();
    await expect(page.getByTestId('marker-tip')).toContainText('1 failed request');
    await expect(page.getByTestId('marker-tip')).toContainText('Item ink-3 is out of stock');
    await page.getByTestId('tab-network').click();
    await fail.click();
    await expect(page.getByTestId('tab-console')).toHaveAttribute('aria-selected', 'true');
    const row = page.locator('[data-id="net:top-2"]');
    await expect(row).toBeInViewport();
    await expect(row).toHaveClass(/flash/);
  });

  test('J-096 chapters menu seeks; the bar is split at chapter edges', async ({ page }) => {
    test.skip(!AI, 'paused: FEATURE_AI is off (docs/scope.md)');
    await open(page, captureUrl(IDS.video));
    await ready(page);
    await expect(page.getByTestId('chapter-split')).toHaveCount(1);
    await page.getByTestId('chapter-pill').click();
    const items = page.getByTestId('chapters').getByRole('menuitem');
    await expect(items).toHaveCount(2);
    await items.nth(1).click();
    await expect.poll(() => videoTime(page)).toBeCloseTo(5.98, 1);
    await expect(page.getByTestId('chapter-pill')).toContainText('Your details');
  });

  test('J-097 share at the current time', async ({ page, context }) => {
    await open(page, captureUrl(IDS.video));
    await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 2.34));
    await expect(page.getByTestId('share-at-time')).toContainText('0:02.34');
    await page.getByTestId('share-at-time').click();
    await expect(page.getByRole('status').filter({ hasText: 'Link to 0:02.34 copied' })).toBeVisible();
    const url = await clipboard(page);
    expect(url).toBe(`${shareUrl(IDS.video)}?t=2.34`);
    const other = await context.browser()!.newContext();
    const p2 = await other.newPage();
    await open(p2, url);
    await expect.poll(() => videoTime(p2)).toBeCloseTo(2.34, 1);
    await other.close();
  });

  test('J-098 J-154 downloads with the agent nudge', async ({ page }) => {
    await open(page, captureUrl(IDS.video));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.webm$/);
    const toast = page.getByRole('status').filter({ hasText: 'Download started' });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole('button', { name: 'Set up your agent' })).toBeVisible();
    await open(page, captureUrl(IDS.screenshot));
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    expect(dl2.suggestedFilename()).toMatch(/\.png$/);
  });

  test('J-099 J-209 screenshot lightbox and crop/full switcher', async ({ page }) => {
    await open(page, captureUrl(IDS.screenshot));
    const img = page.getByTestId('screenshot');
    await expect(img).toHaveAttribute('data-which', 'crop');
    await expect(page.getByTestId('thumb-crop')).toHaveAttribute('aria-selected', 'true');
    const border = await page.getByTestId('thumb-crop').evaluate((el) => getComputedStyle(el).borderColor);
    expect(border).not.toBe('rgba(0, 0, 0, 0)');
    await page.getByTestId('thumb-full').click();
    await expect(img).toHaveAttribute('data-which', 'full');
    await expect(img).toHaveAttribute('src', /\/full$/);
    await page.getByTestId('thumb-crop').click();
    await img.click();
    await expect(page.getByTestId('lightbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('lightbox')).toHaveCount(0);
    await img.click();
    await page.getByTestId('lightbox').click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId('lightbox')).toHaveCount(0);
  });

  test('J-100 J-229 instant replay: loading card, DOM replay, small control bar', async ({ page }) => {
    await page.route('**/media/rrweb-000', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await open(page, captureUrl(IDS.replay));
    await expect(page.getByTestId('replay-loading')).toBeVisible();
    await expect(page.getByTestId('replay-loading').locator('.progress')).toBeVisible();
    await expect(page.getByTestId('replay-loading')).toHaveCount(0, { timeout: 15000 });
    const frame = page.frameLocator('[data-testid="replay-stage"] iframe');
    await expect(frame.locator('h1')).toHaveText('Lab replay page');
    const card = page.getByTestId('replay-card');
    for (const name of ['Play', 'Back 5 seconds', 'Forward 5 seconds', 'Playback speed', 'Fullscreen']) await expect(card.getByRole('button', { name, exact: true })).toBeVisible();
    for (const id of ['download', 'share-at-time', 'quality', 'chapter-pill']) await expect(card.getByTestId(id)).toHaveCount(0);
    await expect(card.getByRole('button', { name: /Mute/ })).toHaveCount(0);
    await expect(card.getByTestId('time')).toHaveText('0:00 / 0:06');
    await expect(card.getByTestId('marker-error')).toBeVisible();
    await card.getByTestId('play').click();
    await expect(frame.locator('#status')).toHaveText('Something broke', { timeout: 5000 });
    await expect(page.locator('.replayer-mouse')).toHaveCount(1);
  });

  test('J-236 captions from the transcript', async ({ page }) => {
    await open(page, captureUrl(IDS.commented));
    await page.getByTestId('cc').click();
    await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 1.5));
    await expect(page.getByTestId('caption')).toHaveText('I fill in the name and press send.');
  });

  test('J-115 390 px: one column, toggle to dev tools, network scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, captureUrl(IDS.video));
    await ready(page);
    await expect(page.getByTestId('video-card')).toBeVisible();
    await expect(page.getByTestId('right-panel')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId('narrow-devtools').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('video-card')).toBeHidden();
    await page.getByTestId('tab-network').click();
    const list = page.getByTestId('network-list');
    expect(await list.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByTestId('narrow-capture').click();
    await expect(page.getByTestId('video-card')).toBeVisible();
  });
});

test('J-198 logged-out first paint under 3 s', async ({ page }) => {
  await open(page, shareUrl(IDS.video));
  await page.reload();
  const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 99999);
  expect(fcp).toBeLessThan(budget(3000));
  await expect(page.getByTestId('video-card')).toBeVisible();
});
