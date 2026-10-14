// Instant replay (J-009, J-010, J-189), the picker cancel path (J-201), the worker's UI
// commands around a recording (J-032 bar after reload, J-034 spinner, J-008 bar follows tabs),
// the record shortcut through real X input, and extension-owned requests (J-248).
import { execFileSync } from 'node:child_process';
import type { BrowserContext, Worker } from '@playwright/test';
import type { MockServer } from '../../fixtures/mock-upload-server.ts';
import { DISPLAY } from '../../fixtures/extension.ts';
import { privateDisplay } from '../../fixtures/xvfb.ts';
import { LAB_URL, byKind, draftWithBlobs, expect, launchTabBrowser, resetSession, ring, session, setSettings, signIn, sleep, svc, tabIdOf, test } from './helpers.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function waitState(sw: Worker, state: string, timeout = 15_000): Promise<any> {
  await expect
    .poll(async () => {
      const s = await session(sw);
      return s.state === 'error' ? `error: ${String(s.message)}` : s.state;
    }, { timeout })
    .toBe(state);
  return session(sw);
}

/** Records the ContentCommands the worker sends to tabs. */
async function spyContent(sw: Worker) {
  await sw.evaluate(() => {
    const g = globalThis as unknown as { __tb: { capture: { sendContent: (...a: unknown[]) => Promise<unknown> } }; __sent?: unknown[] };
    const svc = g.__tb.capture;
    g.__sent = [];
    const orig = svc.sendContent.bind(svc);
    if ((svc.sendContent as unknown as { spied?: boolean }).spied) return;
    const spy = async (tabId: unknown, c: unknown, frameId?: unknown) => {
      g.__sent!.push({ tabId, c, at: Date.now() });
      return orig(tabId, c, frameId);
    };
    (spy as unknown as { spied: boolean }).spied = true;
    svc.sendContent = spy;
  });
}
async function sent(sw: Worker): Promise<{ tabId: number; c: { type: string; [k: string]: unknown } }[]> {
  return sw.evaluate(() => (globalThis as unknown as { __sent: never[] }).__sent);
}

test.describe.configure({ timeout: 180_000 });

test('instant replay: DOM replay of the recent past, trimmed to the last 30 s, local until create (J-009, J-189)', async ({ context, sw, mock }) => {
  await setSettings(sw, { instantReplay: true, replayMinutes: 2 });
  try {
    const page = await context.newPage();
    await page.goto(LAB_URL);
    const tabId = await tabIdOf(sw, page);
    await sleep(1000);
    await page.getByTestId('hidden-500').click();
    await page.getByTestId('throws').click();
    await sleep(1500);
    await spyContent(sw);
    const t0 = Date.now();
    const draft = await svc<{ id: string; kind: string; durationMs: number; trim: { startMs: number; endMs: number } }>(sw, 'triggerReplay', tabId);
    expect(Date.now() - t0).toBeLessThan(4600); // J-194 budget for replay
    expect(draft.kind).toBe('replay');
    expect(draft.trim.endMs).toBe(Math.round(draft.durationMs));
    expect(draft.trim.endMs - draft.trim.startMs).toBeLessThanOrEqual(30_000);
    const { events, rrweb } = await draftWithBlobs(sw, draft.id);
    const rr = rrweb as { type: number; timestamp: number }[];
    expect(rr[0]!.type).toBe(4); // meta, then the full snapshot the replay starts from
    expect(rr[1]!.type).toBe(2);
    expect(rr.length).toBeGreaterThan(2);
    const ev = events as { kind: string; data: Record<string, unknown> }[];
    expect(ev.some((e) => e.kind === 'net.res' && e.data.status === 500)).toBe(true);
    expect(ev.some((e) => e.kind === 'error')).toBe(true);
    // the session owner (ext-ui) holds the draft and opens its editor
    expect(await session(sw)).toMatchObject({ state: 'draft', draftId: draft.id });
    expect(mock.log.filter((l) => l.method !== 'GET')).toEqual([]); // the replay buffer never uploads before create
    const res = await svc<{ recordingId: string }>(sw, 'createFromDraft', draft.id, { title: 'Replay' });
    const cap = mock.captures.get(res.recordingId)!;
    expect(cap.body).toMatchObject({ kind: 'replay' });
    expect(Object.keys(cap.completed).sort()).toEqual(['events', 'rrweb']);
    expect((mock.ndjson(res.recordingId, 'rrweb') as { type: number }[]).filter((r) => r.type === 2).length).toBeGreaterThan(0);
    await page.close();
  } finally {
    await setSettings(sw, { instantReplay: false });
  }
});

