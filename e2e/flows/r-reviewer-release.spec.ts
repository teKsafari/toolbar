// Flow R: the reviewer toolbar in the release build, whose shadow root is closed (spikes S4):
// typing in the composer must stay in the composer, even though a page-level key listener cannot
// see inside a closed root. Runs in the flows browser, where the signed-in reviewer allowed the
// lab as a project origin (D-126), so the release build has its capture scripts on the lab.
import { EXT_ID, expect, labPage, test } from './fixture.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

test('R: release build, keys typed in the reviewer composer stay there', async ({ tb }) => {
  const sw = await tb.sw();
  expect(sw.url()).toContain(EXT_ID);
  await expect.poll(() => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length), { timeout: 15_000 }).toBeGreaterThan(0);
  const page = await labPage(tb.context);
  await page.bringToFront();
  const closed = await page.locator('toolbar-root').evaluate((h) => h.shadowRoot === null, undefined, { timeout: 15_000 });
  expect(closed, 'the release build mounts a closed shadow root').toBe(true);
  await page.waitForTimeout(500);

  const comments = () =>
    sw.evaluate(async () => Object.values(((await chrome.storage.session.get('tb:review'))['tb:review'] ?? {}) as Record<string, { items: { comment: string }[] }>).flatMap((t) => t.items.map((i) => i.comment)));
  const before = await comments();
  await page.keyboard.press('Control+Shift+Period'); // wake
  await page.keyboard.press('c');
  await page.getByTestId('works').hover();
  await page.getByTestId('works').click();
  await page.waitForTimeout(300);
  // letters that are tools (a, s, l, h, r, f, v, x) and spaces that would press the page's button
  await page.keyboard.type('a shaky save, really slow');
  await page.keyboard.press('Enter');
  await expect.poll(comments).toEqual([...before, 'a shaky save, really slow']);
  await expect(page.getByTestId('status')).toContainText('idle');
  await page.close();
});
