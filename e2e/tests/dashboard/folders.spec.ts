// Folders, selection, drag to folder and video upload on a fresh account (J-020, J-162 to
// J-166, J-203, J-213).
import { test, expect, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SERVER, dropVideo, go, json, launch, me, newContext, signIn, toast, uniqueEmail } from './helpers.ts';

// One account and page for the whole file; a failure skips the rest instead of re-running setup.
test.describe.configure({ mode: 'serial' });

let browser: Browser;
let page: Page;
let mp4: Buffer;
let small: Buffer;

test.beforeAll(async () => {
  browser = await launch();
  page = await (await newContext(browser)).newPage();
  await signIn(page, uniqueEmail(undefined, 'folders'));
  const dir = mkdtempSync(join(tmpdir(), 'tb-e2e-'));
  const f = join(dir, 'ten.mp4');
  // about 10 MB of H.264 so the upload converts a real file (J-020)
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '8', '-c:v', 'libx264', '-b:v', '10M', '-maxrate', '10M', '-bufsize', '20M', '-pix_fmt', 'yuv420p', f]);
  expect(statSync(f).size).toBeGreaterThan(6_000_000);
  mp4 = readFileSync(f);
  const g = join(dir, 'small.mp4');
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', g]);
  small = readFileSync(g);
});
test.afterAll(async () => browser.close());

test('J-163, J-213, J-162, J-203: create a folder from the sidebar, collapse the list, open the empty folder', async () => {
  await go(page, '/');
  await expect(page.getByTestId('grid-empty')).toBeVisible();
  await page.getByTestId('folders-heading').hover();
  await page.getByTestId('new-folder').click();
  await page.getByTestId('new-folder-input').fill('Bugs');
  await page.keyboard.press('Enter');
  await toast(page, 'Folder "Bugs" created');
  await expect(page).toHaveURL(`${SERVER}/`); // you stay where you are
  await page.getByTestId('new-folder').click();
  await page.getByTestId('new-folder-input').fill('Archive');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('folder-list').getByRole('link')).toHaveText(['Archive', 'Bugs']);
  await page.getByTestId('folders-heading').click();
  await expect(page.getByTestId('folder-list')).toBeHidden();
  await page.getByTestId('folders-heading').click();
  await expect(page.getByTestId('folder-list')).toBeVisible();
  await page.getByTestId('folder-list').getByRole('link', { name: 'Bugs' }).click();
  await expect(page).toHaveURL(/\/f\/[a-z2-9]{4}$/);
  const empty = page.getByTestId('folder-empty');
  await expect(empty).toContainText('This folder is empty');
  await expect(empty.getByTestId('new-capture')).toBeVisible();
  await expect(page.getByTestId('filter-bar')).toHaveCount(0);
});

test('J-020: dropping a 10 MB MP4 makes a playable video capture with no logs; 201 MB is refused', async () => {
  await go(page, '/');
  await dropVideo(page, mp4, 'checkout-bug.mp4');
  await toast(page, 'checkout-bug.mp4 uploaded', 90_000);
  const card = page.getByTestId('capture-card').first();
  await expect(card).toContainText('checkout-bug');
  const id = (await card.getAttribute('data-id'))!;
  await expect
    .poll(async () => (await json<{ items: { id: string; status: string; source: string }[] }>(page, 'GET', '/api/v1/recordings?folderId=all')).items.find((c) => c.id === id)?.status, { timeout: 90_000 })
    .toBe('ready');
  const video = await page.request.get(`${SERVER}/api/v1/recordings/${id}/media/video`, { headers: { range: 'bytes=0-15' } });
  expect(video.status()).toBe(206);
  expect(video.headers()['content-type']).toContain('webm');
  const list = await json<{ items: { id: string; source: string; durationMs: number | null }[] }>(page, 'GET', '/api/v1/recordings?sources=upload');
  expect(list.items.find((c) => c.id === id)).toMatchObject({ source: 'upload' });
  // too big: refused before any upload
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new ArrayBuffer(201 * 1024 * 1024)], 'huge.mp4', { type: 'video/mp4' }));
    const t = document.querySelector('[data-testid=grid-wrap]')!;
    t.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    t.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await toast(page, /huge\.mp4 is 201 MB; videos are limited to 200 MB/);
});