test('instant replay is a rolling window: never longer than the setting, never reset to zero (J-010)', async ({ context, sw, mock: _ }) => {
  await setSettings(sw, { instantReplay: true, replayMinutes: 1 });
  try {
    const page = await context.newPage();
    await page.goto(LAB_URL);
    const tabId = await tabIdOf(sw, page);
    const loadedAt = Date.now();
    for (let i = 0; i < 9; i++) {
      await page.getByTestId('works').click();
      await sleep(8000);
    }
    await svc(sw, 'prune');
    const draft = await svc<{ id: string; durationMs: number; startedAt: number }>(sw, 'triggerReplay', tabId);
    expect(draft.durationMs).toBeLessThanOrEqual(61_000);
    expect(draft.durationMs).toBeGreaterThan(55_000); // a 72 s old page: the full window, not a restart
    expect(draft.startedAt).toBeGreaterThan(loadedAt); // after the last load
    const { rrweb } = await draftWithBlobs(sw, draft.id);
    const first = (rrweb as { timestamp: number }[])[0]!.timestamp;
    // the replay begins at the newest checkout at or before the cut (checkouts every 30 s)
    expect(draft.startedAt - first).toBeLessThan(31_000);
    // pruning dropped what is older than the window, except rrweb back to that checkout
    const s = await ring(sw, tabId, 10 * 60_000);
    const oldest = Math.min(...s.events.map((e) => e.t));
    expect(Date.now() - oldest).toBeLessThan(80_000);
    await svc(sw, 'discardDraft', draft.id);
    await page.close();
  } finally {
    await setSettings(sw, { instantReplay: false, replayMinutes: 2 });
  }
});

test('instant replay with video keeps 10 s segments and uploads them at create (D-013)', async ({ tab: { context, sw }, mockServer: mock }) => {
  await setSettings(sw, { instantReplay: true, replayMinutes: 1 });
  try {
    const page = await context.newPage();
    await page.goto(LAB_URL);
    await page.bringToFront();
    const tabId = await tabIdOf(sw, page);
    const st = await svc<{ tabs: Record<string, { video: boolean }> }>(sw, 'setReplay', { enabled: true, minutes: 1, video: true, tabId });
    expect(st.tabs[String(tabId)]?.video).toBe(true);
    await page.getByTestId('hidden-500').click();
    await sleep(11_500);
    const draft = await svc<{ id: string; replaySegmentBlobIds: string[] }>(sw, 'triggerReplay', tabId);
    expect(draft.replaySegmentBlobIds.length).toBeGreaterThanOrEqual(1);
    expect(mock.log.filter((l) => l.method !== 'GET')).toEqual([]);
    const res = await svc<{ recordingId: string }>(sw, 'createFromDraft', draft.id, { title: 'Replay with video' });
    const cap = mock.captures.get(res.recordingId)!;
    expect(cap.completed.video?.lastSeq).toBe(draft.replaySegmentBlobIds.length - 1);
    expect(mock.bytes(res.recordingId, 'video').subarray(0, 4).toString('hex')).toBe('1a45dfa3'); // EBML header: a standalone WebM
    await svc(sw, 'setReplay', { enabled: false, video: false, tabId });
    await page.close();
  } finally {
    await setSettings(sw, { instantReplay: false, replayMinutes: 2 });
  }
});

test('the recording bar comes back after a reload with the same start time; spinner then editor at stop (J-032, J-034)', async ({ tab: { context, sw } }) => {
  await setSettings(sw, { recordMode: 'tab', mic: false });
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page);
  await spyContent(sw);
  await svc(sw, 'startRecording', { tabId, delaySec: 0 });
  const rec = (await waitState(sw, 'recording', 10_000)) as { startedAt: number };
  await page.reload();
  await sleep(1500);
  // The bar is ext-ui's (ui.session); its own e2e checks it on the new document. Here: the
  // recording goes on across the reload with the same start time, and the media side re-attaches
  // the new document's ports (attach), so its logs keep flowing into the recording.
  const after = (await session(sw)) as { state: string; startedAt: number };
  expect(after).toMatchObject({ state: 'recording', startedAt: rec.startedAt });
  await svc(sw, 'stopRecording');
  const s = (await waitState(sw, 'draft', 5000)) as unknown as { draftId: string };
  const { events } = await draftWithBlobs(sw, s.draftId);
  expect((events as { kind: string; data: { type?: string } }[]).filter((e) => e.kind === 'nav' && e.data.type === 'load').length).toBeGreaterThanOrEqual(1);
  await svc(sw, 'discardDraft', s.draftId);
  await page.close();
});

