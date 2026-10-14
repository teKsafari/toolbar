// Dashboard grid, filters, palette, empty and not-found states, phone width and dark mode, on
// the seed workspace (read only). Needs the seed (scripts/area-setup.sh dashboard --seed).
import { test, expect, type Browser, type Page } from '@playwright/test';
import { SERVER, go, launch, newContext, signIn, toast } from './helpers.ts';

// One account and page for the whole file; a failure skips the rest instead of re-running setup.
test.describe.configure({ mode: 'serial' });

let browser: Browser;
let page: Page;
const SAM = '019a0000-0000-7000-8000-000000000002';

test.beforeAll(async () => {
  browser = await launch();
  page = await (await newContext(browser)).newPage();
  await signIn(page, 'dana@nib.test', 'nib-dev-password');
});
test.afterAll(async () => browser.close());

test('J-158, J-159: grid cards with thumbnail, creator, duration, title and time; hover shows check and copy', async () => {
  await go(page, '/');
  const cards = page.getByTestId('capture-card');
  await expect(cards).toHaveCount(2); // the foldered screenshot is left out
  const first = cards.first();
  await expect(first).toHaveAttribute('href', /\/c\/019a0000-0000-7000-8000-0000000000c3$/);
  await expect(first.getByTestId('duration')).toHaveText('0:08');
  await expect(first).toContainText('Sam Developer');
  await expect(first).toContainText('Details form rejects valid input');
  await expect(first.locator('img').first()).toHaveJSProperty('complete', true);
  await first.hover();
  await expect(first.getByTestId('card-check')).toBeVisible();
  await first.getByTestId('card-copy').click();
  await toast(page, 'Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${SERVER}/c/019a0000-0000-7000-8000-0000000000c3`);
  await expect(page).toHaveURL(`${SERVER}/`); // copying does not open the card
});

test('J-160, J-204: filters become chips, survive a reload, and an empty result shows two lines', async () => {
  await go(page, '/');
  await page.getByTestId('filter-type').click();
  await page.getByRole('option', { name: 'Screenshot' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-chip')).toHaveText(['Screenshot']);
  await expect(page).toHaveURL(/type=screenshot/);
  await expect(page.getByTestId('no-results')).toContainText('No captures match these filters.');
  await go(page, '/?type=screenshot');
  await expect(page.getByTestId('filter-chip')).toHaveText(['Screenshot']);
  await page.getByRole('button', { name: 'Clear Screenshot' }).click();
  await expect(page.getByTestId('capture-card')).toHaveCount(2);
  await page.getByTestId('filter-creator').click();
  await page.getByRole('option', { name: /Sam Developer/ }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('capture-card')).toHaveCount(1);
  await expect(page.getByTestId('filter-chip')).toHaveText(['By Sam Developer']);
  await page.getByTestId('filter-source').click();
  await page.getByRole('option', { name: 'Upload' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('filter-chip')).toHaveCount(2);
  await expect(page.getByTestId('no-results')).toBeVisible();
});

test('J-161, J-228: Ctrl+K palette: recent rows, grouped results, preview, arrows, Enter, Ctrl+C, members', async () => {
  await go(page, '/');
  await page.keyboard.press('Control+k');
  const pal = page.getByTestId('palette');
  await expect(pal).toBeVisible();
  await expect(page.getByTestId('palette-input')).toHaveAttribute('placeholder', 'Search captures, people and folders');
  await expect(pal.locator('[data-row-type=capture]').first()).toBeVisible();
  await expect(pal).toContainText('Recently viewed');
  await page.getByTestId('palette-input').fill('submit');
  await expect(pal.locator('[data-row-type=capture]').first()).toContainText(/Submit order/);
  await expect(page.getByTestId('palette-preview')).toBeVisible();
  await expect(page.getByTestId('palette-enter-hint')).toContainText('Open capture');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Control+c');
  await toast(page, 'Link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/c\/019a0000-0000-7000-8000-0000000000c\d$/);
  // members group above captures; Enter opens the creator filter (J-228)
  await page.getByTestId('palette-input').fill('sam');
  await expect(pal.locator('[data-row-type=member]')).toHaveCount(1);
  await expect(pal).toContainText('Members');
  await expect(page.getByTestId('palette-enter-hint')).toContainText('Show their captures');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(`${SERVER}/?by=${SAM}`);
  await expect(page.getByTestId('filter-chip')).toHaveText(['By Sam Developer']);
  // nothing found (J-204)
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('zzqqxxnothing');
  await expect(page.getByTestId('palette-empty')).toContainText('Nothing matches');
  await page.keyboard.press('Escape');
  await expect(pal).toBeHidden();
  // Enter on a capture opens it
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('Details form');
  await expect(pal.locator('[data-row-type=capture]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/c\/019a0000-0000-7000-8000-0000000000c3$/);
});

test('J-162: the active folder shows its count and folder URLs use a 4-character id', async () => {
  await go(page, '/');
  const link = page.getByTestId('folder-list').getByRole('link', { name: /Checkout bugs/ });
  await link.click();
  await expect(page).toHaveURL(/\/f\/[a-z2-9]{4}$/);
  await expect(page.getByTestId('folder-count')).toHaveText('1');
  await expect(page.getByTestId('capture-card')).toHaveCount(1);
});

test('J-214: an unknown route shows the drawn not-found page with a button home', async () => {
  await go(page, '/nope');
  await expect(page.getByTestId('not-found')).toBeVisible();
  await page.getByRole('link', { name: 'Back to captures' }).click();
  await expect(page).toHaveURL(`${SERVER}/`);
});

test('J-207: the grid shows skeletons while captures load', async () => {
  const p = await (await newContext(browser)).newPage();
  await signIn(p, 'dana@nib.test', 'nib-dev-password');
  await p.route('**/api/v1/recordings?*', async (r) => {
    await new Promise((x) => setTimeout(x, 1500));
    await r.continue();
  });
  await go(p, '/');
  await expect(p.getByTestId('grid-skeleton')).toBeVisible();
  await expect(p.getByTestId('capture-card')).toHaveCount(2);
  await p.context().close();
});

test('390 px and dark mode: one column, the sidebar becomes a drawer, dark tokens apply', async () => {
  const ctx = await newContext(browser, { width: 390, height: 844, dark: true });
  const p = await ctx.newPage();
  await signIn(p, 'dana@nib.test', 'nib-dev-password');
  await go(p, '/');
  await expect(p.getByTestId('capture-card')).toHaveCount(2);
  const widths = await p.getByTestId('capture-card').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThan(300);
  expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(p.getByTestId('nav-all')).not.toBeInViewport();
  await p.getByTestId('menu-button').click();
  await expect(p.getByTestId('nav-links')).toBeInViewport();
  await p.getByTestId('nav-links').click();
  await expect(p).toHaveURL(`${SERVER}/links`);
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g)!.map(Number);
  expect(r! + g! + b!).toBeLessThan(150);
  await p.screenshot({ path: 'test-results/dashboard-390-dark.png' });
  await ctx.close();
});