test('J-159, J-165: tick a card, the selection bar counts it, move goes at once, delete confirms', async () => {
  const { activeWorkspaceId } = await me(page);
  await go(page, '/');
  // a second capture to work with
  await dropVideo(page, small, 'second.mp4');
  await toast(page, 'second.mp4 uploaded', 60_000);
  const cards = page.getByTestId('capture-card');
  await expect(cards).toHaveCount(2);
  await cards.first().hover();
  await cards.first().getByTestId('card-check').click();
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
  await cards.nth(1).click(); // in selection mode a click toggles
  await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
  await cards.nth(1).click();
  await expect(page.getByTestId('selection-count')).toHaveText('1 selected');
  await page.getByTestId('bulk-move').click();
  await expect(page.getByTestId('folder-picker').locator('[data-folder-pick=none]')).toBeDisabled(); // current location greyed
  await page.getByTestId('folder-picker').getByRole('menuitem', { name: 'Archive' }).click();
  await toast(page, 'Moved 1 capture to Archive');
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId('selection-bar')).toHaveCount(0);
  const folders = await json<{ items: { name: string; captureCount: number }[] }>(page, 'GET', `/api/v1/workspaces/${activeWorkspaceId}/folders`);
  expect(folders.items.find((f) => f.name === 'Archive')!.captureCount).toBe(1);
});

test('J-166: drag a card onto a sidebar folder to move it', async () => {
  await go(page, '/');
  const card = page.getByTestId('capture-card').first();
  const target = page.getByTestId('folder-list').getByRole('link', { name: 'Bugs' });
  const other = page.getByTestId('folder-list').getByRole('link', { name: 'Archive' });
  // while a card is dragged, folders get dashed outlines and the hovered one a solid outline
  await card.dispatchEvent('dragstart', { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
  await expect.poll(() => other.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('dashed');
  await target.dispatchEvent('dragover', { dataTransfer: await page.evaluateHandle(() => { const d = new DataTransfer(); d.setData('application/x-toolbar-captures', '[]'); return d; }) });
  await expect.poll(() => target.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe('solid');
  await card.dispatchEvent('dragend');
  await expect.poll(() => other.evaluate((el) => getComputedStyle(el).borderTopStyle)).not.toBe('dashed');
  await card.dragTo(target);
  await toast(page, 'Moved to Bugs');
  await expect(page.getByTestId('capture-card')).toHaveCount(0);
  await target.click();
  await expect(page.getByTestId('capture-card')).toHaveCount(1);
  await expect(page.getByTestId('folder-count')).toHaveText('1');
});

test('J-164: rename a folder from its menu (prefilled, selected), then delete it with its captures', async () => {
  await go(page, '/');
  await page.getByTestId('folder-list').getByRole('link', { name: 'Bugs' }).click();
  await page.getByTestId('folder-menu').click();
  await page.getByTestId('folder-rename').click();
  const input = page.getByTestId('rename-input');
  await expect(input).toHaveValue('Bugs');
  expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 4]);
  await input.fill('Checkout bugs');
  await page.keyboard.press('Enter');
  await toast(page, 'Renamed to "Checkout bugs"');
  await expect(page.getByTestId('folder-title')).toHaveText('Checkout bugs');
  const id = (await page.getByTestId('capture-card').first().getAttribute('data-id'))!;
  await page.getByTestId('folder-menu').click();
  await page.getByTestId('folder-delete').click();
  await expect(page.locator('[data-testid=confirm-dialog][open]')).toContainText('permanently');
  await page.locator('[data-testid=confirm-dialog][open]').getByTestId('confirm-button').click();
  await toast(page, 'Deleted "Checkout bugs" and 1 capture');
  await expect(page).toHaveURL(`${SERVER}/`);
  await expect(page.getByTestId('folder-list').getByRole('link')).toHaveText(['Archive']);
  // J-191: gone at its URL and its media 404s at once
  expect((await page.request.get(`${SERVER}/api/v1/recordings/${id}/media/video`)).status()).toBe(404);
});

test('J-165: bulk delete asks first', async () => {
  await go(page, '/');
  await page.getByTestId('folder-list').getByRole('link', { name: 'Archive' }).click();
  const card = page.getByTestId('capture-card').first();
  await card.hover();
  await card.getByTestId('card-check').click();
  await page.getByTestId('bulk-delete').click();
  await expect(page.locator('[data-testid=confirm-dialog][open]')).toContainText('Delete this capture?');
  await page.locator('[data-testid=confirm-dialog][open]').getByTestId('confirm-button').click();
  await toast(page, 'Deleted 1 capture');
  await expect(page.getByTestId('folder-empty')).toBeVisible();
});