// Chrome's picker crashes Chromium on Xvfb now and then (X BadWindow, docs/spikes.md S2). This
// test runs in a browser of its own on a display of its own: with the suite's other browsers on
// the same display the picker died on nearly every try. A crash (only that) gets up to three
// more tries in a fresh browser.
test('cancelling Chrome\'s share picker leaves no draft and no bar (J-201)', async ({ mockServer: mock }) => {
  const x = await privateDisplay(Number(DISPLAY.slice(1)) + 40);
  try {
    for (let attempt = 1; ; attempt++) {
      const b = await launchTabBrowser(x.display);
      let crashed = false;
      let closing = false;
      b.context.on('close', () => {
        if (!closing) crashed = true;
      });
      try {
        await pickerCancel(b, mock, x.display);
        return;
      } catch (e) {
        if (!crashed || attempt >= 4) throw e;
        console.log(`J-201: attempt ${attempt}: Chromium went away under the picker (${(e as Error).message.split('\n')[0]}); trying again`);
      } finally {
        closing = true;
        await b.close();
      }
    }
  } finally {
    x.stop();
  }
});

async function pickerCancel({ context, sw }: { context: BrowserContext; sw: Worker }, mock: MockServer, display: string) {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  mock.reset();
  await signIn(sw, mock.url);
  await resetSession(sw);
  await setSettings(sw, { recordMode: 'desktop', mic: false });
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  // Chromium's first windows come and go for a moment after launch; the picker enumerates
  // every window, and one destroyed mid-way kills the browser with X BadWindow
  for (const p of context.pages()) if (p !== page) await p.close();
  await sleep(3000);
  const tabId = await tabIdOf(sw, page);
  await spyContent(sw);
  await svc(sw, 'startRecording', { tabId });
  expect((await session(sw)).state).toBe('starting');
  // The picker is Chromium's own top-level window (600x492, docs/spikes.md S2). Click its
  // Cancel button with real X pointer input; activating the window for a key press made
  // Chromium die with X BadWindow far more often.
  const env = { ...process.env, DISPLAY: display };
  const x = (...a: string[]) => execFileSync('xdotool', a, { env, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  let geo = '';
  for (let i = 0; i < 60 && !geo; i++) {
    await sleep(250);
    try {
      const win = x('search', '--onlyvisible', '--name', 'Choose what to share').split('\n')[0]!;
      geo = x('getwindowgeometry', win);
    } catch {
      /* not mapped yet */
    }
  }
  expect(geo, 'the share picker opened').not.toBe('');
  await sleep(700); // its buttons paint after the window maps
  const [, px, py] = geo.match(/Position: (\d+),(\d+)/)!.map(Number);
  const [, pw, ph] = geo.match(/Geometry: (\d+)x(\d+)/)!.map(Number);
  x('mousemove', '--sync', String(px! + pw! - 137), String(py! + ph! - 39));
  x('click', '1');
  await waitState(sw, 'idle', 10_000);
  expect((await sent(sw)).some((x) => x.c.type === 'ui.bar' && x.c.bar === null)).toBe(true);
  const drafts = await sw.evaluate(async () => ((await chrome.storage.local.get('nib:drafts'))['nib:drafts'] ?? []).filter((d: { kind: string; status: string }) => d.kind === 'screen' && d.status === 'open').length);
  expect(drafts).toBe(0);
  const created = [...mock.captures.values()].filter((c) => c.body.kind === 'screen');
  expect(created.every((c) => c.deleted)).toBe(true); // the unlisted server capture is removed
  await page.close();
}

test('the record shortcut starts and stops a tab recording, live in under 6.4 s (J-006 key path, J-195, real X input)', async ({ tab: { context, sw } }) => {
  await setSettings(sw, { recordMode: 'tab', mic: false });
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  await page.getByTestId('status').click(); // focus the page, not the omnibox
  const env = { ...process.env, DISPLAY };
  const win = execFileSync('xdotool', ['getactivewindow'], { env }).toString().trim();
  const keyAt = Date.now();
  execFileSync('xdotool', ['windowfocus', '--sync', win, 'key', '--clearmodifiers', 'ctrl+shift+space'], { env });
  await waitState(sw, 'recording', 12_000);
  expect(Date.now() - keyAt).toBeLessThan(6400); // J-195: key to live, countdown included
  await sleep(1000);
  execFileSync('xdotool', ['windowfocus', '--sync', win, 'key', '--clearmodifiers', 'ctrl+shift+space'], { env });
  const s = (await waitState(sw, 'draft', 8000)) as { draftId: string };
  await svc(sw, 'discardDraft', s.draftId);
  await page.close();
});

test('requests the extension makes never appear in a capture (J-248)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  // the worker talks to the server while the page is open
  await svc(sw, 'drainAll');
  await page.getByTestId('works').click();
  await sleep(300);
  const s = await ring(sw, tabId);
  const urls = s.events.map((e) => String(e.data.url ?? '')).filter(Boolean);
  expect(urls.filter((u) => u.startsWith('chrome-extension://') || u.includes(':3102/'))).toEqual([]);
  expect(byKind(s, 'net.fail').filter((e) => e.data.source === 'webRequest')).toEqual([]);
  await page.close();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;
