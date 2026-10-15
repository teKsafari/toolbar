// Locator packets (PLAN "Source location without app integration", D-117), on three builds of
// the lab app with no change to how it is served:
//   LAB_URL       production build without source maps (user service toolbar-lab, :5173)
//   LAB_MAPS_URL  production build that serves source maps (`vite build --sourcemap`, then
//                 `PORT=5186 node server.js` in lab/)
//   LAB_DEV_URL   the vite dev server (`npx vite dev --port 5184` in lab/)
// The extension's worker builds each packet (`__tb.locator.capture`, the same code as the
// `locator.capture` request). The last test stores a packet with a capture on a real server
// (SERVER_URL, mock OIDC sign-in) and reads it back.
import fs from 'node:fs';
import path from 'node:path';
import type { Page, Worker } from '@playwright/test';
import { LAB_URL, SERVER_URL, expect, test } from '../../fixtures/extension.ts';
import { signInOidc } from '../../fixtures/oidc.ts';
import type { LocatorPacket } from '@toolbar/shared/locator';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const LAB_MAPS_URL = process.env.LAB_MAPS_URL ?? 'http://localhost:5186';
const LAB_DEV_URL = process.env.LAB_DEV_URL ?? 'http://localhost:5184';
const LAB_SRC = path.resolve(import.meta.dirname, '../../../lab/src/routes');

test.describe.configure({ timeout: 180_000 });

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

async function tabIdOf(sw: Worker, page: Page): Promise<number> {
  const url = page.url();
  return sw.evaluate(async (url) => {
    for (let i = 0; i < 40; i++) {
      const tabs = ((await chrome.tabs.query({})) as { id?: number; url?: string }[]).filter((t) => t.url === url);
      if (tabs.length) return Math.max(...tabs.map((t) => t.id ?? -1));
      await new Promise((r) => setTimeout(r, 100));
    }
    return -1;
  }, url);
}

interface Captured {
  locator: LocatorPacket;
  crop: { dataUrl: string; w: number; h: number } | null;
}

async function locate(sw: Worker, tabId: number, req: Record<string, unknown>): Promise<Captured> {
  return sw.evaluate(
    async ({ tabId, req }) => {
      const tb = (globalThis as unknown as { __tb: { ready(): Promise<unknown>; locator: { capture(r: unknown): Promise<unknown> } } }).__tb;
      return JSON.parse(JSON.stringify(await tb.locator.capture({ tabId, ...req })));
    },
    { tabId, req },
  ) as Promise<Captured>;
}

/** A page with the capture scripts loaded (registered at runtime by the worker). */
async function open(context: import('@playwright/test').BrowserContext, sw: Worker, url: string) {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await page.bringToFront();
  return { page, tabId: await tabIdOf(sw, page) };
}

/** 1-based line of the first line in a lab route file that contains `needle`. */
function lineOf(file: string, needle: string): number {
  const lines = fs.readFileSync(path.join(LAB_SRC, file), 'utf8').split('\n');
  return lines.findIndex((l) => l.includes(needle)) + 1;
}

