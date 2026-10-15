// Editor e2e: create, the form, destination/workspace/folder pickers, attachments, discard.
import type { BrowserContext, FrameLocator, Page, Worker } from '@playwright/test';
import { expect, test, LAB_URL } from '../../fixtures/extension.ts';
import { MOCK_IDS, startMock, type MockState } from './mock-server.ts';
import { MOCK_PORT, draftCount, getDraft, openEditorInPage, openEditorTab, seedDraft, signIn, tabIdOf } from './helpers.ts';
import { budget } from '../../fixtures/budget.ts';

let mock: MockState;
test.beforeAll(async () => {
  mock = await startMock(MOCK_PORT);
});
test.afterAll(async () => {
  await mock.close();
});
test.beforeEach(() => {
  mock.finalizes.length = 0;
  mock.assets.clear();
  mock.recordings.clear();
});

async function labPage(context: BrowserContext, sw: Worker) {
  await signIn(sw, mock.url);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 860 });
  await page.goto(LAB_URL);
  await page.locator('toolbar-root').waitFor({ state: 'attached' });
  return page;
}

/** Decode a PNG in the browser and read pixels at image coordinates. */
async function pixels(page: Page, png: Buffer, pts: [number, number][]) {
  return page.evaluate(
    async ({ b64, pts }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      return { w: c.width, h: c.height, px: pts.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data)) };
    },
    { b64: png.toString('base64'), pts },
  );
}

/** Mean absolute step between neighbouring pixels in a box: sharp text is high, blur is low. */
async function sharpness(page: Page, png: Buffer, box: { x: number; y: number; w: number; h: number }) {
  return page.evaluate(
    async ({ b64, box }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(box.x, box.y, box.w, box.h).data;
      let sum = 0;
      for (let i = 4; i < d.length; i += 4) sum += Math.abs(d[i]! - d[i - 4]!);
      return sum / (d.length / 4);
    },
    { b64: png.toString('base64'), box },
  );
}

async function mapper(f: FrameLocator, imgW = 1000) {
  const b = (await f.getByTestId('annotator').boundingBox())!;
  const k = b.width / imgW;
  return (x: number, y: number) => [b.x + x * k, b.y + y * k] as [number, number];
}
async function drag(page: Page, from: [number, number], to: [number, number]) {
  await page.mouse.move(...from);
  await page.mouse.down();
  await page.mouse.move(...to, { steps: 6 });
  await page.mouse.up();
}

test('create a screenshot: annotations and blur burned into one PNG, link copied, capture opens right of the tab (J-086, J-051, J-044, J-197, J-202)', async ({ context, sw }) => {
  const page = await labPage(context, sw);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(LAB_URL).origin });
  const tabId = await tabIdOf(sw, page);
  const id = await seedDraft(sw, { tabId });
  const f = await openEditorInPage(sw, page, id);
  const at = await mapper(f);
  await f.locator('[data-tool="rect"]').click();
  await drag(page, at(600, 300), at(900, 500));
  await f.locator('[data-tool="blur"]').click();
  await drag(page, at(20, 20), at(500, 110));
  await f.getByTestId('field').click();
  await page.keyboard.type('Rows are wrong');

  const t0 = Date.now();
  await f.getByTestId('create').click();
  await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0, { timeout: 15000 });
  const elapsed = Date.now() - t0;
  console.log('create to close', elapsed, 'ms');
  expect(elapsed).toBeLessThan(budget(4000));
  await expect(page.locator('toolbar-root').getByText('Link copied')).toBeVisible();

  expect(mock.finalizes).toHaveLength(1);
  const fin = mock.finalizes[0]!;
  expect(fin.body).toMatchObject({ title: 'Rows are wrong', destination: { type: 'link' }, aiAccepted: false });
  const shot = mock.assets.get(fin.body.screenshotAssetId as string)!;
  expect(shot.kind).toBe('screenshot');
  expect(shot.type).toBe('image/png');
  const { w, px } = await pixels(page, shot.bytes, [
    [600, 400],
    [750, 400],
  ]);
  expect(w).toBe(1000);
  // the rectangle outline in ink, the inside untouched
  expect(px[0]!.slice(0, 3)).toEqual([0x34, 0x46, 0xcf]);
  expect(px[1]!.slice(0, 3)).toEqual([255, 255, 255]);
  // the blurred band is much softer than the same band in the original
  const blurred = await sharpness(page, shot.bytes, { x: 40, y: 30, w: 400, h: 60 });
  const sharp = await sharpness(page, shot.bytes, { x: 40, y: 250, w: 400, h: 60 });
  expect(blurred).toBeLessThan(sharp / 3);

  // link on the clipboard, copied by the extension (focus the page to read it)
  await page.bringToFront();
  await page.mouse.click(5, 5);
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()), { timeout: 5000 }).toBe(`${mock.url}/s/share-${fin.id.slice(0, 8)}`);
  // the capture page opened in a background tab directly right of the source tab
  const tabs = await sw.evaluate(async () => (await chrome.tabs.query({ currentWindow: true })).map((t) => ({ id: t.id, index: t.index, url: t.url ?? t.pendingUrl, active: t.active })));
  const src = tabs.find((t) => t.id === tabId)!;
  const opened = tabs.find((t) => t.url?.includes(`/c/${fin.id}`))!;
  expect(opened.index).toBe(src.index + 1);
  expect(opened.active).toBe(false);
  // the draft is gone
  expect(await getDraft(sw, id)).toBeUndefined();
  await sw.evaluate((tid) => chrome.tabs.remove(tid), opened.id!);
  await page.close();
});

