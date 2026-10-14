// Comments: J-127, J-128, J-129, J-130, J-131, J-132, J-133, J-134, J-135.
import { expect, test } from '@playwright/test';
import { SERVER, allowClipboard, captureUrl, clipboard, IDS, mailsTo, open, open as openPage, reseed, shareUrl, signIn, videoTime } from './helpers.ts';
import { budget } from '../../fixtures/budget.ts';

test.beforeAll(() => reseed());
test.beforeEach(async ({ context }) => {
  await allowClipboard(context);
});

test('J-127 timestamped comment: pill names the time, Enter adds a line, clears fast', async ({ page, context }) => {
  await signIn(context);
  await open(page, captureUrl(IDS.video));
  await expect(page.getByTestId('send')).not.toContainText('at');
  await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 5));
  await expect(page.getByTestId('send')).toContainText('at 0:05');
  const input = page.getByTestId('comment-input');
  await input.fill('First line');
  await input.press('Enter');
  await input.pressSequentially('second line');
  await expect(input).toHaveValue('First line\nsecond line');
  const cleared = await input.evaluate(
    (el: HTMLTextAreaElement) =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
        const check = () => (el.value === '' ? resolve(performance.now() - t0) : requestAnimationFrame(check));
        check();
      }),
  );
  expect(cleared).toBeLessThan(budget(200));
  const c = page.getByTestId('comment').filter({ hasText: 'second line' });
  await expect(c.getByTestId('comment-time')).toHaveText('0:05');
  await page.reload();
  await expect(page.getByTestId('comment').filter({ hasText: 'second line' }).getByTestId('comment-time')).toHaveText('0:05');
});

test('J-128 comment bubbles on the timeline; time chip seeks and highlights', async ({ page, context }) => {
  await signIn(context);
  await open(page, captureUrl(IDS.commented));
  const bubbles = page.getByTestId('marker-comment');
  await expect(bubbles).toHaveCount(2);
  await bubbles.first().hover();
  await expect(page.getByTestId('marker-tip')).toContainText('Dana Reviewer');
  await expect(page.getByTestId('marker-tip')).toContainText('CSRF check failed');
  const thread = page.locator(`[data-comment-id="${IDS.thread}"]`);
  await thread.getByTestId('comment-time').click();
  await expect.poll(() => videoTime(page)).toBeCloseTo(3.18, 1);
  await expect(thread).toHaveClass(/hl/);
});

test('J-129 comment permalink opens with the comment highlighted', async ({ page, context }) => {
  await signIn(context);
  await open(page, captureUrl(IDS.commented));
  const thread = page.locator(`[data-comment-id="${IDS.thread}"]`);
  await thread.hover();
  await thread.getByTestId('comment-link').click();
  await expect(page.getByRole('status').filter({ hasText: 'Link to the comment copied' })).toBeVisible();
  const url = await clipboard(page);
  expect(url).toBe(`${shareUrl(IDS.commented)}?comment=${IDS.thread}`);
  const other = await context.browser()!.newContext();
  const p2 = await other.newPage();
  await open(p2, url);
  await expect(p2.locator(`[data-comment-id="${IDS.thread}"]`)).toHaveClass(/hl/);
  await expect(p2.locator(`[data-comment-id="${IDS.thread}"]`)).toBeInViewport();
  await other.close();
});

test('J-130 reactions: one of eight, a pill with a count, click your own to remove', async ({ page, context }) => {
  await signIn(context);
  await open(page, captureUrl(IDS.commented));
  const thread = page.locator(`[data-comment-id="${IDS.thread}"]`);
  await thread.hover();
  await thread.getByTestId('react').click();
  await expect(page.getByTestId('reaction-picker').getByRole('menuitem')).toHaveCount(8);
  await page.getByTestId('pick-heart').click();
  const pill = thread.getByTestId('reaction-heart');
  await expect(pill).toHaveText('1');
  await expect(pill).toHaveAttribute('aria-pressed', 'true');
  await pill.click();
  await expect(pill).toHaveCount(0);
});

test('J-131 edit and delete your own comment', async ({ page, context }) => {
  await signIn(context);
  await open(page, captureUrl(IDS.commented));
  const input = page.getByTestId('comment-input');
  await input.fill('Typo in thsi comment');
  await input.press('Control+Enter');
  const c = page.getByTestId('comment').filter({ hasText: 'Typo in thsi comment' });
  await expect(c).toHaveAttribute('data-comment-id', /^[0-9a-f-]{36}$/);
  await c.hover();
  await c.getByTestId('comment-more').click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  await page.getByTestId('edit-input').fill('Typo in this comment');
  await page.getByTestId('save-edit').click();
  const fixed = page.getByTestId('comment').filter({ hasText: 'Typo in this comment' });
  await expect(fixed.getByTestId('edited')).toBeVisible();
  await fixed.hover();
  await fixed.getByTestId('comment-more').click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('permanent');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(fixed).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('comment').filter({ hasText: 'Typo in this comment' })).toHaveCount(0);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDGgAQYGBgAa7QH/K8x0WwAAAABJRU5ErkJggg==', 'base64');

test('J-132 attach an image: removable thumbnail, image-only comment, opens full size', async ({ page, context }) => {
  await signIn(context);
  await open(page, captureUrl(IDS.video));
  await page.getByTestId('attach-input').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('composer-attachment')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove attachment' }).click();
  await expect(page.getByTestId('composer-attachment')).toHaveCount(0);
  await page.getByTestId('attach-input').setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('send')).toBeEnabled();
  await page.getByTestId('send').click();
  const att = page.getByTestId('comment-attachment');
  await expect(att).toHaveCount(1);
  await expect(att).toHaveAttribute('target', '_blank');
  const href = await att.getAttribute('href');
  const r = await page.request.get(new URL(href!, page.url()).toString());
  expect(r.headers()['content-type']).toBe('image/png');
});

