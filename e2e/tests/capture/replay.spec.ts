// Instant replay (J-009, J-010, J-189), the picker cancel path (J-201), the worker's UI
// commands around a recording (J-032 bar after reload, J-034 spinner, J-008 bar follows tabs),
// the record shortcut through real X input, and extension-owned requests (J-248).
import { execFileSync } from 'node:child_process';
import type { Worker } from '@playwright/test';
import { DISPLAY } from '../../fixtures/extension.ts';
import { LAB_URL, byKind, draftWithBlobs, expect, ring, session, setSettings, sleep, svc, tabIdOf, test } from './helpers.ts';

async function waitState(sw: Worker, state: string, timeout = 15_000) {
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
    expect((await sent(sw)).map((x) => x.c.type)).toContain('ui.editor-open');
    expect(mock.log).toEqual([]); // the replay buffer never uploads before create
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
    expect(mock.log).toEqual([]);
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
  const bars = (await sent(sw)).filter((x) => x.c.type === 'ui.bar' && x.c.bar);
  expect(bars.length).toBeGreaterThanOrEqual(2); // at start, and again for the new document
  expect(bars.every((b) => (b.c.bar as { startedAt: number }).startedAt === rec.startedAt)).toBe(true);
  await svc(sw, 'stopRecording');
  await waitState(sw, 'draft', 5000);
  const types = (await sent(sw)).map((x) => (x.c.type === 'ui.processing' ? `processing:${x.c.visible}` : x.c.type === 'ui.bar' ? `bar:${x.c.bar ? 'on' : 'off'}` : x.c.type));
  const tail = types.slice(types.indexOf('processing:true'));
  expect(tail).toEqual(expect.arrayContaining(['processing:true', 'bar:off', 'processing:false', 'ui.editor-open']));
  expect(tail.indexOf('ui.editor-open')).toBeGreaterThan(tail.indexOf('processing:false'));
  const s = (await session(sw)) as { draftId: string };
  await svc(sw, 'discardDraft', s.draftId);
  await page.close();
});

test('cancelling Chrome\'s share picker leaves no draft and no bar (J-201)', async ({ tab: { context, sw }, mockServer: mock }) => {
  await setSettings(sw, { recordMode: 'desktop', mic: false });
  try {
    const page = await context.newPage();
    await page.goto(LAB_URL);
    await page.bringToFront();
    const tabId = await tabIdOf(sw, page);
    await spyContent(sw);
    await svc(sw, 'startRecording', { tabId });
    expect((await session(sw)).state).toBe('starting');
    // The picker is Chromium's own window; press Escape in it with real X input on our display.
    let win = '';
    for (let i = 0; i < 40 && !win; i++) {
      await sleep(250);
      try {
        win = execFileSync('xdotool', ['search', '--name', 'Choose what to share'], { env: { ...process.env, DISPLAY } }).toString().trim().split('\n')[0] ?? '';
      } catch {
        /* not yet */
      }
    }
    expect(win).not.toBe('');
    execFileSync('xdotool', ['windowactivate', '--sync', win, 'key', '--clearmodifiers', 'Escape'], { env: { ...process.env, DISPLAY } });
    await waitState(sw, 'idle', 10_000);
    expect((await sent(sw)).some((x) => x.c.type === 'ui.bar' && x.c.bar === null)).toBe(true);
    const drafts = await sw.evaluate(async () => ((await chrome.storage.local.get('nib:drafts'))['nib:drafts'] ?? []).filter((d: { kind: string; status: string }) => d.kind === 'screen' && d.status === 'open').length);
    expect(drafts).toBe(0);
    const created = [...mock.captures.values()].filter((c) => c.body.kind === 'screen');
    expect(created.every((c) => c.deleted)).toBe(true); // the unlisted server capture is removed
    await page.close();
  } finally {
    await setSettings(sw, { recordMode: 'tab' });
  }
});

test('the record shortcut starts and stops a tab recording (J-006 key path, real X input)', async ({ tab: { context, sw } }) => {
  await setSettings(sw, { recordMode: 'tab', mic: false });
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  await page.getByTestId('status').click(); // focus the page, not the omnibox
  const env = { ...process.env, DISPLAY };
  const win = execFileSync('xdotool', ['getactivewindow'], { env }).toString().trim();
  execFileSync('xdotool', ['windowfocus', '--sync', win, 'key', '--clearmodifiers', 'ctrl+shift+space'], { env });
  await waitState(sw, 'recording', 12_000);
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
