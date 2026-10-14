// Recording links page and the recipient's recorder page (J-017, J-126, J-167, J-223, J-241).
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mailTo } from '../auth/helpers.ts';
import { SERVER, go, json, launch, me, newContext, signIn, toast, uniqueEmail } from './helpers.ts';

// One account and page for the whole file; a failure skips the rest instead of re-running setup.
test.describe.configure({ mode: 'serial' });

let browser: Browser;
let page: Page;
let email: string;

test.beforeAll(async () => {
  browser = await launch();
  page = await (await newContext(browser)).newPage();
  email = uniqueEmail(undefined, 'links');
  await signIn(page, email);
  const { activeWorkspaceId } = await me(page);
  await json(page, 'POST', `/api/v1/workspaces/${activeWorkspaceId}/folders`, { name: 'Support' });
  await json(page, 'POST', `/api/v1/workspaces/${activeWorkspaceId}/folders`, { name: 'Triage' });
});
test.afterAll(async () => browser.close());

test('J-167, J-015: the new-link popover creates a link, copies it and lists it with its folder chip', async () => {
  await go(page, '/links');
  await expect(page.getByTestId('links-empty')).toBeVisible();
  await page.getByTestId('new-link').click();
  await page.getByTestId('new-link-name').fill('Customer reports');
  await page.getByTestId('new-link-folder').selectOption({ label: 'Support' });
  await page.getByTestId('new-link-ref').fill('https://github.com/acme/shop/issues/12');
  await page.getByTestId('new-link-create').click();
  await toast(page, 'Recording link created and copied');
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(new RegExp(`^${SERVER}/rl/[A-Za-z0-9_-]{22}$`));
  const row = page.getByTestId('link-row').first();
  await expect(row.getByTestId('link-name')).toHaveText('Customer reports');
  await expect(row.getByTestId('link-folder')).toContainText('Support');
  await expect(row.getByTestId('link-uses')).toHaveText('0 recordings');
  await expect(row.getByTestId('link-ref')).toHaveText('acme/shop#12');
  await expect(row.locator('.mosaic')).toBeVisible();
});

test('J-223: rename in place with the pencil, retarget the folder from the chip (and make a new one)', async () => {
  await go(page, '/links');
  const row = page.getByTestId('link-row').first();
  await row.getByTestId('link-rename').click();
  await page.getByTestId('link-rename-input').fill('Support inbox');
  await page.keyboard.press('Enter');
  await toast(page, 'Link renamed');
  await expect(row.getByTestId('link-name')).toHaveText('Support inbox');
  await row.getByTestId('link-folder').click();
  await page.getByTestId('folder-picker').getByRole('menuitem', { name: 'Triage' }).click();
  await toast(page, 'New recordings land in Triage');
  await expect(row.getByTestId('link-folder')).toContainText('Triage');
  await row.getByTestId('link-folder').click();
  await page.getByTestId('picker-new-folder').click();
  await page.getByTestId('picker-new-folder-input').fill('From customers');
  await page.keyboard.press('Enter');
  await toast(page, 'New recordings land in From customers');
  await expect(page.getByTestId('folder-list').getByRole('link', { name: 'From customers' })).toBeVisible();
});

