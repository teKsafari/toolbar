// Editor e2e: video drafts (J-084, J-085, J-240), AI ghost text (J-083, J-230), save for later
// (J-219), reopen with trim and AI text (J-218).
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test, LAB_URL } from '../../fixtures/extension.ts';
import { startMock, type MockState } from './mock-server.ts';
import { MOCK_PORT, getDraft, openEditorInPage, openEditorTab, seedDraft, signIn, tabIdOf } from './helpers.ts';

const VIDEO = fs.readFileSync(path.resolve(import.meta.dirname, '../../../apps/server/fixtures/tab-video.webm')).toString('base64');
const AI = {
  title: 'Submitting the order fails with a server error',
  summary: 'Place order returns 500 and nothing tells the user.',
  steps: [
    { text: 'Open the checkout page', tMs: 0 },
    { text: 'Click Submit order', tMs: 2000 },
  ],
  result: 'POST /api/orders answers 500',
};

let mock: MockState;
test.beforeAll(async () => {
  mock = await startMock(MOCK_PORT);
});
test.afterAll(async () => {
  await mock.close();
});
test.beforeEach(() => {
  mock.finalizes.length = 0;
  mock.ai = { status: 503, body: { error: 'unavailable' }, delayMs: 0 };
  mock.aiCalls = 0;
});

const video = (page: Page) => page.getByTestId('draft-video');
const currentMs = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.currentTime * 1000);
const paused = (page: Page) => video(page).evaluate((v: HTMLVideoElement) => v.paused);

test('video draft: play from the left grip, click toggles, bar seeks, length in words, no tools (J-084, J-240)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  const id = await seedDraft(sw, { kind: 'video', videoBase64: VIDEO, durationMs: 8000 });
  await openEditorTab(page, id);
  await expect(page.getByTestId('length')).toHaveText('8 seconds');
  await expect(page.getByTestId('tool-pill')).toHaveCount(0);
  await expect(page.getByTestId('play')).toBeVisible();
  // move the left grip to about 2 s, then play: playback starts there
  const track = (await page.getByTestId('trim-track').boundingBox())!;
  const g = (await page.getByTestId('grip-start').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.25, g.y + g.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId('play').click();
  await expect.poll(() => paused(page)).toBe(false);
  expect(await currentMs(page)).toBeGreaterThanOrEqual(1900);
  // clicking the video pauses, clicking again plays
  await video(page).click({ position: { x: 30, y: 30 } });
  await expect.poll(() => paused(page)).toBe(true);
  await video(page).click({ position: { x: 30, y: 30 } });
  await expect.poll(() => paused(page)).toBe(false);
  await video(page).click({ position: { x: 30, y: 30 } });
  // clicking the bar seeks
  await page.mouse.click(track.x + track.width * 0.75, track.y + track.height / 2);
  await expect.poll(() => currentMs(page)).toBeGreaterThan(5500);
  // a frame became the draft's thumbnail
  await expect.poll(async () => (await getDraft(sw, id))?.thumbBlobId).toBeTruthy();
});

