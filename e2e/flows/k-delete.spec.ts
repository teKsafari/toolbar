// Flow K: delete a capture. On the capture page: the three-dot menu, Delete, confirm (3 clicks).
// A toast confirms, the dashboard opens, and the capture is gone from the list, from search and
// from its share link.
import { SERVER, api, captureOf, chord, createFromEditor, editorFrame, expect, hydrated, labPage, saveShot, test } from './fixture.ts';

test('K: three-dot menu, Delete, confirm; toast, dashboard, gone from list, search and the share link', async ({ context }) => {
  // a capture of its own, so the captures later flows reuse stay
  const lab = await labPage(context);
  await chord(lab, 'ctrl+shift+s');
  await lab.waitForTimeout(300);
  await lab.mouse.move(400, 300);
  await lab.mouse.click(410, 305);
  const stamp = Date.now().toString(36);
  const title = `Flow K ${stamp}`;
  const link = await createFromEditor(lab, await editorFrame(lab), title);
  const rec = await captureOf(context, link);
  await lab.close();

  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SERVER}/c/${rec.id}`);
  await hydrated(page);
  await page.getByTestId('more').click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible();
  await page.screenshot({ path: saveShot('k-confirm') });
  const t0 = Date.now();
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Capture deleted' }).first()).toBeVisible();
  const toastMs = Date.now() - t0;
  await page.waitForURL(`${SERVER}/`);
  console.log(`K: toast ${toastMs} ms, dashboard ${Date.now() - t0} ms after confirm`);
  await hydrated(page);
  await expect(page.locator(`[data-testid="capture-card"][data-id="${rec.id}"]`)).toHaveCount(0);

  // gone everywhere: the API, the share link, search
  expect((await api(context, 'GET', `/api/v1/recordings/${rec.id}`)).status).toBe(404);
  expect((await context.request.get(link, { failOnStatusCode: false })).status()).toBe(404);
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill(stamp);
  await expect(page.getByTestId('palette-empty')).toBeVisible();
  await page.close();
});