test('J-017, J-126: a signed-out recipient records screen and voice, adds a note and sends; it lands in the folder and the owner gets an email', async () => {
  await go(page, '/links');
  const row = page.getByTestId('link-row').first();
  await row.getByTestId('link-share').click();
  await page.getByTestId('link-copy').click();
  await toast(page, 'Link copied');
  const base = await page.evaluate(() => navigator.clipboard.readText());
  const guestCtx = await newContext(browser);
  const guest = await guestCtx.newPage();
  await guest.goto(`${base}?title=${encodeURIComponent('Checkout total is wrong')}&mic=1&ref=${encodeURIComponent('https://github.com/acme/shop/issues/12')}`);
  await guest.waitForFunction(() => document.documentElement.hasAttribute('data-app-ready'));
  await expect(guest.getByRole('heading', { level: 1 })).toHaveText('Checkout total is wrong');
  await expect(guest.getByTestId('choose-voice')).toHaveAttribute('aria-checked', 'true'); // mic=1 preset
  await guest.getByTestId('recorder-start').click();
  await expect(guest.getByTestId('recorder-live')).toBeVisible({ timeout: 15_000 });
  await guest.waitForTimeout(2500);
  await expect(guest.getByTestId('recorder-time')).not.toHaveText('0:00');
  await guest.getByTestId('recorder-stop').click();
  await expect(guest.getByTestId('recorder-preview')).toBeVisible();
  await guest.getByTestId('recorder-note').fill('The total jumps after I add the pen.');
  await guest.getByTestId('recorder-submit').click();
  await expect(guest.getByTestId('recorder-done')).toBeVisible({ timeout: 30_000 });
  await guestCtx.close();

  // owner side: the uses count, the capture in the link's folder, and an email
  await expect.poll(async () => {
    await go(page, '/links');
    return page.getByTestId('link-row').first().getByTestId('link-uses').textContent();
  }, { timeout: 30_000 }).toBe('1 recording');
  await page.getByTestId('link-row').first().getByTestId('link-open-captures').click();
  await expect(page.getByTestId('filter-chip')).toHaveText(['Via recording link']);
  const card = page.getByTestId('capture-card').first();
  await expect(card).toContainText('Checkout total is wrong');
  await expect(card).toContainText('Support inbox'); // the recording-link chip
  const { activeWorkspaceId } = await me(page);
  const folders = await json<{ items: { id: string; name: string }[] }>(page, 'GET', `/api/v1/workspaces/${activeWorkspaceId}/folders`);
  const target = folders.items.find((f) => f.name === 'From customers')!;
  const list = await json<{ items: { id: string; title: string; source: string; kind: string }[] }>(page, 'GET', `/api/v1/recordings?folderId=${target.id}`);
  expect(list.items[0]).toMatchObject({ title: 'Checkout total is wrong', source: 'recording-link', kind: 'link' });
  const issues = await json<{ items: { key: string }[] }>(page, 'GET', `/api/v1/recordings/${list.items[0]!.id}/issues`);
  expect(issues.items.map((i) => i.key)).toContain('acme/shop#12'); // J-241: the ticket links back
  const mail = await mailTo(page.request, email, /New recording from "Support inbox"/);
  expect(mail.text).toContain('The total jumps after I add the pen.');
  expect(mail.text).toContain(`/c/${list.items[0]!.id}`);
});

test('J-167: status and sort filters, turn off, and delete after confirm', async () => {
  const { activeWorkspaceId } = await me(page);
  await json(page, 'POST', `/api/v1/workspaces/${activeWorkspaceId}/recording-links`, { name: 'Aardvark link' });
  await go(page, '/links');
  await page.getByTestId('link-sort').selectOption('name');
  await expect(page.getByTestId('link-name')).toHaveText(['Aardvark link', 'Support inbox']);
  await page.getByTestId('link-sort').selectOption('most-used');
  await expect(page.getByTestId('link-name').first()).toHaveText('Support inbox');
  const row = page.getByTestId('link-row').filter({ hasText: 'Aardvark link' });
  await row.getByTestId('link-more').click();
  await page.getByRole('menuitem', { name: 'Turn off' }).click();
  await toast(page, 'Link turned off');
  await expect(page.getByTestId('link-row')).toHaveCount(1);
  await page.getByTestId('link-status').getByRole('radio', { name: 'Turned off' }).click();
  await expect(page.getByTestId('link-name')).toHaveText(['Aardvark link']);
  const off = await json<{ items: { url: string }[] }>(page, 'GET', `/api/v1/workspaces/${activeWorkspaceId}/recording-links?status=revoked`);
  const guest = await (await newContext(browser)).newPage();
  await guest.goto(off.items[0]!.url);
  await expect(guest.getByTestId('recorder-unavailable')).toContainText('This link was turned off');
  await guest.context().close();
  await page.getByTestId('link-row').first().getByTestId('link-more').click();
  await page.getByTestId('link-delete').click();
  await page.locator('[data-testid=confirm-dialog][open]').getByTestId('confirm-button').click();
  await toast(page, 'Recording link deleted');
  await expect(page.getByTestId('links-empty')).toBeVisible();
});

test('J-207: the recording links page shows a spinner while it loads', async () => {
  await page.route('**/recording-links?*', async (r) => {
    await new Promise((x) => setTimeout(x, 1500));
    await r.continue();
  });
  await go(page, '/links');
  await expect(page.getByTestId('links-loading')).toBeVisible();
  await expect(page.getByTestId('links-loading')).toBeHidden({ timeout: 10_000 });
  await page.unroute('**/recording-links?*');
});
