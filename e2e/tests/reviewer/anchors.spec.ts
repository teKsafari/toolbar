// Drawings and pins stay on the content they were drawn on (D-204). The lab's anchors page
// (lab/static/anchors.html) has four layouts: a scrolling document, an app shell whose <main>
// scrolls (as on Nuru), a fixed header over a scrolling document, and content in a transformed
// wrapper inside a scrolling <main>. On each, a rectangle around a card, an arrow and a freehand
// stroke on a second card must keep their offset from the card (within 2 px) after the document or
// the inner container scrolls, a banner shifts the layout, and the window is resized.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page, Worker } from '@playwright/test';
import { LAB_URL, SERVER_URL, expect, test } from '../../fixtures/extension.ts';
import { signInOidc } from '../../fixtures/oidc.ts';

test.describe.configure({ timeout: 180_000 });

type Case = 'doc' | 'nested' | 'sticky' | 'transform';
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ui = (page: Page, id: string): Locator => page.getByTestId(id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openCase(page: Page, c: Case) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${LAB_URL}/anchors.html?case=${c}`);
  await page.bringToFront();
  await expect(ui(page, 'review-launcher').or(ui(page, 'review-pill'))).toBeVisible({ timeout: 15_000 });
  if (!(await ui(page, 'review-pill').isVisible())) await ui(page, 'review-launcher').click();
  await expect(ui(page, 'review-pill')).toBeVisible();
}

async function drag(page: Page, pts: [number, number][]) {
  await page.mouse.move(pts[0]![0], pts[0]![1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
}

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  expect(b, 'the element is on screen').toBeTruthy();
  return b!;
}

/** A saved shape on the layer (not the draft's live copy). */
const saved = (page: Page, type: string) => page.getByTestId('review-layer').locator(`[data-shape="${type}"]:not([data-live])`);

/** Draw, then add the note with Enter; a drawing needs no words. */
async function drawNote(page: Page, key: 'r' | 'a' | 'f', pts: [number, number][]) {
  await page.keyboard.press(key);
  await drag(page, pts);
  await expect(ui(page, 'review-composer')).toHaveAttribute('data-kind', 'draw');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-composer')).toHaveCount(0);
  await page.keyboard.press('Escape'); // tool off
}

/** Offset of a shape's box from its card's box, per edge. */
async function offset(shape: Locator, card: Locator) {
  const [s, c] = [await box(shape), await box(card)];
  return { l: s.x - c.x, t: s.y - c.y, r: s.x + s.width - (c.x + c.width), b: s.y + s.height - (c.y + c.height) };
}

async function expectSame(page: Page, what: string, shape: Locator, card: Locator, before: Awaited<ReturnType<typeof offset>>) {
  // the layer follows on the next animation frame
  await expect
    .poll(async () => {
      const now = await offset(shape, card);
      return Math.max(Math.abs(now.l - before.l), Math.abs(now.t - before.t), Math.abs(now.r - before.r), Math.abs(now.b - before.b));
    }, { message: `${what}: the shape keeps its place on the card`, timeout: 3000 })
    .toBeLessThanOrEqual(2);
}

/** Scroll the way a person does: the wheel over the content (the document or the inner <main>). */
async function wheel(page: Page, dy: number) {
  await page.mouse.move(640, 500);
  await page.mouse.wheel(0, dy);
  await sleep(400);
}

async function scrollTops(page: Page) {
  return page.evaluate(() => ({ win: Math.round(scrollY), main: Math.round(document.querySelector('main')!.scrollTop) }));
}

for (const c of ['doc', 'nested', 'sticky', 'transform'] as Case[]) {
  test(`${c}: a rectangle, an arrow and a freehand stroke stay on their cards through scrolling, a layout shift and a resize`, async ({ context }) => {
    const page = await context.newPage();
    await openCase(page, c);
    const card = ui(page, 'target');
    const card2 = ui(page, 'target2');
    const a = await box(card);
    const b = await box(card2);

    await drawNote(page, 'r', [
      [a.x - 8, a.y - 8],
      [a.x + a.width + 8, a.y + a.height + 8],
    ]);
    await drawNote(page, 'a', [
      [b.x + 40, b.y + 130],
      [b.x + 200, b.y + 40],
    ]);
    await drawNote(page, 'f', [
      [b.x + 30, b.y + 80],
      [b.x + 90, b.y + 100],
      [b.x + 150, b.y + 70],
      [b.x + 240, b.y + 110],
    ]);
    await expect(ui(page, 'review-pin')).toHaveCount(3);
    const shapes: [string, Locator, Locator][] = [
      ['rectangle', saved(page, 'rect'), card],
      ['arrow', saved(page, 'arrow'), card2],
      ['freehand', saved(page, 'freehand'), card2],
    ];
    const pins = ui(page, 'review-pin');
    const before = await Promise.all(shapes.map(([, s, k]) => offset(s, k)));
    const pinBefore = await offset(pins.first(), card);
    // the rectangle frames the card, as drawn
    expect(Math.abs(before[0]!.l + 8) <= 2 && Math.abs(before[0]!.b - 8) <= 2, JSON.stringify(before[0])).toBe(true);

    const check = async (what: string) => {
      for (const [i, [name, s, k]] of shapes.entries()) await expectSame(page, `${what}, ${name}`, s, k, before[i]!);
      await expectSame(page, `${what}, pin of the rectangle`, pins.first(), card, pinBefore);
    };

    // 1. scroll the content (the document, or the inner <main>)
    const t0 = await scrollTops(page);
    await wheel(page, 240);
    const t1 = await scrollTops(page);
    if (c === 'nested' || c === 'transform') expect(t1.main - t0.main, 'the inner container scrolled').toBeGreaterThan(100);
    else expect(t1.win - t0.win, 'the document scrolled').toBeGreaterThan(100);
    expect(Math.abs((await box(card)).y - a.y), 'the card moved with the content').toBeGreaterThan(100);
    await check('after scrolling');

    // 2. a banner pushes the content down (a layout shift; no scroll, no resize of the card)
    await page.evaluate(() => (document.querySelector('[data-testid=shift]') as HTMLButtonElement).click());
    await check('after a layout shift');

    // 3. a narrower, shorter window
    await page.setViewportSize({ width: 1000, height: 640 });
    await sleep(300);
    await card.scrollIntoViewIfNeeded();
    await check('after a resize');

    // 4. back up again
    await wheel(page, -600);
    await card.scrollIntoViewIfNeeded();
    await check('after scrolling back');

    if (c === 'sticky') {
      // a drawing on the fixed header stays on the header while the document scrolls under it
      const badge = ui(page, 'hdr-target');
      const h = await box(badge);
      await drawNote(page, 'r', [
        [h.x - 6, h.y - 6],
        [h.x + h.width + 6, h.y + h.height + 6],
      ]);
      const rects = saved(page, 'rect');
      await expect(rects).toHaveCount(2);
      const hb = await offset(rects.nth(1), badge);
      await wheel(page, 300);
      await expectSame(page, 'header rectangle after scrolling', rects.nth(1), badge, hb);
    }
  });
}

test('nested scroller: an element comment pin stays on its element, and a drawing whose element is removed stays put and says detached', async ({ context }) => {
  const page = await context.newPage();
  await openCase(page, 'nested');
  const card = ui(page, 'target');
  const card2 = ui(page, 'target2');
  const b = await box(card2);

  // comment on the second card
  await page.keyboard.press('c');
  await page.mouse.click(b.x + 120, b.y + 100);
  await expect(ui(page, 'review-composer')).toBeVisible();
  await ui(page, 'review-comment').fill('Card text is too dim');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-composer')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const pin = ui(page, 'review-pin').first();
  const pb = await offset(pin, card2);
  await wheel(page, 260);
  await expectSame(page, 'element pin after scrolling <main>', pin, card2, pb);
  await page.setViewportSize({ width: 900, height: 600 });
  await card2.scrollIntoViewIfNeeded();
  await expectSame(page, 'element pin after a resize', pin, card2, pb);

  // a rectangle around the first card, then the app removes the card
  await card.scrollIntoViewIfNeeded();
  const a = await box(card);
  await drawNote(page, 'r', [
    [a.x - 8, a.y - 8],
    [a.x + a.width + 8, a.y + a.height + 8],
  ]);
  const rect = saved(page, 'rect');
  const last = await box(rect);
  await page.evaluate(() => (document.querySelector('[data-testid=remove]') as HTMLButtonElement).click());
  const drawPin = ui(page, 'review-pin').nth(1);
  await expect(drawPin).toHaveAttribute('data-detached', 'true');
  await expect(drawPin).toHaveAttribute('aria-label', /detached/);
  const still = await box(rect);
  expect(Math.abs(still.x - last.x) + Math.abs(still.y - last.y), 'a detached drawing keeps its last place').toBeLessThanOrEqual(2);
  await expect(ui(page, 'review-pin').first()).not.toHaveAttribute('data-detached', 'true');
});

// ---- the feedback folder: the crop and aNN.shapes.json line up with the content (step 3)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

async function signIn(page: Page, sw: Worker) {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  const email = `anchors-${Date.now()}@toolbar.test`;
  await signInOidc(page, SERVER_URL, email, { name: 'Ana Chor' });
  const me = await (await page.request.get(`${SERVER_URL}/api/v1/me`)).json();
  const res = await page.request.post(`${SERVER_URL}/api/v1/tokens`, { data: { name: 'anchors e2e', scopes: ['cli:read', 'cli:write'], expiresInDays: 7 } });
  expect(res.status()).toBe(201);
  const { secret } = await res.json();
  await sw.evaluate(
    async ({ serverUrl, token, ws, email }) => {
      await chrome.storage.local.set({
        'tb:auth': { serverUrl, token, tokenId: 'tok-anchors', user: { id: 'u', name: 'Ana Chor', email, image: null }, activeWorkspaceId: ws, signedInAt: Date.now() },
        'tb:server-url': serverUrl,
      });
    },
    { serverUrl: SERVER_URL, token: secret as string, ws: me.activeWorkspaceId as string, email },
  );
}

test('nested scroller: the crop and annotations/aNN.shapes.json of a drawing line up with the card', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openCase(page, 'nested');
  await wheel(page, 120); // the inner <main> is scrolled when the reviewer draws; the window is not
  const card = ui(page, 'target');
  const a = await box(card);
  await drawNote(page, 'r', [
    [a.x - 8, a.y - 8],
    [a.x + a.width + 8, a.y + a.height + 8],
  ]);
  await wheel(page, 200); // scrolled again before sending

  const before = await sw.evaluate(() => (globalThis as unknown as { __tbReview: { submits(): unknown[] } }).__tbReview.submits().length);
  await ui(page, 'review-send').click();
  await expect.poll(async () => sw.evaluate(() => (globalThis as unknown as { __tbReview: { submits(): unknown[] } }).__tbReview.submits().length), { timeout: 30_000 }).toBe(before + 1);
  const res = await sw.evaluate((i) => (globalThis as unknown as { __tbReview: { submits(): { recordingId: string }[] } }).__tbReview.submits()[i]!, before);

  const r = await page.request.get(`${SERVER_URL}/api/v1/recordings/${res.recordingId}/folder`);
  expect(r.status()).toBe(200);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-anchors-'));
  fs.writeFileSync(path.join(dir, 'f.tgz'), await r.body());
  execFileSync('tar', ['xzf', 'f.tgz'], { cwd: dir });
  const ann = path.join(dir, '.feedback', res.recordingId, 'annotations');
  const sj = JSON.parse(fs.readFileSync(path.join(ann, 'a01.shapes.json'), 'utf8')) as {
    space: string;
    cropRect: { x: number; y: number; w: number; h: number };
    frame?: { selector: string; box: { x: number; y: number; w: number; h: number }; fit?: boolean };
    shapes: { points: number[][] }[];
  };
  const png = fs.readFileSync(path.join(ann, 'a01.png'));
  fs.rmSync(dir, { recursive: true, force: true });

  expect(sj.space).toBe('page');
  const [p, q] = [sj.shapes[0]!.points[0]!, sj.shapes[0]!.points[1]!];
  // the crop is the drawing plus 16 px, in the same coordinates as the shapes
  expect(Math.abs(sj.cropRect.x - (Math.min(p[0]!, q[0]!) - 16))).toBeLessThanOrEqual(1);
  expect(Math.abs(sj.cropRect.y - (Math.min(p[1]!, q[1]!) - 16))).toBeLessThanOrEqual(1);
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([Math.round(sj.cropRect.w), Math.round(sj.cropRect.h)]);
  // the frame names the card and where it was when the rectangle was drawn: 8 px inside the rectangle
  expect(sj.frame?.selector).toContain('target');
  expect(sj.frame!.fit).toBe(true);
  expect(Math.abs(sj.frame!.box.x - (Math.min(p[0]!, q[0]!) + 8))).toBeLessThanOrEqual(2);
  expect(Math.abs(sj.frame!.box.y - (Math.min(p[1]!, q[1]!) + 8))).toBeLessThanOrEqual(2);
  expect(Math.abs(sj.frame!.box.w - a.width)).toBeLessThanOrEqual(1);
});
