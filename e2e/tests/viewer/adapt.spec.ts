// The capture page adapts to what the capture holds (owner, D-206): a comment-only feedback starts
// with the dev tools pane collapsed and its page facts in a strip; each note shows chips for the
// errors and failed requests it attached, which open Console or Network on the note's window;
// tabs with no entries are hidden. Captures with data keep today's layout.
import { expect, test, type Page } from '@playwright/test';
import { captureUrl, IDS, open, ready, reseed, shareUrl, signIn } from './helpers.ts';

test.beforeAll(() => reseed());

const tabs = (page: Page) => page.getByTestId('devtools').getByRole('tab');

test.describe('member', () => {
  test.beforeEach(async ({ context }) => {
    await signIn(context);
  });

  test('comment-only feedback: pane collapsed, facts in a strip, the list takes the width; the toggle opens Info and Agent only', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, captureUrl(IDS.feedback));
    await ready(page);
    const strip = page.getByTestId('info-strip');
    await expect(strip).toBeVisible();
    for (const t of ['http://localhost:5173/', 'Chrome 141.0.7390.54', 'Linux', '1280 x 720']) await expect(strip).toContainText(t);
    await expect(page.getByTestId('right-panel')).toHaveCount(0);
    await expect(page.getByTestId('feedback-item')).toHaveCount(3);
    // no chips on notes that attached nothing
    await expect(page.getByTestId('feedback-context')).toHaveCount(0);
    const list = (await page.getByTestId('feedback-list').boundingBox())!;
    expect(list.width, 'the feedback list uses the freed width').toBeGreaterThan(900);
    // the strip sits between the header and the list, one line high
    const s = (await strip.boundingBox())!;
    expect(s.height).toBeLessThanOrEqual(40);
    expect(s.y + s.height).toBeLessThanOrEqual(list.y);

    // the pane still opens, with only the tabs that have something
    await page.getByTestId('show-devtools').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(tabs(page)).toHaveText(['Info', 'Agent']);
    await expect(page.getByTestId('tab-info')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('info-tab')).toContainText('http://localhost:5173/');
    // keyboard: Tab reaches the tabs, Enter switches
    await page.getByTestId('tab-info').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tab-agent')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tab-agent')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('tab-info').click();
    await page.getByTestId('show-devtools').click();
    await expect(page.getByTestId('right-panel')).toHaveCount(0);

    // opening it here leaves other captures alone: a video keeps two columns and no strip
    await page.getByTestId('show-devtools').click();
    await open(page, captureUrl(IDS.video));
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('info-strip')).toHaveCount(0);
    await expect(tabs(page)).toHaveText(['Info', 'Console', 'Network', 'Actions', 'Agent']);
    // and the lean capture starts collapsed again
    await open(page, captureUrl(IDS.feedback));
    await expect(page.getByTestId('right-panel')).toHaveCount(0);
  });

  test('a replay and a feedback with logs keep the two columns; empty tabs are hidden', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, captureUrl(IDS.replay));
    await ready(page);
    await expect(page.getByTestId('info-strip')).toHaveCount(0);
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(tabs(page)).toHaveText(['Info', 'Console', 'Actions', 'Agent']);

    await open(page, captureUrl(IDS.feedbackCtx));
    await ready(page);
    await expect(page.getByTestId('info-strip')).toHaveCount(0);
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(tabs(page)).toHaveText(['Info', 'Console', 'Network', 'Agent']);
    await expect(page.getByTestId('tab-actions')).toHaveCount(0);
  });

  test('context chips: a note shows what it attached, and a chip opens the pane on its window with those entries selected', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, captureUrl(IDS.feedbackCtx));
    await ready(page);
    const notes = page.getByTestId('feedback-item');
    await expect(notes).toHaveCount(2);
    await expect(notes.nth(0).getByTestId('feedback-context')).toHaveCount(0);
    await expect(notes.nth(1).getByTestId('feedback-chip-errors')).toHaveText('1 error');
    await expect(notes.nth(1).getByTestId('feedback-chip-requests')).toHaveText('1 failed request');

    // the chip opens a hidden pane
    await page.getByTestId('hide-devtools').click();
    await expect(page.getByTestId('right-panel')).toHaveCount(0);
    await notes.nth(1).getByTestId('feedback-chip-errors').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('tab-console')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('note-window')).toContainText('Note 2');
    const rows = page.getByTestId('console-list').locator('.vp-row');
    // the error after the note is outside its window; the two attached entries are selected
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('console-list')).not.toContainText('a later error');
    await expect(page.getByTestId('console-list').locator('[data-picked]')).toHaveCount(2);

    await notes.nth(1).getByTestId('feedback-chip-requests').click();
    await expect(page.getByTestId('tab-network')).toHaveAttribute('aria-selected', 'true');
    const req = page.getByTestId('network-list').locator('.nrow');
    await expect(req).toHaveCount(1);
    await expect(req.first()).toHaveAttribute('data-picked', 'true');
    await expect(req.first()).toHaveClass(/\bsel\b/);
    await expect(page.getByText('500 Internal Server Error')).toBeVisible();

    // the X shows every entry again
    await page.getByTestId('note-window-clear').click();
    await expect(page.getByTestId('note-window')).toHaveCount(0);
    await page.getByTestId('tab-console').click();
    await expect(rows).toHaveCount(3);
    await expect(page.getByTestId('console-list').locator('[data-picked]')).toHaveCount(0);
  });

  test('at 390 px a chip switches to the dev tools view; the strip wraps without a side scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, captureUrl(IDS.feedback));
    await expect(page.getByTestId('info-strip')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await open(page, captureUrl(IDS.feedbackCtx));
    await ready(page);
    await page.getByTestId('feedback-chip-requests').click();
    await expect(page.getByTestId('right-panel')).toBeVisible();
    await expect(page.getByTestId('tab-network')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('narrow-devtools')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('narrow-capture').click();
    await expect(page.getByTestId('feedback-list')).toBeVisible();
  });
});

test('the share page adapts the same way, and its chips open the pane', async ({ browser }) => {
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await anon.newPage();
  await open(page, shareUrl(IDS.feedback));
  await expect(page.getByTestId('info-strip')).toBeVisible();
  await expect(page.getByTestId('right-panel')).toHaveCount(0);
  await open(page, shareUrl(IDS.feedbackCtx));
  await ready(page);
  await page.getByTestId('feedback-chip-errors').click();
  await expect(page.getByTestId('tab-console')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('console-list').locator('[data-picked]')).toHaveCount(2);
  await anon.close();
});