test('production build: element packet with route file from the route table, 1x crop, unmapped error', async ({ context, sw }) => {
  test.skip(!(await up(LAB_URL)), `lab app not running at ${LAB_URL}`);
  const { page, tabId } = await open(context, sw, LAB_URL);
  await page.getByTestId('throws').click();
  await page.waitForTimeout(500);
  const box = (await page.getByTestId('throws').boundingBox())!;
  const { locator, crop } = await locate(sw, tabId, { selector: '[data-testid="throws"]' });
  expect(locator).toMatchObject({
    v: 1,
    kind: 'element',
    route: '/',
    title: 'Lab',
    tag: 'button',
    role: 'button',
    name: 'Show profile (throws)',
    testId: 'throws',
    heading: 'Requests and errors',
    framework: { name: 'sveltekit', dev: false, routeId: '/' },
  });
  expect(locator.landmarks).toContain('main');
  expect(locator.routeFiles[0]).toEqual({ file: 'src/routes/+page.svelte', routeId: '/', role: 'page', source: 'manifest' });
  expect(locator.source).toBeUndefined();
  // the crop is the element at 1x CSS pixels
  expect(crop).not.toBeNull();
  // (the whole CSS pixels that cover the element, whatever the scrollbar takes)
  expect(await page.evaluate(() => innerWidth - document.documentElement.clientWidth), 'the page shows a scrollbar').toBeGreaterThan(0);
  expect(crop!.w).toBe(Math.ceil(box.x + box.width) - Math.floor(box.x));
  expect(crop!.h).toBe(Math.ceil(box.y + box.height) - Math.floor(box.y));
  expect(locator.crop).toEqual({ w: crop!.w, h: crop!.h, scale: 1 });
  expect(crop!.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  // the uncaught TypeError is attached; this build serves no maps
  const err = locator.errors?.find((e) => e.kind === 'error' && /TypeError/.test(e.message));
  expect(err, JSON.stringify(locator.errors)).toBeTruthy();
  expect(err).toMatchObject({ mapped: false, reason: 'no_map' });
  await page.close();
});

test('production build: route params, server loads, text selection and area packets', async ({ context, sw }) => {
  test.skip(!(await up(`${LAB_MAPS_URL}/items/42`)), `source-mapped lab build not running at ${LAB_MAPS_URL} (see the header of this file)`);
  const { page, tabId } = await open(context, sw, `${LAB_MAPS_URL}/items/42`);
  const item = await locate(sw, tabId, { selector: '[data-testid="item-buy"]' });
  expect(item.locator).toMatchObject({ route: '/items/42', heading: 'Item 42', framework: { name: 'sveltekit', routeId: '/items/[id]' } });
  expect(item.locator.routeFiles[0]).toEqual({ file: 'src/routes/items/[id]/+page.svelte', routeId: '/items/[id]', role: 'page', source: 'manifest', params: { id: '42' } });

  // a text selection
  await page.locator('p').first().selectText();
  const text = await locate(sw, tabId, { selection: true, crop: false });
  expect(text.locator).toMatchObject({ kind: 'text', selection: 'A route with a parameter, for source location tests.', tag: 'p' });
  expect(text.crop).toBeNull();

  // an area: described by the element under its centre, cropped to the area
  const box = (await page.getByTestId('item-buy').boundingBox())!;
  const rect = { x: Math.round(box.x) - 4, y: Math.round(box.y) - 4, w: Math.round(box.width) + 8, h: Math.round(box.height) + 8 };
  const area = await locate(sw, tabId, { rect });
  expect(area.locator).toMatchObject({ kind: 'area', testId: 'item-buy' });
  expect(area.crop).toMatchObject({ w: rect.w, h: rect.h });

  // a page with a server load (the route table marks it) also lists +page.server.ts; the form
  // page's server file holds only actions, which a production route table does not mark
  await page.goto(`${LAB_MAPS_URL}/slow`);
  await page.waitForLoadState('networkidle');
  const slow = await locate(sw, tabId, { at: { x: 5, y: 5 }, crop: false });
  expect(slow.locator.routeFiles.map((f) => f.file)).toEqual(['src/routes/slow/+page.svelte', 'src/routes/slow/+page.server.ts']);
  await page.goto(`${LAB_MAPS_URL}/form`);
  await page.waitForLoadState('networkidle');
  const form = await locate(sw, tabId, { at: { x: 5, y: 5 }, crop: false });
  expect(form.locator.routeFiles.map((f) => f.file)).toEqual(['src/routes/form/+page.svelte']);
  await page.close();
});

test('source-mapped build: error stacks map to the original file and line, also as stackmap events', async ({ context, sw }) => {
  test.skip(!(await up(LAB_MAPS_URL)), `source-mapped lab build not running at ${LAB_MAPS_URL} (see the header of this file)`);
  const { page, tabId } = await open(context, sw, LAB_MAPS_URL);
  await page.getByTestId('throws').click();
  const line = lineOf('+page.svelte', 'return user.profile.name');
  // the worker emits a stackmap event that points at the error event
  await expect
    .poll(
      async () =>
        sw.evaluate(async (tabId) => {
          const svc = (globalThis as unknown as { __tb: { capture: { flushTabs(t: number[]): Promise<void>; ringInfo(t: number, s: number, f: boolean): Promise<{ slice: { events: { id: string; kind: string; data: Record<string, unknown> }[] } }> } } }).__tb.capture;
          await svc.flushTabs([tabId]);
          const ev = (await svc.ringInfo(tabId, 60_000, true)).slice.events;
          const err = ev.find((e) => e.kind === 'error' && e.data.name === 'TypeError');
          const map = ev.find((e) => e.kind === 'stackmap' && e.data.ref === err?.id);
          return map ? (map.data.frames as { file?: string; srcLine?: number }[])[0] : null;
        }, tabId),
      { timeout: 20_000 },
    )
    .toMatchObject({ file: 'src/routes/+page.svelte', srcLine: line });

  const { locator } = await locate(sw, tabId, { selector: '[data-testid="throws"]', crop: false });
  const err = locator.errors?.find((e) => e.kind === 'error' && /TypeError/.test(e.message));
  expect(err?.mapped).toBe(true);
  expect(err?.frames?.[0]).toMatchObject({ fn: expect.any(String), file: 'src/routes/+page.svelte', srcLine: line, snippet: 'return user.profile.name;' });
  // console.error with an Error object maps too
  await page.getByTestId('console').click();
  const again = await locate(sw, tabId, { selector: '[data-testid="console"]', crop: false });
  const logged = again.locator.errors?.find((e) => e.kind === 'console' && /lab error object/.test(e.message));
  expect(logged?.frames?.[0]).toMatchObject({ file: 'src/routes/+page.svelte', srcLine: lineOf('+page.svelte', "new Error('lab error object')") });
  await page.close();
});

test('dev server: __svelte_meta gives the real file and line; stacks map through vite maps', async ({ context, sw }) => {
  test.skip(!(await up(LAB_DEV_URL)), `lab dev server not running at ${LAB_DEV_URL} (see the header of this file)`);
  const { page, tabId } = await open(context, sw, LAB_DEV_URL);
  await page.getByTestId('throws').click();
  const { locator } = await locate(sw, tabId, { selector: '[data-testid="throws"]', crop: false });
  expect(locator.source).toEqual({ file: 'src/routes/+page.svelte', line: lineOf('+page.svelte', 'data-testid="throws"'), column: 2, via: 'svelte-meta', depth: 0 });
  expect(locator.framework).toMatchObject({ name: 'sveltekit', dev: true, routeId: '/' });
  expect(locator.routeFiles[0]).toEqual({ file: 'src/routes/+page.svelte', routeId: '/', role: 'page', source: 'svelte-meta' });
  // the layout renders the page: Svelte's dev stack names it
  expect(locator.components?.some((c) => c.file === 'src/routes/+layout.svelte')).toBe(true);
  const err = locator.errors?.find((e) => e.kind === 'error' && /TypeError/.test(e.message));
  expect(err?.frames?.[0]).toMatchObject({ file: 'src/routes/+page.svelte', srcLine: lineOf('+page.svelte', 'return user.profile.name') });

  await page.goto(`${LAB_DEV_URL}/items/7`);
  await page.waitForLoadState('networkidle');
  const item = await locate(sw, tabId, { selector: '[data-testid="item-buy"]', crop: false });
  expect(item.locator.source).toMatchObject({ file: 'src/routes/items/[id]/+page.svelte', line: lineOf('items/[id]/+page.svelte', 'data-testid="item-buy"') });
  expect(item.locator.routeFiles[0]).toMatchObject({ file: 'src/routes/items/[id]/+page.svelte', routeId: '/items/[id]', source: 'svelte-meta' });
  await page.close();
});

test('the server stores a packet with its annotation and returns it with the capture', async ({ context, sw }) => {
  test.skip(!(await up(`${SERVER_URL}/api/health`)) || !(await up(LAB_URL)), `needs the server at ${SERVER_URL} and the lab app`);
  const { page, tabId } = await open(context, sw, LAB_URL);
  const { locator, crop } = await locate(sw, tabId, { selector: '[data-testid="works"]' });
  const api = await context.newPage();
  await signInOidc(api, SERVER_URL, `locator-${Date.now()}@toolbar.test`, { name: 'Locator Reviewer' });
  const me = await (await api.request.get(`${SERVER_URL}/api/v1/me`)).json();
  const created = await api.request.post(`${SERVER_URL}/api/v1/recordings`, {
    data: { clientId: crypto.randomUUID(), kind: 'screenshot', workspaceId: me.activeWorkspaceId, page: { url: locator.url, title: locator.title ?? '' }, startedAt: Date.now() },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const png = Buffer.from(crop!.dataUrl.split(',')[1]!, 'base64');
  const asset = await api.request.post(`${SERVER_URL}/api/v1/assets`, { multipart: { kind: 'crop', recordingId: id, file: { name: 'a01.png', mimeType: 'image/png', buffer: png } } });
  expect(asset.status(), await asset.text()).toBe(201);
  const { id: assetId } = await asset.json();
  const shot = await api.request.post(`${SERVER_URL}/api/v1/assets`, { multipart: { kind: 'screenshot', recordingId: id, file: { name: 'shot.png', mimeType: 'image/png', buffer: png } } });
  const fin = await api.request.post(`${SERVER_URL}/api/v1/recordings/${id}/finalize`, {
    data: { title: 'Locator round trip', screenshotAssetId: (await shot.json()).id, annotations: [{ assetId, comment: 'Save does nothing visible', shapes: [], locator }] },
  });
  expect(fin.status(), await fin.text()).toBe(200);
  const detail = await (await api.request.get(`${SERVER_URL}/api/v1/recordings/${id}`)).json();
  expect(detail.annotations).toHaveLength(1);
  expect(detail.annotations[0].locator).toMatchObject({ kind: 'element', testId: 'works', routeFiles: locator.routeFiles, crop: { w: crop!.w, h: crop!.h, scale: 1, assetId } });
  await api.close();
  await page.close();
});
