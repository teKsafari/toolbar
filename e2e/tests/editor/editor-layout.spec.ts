// Editor e2e: the in-page modal, layout and isolation (J-037, J-216), tools and tooltips.
import { expect, test, LAB_URL } from '../../fixtures/extension.ts';
import { startMock, type MockState } from './mock-server.ts';
import { MOCK_PORT, openEditorInPage, seedDraft, signIn, tabIdOf } from './helpers.ts';

let mock: MockState;
test.beforeAll(async () => {
  mock = await startMock(MOCK_PORT);
});
test.afterAll(async () => {
  await mock.close();
});

test('screenshot editor opens in-page over a dimmed page with preview, tool pill and form (J-037)', async ({ context, sw }) => {
  await signIn(sw, mock.url);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(LAB_URL);
  await page.locator('toolbar-root').waitFor({ state: 'attached' });
  const tabId = await tabIdOf(sw, page);
  const id = await seedDraft(sw, { tabId });
  const t0 = Date.now();
  const f = await openEditorInPage(sw, page, id);
  console.log('editor painted in', Date.now() - t0, 'ms');

  const modal = await f.getByTestId('editor').boundingBox();
  expect(modal!.width).toBeGreaterThan(1300);
  expect(modal!.width).toBeLessThanOrEqual(1380);
  expect(modal!.height).toBeGreaterThan(700);
  expect(modal!.height).toBeLessThanOrEqual(730);
  const media = await f.locator('.nb-ed-media').boundingBox();
  const form = await f.locator('.nb-ed-form').boundingBox();
  expect(media!.width / modal!.width).toBeGreaterThan(0.68);
  expect(media!.width / modal!.width).toBeLessThan(0.76);
  expect(form!.x).toBeGreaterThan(media!.x);
  await expect(f.getByTestId('close')).toBeVisible();
  await expect(f.getByTestId('tool-pill')).toBeVisible();
  await expect(f.getByTestId('field')).toBeFocused();
  // the backdrop dims the page
  const bg = await f.getByTestId('editor-backdrop').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toMatch(/rgba?\(18, 18, 17, 0\.5\)|rgba\(0, 0, 0, 0\.6\)/);

  // page CSS does not leak in: a hostile rule on the page leaves the editor alone
  await page.addStyleTag({ content: '* { font-family: monospace !important; color: rgb(255, 0, 0) !important; } button { display: none !important; }' });
  await expect(f.getByTestId('create')).toBeVisible();
  const font = await f.getByTestId('create').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).not.toMatch(/^monospace/);
  await page.close();
});

test('wheel over the preview scrolls the page behind (J-216: match)', async ({ context, sw }) => {
  await signIn(sw, mock.url);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(LAB_URL);
  await page.evaluate(() => {
    document.body.style.minHeight = '4000px';
  });
  await page.locator('toolbar-root').waitFor({ state: 'attached' });
  const id = await seedDraft(sw, { tabId: await tabIdOf(sw, page) });
  const f = await openEditorInPage(sw, page, id);
  // let the layout settle (image size, form) before taking the reference position
  let box = await f.getByTestId('annotator').boundingBox();
  await expect
    .poll(async () => {
      const prev = box;
      box = await f.getByTestId('annotator').boundingBox();
      return prev && box && prev.y === box.y && prev.height === box.height;
    }, { intervals: [400] })
    .toBe(true);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(100);
  // the preview stays put
  const after = await f.getByTestId('annotator').boundingBox();
  expect(after!.y).toBeCloseTo(box!.y, 0);
  await page.close();
});

test('in dark mode the page still shows through the backdrop (no opaque frame)', async ({ context, sw }) => {
  await signIn(sw, mock.url);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(LAB_URL);
  await page.locator('toolbar-root').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    document.documentElement.style.background = 'rgb(255, 255, 255)';
    document.body.style.background = 'rgb(255, 255, 255)';
  });
  const id = await seedDraft(sw, { tabId: await tabIdOf(sw, page) });
  const f = await openEditorInPage(sw, page, id);
  await expect(f.getByTestId('editor-backdrop')).toHaveClass(/nb-shown/);
  await page.waitForTimeout(500); // fade-in
  // a corner outside the modal: white page under a 60% black veil is mid grey, an opaque frame is near black
  const png = await page.screenshot({ clip: { x: 2, y: 840, width: 4, height: 4 } });
  const lum = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(1, 1, 1, 1).data;
    return (d[0]! + d[1]! + d[2]!) / 3;
  }, png.toString('base64'));
  expect(lum).toBeGreaterThan(70);
  expect(lum).toBeLessThan(140);
  await page.close();
});
