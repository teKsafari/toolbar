// Flow D: desktop recording across tabs. Popup, record chevron, Screen (sticky), record row,
// Chrome's share picker (Entire Screen, the thumbnail, Share), work in two tabs, stop, create.
//
// Chrome's picker crashes Chromium on Xvfb now and then (X BadWindow, docs/spikes.md S2), so
// this flow runs in a browser of its own with its own account, on a display of its own: a crash
// cannot take down the browser the other flows share. throughPicker gives a crash two more tries
// in a fresh browser, then falls back to fake media with a "limitation" annotation. Any failure
// that is not a browser crash fails the test at once. In practice about half the tries crash,
// right as the picker opens and the popup closes.
import { BrowserCrash, FAKE_MEDIA, LAB_URL, api, captureOf, chord, connectExtension, createFromEditor, editorFrame, expect, labPage, launchExtension, newEmail, openPopup, pickEntireScreen, saveShot, test, throughPicker, waitReady, withPrivateDisplay, xshot } from './fixture.ts';

type Mode = 'picker' | 'fake';

interface Session {
  state: string;
  recordingId?: string;
}

const desktopRecording = (mode: Mode) => withPrivateDisplay((display) => desktopRecordingOn(display, mode));

async function desktopRecordingOn(display: string, mode: Mode) {
  const b = await launchExtension({ cdpPort: 9351, display, args: mode === 'fake' ? FAKE_MEDIA : [] });
  let crashed = false;
  let closing = false;
  b.context.on('close', () => {
    if (!closing) crashed = true;
  });
  const session = async () => (await (await b.sw()).evaluate(async () => (await chrome.storage.session.get('tb:session'))['tb:session'])) as Session;
  try {
    const { lab, popup: first } = await connectExtension(b.context, newEmail('desk'));
    await first.close();
    await lab.close();

    // Tab A: the popup, chevron, Screen, record row (4 clicks)
    const a = await labPage(b.context);
    const popup = await openPopup(b.context, a);
    await popup.locator('[data-row-chevron="record"]').click();
    await popup.locator('[data-row-options="record"] [data-value="desktop"]').click();
    await expect(popup.locator('[data-row-main="record"]')).toContainText('Record full screen');
    await popup.locator('[data-row-main="record"]').click();

    // Chrome's picker: Entire Screen is already the open tab for a monitor request (2 clicks)
    let picked = 0;
    if (mode === 'picker') {
      picked = await pickEntireScreen();
      expect(picked, 'the share picker opened').toBeGreaterThan(0);
    }
    const t0 = Date.now();
    await expect.poll(async () => { const s = await session(); return s?.state === 'error' ? `error: ${JSON.stringify(s)}` : s?.state; }, { timeout: 30_000, message: 'live after the picker' }).toBe('recording');
    console.log(`D (${mode}): live ${Date.now() - t0} ms after Share; picker clicks ${picked}`);
    xshot(`d-${mode}-live`);

    // the hidden 500 in tab A, then a second tab where the save works
    await a.getByTestId('hidden-500').click();
    await expect(a.getByTestId('status')).toContainText('saved');
    const tabB = await labPage(b.context);
    await tabB.getByTestId('works').click();
    await tabB.getByTestId('console').click();
    await tabB.waitForTimeout(1500);

    // stop from tab B (the record chord stops a live recording); the editor opens there
    await chord(tabB, 'ctrl+shift+space');
    const t1 = Date.now();
    const f = await editorFrame(tabB, 60_000);
    console.log(`D (${mode}): editor ${Date.now() - t1} ms after stop`);
    await expect(f.locator('video')).toHaveCount(1);
    await tabB.screenshot({ path: saveShot(`d-${mode}-editor`) });
    const title = `Flow D ${Date.now().toString(36)}`;
    const link = await createFromEditor(tabB, f, title);
    const rec = await captureOf(b.context, link);
    expect(rec.kind).toBe('screen');
    await waitReady(b.context, rec.id, 180_000);

    // requests from both tabs, each with its own tab id (J-008, J-224)
    const net = await api<{ items: { url: string; status: number | null; tabId?: number | null }[] }>(b.context, 'GET', `/api/v1/recordings/${rec.id}/network?limit=200`);
    expect(net.status).toBe(200);
    const fail = net.body.items.find((r) => r.url === `${LAB_URL}/api/fail`);
    const ok = net.body.items.find((r) => r.url.startsWith(`${LAB_URL}/api/ok?q=works`));
    expect(fail?.status, JSON.stringify(net.body.items.map((r) => r.url))).toBe(500);
    expect(ok?.status).toBe(200);
    expect(fail?.tabId).toBeTruthy();
    expect(ok?.tabId).toBeTruthy();
    expect(fail?.tabId).not.toBe(ok?.tabId);

    // the desktop choice stuck (6 clicks next time instead of 8)
    const again = await openPopup(b.context, tabB);
    await expect(again.locator('[data-row-main="record"]')).toContainText('Record full screen');
    await again.close();
  } catch (e) {
    if (crashed) throw new BrowserCrash(`Chromium went away during the ${mode} run: ${(e as Error).message.split('\n')[0]}`);
    throw e;
  } finally {
    closing = true;
    await b.close();
  }
}

test('D: popup, Screen, record, Chrome picker, two tabs, stop, create; desktop choice sticks', async () => {
  await throughPicker('D', desktopRecording);
});
