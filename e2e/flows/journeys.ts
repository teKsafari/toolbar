// The capture-making journeys, shared: a later flow that needs a video or a replay reuses the
// one an earlier flow made in this worker, or makes its own.
import { SERVER, api, captureOf, chord, createFromEditor, editorFrame, expect, labPage, openPopup, saveShot, waitReady, type Made, type Nib } from './fixture.ts';

/** Click the lab's failing cases: hidden 500, uncaught throw, unhandled rejection, console levels. */
export async function labErrors(page: import('@playwright/test').Page) {
  await page.getByTestId('hidden-500').click();
  await page.waitForTimeout(300);
  await page.getByTestId('throws').click();
  await page.getByTestId('rejects').click();
  await page.getByTestId('console').click();
  await page.getByTestId('dead').click();
  await page.waitForTimeout(800);
}

/** Flow B. */
export async function recordLabErrors(nib: Nib): Promise<Made> {
  if (nib.made.video) return nib.made.video;
  const { context } = nib;
  const page = await labPage(context);
  const t0 = Date.now();
  await chord(page, 'ctrl+shift+space');
  // countdown 3, 2, 1 then live; the page keeps working underneath
  await page.waitForTimeout(4500);
  console.log('B: recording since', Date.now() - t0, 'ms after the chord');
  await labErrors(page);
  await page.waitForTimeout(1500);
  await chord(page, 'ctrl+shift+space');
  const t1 = Date.now();
  const f = await editorFrame(page, 60_000);
  console.log('B: editor after stop', Date.now() - t1, 'ms');
  await expect(f.locator('video')).toHaveCount(1);
  await page.screenshot({ path: saveShot('b-editor') });
  const title = `Flow B ${Date.now().toString(36)}`;
  const shareUrl = await createFromEditor(page, f, title);
  console.log('B: link', shareUrl);
  const rec = await captureOf(context, shareUrl);
  expect(rec.kind).toBe('video');
  expect(rec.title).toBe(title);
  await waitReady(context, rec.id, 180_000);
  // the recording holds the failing request and the errors
  const net = await api<{ items: { status: number | null; url: string }[] }>(context, 'GET', `/api/v1/recordings/${rec.id}/network?status=5xx`);
  expect(net.status).toBe(200);
  expect(net.body.items.some((r) => r.url.endsWith('/api/fail') && r.status === 500), JSON.stringify(net.body).slice(0, 500)).toBe(true);
  await page.close();
  nib.made.video = { id: rec.id, shareUrl, title };
  void SERVER;
  return nib.made.video;
}

/** Flow C, including the one-time setup in the popup (menu, settings, switch). */
export async function instantReplay(nib: Nib): Promise<Made> {
  if (nib.made.replay) return nib.made.replay;
  const { context } = nib;
  const first = await labPage(context);
  const popup = await openPopup(context, first);
  if (!(await popup.getByRole('button', { name: /Instant replay/ }).count())) {
    await popup.getByRole('button', { name: 'Menu' }).click();
    await popup.getByRole('menuitem', { name: 'Settings' }).click();
    const sw = popup.getByRole('switch', { name: 'Instant replay' });
    await sw.click();
    await expect(sw).toBeChecked();
  }
  await popup.close();
  await first.close();

  // the buffer starts at the page load; the bug happens, nobody is recording
  const page = await labPage(context);
  await page.waitForTimeout(1500);
  await labErrors(page);
  await page.waitForTimeout(1500);
  const t0 = Date.now();
  await chord(page, 'ctrl+shift+x');
  const f = await editorFrame(page, 60_000);
  console.log('C: editor after the chord', Date.now() - t0, 'ms');
  await page.screenshot({ path: saveShot('c-editor') });
  const title = `Flow C ${Date.now().toString(36)}`;
  const shareUrl = await createFromEditor(page, f, title);
  console.log('C: link', shareUrl);
  const rec = await captureOf(context, shareUrl);
  expect(rec.kind).toBe('replay');
  await waitReady(context, rec.id, 180_000);
  const net = await api<{ items: { status: number | null; url: string }[] }>(context, 'GET', `/api/v1/recordings/${rec.id}/network?status=5xx`);
  expect(net.body.items.some((r) => r.url.endsWith('/api/fail') && r.status === 500), JSON.stringify(net.body).slice(0, 500)).toBe(true);
  await page.close();
  nib.made.replay = { id: rec.id, shareUrl, title };
  return nib.made.replay;
}
