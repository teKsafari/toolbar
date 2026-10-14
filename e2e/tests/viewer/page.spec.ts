// Page chrome: J-110, J-111, J-112, J-113, J-116, J-117, J-118, J-121, J-205, J-114.
import { expect, test } from '@playwright/test';
import { allowClipboard, captureUrl, clipboard, IDS, open, ready, reseed, SERVER, shareUrl, signIn, videoTime } from './helpers.ts';

test.beforeAll(() => reseed());
test.afterAll(() => reseed());

test.describe('member', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context);
    await allowClipboard(context);
  });

  test('J-110 inline title and description editing', async ({ page, context }) => {
    await open(page, captureUrl(IDS.video));
    await page.getByTestId('title').getByRole('button').click();
    const input = page.getByTestId('title-input');
    await input.fill('Order button fails silently');
    await input.press('Enter');
    await expect(page.getByTestId('title')).toHaveText('Order button fails silently');
    await expect(page).toHaveTitle(/^Order button fails silently/);
    await page.getByTestId('description').click();
    const desc = page.getByTestId('description-input');
    await desc.fill('- first step\n- second **bold** step');
    await page.getByTestId('title').click({ position: { x: 1, y: 1 }, force: true }).catch(() => {});
    await page.locator('body').click({ position: { x: 5, y: 600 } });
    await expect(page.getByTestId('description').locator('li')).toHaveCount(2);
    await expect(page.getByTestId('description').locator('strong')).toHaveText('bold');
    await page.reload();
    await expect(page.getByTestId('title')).toHaveText('Order button fails silently');
    await expect(page.getByTestId('description').locator('li')).toHaveCount(2);
    // a logged-out viewer cannot edit
    const anon = await context.browser()!.newContext();
    const p2 = await anon.newPage();
    await open(p2, shareUrl(IDS.video));
    await expect(p2.getByTestId('title')).toHaveText('Order button fails silently');
    await expect(p2.getByTestId('title').getByRole('button')).toHaveCount(0);
    await p2.getByTestId('description').click();
    await expect(p2.getByTestId('description-input')).toHaveCount(0);
    await anon.close();
  });

  test('J-111 time links in the description seek the player', async ({ page }) => {
    const r = await page.request.patch(`${SERVER}/api/v1/recordings/${IDS.commented}`, {
      data: { description: '1. Fill the name [0:02](t:2000)\n2. Press Send [0:05](t:5000)' },
      headers: { origin: SERVER },
    });
    expect(r.ok()).toBe(true);
    await open(page, captureUrl(IDS.commented));
    await page.getByTestId('description').getByRole('button', { name: '0:05' }).click();
    await expect.poll(() => videoTime(page)).toBeCloseTo(5, 1);
  });

  test('J-112 J-113 header actions and move to folder', async ({ page }) => {
    await open(page, captureUrl(IDS.video));
    await expect(page.getByTestId('home')).toHaveAttribute('href', '/');
    await expect(page.getByTestId('folder-chip')).toHaveText('All captures');
    await expect(page.getByTestId('send-split')).toBeVisible();
    await expect(page.getByTestId('copy-split')).toBeVisible();
    await page.getByTestId('send-caret').click();
    await expect(page.getByRole('menuitem', { name: 'Connect an app' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('more').click();
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Move to folder' }).click();
    await expect(page.getByRole('menuitem', { name: 'New folder' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Checkout bugs' }).click();
    await expect(page.getByTestId('folder-chip')).toHaveText('Checkout bugs');
    await expect(page.getByRole('status').filter({ hasText: 'Moved to Checkout bugs' })).toBeVisible();
    const d = await (await page.request.get(`${SERVER}/api/v1/recordings/${IDS.video}`)).json();
    expect(d.folderId).toBe(IDS.folder);
    await page.reload();
    await expect(page.getByTestId('folder-chip')).toHaveText('Checkout bugs');
  });

  test('J-116 Figma link reveals an embed on click', async ({ page }) => {
    await page.request.patch(`${SERVER}/api/v1/recordings/${IDS.screenshot}`, {
      data: { description: 'Design: https://www.figma.com/design/AbC123xyz/Checkout?node-id=1-2' },
      headers: { origin: SERVER },
    });
    await open(page, captureUrl(IDS.screenshot));
    await expect(page.getByTestId('figma-embed')).toHaveCount(0);
    await page.getByTestId('figma-toggle').click();
    await expect(page.getByTestId('figma-embed')).toHaveAttribute('src', /figma\.com\/embed\?.*url=https%3A%2F%2Fwww\.figma\.com%2Fdesign%2FAbC123xyz/);
  });

  test('J-117 copy share link: tick for about 2 s and a toast', async ({ page }) => {
    await open(page, captureUrl(IDS.video));
    await page.getByTestId('copy-link').click();
    await expect(page.getByTestId('copy-link')).toHaveText('Copied');
    await expect(page.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible();
    expect(await clipboard(page)).toBe(shareUrl(IDS.video));
    await expect(page.getByTestId('copy-link')).toHaveText('Copy link', { timeout: 3000 });
  });

  test('J-118 link with or without dev tools', async ({ page, context }) => {
    await open(page, captureUrl(IDS.commented));
    await page.getByTestId('share-caret').click();
    await expect(page.getByTestId('share-full')).toBeVisible();
    await page.getByTestId('share-content').click();
    const url = await clipboard(page);
    // since the merge the content-only link is server-core's own link (its own token, dev tools
    // refused on the server), not the full link with ?devtools=0
    expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{16,64}$/);
    expect(url.startsWith(shareUrl(IDS.commented))).toBe(false);
    const anon = await context.browser()!.newContext();
    const p2 = await anon.newPage();
    await open(p2, url);
    await expect(p2.getByTestId('video-card')).toBeVisible();
    await expect(p2.getByTestId('title')).toBeVisible();
    await expect(p2.getByTestId('description')).toBeVisible();
    await expect(p2.getByTestId('comments')).toContainText('CSRF check failed');
    await expect(p2.getByTestId('devtools')).toHaveCount(0);
    await expect(p2.getByTestId('show-devtools')).toHaveCount(0);
    await anon.close();
  });
});

test('J-121 logged-out viewer: every tab, copy cURL, share-at-time, download; sign-in only', async ({ page, context }) => {
  await allowClipboard(context);
  await open(page, shareUrl(IDS.video));
  await ready(page);
  const header = page.getByTestId('viewer-header');
  await expect(header.getByTestId('sign-in')).toBeVisible();
  await expect(header.getByTestId('sign-up')).toBeVisible();
  for (const id of ['home', 'more', 'send-split', 'copy-split', 'folder-chip']) await expect(header.getByTestId(id)).toHaveCount(0);
  await expect(page.getByTestId('title').getByRole('button')).toHaveCount(0);
  for (const t of ['info', 'console', 'network', 'actions']) {
    await page.getByTestId(`tab-${t}`).click();
    await expect(page.getByTestId(`tab-${t}`)).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByTestId('actions-list')).toContainText('Submit order');
  await page.getByTestId('tab-network').click();
  await page.locator('[data-rid="top-2"]').click();
  await page.getByTestId('copy-curl').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('-X POST');
  await page.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 1.5));
  await page.getByTestId('share-at-time').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${shareUrl(IDS.video)}?t=1.5`);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.webm$/);
});

test('J-205 unknown capture: one centred line', async ({ page, context }) => {
  await signIn(context);
  await page.goto(`${SERVER}/c/019a0000-0000-7000-8000-00000000dead`);
  await expect(page.getByTestId('not-found')).toHaveText('This capture could not be found.');
  await expect(page.locator('a')).toHaveCount(0);
  await expect(page.locator('header')).toHaveCount(0);
  const r = await page.goto(`${SERVER}/s/AAAAAAAAAAAAAAAAAAAAAA`);
  expect(r?.status()).toBe(404);
  await expect(page.getByTestId('not-found')).toBeVisible();
});

test('J-114 delete: confirm, toast, dashboard within 3 s, then not found', async ({ page, context }) => {
  await signIn(context);
  await open(page, captureUrl(IDS.screenshot));
  await page.getByTestId('more').click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toContainText('permanent');
  const t0 = Date.now();
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Capture deleted' })).toBeVisible();
  await page.waitForURL(`${SERVER}/`);
  expect(Date.now() - t0).toBeLessThan(3000);
  await page.goto(captureUrl(IDS.screenshot));
  await expect(page.getByTestId('not-found')).toBeVisible();
  const s = await page.goto(shareUrl(IDS.screenshot));
  expect(s?.status()).toBe(404);
});