test('trim: grips grey the cut, scrub the preview, update the length; Ctrl+Z and Ctrl+Shift+Z per drag; trim reaches finalize (J-085)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  const id = await seedDraft(sw, { kind: 'video', videoBase64: VIDEO, durationMs: 8000 });
  await openEditorTab(page, id);
  await expect(page.getByTestId('length')).toHaveText('8 seconds');
  const track = (await page.getByTestId('trim-track').boundingBox())!;
  const dragGrip = async (grip: 'start' | 'end', frac: number) => {
    const g = (await page.getByTestId(`grip-${grip}`).boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * frac, g.y + g.height / 2, { steps: 6 });
    await page.mouse.up();
  };
  await dragGrip('start', 0.25);
  expect(await currentMs(page)).toBeGreaterThan(1500); // scrubbed with the grip
  const cut = (await page.getByTestId('cut-start').boundingBox())!;
  expect(cut.width).toBeGreaterThan(track.width * 0.2);
  await expect(page.getByTestId('length')).toHaveText('6 seconds');
  await dragGrip('end', 0.75);
  await expect(page.getByTestId('length')).toHaveText('4 seconds');
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('length')).toHaveText('6 seconds');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('length')).toHaveText('8 seconds');
  await expect(page.getByTestId('trim-undo')).toBeDisabled();
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('length')).toHaveText('4 seconds');
  // kept in the draft for a later reopen
  await expect.poll(async () => (await getDraft(sw, id))?.trim).toMatchObject({ startMs: expect.any(Number), endMs: expect.any(Number) });
  await page.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(1);
  const fin = mock.finalizes[0]!.body as { trim: { startMs: number; endMs: number }; durationMs: number };
  expect(fin.trim.startMs).toBeGreaterThan(1500);
  expect(fin.trim.startMs).toBeLessThan(2500);
  expect(fin.trim.endMs).toBeGreaterThan(5500);
  expect(fin.trim.endMs).toBeLessThan(6500);
  expect(fin.durationMs).toBe(fin.trim.endMs - fin.trim.startMs);
});

test('a MediaRecorder WebM without a duration header still gets its length (better than J-034)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  await openEditorTab(page, await seedDraft(sw)); // any extension page to record in
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 180;
    const g = c.getContext('2d')!;
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    let i = 0;
    const timer = setInterval(() => {
      g.fillStyle = `hsl(${(i++ * 20) % 360} 70% 50%)`;
      g.fillRect(0, 0, 320, 180);
    }, 33);
    rec.start(250);
    await new Promise((r) => setTimeout(r, 3000));
    rec.stop();
    await new Promise((r) => (rec.onstop = r));
    clearInterval(timer);
    const buf = new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer());
    let s = '';
    for (const x of buf) s += String.fromCharCode(x);
    return btoa(s);
  });
  const id = await seedDraft(sw, { kind: 'video', videoBase64: b64, durationMs: null as unknown as number });
  await openEditorTab(page, id);
  await expect(page.getByTestId('length')).toHaveText(/^[23] seconds$/);
});

test('AI ghost text on a video draft: grey title, summary, timed steps, result; Tab accepts (J-083)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  mock.ai = { status: 200, body: AI, delayMs: 800 };
  const id = await seedDraft(sw, { kind: 'video', videoBase64: VIDEO, durationMs: 8000 });
  const t0 = Date.now();
  await openEditorTab(page, id);
  await expect(page.getByTestId('ai-switch')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ai-ghost-title')).toHaveText(AI.title, { timeout: 6000 });
  expect(Date.now() - t0).toBeLessThan(6000);
  const ghost = page.getByTestId('ai-ghost');
  await expect(ghost).toContainText(AI.summary);
  await expect(ghost.locator('li')).toHaveCount(2);
  await expect(ghost.getByRole('button', { name: '0:02' })).toBeVisible();
  // a time link seeks the preview without accepting
  await ghost.getByRole('button', { name: '0:02' }).click();
  await expect.poll(() => currentMs(page)).toBeGreaterThan(1900);
  await expect(page.getByTestId('ai-ghost')).toBeVisible();
  await page.getByTestId('field').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  await expect(page.getByTestId('field').locator('> :first-child')).toHaveText(AI.title);
  await expect(page.getByTestId('field')).toContainText('Click Submit order (0:02)');
  await page.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(1);
  expect(mock.finalizes[0]!.body).toMatchObject({ title: AI.title, aiAccepted: true });
  expect(mock.finalizes[0]!.body.description).toContain('1. Open the checkout page (0:00)');
});

