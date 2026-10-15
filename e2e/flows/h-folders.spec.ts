// Flow H: file captures into a folder. Create a folder from the sidebar (hover the heading,
// plus, type, Enter), move a capture with the card checkbox (tick, move, pick), and drag
// another card onto the folder.
import { SERVER, expect, hydrated, saveShot, test } from './fixture.ts';
import { instantReplay, recordLabErrors } from './journeys.ts';

test('H: new folder from the sidebar; move by checkbox and by drag', async ({ tb, context }) => {
  const video = await recordLabErrors(tb);
  const replay = await instantReplay(tb);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SERVER}/`);
  await hydrated(page);
  const name = `Checkout ${Date.now().toString(36)}`;
  await page.getByTestId('folders-heading').hover();
  await page.getByTestId('new-folder').click();
  await page.getByTestId('new-folder-input').fill(name);
  await page.keyboard.press('Enter');
  const folder = page.getByTestId('folder-list').getByRole('link', { name });
  await expect(folder).toBeVisible();

  // tick, move, pick: 3 clicks
  const card = page.locator(`[data-testid="capture-card"][data-id="${video.id}"]`);
  await card.hover();
  await card.getByTestId('card-check').click();
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
  await page.getByTestId('bulk-move').click();
  await page.getByTestId('folder-picker').getByRole('menuitem', { name }).click();
  await expect(page.getByRole('status').filter({ hasText: name }).first()).toBeVisible();

  // drag a card onto the folder
  const other = page.locator(`[data-testid="capture-card"][data-id="${replay.id}"]`);
  await other.dragTo(folder);
  await expect(page.getByRole('status').filter({ hasText: `Moved to ${name}` }).first()).toBeVisible();

  await folder.click();
  await expect(page.getByTestId('capture-card')).toHaveCount(2);
  await expect(page.getByTestId('folder-count')).toHaveText('2');
  await page.screenshot({ path: saveShot('h-folder') });
  await page.close();
});
