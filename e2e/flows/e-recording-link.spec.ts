// Flow E: ask someone else to record. The sender opens the popup, clicks the recording-link
// row, names the link and creates it; the link lands on the clipboard. The recipient opens it
// in a browser with no extension and no account, keeps "screen only", starts, picks the screen
// in Chrome's share picker, stops, adds a note and sends. The sender gets a mail with the
// capture, which holds video only.
//
// The recipient's browser goes through Chrome's picker, which crashes Chromium on Xvfb now and
// then (docs/spikes.md S2). It runs on a display of its own; throughPicker retries a crash twice
// in a fresh browser, then falls back to fake media and annotates the test.
import { chromium } from '@playwright/test';
import { BrowserCrash, FAKE_MEDIA, SERVER, api, clipboard, expect, labPage, linkIn, mailTo, openPopup, pickEntireScreenInPage, saveShot, test, throughPicker, waitReady, withPrivateDisplay, xshot } from './fixture.ts';

test('E: recording link from the popup; a recipient with no extension records and sends; the sender gets mail', async ({ tb, context }) => {
  // Sender: popup, recording-link row, a name, create (3 clicks and typing)
  const lab = await labPage(context);
  const popup = await openPopup(context, lab);
  await popup.locator('[data-row-main="link"]').click();
  const name = `Flow E ${Date.now().toString(36)}`;
  await popup.locator('[data-link-name]').fill(name);
  const before = clipboard();
  const t0 = Date.now();
  await popup.locator('[data-link-create]').click();
  await expect(popup.locator('[data-link-done]')).toBeVisible();
  const url = await popup.locator('[data-link-url]').inputValue();
  expect(url).toMatch(new RegExp(`^${SERVER}/rl/[A-Za-z0-9_-]+$`));
  await expect.poll(() => (clipboard() !== before ? clipboard() : ''), { message: 'link copied at once' }).toBe(url);
  console.log('E: link copied', Date.now() - t0, 'ms after create');
  await popup.close();
  await lab.close();

  const note = 'The total stays at zero after I add the second item.';
  await throughPicker('E', (mode) => withPrivateDisplay(async (display) => {
    const browser = await chromium.launch({
      headless: false,
      env: { ...process.env, DISPLAY: display },
      args: ['--window-position=0,0', '--window-size=1440,900', '--force-device-scale-factor=1', ...(mode === 'fake' ? FAKE_MEDIA : [])],
    });
    let crashed = false;
    let closing = false;
    browser.on('disconnected', () => {
      if (!closing) crashed = true;
    });
    try {
      const page = await (await browser.newContext({ viewport: null })).newPage();
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('heading', { name })).toBeVisible();
      await expect(page.getByTestId('choose-screen')).toHaveAttribute('aria-checked', 'true'); // screen only by default
      await page.getByTestId('choose-screen').click(); // the tile starts the recording (J-017)
      if (mode === 'picker') {
        // for a page the picker is a dialog in the tab, open on the tab list: Entire Screen, the thumbnail, Share
        expect(await pickEntireScreenInPage(), 'the share picker opened').toBeGreaterThan(0);
      }
      await expect(page.getByTestId('recorder-live')).toBeVisible({ timeout: 20_000 });
      xshot(`e-${mode}-recording`);
      await page.waitForTimeout(2500);
      await page.bringToFront();
      await page.getByTestId('recorder-stop').click();
      await expect(page.getByTestId('recorder-preview')).toBeVisible();
      await page.getByTestId('recorder-note').fill(note);
      await page.getByTestId('recorder-submit').click();
      await expect(page.getByTestId('recorder-done')).toBeVisible({ timeout: 60_000 });
      await page.screenshot({ path: saveShot(`e-${mode}-sent`) });
    } catch (e) {
      if (crashed) throw new BrowserCrash(`the recipient's Chromium went away (${mode}): ${(e as Error).message.split('\n')[0]}`);
      throw e;
    } finally {
      closing = true;
      await browser.close().catch(() => undefined);
    }
  }));

  // Sender: the mail names the link and carries the note and the capture
  const mail = await mailTo(context, tb.email, new RegExp(`New recording from "${name}"`), 60_000);
  expect(mail.text).toContain(note);
  const captureUrl = linkIn(mail.text, `${SERVER}/c/`);
  const id = captureUrl.split('/c/')[1]!.split(/[?#]/)[0]!;
  await waitReady(context, id, 180_000);
  const rec = await api<{ kind: string; title: string; recordingLinkId?: string | null }>(context, 'GET', `/api/v1/recordings/${id}`);
  expect(rec.status).toBe(200);
  expect(rec.body.kind).toBe('link'); // a recording-link capture
  // video only: no console or network capture from a recording link
  const net = await api<{ items: unknown[] }>(context, 'GET', `/api/v1/recordings/${id}/network`);
  expect(net.status === 200 ? (net.body.items ?? []).length : 0, `network ${net.status}`).toBe(0);
  const page = await context.newPage();
  await page.goto(captureUrl);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('video').first()).toBeVisible();
  await page.screenshot({ path: saveShot('e-sender-capture') });
  await page.close();
});