test('a click inside the ghost title accepts it with the caret where you clicked (J-230)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  mock.ai = { status: 200, body: AI, delayMs: 0 };
  const id = await seedDraft(sw, { kind: 'video', videoBase64: VIDEO, durationMs: 8000 });
  await openEditorTab(page, id);
  const title = page.getByTestId('ai-ghost-title');
  await expect(title).toBeVisible();
  // click right after "Submitting"
  const pos = await title.evaluate((el) => {
    const r = document.createRange();
    r.setStart(el.firstChild!, 10);
    r.setEnd(el.firstChild!, 10);
    const b = r.getBoundingClientRect();
    return { x: b.left + 1, y: b.top + b.height / 2 };
  });
  await page.mouse.click(pos.x, pos.y);
  await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  await page.keyboard.type(' now');
  await expect(page.getByTestId('field').locator('> :first-child')).toHaveText('Submitting now the order fails with a server error');
});

test('AI switch: disabled with a reason on screenshots; the on or off choice persists (J-083)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  mock.ai = { status: 200, body: AI, delayMs: 0 };
  await openEditorTab(page, await seedDraft(sw));
  await expect(page.getByTestId('ai-switch')).toBeDisabled();
  await page.getByTestId('ai-switch').hover({ force: true });
  await expect(page.getByTestId('tooltip')).toHaveText(/videos and replays/);

  await openEditorTab(page, await seedDraft(sw, { kind: 'video', videoBase64: VIDEO, durationMs: 8000 }));
  await expect(page.getByTestId('ai-ghost')).toBeVisible();
  await page.getByTestId('ai-switch').click();
  await expect(page.getByTestId('ai-switch')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
  const calls = mock.aiCalls;
  await openEditorTab(page, await seedDraft(sw, { kind: 'video', videoBase64: VIDEO, durationMs: 8000 }));
  await expect(page.getByTestId('ai-switch')).toHaveAttribute('aria-checked', 'false');
  await page.waitForTimeout(500);
  expect(mock.aiCalls).toBe(calls);
  await page.getByTestId('ai-switch').click(); // back on for later tests
  await expect(page.getByTestId('ai-ghost')).toBeVisible();
});

test('AI off on the server: the switch is disabled with a reason, nothing breaks', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  await openEditorTab(page, await seedDraft(sw, { kind: 'video', videoBase64: VIDEO, durationMs: 8000 }));
  await expect(page.getByTestId('ai-switch')).toBeDisabled();
  await expect(page.getByTestId('ai-ghost')).toHaveCount(0);
});

test('a reopened video draft saves for later from its close button; toast with view; reopen keeps trim and AI text (J-219, J-218)', async ({ context, sw }) => {
  await signIn(sw, mock.url);
  mock.ai = { status: 200, body: AI, delayMs: 0 };
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(LAB_URL);
  await page.locator('toolbar-root').waitFor({ state: 'attached' });
  const tabId = await tabIdOf(sw, page);
  const id = await seedDraft(sw, { kind: 'video', videoBase64: VIDEO, durationMs: 8000, tabId, reopened: true });
  let f = await openEditorInPage(sw, page, id);
  await expect(f.getByTestId('close')).toHaveText(/Save for later/);
  await expect(f.getByTestId('ai-ghost-title')).toBeVisible();
  const track = (await f.getByTestId('trim-track').boundingBox())!;
  const g = (await f.getByTestId('grip-start').boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.5, g.y + g.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(f.getByTestId('length')).toHaveText('4 seconds');
  await f.getByTestId('close').click();
  await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0);
  const toast = page.locator('toolbar-root').getByText('Saved to your drafts');
  await expect(toast).toBeVisible();
  const d = await getDraft(sw, id);
  expect(d).toMatchObject({ status: 'saved', trim: { startMs: expect.any(Number) } });
  expect((d as { ai: { title: string } }).ai.title).toBe(AI.title);
  // view reopens it with the trim and the AI text
  await page.locator('toolbar-root').getByRole('button', { name: 'View' }).click();
  f = page.frameLocator('iframe[data-nb-editor]');
  await expect(f.getByTestId('length')).toHaveText('4 seconds');
  await expect(f.getByTestId('ai-ghost-title')).toHaveText(AI.title);
  expect(mock.aiCalls).toBe(1);
  expect((await getDraft(sw, id))?.status).toBe('open');
  await page.close();
});
