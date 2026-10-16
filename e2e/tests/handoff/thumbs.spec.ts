// Card images for every capture kind (D-184) against a real server (SERVER_URL) with the mock
// OIDC provider: the extension makes a screenshot, a tab video, an instant replay without video
// and a trace on the lab app; an injector capture comes over the HTTP API as the page bundle
// sends it (no still). Each one shows a loaded image in the dashboard grid: the screenshot, the
// video's poster frame, the stills the extension sent for the replay and the trace (the
// viewport's shape), and the placeholder card for the injector capture (640x400). The last test
// checks the production preset's mask on a still: the text of a lab button is painted over.
//   SERVER_URL=http://localhost:3550 E2E_DISPLAY=:250 npx playwright test tests/handoff/thumbs.spec.ts
import type { Page, Worker } from '@playwright/test';
import { LAB_URL, expect, session, setSettings, sleep, svc, tabIdOf, test } from '../capture/helpers.ts';
import { SERVER, injectorCapture, newAccount, waitReady } from './seed.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

test.describe.configure({ mode: 'serial', timeout: 300_000 });

const tb = <T>(sw: Worker, fn: string, ...args: unknown[]) =>
  sw.evaluate(
    async ({ fn, args }) => {
      const [obj, name] = fn.split('.') as [string, string];
      const o = (globalThis as unknown as { __tb: Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> }).__tb[obj]!;
      return JSON.parse(JSON.stringify((await o[name]!.apply(o, args)) ?? null));
    },
    { fn, args },
  ) as Promise<T>;

async function connect(sw: Worker, page: Page) {
  const acct = await newAccount(page, 'thumbs');
  await sw.evaluate(
    async ({ serverUrl, token, ws, email }) => {
      await chrome.storage.local.set({
        'tb:auth': { serverUrl, token, tokenId: 'tok-thumbs', user: { id: 'u', name: 'Thumbs', email, image: null }, activeWorkspaceId: ws, signedInAt: Date.now() },
        'tb:server-url': serverUrl,
      });
    },
    { serverUrl: SERVER, token: acct.token, ws: acct.workspaceId, email: acct.email },
  );
  await sw.evaluate(() => (globalThis as unknown as { __tb: { capture: { apply(e: unknown): Promise<unknown> } } }).__tb.capture.apply({ type: 'RESET' }));
  return acct;
}

/** Natural size of a card's image once it has loaded. */
async function cardImage(grid: Page, id: string) {
  const img = grid.locator(`[data-testid=capture-card][data-id="${id}"] .thumb img`);
  await expect(img, `card image of ${id}`).toHaveCount(1, { timeout: 30_000 });
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0)), { timeout: 30_000 }).toBeGreaterThan(0);
  return img.evaluate((i: HTMLImageElement) => ({ w: i.naturalWidth, h: i.naturalHeight, src: i.getAttribute('src') }));
}

test('every capture kind gets a card image in the dashboard grid', async ({ tabBrowser: { context, sw } }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  const setup = await context.newPage();
  const { token, workspaceId } = await connect(sw, setup);
  // the capture page must not open after create: the lab tab stays the active one for the stills
  await setSettings(sw, { openInNewTab: false });
  const ids: Record<string, string> = {};

  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page);
  expect(tabId).toBeGreaterThan(0);

  // screenshot
  const shot = await svc<{ id: string }>(sw, 'takeScreenshot', null, { tabId, openEditor: false });
  ids.screenshot = (await svc<{ recordingId: string }>(sw, 'createFromDraft', shot.id, { title: 'Thumbs: screenshot', workspaceId })).recordingId;
  await expect.poll(async () => (await session(sw)).state, { timeout: 15_000 }).toBe('idle');
  // the screenshot's editor overlay goes with a reload
  await page.reload();
  await page.bringToFront();

  // tab video
  await setSettings(sw, { recordMode: 'tab', mic: false });
  await svc(sw, 'startRecording', { tabId, delaySec: 0 });
  await expect.poll(async () => (await session(sw)).state, { timeout: 15_000 }).toBe('recording');
  await page.getByTestId('works').click();
  await sleep(2500);
  await svc(sw, 'stopRecording');
  await expect.poll(async () => (await session(sw)).state, { timeout: 8000 }).toBe('draft');
  ids.video = (await svc<{ recordingId: string }>(sw, 'createFromDraft', (await session(sw)).draftId, { title: 'Thumbs: video', workspaceId })).recordingId;
  await expect.poll(async () => (await session(sw)).state, { timeout: 30_000 }).toBe('idle');

  // instant replay, DOM only: the still comes from the extension
  await setSettings(sw, { instantReplay: true, replayMinutes: 1 });
  try {
    await page.reload();
    await page.bringToFront();
    await sleep(1500);
    await page.getByTestId('works').click();
    await sleep(800);
    const draft = await svc<{ id: string; thumbBlobId: string | null; kind: string }>(sw, 'triggerReplay', tabId, { openEditor: false });
    expect(draft.kind).toBe('replay');
    expect(draft.thumbBlobId, 'the replay draft holds a still').toBeTruthy();
    ids.replay = (await svc<{ recordingId: string }>(sw, 'createFromDraft', draft.id, { title: 'Thumbs: replay', workspaceId })).recordingId;
    await expect.poll(async () => (await session(sw)).state, { timeout: 30_000 }).toBe('idle');
  } finally {
    await setSettings(sw, { instantReplay: false });
  }

  // trace: the still of the page as the trace stops
  await page.reload();
  await page.bringToFront();
  await tb(sw, 'trace.start', tabId);
  await sleep(800);
  await page.getByTestId('works').click();
  await sleep(1500);
  ids.trace = (await tb<{ recordingId: string }>(sw, 'trace.stop', { open: false })).recordingId;

  // injector capture: events and rrweb over the HTTP API, no still
  ids.injector = await injectorCapture(page.request, token, workspaceId, { kind: 'replay', title: 'Thumbs: injector', comment: 'From the injector', events: 'submit' });

  for (const id of Object.values(ids)) await waitReady(page.request, token, id);

  const grid = await context.newPage();
  await grid.setViewportSize({ width: 1440, height: 2000 });
  await grid.goto(`${SERVER}/`);
  const sizes: Record<string, { w: number; h: number; src: string | null }> = {};
  for (const [kind, id] of Object.entries(ids)) sizes[kind] = await cardImage(grid, id);
  for (const s of Object.values(sizes)) expect(s.src).toMatch(/\/media\/(thumb|screenshot)$/);
  // stills of the viewport, not the placeholder card
  for (const k of ['video', 'replay', 'trace'] as const) {
    expect(sizes[k]!.w, `${k} card width`).toBeLessThanOrEqual(640);
    expect(sizes[k]!.h, `${k} is not the 640x400 placeholder: ${JSON.stringify(sizes[k])}`).not.toBe(400);
  }
  expect(sizes.injector).toMatchObject({ w: 640, h: 400 });
  await grid.screenshot({ path: test.info().outputPath('grid.png') });
  await Promise.all([setup.close(), page.close(), grid.close()]);
});

