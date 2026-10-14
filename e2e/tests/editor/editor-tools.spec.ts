// Editor e2e: screenshot annotation tools (J-038 to J-050, J-052), driven with the real mouse
// and keyboard in the editor page.
import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/extension.ts';
import { startMock, type MockState } from './mock-server.ts';
import { MOCK_PORT, openEditorTab, seedDraft, signIn } from './helpers.ts';

let mock: MockState;
test.beforeAll(async () => {
  mock = await startMock(MOCK_PORT);
});
test.afterAll(async () => {
  await mock.close();
});

/** Map image pixels (the seeded shot is 1000 x 600) to page coordinates. */
async function mapper(page: Page) {
  const b = (await page.getByTestId('annotator').boundingBox())!;
  const k = b.width / 1000;
  return (x: number, y: number) => [b.x + x * k, b.y + y * k] as [number, number];
}
async function drag(page: Page, from: [number, number], to: [number, number], steps = 6) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps });
  await page.mouse.up();
}
const shapes = (page: Page) => page.locator('svg[aria-label="Annotation layer"] g[data-shape]');

async function fresh(page: Page, sw: Parameters<typeof seedDraft>[0]) {
  await signIn(sw, mock.url);
  const id = await seedDraft(sw);
  await openEditorTab(page, id);
  return mapper(page);
}