test('Ctrl+Enter in the title creates; an empty title is fine (J-220, J-077)', async ({ context, sw }) => {
  const page = await labPage(context, sw);
  const id = await seedDraft(sw, { tabId: await tabIdOf(sw, page) });
  const f = await openEditorInPage(sw, page, id);
  await expect(f.getByTestId('field')).toBeFocused();
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0);
  expect(mock.finalizes).toHaveLength(1);
  expect(mock.finalizes[0]!.body).toMatchObject({ title: '', description: '' });
  await page.close();
});

test('one field: first line is the title, Markdown rules and Ctrl+B in the description (J-077, J-078)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  const id = await seedDraft(sw);
  await openEditorTab(page, id);
  await expect(page.getByTestId('field')).toBeFocused();
  await page.keyboard.type('Checkout total is wrong');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Steps ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('matter');
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- open cart');
  await page.keyboard.press('Enter');
  await page.keyboard.type('pay');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. first');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await expect(page.getByTestId('field').locator('ul li')).toHaveCount(2);
  await expect(page.getByTestId('field').locator('ol li')).toHaveCount(2);
  const titleSize = await page.getByTestId('field').locator('> :first-child').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(titleSize).toBeGreaterThanOrEqual(18);
  await page.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(1);
  expect(mock.finalizes[0]!.body.title).toBe('Checkout total is wrong');
  expect(mock.finalizes[0]!.body.description).toBe('Steps **matter**\n- open cart\n- pay\n1. first\n2. second');
});

test('destination menu: share link default, GitHub, GitLab, Slack and webhook, no skipped trackers; GitHub fields reach finalize (J-079)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  const id = await seedDraft(sw);
  await openEditorTab(page, id);
  await expect(page.getByTestId('destination')).toContainText('Share link');
  await page.getByTestId('destination').click();
  const menu = page.getByRole('menu', { name: 'Destination' });
  await expect(menu.getByRole('menuitemradio')).toHaveText([/Share link/, /GitHub: lab\/shop/, /GitLab.*Connect/, /Slack.*Connect/, /Webhook.*Settings/]);
  await expect(menu).not.toContainText(/Jira|Linear|ClickUp|Notion|Azure|Asana/);
  await page.getByTestId('dest-github').click();
  await expect(page.getByTestId('destination')).toContainText('GitHub: lab/shop');
  await expect(page.getByTestId('dest-repo')).toHaveValue('lab/shop');
  await page.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(1);
  expect(mock.finalizes[0]!.body.destination).toEqual({ type: 'integration', integrationId: MOCK_IDS.GH, fields: { repo: 'lab/shop' } });
});

test('paused trackers and Slack (docs/scope.md): no destination picker, create sends the share link', async ({ page, sw }) => {
  mock.features = { ai: false, trackers: false, slack: false };
  try {
    await signIn(sw, mock.url);
    const id = await seedDraft(sw);
    await openEditorTab(page, id);
    await expect(page.getByTestId('workspace')).toBeVisible();
    await expect(page.getByTestId('destination')).toHaveCount(0);
    await page.getByTestId('create').click();
    await expect.poll(() => mock.finalizes.length).toBe(1);
    expect(mock.finalizes[0]!.body.destination ?? { type: 'link' }).toEqual({ type: 'link' });
  } finally {
    mock.features = { ai: true, trackers: true, slack: true };
  }
});

test('workspace picker switches folders, integrations and the target workspace (J-080, J-251)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  const id = await seedDraft(sw);
  await openEditorTab(page, id);
  await page.getByTestId('folder').click();
  await expect(page.getByRole('menu', { name: 'Folder' })).toContainText('Checkout bugs');
  await page.keyboard.press('Escape');
  await page.getByTestId('workspace').click();
  await expect(page.getByRole('menu', { name: 'Workspace' }).getByRole('menuitemradio')).toHaveText([/Lab shop/, /Second team/]);
  await page.getByTestId(`ws-${MOCK_IDS.WS2}`).click();
  await expect(page.getByTestId('workspace')).toHaveAttribute('aria-label', /Second team/);
  await page.getByTestId('folder').click();
  await expect(page.getByRole('menu', { name: 'Folder' })).toContainText('Team two inbox');
  await expect(page.getByRole('menu', { name: 'Folder' })).not.toContainText('Checkout bugs');
  await page.keyboard.press('Escape');
  await page.getByTestId('destination').click();
  await expect(page.getByTestId('dest-github')).toContainText('Connect');
  await page.keyboard.press('Escape');
  await page.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(1);
  expect(mock.finalizes[0]!.body.workspaceId).toBe(MOCK_IDS.WS2);
  expect([...mock.recordings.values()][0]!.body.workspaceId).toBe(MOCK_IDS.WS2);
});

