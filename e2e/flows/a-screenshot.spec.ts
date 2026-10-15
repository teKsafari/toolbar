// Flow A: screenshot with one mark, to a link on the clipboard. Chord, one click on the page,
// rectangle tool, one drag, a title, Ctrl+Enter.
import { chromium } from '@playwright/test';
import { SERVER, captureOf, chord, createFromEditor, editorFrame, expect, labPage, saveShot, test, waitReady } from './fixture.ts';

test('A: chord, click, rectangle, title, Ctrl+Enter gives a share link that opens logged out', async ({ tb, context }) => {
  const page = await labPage(context);
  await page.getByTestId('hidden-500').click();
  await expect(page.getByTestId('status')).toContainText('saved'); // the hidden 500 looks like success

  await chord(page, 'ctrl+shift+s');
  // armed: the page must not receive the grabbing click (J-250)
  await page.evaluate(() => {
    (window as unknown as { __clicks: number }).__clicks = 0;
    document.addEventListener('click', () => (window as unknown as { __clicks: number }).__clicks++, true);
  });
  await page.waitForTimeout(300);
  const works = (await page.getByTestId('works').boundingBox())!;
  await page.mouse.move(works.x + 10, works.y + 10);
  await page.mouse.move(works.x + 20, works.y + 12);
  await page.mouse.click(works.x + 20, works.y + 12);

  const t0 = Date.now();
  const f = await editorFrame(page);
  console.log('A: editor painted after', Date.now() - t0, 'ms');
  expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(0);

  await f.locator('[data-tool="rect"]').click();
  const box = (await f.getByTestId('annotator').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: saveShot('a-editor') });

  const title = `Flow A ${Date.now().toString(36)}`;
  const link = await createFromEditor(page, f, title);
  console.log('A: link', link);
  await expect(page.locator('iframe').filter({ has: page.locator('[data-nb-editor]') })).toHaveCount(0);

  // the capture page opens in a new tab next to the lab (J-197)
  await expect.poll(() => context.pages().some((p) => /\/c\/[0-9a-f-]{36}/.test(p.url())), { timeout: 15_000 }).toBe(true);

  const rec = await captureOf(context, link);
  expect(rec.kind).toBe('screenshot');
  expect(rec.title).toBe(title);
  await waitReady(context, rec.id);
  tb.made.screenshot = { id: rec.id, shareUrl: link, title };

  // a logged-out viewer sees the image with the box burned in
  const browser = await chromium.launch();
  const anon = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await anon.goto(link);
  const img = anon.locator('img[src*="/media/"], img[src*="screenshot"]').first();
  await expect(img).toBeVisible();
  await expect(anon.getByText(title).first()).toBeVisible();
  await anon.screenshot({ path: saveShot('a-share-logged-out') });
  await browser.close();
  await page.close();
});
