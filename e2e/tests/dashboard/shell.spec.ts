// Shell extras on a fresh account: new capture (J-018), help menu (J-170), onboarding card
// (J-169), palette skeleton rows (J-207), folder share popover (J-122), the Created-by-me nav.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { NEW_CAPTURE_EVENT } from '@toolbar/shared/areas/dashboard';
import { mailTo } from '../auth/helpers.ts';
import { SERVER, go, json, launch, me, newContext, signIn, toast, uniqueEmail } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  browser = await launch();
  page = await (await newContext(browser)).newPage();
  await signIn(page, uniqueEmail(undefined, 'shell'));
});
test.afterAll(async () => browser.close());

test('J-018: new capture asks the extension to open its menu, or explains how to get it', async () => {
  await go(page, '/');
  await page.getByTestId('new-capture').first().click();
  const help = page.getByTestId('new-capture-help');
  await expect(help).toContainText('Capture with the extension');
  await expect(help.getByRole('link', { name: /Install and connect/ })).toHaveAttribute('href', '/settings/browsers');
  await page.keyboard.press('Escape');
  // with the extension present (it marks <html>), the click dispatches the event instead
  await page.evaluate((ev) => {
    document.documentElement.setAttribute('data-tb-extension', '');
    (window as unknown as { __got: unknown[] }).__got = [];
    window.addEventListener(ev, (e) => (window as unknown as { __got: unknown[] }).__got.push((e as CustomEvent).detail));
  }, NEW_CAPTURE_EVENT);
  await page.getByTestId('new-capture').first().click();
  expect(await page.evaluate(() => (window as unknown as { __got: unknown[] }).__got)).toEqual([{ from: 'dashboard' }]);
  await expect(help).toBeHidden();
});

test('J-170: the help button opens docs, source, issues and install links, shortcuts and the theme', async () => {
  await go(page, '/');
  await page.getByTestId('help-button').click();
  const menu = page.getByTestId('help-menu');
  for (const l of ['Documentation', 'Source code', 'Report a problem', 'Install the extension']) await expect(menu.getByRole('menuitem', { name: l })).toBeVisible();
  await expect(menu).not.toContainText(/pricing|chat/i);
  await menu.locator('[data-theme-choice=dark]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await go(page, '/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); // remembered
  await page.getByTestId('help-button').click();
  await page.getByTestId('help-menu').locator('[data-theme-choice=system]').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
});

test('J-169: the setup card lists four steps as links, ticks done ones, and can be dismissed', async () => {
  await go(page, '/');
  const card = page.getByTestId('onboarding');
  await expect(card.getByRole('link')).toHaveCount(4);
  await expect(card.locator('li.done')).toHaveCount(0);
  const { activeWorkspaceId } = await me(page);
  await json(page, 'POST', `/api/v1/workspaces/${activeWorkspaceId}/webhooks`, { url: 'http://127.0.0.1:9/never', events: ['capture.deleted'] });
  await go(page, '/');
  await expect(card.locator('li.done')).toHaveText(['Connect an app']);
  await page.getByTestId('onboarding-dismiss').click();
  await expect(card).toBeHidden();
  await go(page, '/');
  await expect(page.getByTestId('onboarding')).toHaveCount(0);
});

test('J-207: the palette shows skeleton rows while recent captures load', async () => {
  await page.route('**/api/v1/search/recent*', async (r) => {
    await new Promise((x) => setTimeout(x, 1500));
    await r.continue();
  });
  await go(page, '/');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette-skeleton').first()).toBeVisible();
  await expect(page.getByTestId('palette-skeleton')).toHaveCount(0, { timeout: 10_000 });
  await page.keyboard.press('Escape');
  await page.unroute('**/api/v1/search/recent*');
});

test('J-122: folder share popover copies the link, invites by email and sets general access', async () => {
  const { activeWorkspaceId } = await me(page);
  const f = await json<{ shortId: string }>(page, 'POST', `/api/v1/workspaces/${activeWorkspaceId}/folders`, { name: 'Shared work' });
  await go(page, `/f/${f.shortId}`);
  await page.getByTestId('folder-share').click();
  await page.getByTestId('folder-copy-link').click();
  await toast(page, 'Folder link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${SERVER}/f/${f.shortId}`);
  const guest = uniqueEmail(undefined, 'guest');
  await expect(page.getByTestId('folder-invite')).toBeDisabled();
  await page.getByTestId('folder-invite-email').fill(guest);
  await page.getByTestId('folder-invite').click();
  await toast(page, `Invited ${guest}`);
  await expect(page.getByTestId('folder-people')).toContainText(guest);
  await expect(page.getByTestId('folder-people')).toContainText('Invited');
  await page.getByTestId('folder-access').selectOption('private');
  await expect.poll(async () => (await json<{ access: string }>(page, 'GET', `/api/v1/folders/${f.shortId}/share`)).access).toBe('private');
  const mail = await mailTo(page.request, guest, /shared "Shared work"/);
  expect(mail.text).toContain(`/f/${f.shortId}`);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('folder-title')).toContainText('Shared work');
  // the folder now shows a lock in the sidebar
  await expect(page.getByTestId('folder-list').getByRole('link', { name: 'Shared work' }).locator('[data-icon=lock]')).toBeVisible();
});

test('Created by me sets the creator filter to the caller', async () => {
  await go(page, '/');
  await page.getByTestId('nav-mine').click();
  const { id } = await me(page);
  await expect(page).toHaveURL(`${SERVER}/?by=${id}`);
  await expect(page.getByRole('heading', { name: 'Created by me' })).toBeVisible();
  await expect(page.getByTestId('nav-mine')).toHaveClass(/active/);
});
