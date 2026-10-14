import { test, LAB_URL } from '../../fixtures/extension.ts';
import { startMock } from './mock-server.ts';
import { MOCK_PORT, openEditorInPage, seedDraft, signIn, tabIdOf } from './helpers.ts';
const OUT = process.env.SHOT_DIR ?? '/tmp';
test('visual', async ({ context, sw }) => {
  const mock = await startMock(MOCK_PORT);
  await signIn(sw, mock.url);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(LAB_URL);
  await page.locator('toolbar-root').waitFor({ state: 'attached' });
  const id = await seedDraft(sw, { tabId: await tabIdOf(sw, page) });
  const f = await openEditorInPage(sw, page, id);
  const b = (await f.getByTestId('annotator').boundingBox())!;
  const at = (x: number, y: number) => [b.x + b.width * x, b.y + b.height * y] as const;
  // pen stroke
  await page.mouse.move(...at(0.1, 0.2)); await page.mouse.down();
  for (let i = 0; i <= 20; i++) await page.mouse.move(...at(0.1 + i * 0.01, 0.2 + Math.sin(i / 3) * 0.05));
  await page.mouse.up();
  for (const [tool, x0, y0, x1, y1] of [['rect', 0.35, 0.1, 0.55, 0.3], ['ellipse', 0.6, 0.1, 0.9, 0.25], ['arrow', 0.1, 0.6, 0.4, 0.45], ['line', 0.1, 0.8, 0.4, 0.85], ['blur', 0.5, 0.5, 0.8, 0.7]] as const) {
    await f.locator(`[data-tool="${tool}"]`).click();
    await page.mouse.move(...at(x0, y0)); await page.mouse.down(); await page.mouse.move(...at((x0 + x1) / 2, (y0 + y1) / 2)); await page.mouse.move(...at(x1, y1)); await page.mouse.up();
  }
  await f.locator('[data-tool="text"]').click();
  await page.mouse.click(...at(0.6, 0.85));
  await page.keyboard.type('Button does nothing');
  await page.mouse.click(...at(0.45, 0.2));
  await f.getByTestId('field').click();
  await page.keyboard.type('Checkout button broken');
  await page.screenshot({ path: `${OUT}/editor-shot.png` });
  await f.getByTestId('colour-dot').click();
  await page.screenshot({ path: `${OUT}/editor-palette.png` });
  await mock.close();
});
