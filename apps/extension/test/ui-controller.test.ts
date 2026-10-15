// lib/bg/ui.ts against WXT's fake browser: settings, the screenshot flow through a driver,
// the countdown into a recording, restricted pages and the cap.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';
import { dispatch, getSession, registerUi, setCaptureDriver, type CaptureDriver } from '../lib/bg/ui';

const send = (msg: object) => browser.runtime.sendMessage(msg) as Promise<{ ok: boolean } & Record<string, unknown>>;

function driver(): CaptureDriver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    startRecording: async () => (calls.push('start'), { mic: 'off' }),
    stopRecording: async (o) => (calls.push('stop'), { draftId: 'd1', kind: 'video', recordingId: o.recordingId, tabId: o.tabId }),
    pauseRecording: async () => void calls.push('pause'),
    resumeRecording: async () => void calls.push('resume'),
    setMic: async () => 'muted',
    takeScreenshot: async (o) => (calls.push(`shot:${JSON.stringify(o.rect)}`), { draftId: 's1', kind: 'screenshot', recordingId: null, tabId: o.tabId }),
    triggerReplay: async (o) => (calls.push('replay'), { draftId: 'r1', kind: 'replay', recordingId: null, tabId: o.tabId }),
  };
}

let registered = false;
let tabId = 0;

beforeEach(async () => {
  if (!registered) {
    // fake-browser lacks the action and commands surfaces the controller touches
    Object.assign(browser, {
      action: { setIcon: vi.fn(async () => {}), setTitle: vi.fn(async () => {}), setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}), openPopup: vi.fn(async () => {}) },
      commands: { onCommand: { addListener: vi.fn() } },
    });
    browser.tabs.sendMessage = vi.fn(async () => undefined) as never;
    registerUi();
    registered = true;
  }
  await dispatch({ type: 'RESET' });
  const tab = await fakeBrowser.tabs.create({ url: 'http://localhost:5173/', active: true });
  tabId = tab.id!;
});

describe('ui controller', () => {
  it('fills default settings with the blocked-sites list and saves patches', async () => {
    const r = await send({ type: 'settings.update', patch: { openInNewTab: false } });
    expect(r.ok).toBe(true);
    const s = r.settings as { openInNewTab: boolean; replayBlockedSites: string[] };
    expect(s.openInNewTab).toBe(false);
    expect(s.replayBlockedSites).toContain('paypal.com');
    const bad = await send({ type: 'settings.update', patch: { replayMinutes: 99 } });
    expect(bad).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('arms screenshot mode, resets a one-shot delay, and turns a click into a draft', async () => {
    const d = driver();
    setCaptureDriver(d);
    await send({ type: 'settings.update', patch: { screenshotDelaySec: 3 } });
    const r = await send({ type: 'capture', mode: 'screenshot', tabId });
    expect(r).toMatchObject({ ok: true, session: { state: 'arming-screenshot', delaySec: 3 } });
    const after = await send({ type: 'settings.update', patch: {} });
    expect((after.settings as { screenshotDelaySec: number }).screenshotDelaySec).toBe(0);
    // the same request again toggles screenshot mode off (J-026)
    expect(await send({ type: 'capture', mode: 'screenshot', tabId })).toMatchObject({ session: { state: 'idle' } });
    await send({ type: 'capture', mode: 'screenshot', tabId });
    const shot = await send({ type: 'screenshot.take', rect: { x: 1, y: 2, w: 3, h: 4 }, dpr: 1 });
    expect(shot).toMatchObject({ ok: true, draftId: 's1' });
    expect(d.calls).toEqual(['shot:{"x":1,"y":2,"w":3,"h":4}']);
    expect((await getSession()).state).toBe('draft');
    // a draft blocks new captures (J-035)
    expect(await send({ type: 'capture', mode: 'screenshot', tabId })).toMatchObject({ ok: false, error: 'busy' });
  });

  it('counts down, records, pauses for blur and stops into a draft', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    try {
      const d = driver();
      setCaptureDriver(d);
      const r = await send({ type: 'capture', mode: 'video', tabId, recordMode: 'tab' });
      expect(r).toMatchObject({ session: { state: 'countdown' } });
      await vi.advanceTimersByTimeAsync(3050); // the 3 s count
      const starting = await getSession();
      expect(starting.state).toBe('starting');
      // the media waits for the page's word that the veil is gone (J-006)
      await vi.advanceTimersByTimeAsync(300);
      expect((await getSession()).state).toBe('starting');
      await send({ type: 'countdown.cleared', recordingId: (starting as { recordingId: string }).recordingId });
      await vi.advanceTimersByTimeAsync(100);
      expect((await getSession()).state).toBe('recording');
      await send({ type: 'recording.tool', tool: 'blur' });
      expect((await getSession()) as { pausedAt: number | null }).toMatchObject({ pausedAt: expect.any(Number) });
      await send({ type: 'recording.tool', tool: null });
      expect((await getSession()) as { pausedAt: number | null }).toMatchObject({ pausedAt: null });
      await send({ type: 'recording.stop' });
      expect((await getSession()).state).toBe('draft');
      expect(d.calls).toEqual(['start', 'pause', 'resume', 'stop']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts the media without the page after a timeout (J-006)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    try {
      setCaptureDriver(driver());
      await send({ type: 'capture', mode: 'video', tabId, recordMode: 'tab' });
      await vi.advanceTimersByTimeAsync(3000 + 700 + 100);
      expect((await getSession()).state).toBe('recording');
      await send({ type: 'recording.stop' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses capture on restricted pages (J-199)', async () => {
    const t = await fakeBrowser.tabs.create({ url: 'chrome://extensions/', active: true });
    expect(await send({ type: 'capture', mode: 'screenshot', tabId: t.id })).toMatchObject({ ok: false, error: 'restricted_page' });
  });

  it('reports the popup context: own server pages default to desktop (J-019)', async () => {
    await browser.storage.local.set({ 'nib:server-url': 'http://localhost:3000' });
    const t = await fakeBrowser.tabs.create({ url: 'http://localhost:3000/c/1', active: true });
    const r = await send({ type: 'ui.context', tabId: t.id });
    expect(r).toMatchObject({ ok: true, context: { isServerPage: true, recordMode: 'desktop', restricted: false } });
    const lab = await send({ type: 'ui.context', tabId });
    expect(lab).toMatchObject({ context: { isServerPage: false, recordMode: 'tab' } });
  });
});
