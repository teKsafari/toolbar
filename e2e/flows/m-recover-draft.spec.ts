// Flow M (the part a user can reach without a stuck recording): the editor's tab goes away
// with a draft open. The draft is kept, the popup's capture rows work again, and the drafts
// pill reopens the editor in the current tab, where create still gives a link.
import { captureOf, chord, createFromEditor, editorFrame, expect, labPage, openPopup, test } from './fixture.ts';

test('M: close the tab with the editor open, then the drafts pill, view, create', async ({ context }) => {
  const first = await labPage(context);
  await chord(first, 'ctrl+shift+s');
  await first.waitForTimeout(300);
  await first.mouse.move(400, 300);
  await first.mouse.click(410, 305);
  await editorFrame(first);
  await first.close();

  const page = await labPage(context);
  const popup = await openPopup(context, page);
  const pill = popup.locator('[data-drafts-pill]');
  await expect(pill).toBeVisible();
  // the session is free: capture rows are enabled again
  await expect(popup.locator('[data-row-main="screenshot"]')).toBeEnabled();
  await pill.click();
  const row = popup.locator('[data-draft]').first();
  await expect(row).toBeVisible();
  await row.locator('[data-draft-view]').click();
  const f = await editorFrame(page);
  const title = `Flow M ${Date.now().toString(36)}`;
  const link = await createFromEditor(page, f, title);
  const rec = await captureOf(context, link);
  expect(rec.title).toBe(title);
  await page.close();
});
