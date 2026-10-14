// Flow I: find an old capture. Ctrl+K on the dashboard, type a few words, Enter opens it.
import { SERVER, expect, hydrated, test } from './fixture.ts';
import { recordLabErrors } from './journeys.ts';

test('I: Ctrl+K, a few words of the title, Enter opens the capture', async ({ nib, context }) => {
  const video = await recordLabErrors(nib);
  const page = await context.newPage();
  await page.goto(`${SERVER}/`);
  await hydrated(page);
  await page.keyboard.press('Control+k');
  const pal = page.getByTestId('palette');
  await expect(pal).toBeVisible();
  const t0 = Date.now();
  await page.getByTestId('palette-input').fill(video.title.split(' ').slice(1).join(' '));
  const row = pal.locator('[data-row-type=capture]').filter({ hasText: video.title });
  await expect(row).toHaveCount(1);
  console.log('I: result after', Date.now() - t0, 'ms');
  await expect(page.getByTestId('palette-enter-hint')).toContainText('Open capture');
  // the matching row is the only capture row, so it is the selected one
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/c/${video.id}$`));
  await page.close();
});