test('folder picker lists no folder plus each folder; the pick sticks for the next fresh draft (J-081)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  const id = await seedDraft(sw);
  await openEditorTab(page, id);
  await expect(page.getByTestId('folder')).toHaveText(/Folder/);
  await page.getByTestId('folder').click();
  await expect(page.getByRole('menu', { name: 'Folder' }).getByRole('menuitemradio')).toHaveText([/No folder/, /Checkout bugs/, /Design/]);
  await page.getByTestId(`folder-${MOCK_IDS.F2}`).click();
  await expect(page.getByTestId('folder')).toHaveText(/Design/);
  await page.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(1);
  expect(mock.finalizes[0]!.body.folderId).toBe(MOCK_IDS.F2);
  const id2 = await seedDraft(sw);
  await openEditorTab(page, id2);
  await expect(page.getByTestId('folder')).toHaveText(/Design/);
});

test('attach a PNG and a text file: both upload as attachments of the capture (J-082)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  const id = await seedDraft(sw);
  await openEditorTab(page, id);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.getByTestId('attach-input').setInputFiles([
    { name: 'error.png', mimeType: 'image/png', buffer: png },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('steps and notes') },
  ]);
  await expect(page.getByTestId('attachments').locator('li')).toHaveCount(2);
  await expect(page.getByTestId('attachments')).toContainText('notes.txt');
  // kept with the draft (survives save for later)
  await expect.poll(async () => ((await getDraft(sw, id))?.attachmentBlobIds as string[] | undefined)?.length).toBe(2);
  await page.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(1);
  const ids = mock.finalizes[0]!.body.attachmentAssetIds as string[];
  expect(ids).toHaveLength(2);
  const atts = ids.map((i) => mock.assets.get(i)!);
  expect(atts.map((a) => [a.kind, a.name, a.type])).toEqual([
    ['attachment', 'error.png', 'image/png'],
    ['attachment', 'notes.txt', 'text/plain'],
  ]);
  expect(atts[1]!.bytes.toString()).toBe('steps and notes');
});

test('area shot keeps the full viewport by default; unticked creates the crop only (J-004)', async ({ page, sw }) => {
  await signIn(sw, mock.url);
  const crop = { x: 100, y: 80, w: 600, h: 400 };
  const id = await seedDraft(sw, { crop });
  await openEditorTab(page, id);
  await expect(page.getByTestId('keep-full')).toBeVisible();
  await expect(page.getByTestId('keep-full-check')).toBeChecked();
  await page.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(1);
  const b1 = mock.finalizes[0]!.body;
  expect(mock.assets.get(b1.screenshotAssetId as string)!.kind).toBe('crop');
  expect(mock.assets.get(b1.fullScreenshotAssetId as string)!.kind).toBe('screenshot');
  const full = await pixels(page, mock.assets.get(b1.fullScreenshotAssetId as string)!.bytes, [[0, 0]]);
  expect(full.w).toBe(1200);

  const id2 = await seedDraft(sw, { crop });
  await openEditorTab(page, id2);
  await page.getByTestId('keep-full-check').uncheck();
  await page.getByTestId('create').click();
  await expect.poll(() => mock.finalizes.length).toBe(2);
  const b2 = mock.finalizes[1]!.body;
  expect(b2.fullScreenshotAssetId ?? null).toBeNull();
  expect([...mock.assets.values()].filter((a) => a.recordingId === mock.finalizes[1]!.id)).toHaveLength(1);
});

test('close discards a screenshot draft at once; Escape asks for a second press within a second (J-088)', async ({ context, sw }) => {
  const page = await labPage(context, sw);
  const tabId = await tabIdOf(sw, page);
  const before = await draftCount(sw);
  const id = await seedDraft(sw, { tabId });
  let f = await openEditorInPage(sw, page, id);
  await f.getByTestId('close').click();
  await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0);
  expect(await getDraft(sw, id)).toBeUndefined();

  const id2 = await seedDraft(sw, { tabId });
  f = await openEditorInPage(sw, page, id2);
  await page.keyboard.press('Escape');
  await expect(f.getByText('Press Escape again to discard this draft')).toBeVisible();
  await page.waitForTimeout(1300);
  // Too late: the next press asks again, and one right after it discards. Both presses go in
  // one step inside the editor, 100 ms apart; two round trips from here took over a second on a
  // busy machine, which is the window itself.
  const editor = page.frames().find((fr) => fr.url().includes('/editor.html'))!;
  const askedAgain = await editor.evaluate(async () => {
    const esc = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    esc();
    await new Promise((r) => setTimeout(r, 100));
    const asked = document.body.textContent?.includes('Press Escape again to discard this draft') ?? false;
    esc();
    return asked;
  });
  expect(askedAgain).toBe(true);
  await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0);
  expect(await getDraft(sw, id2)).toBeUndefined();
  expect(await draftCount(sw)).toBe(before);
  await page.close();
});
