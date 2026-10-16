// Editor e2e at phone width and the attachment row (D-181): at 390 px the form goes under the
// preview, the tool pill fits, and every Tab stop is on screen; the attachment size label passes AA
// on its sunken row and the remove button shows keyboard focus.
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../../fixtures/extension.ts';
import { startMock, type MockState } from './mock-server.ts';
import { MOCK_PORT, openEditorTab, seedDraft, settled, signIn } from './helpers.ts';

let mock: MockState;
test.beforeAll(async () => {
  mock = await startMock(MOCK_PORT);
});
test.afterAll(async () => {
  await mock.close();
});

const VIDEO = fs.readFileSync(path.resolve(import.meta.dirname, '../../../apps/server/fixtures/tab-video.webm')).toString('base64');

/** Text contrast of an element over its composited background, in the page. */
async function contrastOf(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const parse = (c: string) => {
      const p = c.match(/rgba?\(([^)]+)\)/)![1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: p[0]!, g: p[1]!, b: p[2]!, a: p[3] ?? 1 };
    };
    type C = ReturnType<typeof parse>;
    const over = (f: C, b: C): C => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
    const lum = (c: C) => {
      const ch = [c.r, c.g, c.b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
    };
    const layers: C[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      const bg = parse(getComputedStyle(n).backgroundColor);
      if (bg.a > 0) {
        layers.push(bg);
        if (bg.a >= 1) break;
      }
    }
    let bg: C = { r: 255, g: 255, b: 255, a: 1 };
    for (const l of layers.reverse()) bg = l.a >= 1 ? l : over(l, bg);
    const fg = over(parse(getComputedStyle(el).color), bg);
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  }, selector);
}

for (const kind of ['screenshot', 'video'] as const)
  test(`${kind} editor at 390 px: form under the preview, tool pill inside, every Tab stop on screen (D-181)`, async ({ page, sw }) => {
    await signIn(sw, mock.url);
    await page.setViewportSize({ width: 390, height: 844 });
    const id = await seedDraft(sw, kind === 'video' ? { kind, videoBase64: VIDEO, durationMs: 8000 } : {});
    await openEditorTab(page, id);
    const vw = 390;
    const media = (await page.locator('.nb-ed-media').boundingBox())!;
    const form = (await page.locator('.nb-ed-form').boundingBox())!;
    expect(form.y, 'the form sits under the preview').toBeGreaterThanOrEqual(media.y + media.height - 1);
    expect(media.width).toBeGreaterThan(340);
    const overflow = await page.getByTestId('editor').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow, 'no sideways scroll in the dialog').toBeLessThanOrEqual(0);
    if (kind === 'screenshot') {
      const pill = (await page.getByTestId('tool-pill').boundingBox())!;
      expect(pill.x).toBeGreaterThanOrEqual(0);
      expect(pill.x + pill.width).toBeLessThanOrEqual(vw);
    }
    // walk the tab order: each stop is inside the viewport once it has the focus
    const seen = new Set<string>();
    const off: string[] = [];
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      const s = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const r = el.getBoundingClientRect();
        const name = `${el.tagName.toLowerCase()} ${el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.textContent?.trim().slice(0, 20) ?? ''}`;
        return { name, l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight };
      });
      if (!s) continue;
      if (seen.has(s.name)) break;
      seen.add(s.name);
      if (s.l < -1 || s.r > s.vw + 1 || s.t < -1 || s.b > s.vh + 1) off.push(`${s.name} [${Math.round(s.l)}, ${Math.round(s.r)}] x [${Math.round(s.t)}, ${Math.round(s.b)}]`);
    }
    expect(seen.size, 'the walk reached the editor controls').toBeGreaterThan(5);
    expect(off, 'focus stops outside the 390 x 844 viewport').toEqual([]);
  });

test('attachment row: the size label passes AA on the sunken row and the remove button shows focus (D-181)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  await page.setViewportSize({ width: 1440, height: 860 });
  const id = await seedDraft(sw);
  await openEditorTab(page, id);
  await page.getByTestId('attach-input').setInputFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('steps and notes') }]);
  await expect(page.getByTestId('attachments').locator('li')).toHaveCount(1);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(200);
    expect(await contrastOf(page, '[data-testid="attachments"] li .nb-faint'), `${scheme} size label`).toBeGreaterThanOrEqual(4.5);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  const remove = page.getByRole('button', { name: 'Remove notes.txt' });
  const style = () => remove.evaluate((el) => ({ o: getComputedStyle(el).outlineStyle, w: parseFloat(getComputedStyle(el).outlineWidth) }));
  const idle = await style();
  for (let i = 0; i < 60 && !(await remove.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(remove).toBeFocused();
  await settled(remove);
  const focused = await style();
  expect(idle.o).toBe('none');
  expect(focused.o).toBe('solid');
  expect(focused.w).toBeGreaterThanOrEqual(2);
});