test('J-133 live updates between two browsers, jump pill below the fold', async ({ page, context, browser }) => {
  await signIn(context);
  await page.setViewportSize({ width: 1280, height: 640 });
  await open(page, captureUrl(IDS.commented));
  const other = await browser.newContext();
  await signIn(other, 'sam');
  const p2 = await other.newPage();
  await open(p2, captureUrl(IDS.commented));
  await p2.getByTestId('comment-input').fill('Live from the other browser');
  await p2.getByTestId('comment-input').press('Control+Enter');
  await expect(page.getByTestId('comment').filter({ hasText: 'Live from the other browser' })).toHaveCount(1);
  await expect(page.getByTestId('jump-pill')).toBeVisible();
  await page.getByTestId('jump-pill').click();
  await expect(page.getByTestId('comment').filter({ hasText: 'Live from the other browser' })).toBeInViewport();
  await other.close();
});

test('J-134 anonymous comment from a share link', async ({ page }) => {
  await open(page, shareUrl(IDS.commented));
  await page.getByTestId('comment-input').fill('Guest note from the share link');
  await page.getByTestId('comment-input').press('Control+Enter');
  const c = page.getByTestId('comment').filter({ hasText: 'Guest note from the share link' });
  await expect(c).toContainText('anonymous');
  await expect(c.locator('.av')).toHaveText('A');
  await page.reload();
  await expect(page.getByTestId('comment').filter({ hasText: 'Guest note from the share link' })).toContainText('Anonymous');
  await expect(page.getByTestId('comment').filter({ hasText: 'Guest note from the share link' }).getByTestId('comment-more')).toHaveCount(0);
});

test('J-135 mentions in a comment and the description email the member', async ({ page, context }) => {
  await signIn(context);
  await open(page, captureUrl(IDS.video));
  const marker = `note-${Date.now()}`;
  const input = page.getByTestId('comment-input');
  await input.fill('Please look ');
  await input.pressSequentially('@Sa');
  await expect(page.getByTestId('mention-picker')).toContainText('Sam Developer');
  await input.press('Enter');
  await expect(input).toHaveValue('Please look @Sam Developer ');
  await input.pressSequentially(marker);
  await input.press('Control+Enter');
  await expect(page.getByTestId('comment').filter({ hasText: marker }).locator('.nb-mention')).toHaveText('@Sam Developer');
  await expect.poll(async () => (await mailsTo('sam@nib.test')).some((m) => m.Snippet.includes(marker)), { timeout: 10000 }).toBe(true);
  // the description takes mentions too
  await page.getByTestId('description').click();
  const desc = page.getByTestId('description-input');
  await desc.press('End');
  await desc.pressSequentially(' @Sam');
  await expect(page.getByTestId('mention-picker')).toBeVisible();
  await desc.press('Tab');
  await page.locator('body').click({ position: { x: 5, y: 600 } });
  await expect(page.getByTestId('description').locator('.nb-mention')).toHaveText('@Sam Developer');
  await expect.poll(async () => (await mailsTo('sam@nib.test')).some((m) => /the description/.test(m.Snippet)), { timeout: 10000 }).toBe(true);
});

test('J-133 a hidden tab closes its comments stream and catches up when shown again', async ({ page, context }) => {
  // Each open stream holds one of the browser's six HTTP/1.1 connections to the server, so six
  // background capture tabs stalled every new page of the app. Playwright reports every page as
  // visible, so the test flips document.visibilityState itself.
  await page.addInitScript(() => {
    const w = window as unknown as { __open: number; __hidden: boolean };
    w.__open = 0;
    w.__hidden = false;
    Object.defineProperty(document, 'visibilityState', { get: () => (w.__hidden ? 'hidden' : 'visible') });
    const Orig = window.EventSource;
    window.EventSource = class extends Orig {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        w.__open++;
      }
      close() {
        if (this.readyState !== 2) w.__open--;
        super.close();
      }
    } as typeof EventSource;
  });
  const setHidden = (hidden: boolean) =>
    page.evaluate((h) => {
      (window as unknown as { __hidden: boolean }).__hidden = h;
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  const open = () => page.evaluate(() => (window as unknown as { __open: number }).__open);
  await signIn(context);
  await openPage(page, captureUrl(IDS.video));
  await expect.poll(open).toBe(1);
  await setHidden(true);
  expect(await open()).toBe(0);
  const text = `Made while hidden ${Date.now().toString(36)}`;
  const r = await context.request.post(`${SERVER}/api/v1/recordings/${IDS.video}/comments`, { data: { body: text }, headers: { origin: SERVER } });
  expect(r.status()).toBeLessThan(300);
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('comment').filter({ hasText: text })).toHaveCount(0);
  await setHidden(false);
  await expect.poll(open).toBe(1);
  await expect(page.getByTestId('comment').filter({ hasText: text })).toHaveCount(1);
  // live again
  const live = `Live after coming back ${Date.now().toString(36)}`;
  await context.request.post(`${SERVER}/api/v1/recordings/${IDS.video}/comments`, { data: { body: live }, headers: { origin: SERVER } });
  await expect(page.getByTestId('comment').filter({ hasText: live })).toHaveCount(1);
});
