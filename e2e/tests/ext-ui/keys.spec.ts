// Real keyboard chords through Chrome's command system, sent with xdotool on the private
// display (never :99): J-179, J-180, J-181. Chrome routes commands only to the focused window.
import { execFileSync } from 'node:child_process';
import { DISPLAY, expect, test } from '../../fixtures/extension.ts';
import { freshState, labPage, session, stats } from './helpers.ts';
import { budget } from '../../fixtures/budget.ts';

function xdo(...args: string[]) {
  return execFileSync('xdotool', args, { env: { ...process.env, DISPLAY }, encoding: 'utf8' }).trim();
}
function focusBrowser() {
  const ids = xdo('search', '--onlyvisible', '--class', 'chromium').split('\n').filter(Boolean);
  const id = ids[ids.length - 1]!;
  xdo('windowactivate', '--sync', id);
  xdo('windowfocus', '--sync', id);
}
const key = (chord: string) => xdo('key', '--clearmodifiers', chord);

test.skip(DISPLAY === ':99', 'never on the shared display');

test.beforeEach(async ({ sw }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  await freshState(sw);
});

test('J-180: Ctrl+Shift+S arms screenshot mode in under 0.5 s with no popup', async ({ context, sw }) => {
  const { page } = await labPage(context);
  focusBrowser();
  await page.mouse.move(400, 300);
  const t0 = Date.now();
  key('ctrl+shift+s');
  await expect.poll(async () => (await session(sw)).state, { intervals: [25] }).toBe('arming-screenshot');
  expect(Date.now() - t0).toBeLessThan(budget(500));
  expect((await stats(sw)).popupOpens).toBe(0);
  await page.mouse.move(410, 310);
  await expect(page.locator('toolbar-root [data-nb-cursor-pill]')).toBeVisible();
  key('Escape');
  await expect.poll(async () => (await session(sw)).state).toBe('idle');
  await page.close();
});

test('J-181: Ctrl+Shift+Space starts with the countdown and the same chord stops', async ({ context, sw }) => {
  const { page } = await labPage(context);
  focusBrowser();
  key('ctrl+shift+space');
  await expect.poll(async () => (await session(sw)).state).toBe('countdown');
  await expect(page.locator('toolbar-root [data-nb-veil]')).toBeVisible();
  await expect.poll(async () => (await session(sw)).state, { timeout: 6400 }).toBe('recording');
  focusBrowser();
  key('ctrl+shift+space');
  await expect.poll(async () => (await session(sw)).state).toBe('draft');
  await page.close();
});

test('J-179: Ctrl+Shift+Y opens the popup', async ({ context, sw }) => {
  const { page } = await labPage(context);
  focusBrowser();
  key('ctrl+shift+y');
  // the popup asks the worker for its tab context as it opens
  await expect.poll(async () => (await stats(sw)).popupOpens, { timeout: 5000 }).toBeGreaterThan(0);
  key('Escape');
  await page.close();
});

test('J-182: Ctrl+Shift+X opens the replay draft with no popup', async ({ context, sw }) => {
  await freshState(sw, { settings: { instantReplay: true } });
  const { page } = await labPage(context);
  focusBrowser();
  key('ctrl+shift+x');
  await expect.poll(async () => (await session(sw)).state).toBe('draft');
  expect((await session(sw)).kind).toBe('replay');
  expect((await stats(sw)).popupOpens).toBe(0);
  await page.close();
});