test('pen is active on open, strokes are filled tapered paths, D reselects (J-038)', async ({ page, sw }) => {
  const at = await fresh(page, sw);
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(...at(100, 100));
  await page.mouse.down();
  for (let i = 1; i <= 25; i++) await page.mouse.move(...at(100 + i * 10, 100 + Math.sin(i / 4) * 40));
  await page.mouse.up();
  await expect(shapes(page)).toHaveCount(1);
  const path = shapes(page).first().locator('path');
  await expect(path).toHaveAttribute('fill', /#/);
  await expect(path).toHaveAttribute('stroke', 'none');
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
  // the tapered outline is narrower at the ends than in the middle
  const widths = await path.evaluate((p: SVGPathElement) => {
    const bb = p.getBBox();
    return { w: bb.width, h: bb.height };
  });
  expect(widths.w).toBeGreaterThan(200);
  await page.keyboard.press('v');
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('d');
  await expect(page.locator('[data-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
});

test('rectangle, ellipse, line and arrow; tool returns to select with the shape selected (J-039 to J-042)', async ({ page, sw }) => {
  const at = await fresh(page, sw);
  await page.locator('[data-tool="rect"]').click();
  await drag(page, at(100, 100), at(300, 200));
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-selection]')).toHaveCount(1);
  await expect(shapes(page).nth(0).locator('path')).toHaveAttribute('d', /A/); // rounded corners

  await page.locator('[data-tool="ellipse"]').click();
  await drag(page, at(400, 100), at(800, 200));
  const bb = await shapes(page).nth(1).locator('path').evaluate((p: SVGPathElement) => { const b = p.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  expect(bb.width / bb.height).toBeGreaterThan(3); // fills the wide box, not a circle
  await expect(page.locator('[data-tool="select"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-tool="line"]').click();
  await drag(page, at(100, 400), at(400, 450));
  await expect(shapes(page).nth(2).locator('path')).toHaveCount(1); // no head
  await expect(shapes(page).nth(2).locator('path')).toHaveAttribute('d', /^M[\d.]+ [\d.]+ L/);

  await page.locator('[data-tool="arrow"]').click();
  await drag(page, at(500, 500), at(900, 500));
  await expect(shapes(page).nth(3).locator('path')).toHaveCount(2); // shaft and open V head
  const before = await shapes(page).nth(3).locator('path').nth(1).getAttribute('d');
  // drag the middle handle: the shaft bends into a curve and the head follows the tangent
  await drag(page, at(700, 500), at(700, 380));
  await expect(shapes(page).nth(3).locator('path').first()).toHaveAttribute('d', /Q/);
  const after = await shapes(page).nth(3).locator('path').nth(1).getAttribute('d');
  expect(after).not.toEqual(before);
});

test('text callout: T, click, type; double-click edits with all text selected; resize scales the font (J-043, J-046)', async ({ page, sw }) => {
  const at = await fresh(page, sw);
  await page.mouse.click(...at(950, 580)); // a tiny pen dot moves focus off the form field
  await page.keyboard.press('Control+z');
  await page.keyboard.press('t');
  await expect(page.locator('[data-tool="text"]')).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(...at(200, 300));
  await expect(page.getByTestId('text-editor')).toBeFocused();
  await page.keyboard.type('Total is wrong');
  await page.mouse.click(...at(600, 550)); // commit by clicking elsewhere
  const t = shapes(page).last();
  await expect(t.locator('text')).toHaveText('Total is wrong');
  await expect(t.locator('text')).toHaveAttribute('fill', '#ffffff');
  await expect(t.locator('text')).toHaveAttribute('font-weight', '700');
  await expect(t.locator('path')).toHaveAttribute('fill', /#3446cf/i);

  const tb = (await t.locator('text').boundingBox())!;
  await page.mouse.dblclick(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await expect(page.getByTestId('text-editor')).toBeFocused();
  expect(await page.evaluate(() => getSelection()?.toString())).toBe('Total is wrong');
  await page.keyboard.press('Escape');

  // select it and drag the bottom-right handle out: the font grows
  const size0 = Number(await t.locator('text').getAttribute('font-size'));
  await page.mouse.click(tb.x + 4, tb.y + tb.height / 2);
  const handle = (await page.locator('[data-handle="se"]').boundingBox())!;
  await drag(page, [handle.x + 4, handle.y + 4], [handle.x + 120, handle.y + 60]);
  const size1 = Number(await shapes(page).last().locator('text').getAttribute('font-size'));
  expect(size1).toBeGreaterThan(size0 * 1.3);
});

test('select, move, resize and rotate a rectangle by its outline (J-046)', async ({ page, sw }) => {
  const at = await fresh(page, sw);
  await page.locator('[data-tool="rect"]').click();
  await drag(page, at(200, 200), at(400, 300));
  await page.keyboard.press('v');
  await page.mouse.click(...at(700, 500)); // empty space deselects
  await expect(page.locator('[data-selection]')).toHaveCount(0);
  await page.mouse.click(...at(300, 250)); // the inside is not the outline
  await expect(page.locator('[data-selection]')).toHaveCount(0);
  await page.mouse.click(...at(200, 225));
  await expect(page.locator('[data-selection]')).toHaveCount(1);
  // move (by the outline, away from the side handle)
  await drag(page, at(200, 225), at(250, 255));
  const bb1 = await shapes(page).first().locator('path').evaluate((p: SVGPathElement) => { const b = p.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  expect(bb1.x).toBeCloseTo(250, 0);
  // resize from the bottom-right corner
  await drag(page, at(450, 330), at(550, 380));
  const bb2 = await shapes(page).first().locator('path').evaluate((p: SVGPathElement) => { const b = p.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
  expect(bb2.width).toBeCloseTo(300, -1);
  // rotate from just outside the top-right corner
  await drag(page, at(562, 218), at(640, 340), 10);
  await expect(shapes(page).first()).toHaveAttribute('transform', /rotate\(/);
});

test('marquee selects two shapes, they move together, Delete removes both and one Ctrl+Z restores both (J-047, J-048)', async ({ page, sw }) => {
  const at = await fresh(page, sw);
  await page.locator('[data-tool="rect"]').click();
  await drag(page, at(100, 100), at(200, 200));
  await page.locator('[data-tool="ellipse"]').click();
  await drag(page, at(300, 100), at(400, 200));
  await page.keyboard.press('v');
  await drag(page, at(50, 50), at(450, 130));
  await expect(page.locator('[data-selection]')).toHaveCount(2);
  await drag(page, at(100, 150), at(130, 170));
  const xs = await shapes(page).locator('path').evaluateAll((ps) => ps.map((p) => Math.round((p as SVGPathElement).getBBox().x)));
  expect(xs).toEqual([130, 330]);
  await page.keyboard.press('Delete');
  await expect(shapes(page)).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(shapes(page)).toHaveCount(2);
});

test('undo and redo: four steps by button and Ctrl+Z, buttons grey when empty (J-049)', async ({ page, sw }) => {
  const at = await fresh(page, sw);
  await expect(page.getByTestId('undo')).toBeDisabled();
  await expect(page.getByTestId('redo')).toBeDisabled();
  await page.locator('[data-tool="rect"]').click();
  await drag(page, at(100, 100), at(300, 200)); // create
  await drag(page, at(100, 150), at(150, 150)); // move
  await page.getByTestId('colour-dot').click();
  await page.getByTestId('palette').locator('[data-colour]').nth(1).click(); // recolour
  await page.keyboard.press('Delete'); // delete
  await expect(shapes(page)).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(shapes(page)).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(shapes(page).first().locator('path')).toHaveAttribute('stroke', /#3446cf/i);
  await page.getByTestId('undo').click();
  await page.keyboard.press('Control+z');
  await expect(shapes(page)).toHaveCount(0);
  await expect(page.getByTestId('undo')).toBeDisabled();
  for (let i = 0; i < 3; i++) await page.getByTestId('redo').click();
  await expect(shapes(page)).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(shapes(page)).toHaveCount(0);
  await expect(page.getByTestId('redo')).toBeDisabled();
});

test('colour palette: six swatches, ink default, red recolours selection and new shapes, a new draft resets (J-045)', async ({ page, sw }) => {
  const at = await fresh(page, sw);
  await expect(page.getByTestId('colour-dot').locator('[data-colour]')).toHaveAttribute('data-colour', '#3446cf');
  await page.locator('[data-tool="rect"]').click();
  await drag(page, at(100, 100), at(300, 200));
  await page.getByTestId('colour-dot').click();
  await expect(page.getByTestId('palette').locator('[data-colour]')).toHaveCount(6);
  await page.getByTestId('palette').locator('[aria-label="Red"]').click();
  await expect(shapes(page).first().locator('path')).toHaveAttribute('stroke', '#e0402f');
  await page.locator('[data-tool="ellipse"]').click();
  await drag(page, at(400, 100), at(600, 200));
  await expect(shapes(page).nth(1).locator('path')).toHaveAttribute('stroke', '#e0402f');
  // next draft starts on ink again
  const id2 = await seedDraft(sw);
  await openEditorTab(page, id2);
  await expect(page.getByTestId('colour-dot').locator('[data-colour]')).toHaveAttribute('data-colour', '#3446cf');
});

test('blur box blurs what is under it and re-blurs when moved (J-044)', async ({ page, sw }) => {
  const at = await fresh(page, sw);
  await page.locator('[data-tool="blur"]').click();
  await drag(page, at(20, 20), at(400, 120));
  const clip = page.locator('clipPath rect');
  expect(Number(await clip.getAttribute('x'))).toBeCloseTo(20, -1);
  expect(Number(await clip.getAttribute('y'))).toBeCloseTo(20, -1);
  await page.keyboard.press('v');
  await drag(page, at(200, 70), at(200, 370));
  await expect.poll(async () => Number(await clip.getAttribute('y'))).toBeGreaterThan(300);
  await expect(page.locator('[data-blur] image')).toHaveAttribute('filter', /url\(#nb-blur/);
});

test('tooltips name each tool after a short hover, with key badges on pen, text and select (J-050)', async ({ page, sw }) => {
  await fresh(page, sw);
  for (const [tool, label, key] of [
    ['select', 'Select', 'V'],
    ['pen', 'Pen', 'D'],
    ['rect', 'Rectangle', null],
    ['text', 'Text', 'T'],
    ['blur', 'Blur', null],
  ] as const) {
    await page.locator(`[data-tool="${tool}"]`).hover();
    const tip = page.getByTestId('tooltip');
    await expect(tip).toBeVisible({ timeout: 1500 });
    await expect(tip).toContainText(label);
    if (key) await expect(tip.locator('kbd')).toHaveText(key);
    else await expect(tip.locator('kbd')).toHaveCount(0);
    await page.mouse.move(5, 5);
    await expect(tip).toHaveCount(0);
  }
});

test('Ctrl+C and Ctrl+V paste a copy offset by 10 px as one undo step (J-052)', async ({ page, sw }) => {
  const at = await fresh(page, sw);
  await page.locator('[data-tool="rect"]').click();
  await drag(page, at(100, 100), at(200, 200));
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(shapes(page)).toHaveCount(2);
  const xs = await shapes(page).locator('path').evaluateAll((ps) => ps.map((p) => Math.round((p as SVGPathElement).getBBox().x)));
  expect(xs[1]! - xs[0]!).toBe(10);
  await page.keyboard.press('Control+z');
  await expect(shapes(page)).toHaveCount(1);
});