test('under the production preset the still paints over the page text', async ({ tabBrowser: { context, sw } }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page);
  // the centre of the first text line of a lab button, in CSS pixels
  const at = await page.getByTestId('works').evaluate((b) => {
    const r = document.createRange();
    r.selectNodeContents(b.firstChild ?? b);
    const box = r.getClientRects()[0] ?? b.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2, vw: innerWidth };
  });
  const sample = (preset: 'staging' | 'production') =>
    sw.evaluate(
      async ({ tabId, lab, preset, at }) => {
        const cur = await chrome.storage.local.get(['tb:bootstrap', 'tb:auth']);
        await chrome.storage.local.set({
          'tb:auth': cur['tb:auth'] ?? { serverUrl: 'http://127.0.0.1:9', token: 'tb_dev_x', tokenId: 't', user: { id: 'u', name: 'U', email: 'u@u.test', image: null }, activeWorkspaceId: 'w', signedInAt: Date.now() },
          'tb:bootstrap': { at: Date.now(), data: { ...(cur['tb:bootstrap']?.data ?? { limits: { chunkBytes: 1048576, maxRecordingMs: null, aiAvailable: false } }), projects: [{ id: 'p', workspaceId: 'w', name: 'Lab', origins: [lab], maskingPreset: preset, bodyAllowlist: [] }] } },
        });
        try {
          const tab = await chrome.tabs.get(tabId);
          const tbx = (globalThis as unknown as { __tb: { capture: { cardStillOf(t: unknown): Promise<{ blob: Blob; width: number; height: number } | null> } } }).__tb;
          const r = await tbx.capture.cardStillOf(tab);
          if (!r) return null;
          const bmp = await createImageBitmap(r.blob);
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const g = c.getContext('2d')!;
          g.drawImage(bmp, 0, 0);
          const s = bmp.width / at.vw;
          const px = Array.from(g.getImageData(Math.round(at.x * s), Math.round(at.y * s), 1, 1).data.slice(0, 3));
          return { w: r.width, h: r.height, type: r.blob.type, px };
        } finally {
          if (cur['tb:bootstrap']) await chrome.storage.local.set({ 'tb:bootstrap': cur['tb:bootstrap'] });
          else await chrome.storage.local.remove('tb:bootstrap');
        }
      },
      { tabId, lab: new URL(LAB_URL).origin, preset, at },
    );
  const masked = await sample('production');
  expect(masked).not.toBeNull();
  expect(masked!.type).toBe('image/webp');
  expect(masked!.w).toBeLessThanOrEqual(640);
  // the bar colour, #c7cbd1, give or take the WebP encoder
  const near = (px: number[], rgb: number[], d = 14) => px.every((v, i) => Math.abs(v - rgb[i]!) <= d);
  expect(near(masked!.px, [0xc7, 0xcb, 0xd1]), `masked pixel ${masked!.px}`).toBe(true);
  const plain = await sample('staging');
  expect(near(plain!.px, [0xc7, 0xcb, 0xd1]), `staging pixel ${plain!.px}`).toBe(false);
  await page.close();
});
