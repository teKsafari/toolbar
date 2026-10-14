// Tab, screen and desktop video through the offscreen recorder, with the uploader against the
// mock server. The browser runs with --allowlisted-extension-id, so tabCapture needs no gesture
// (docs/spikes.md S1), and fake media devices stand in for the picker and the microphone (S2).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Worker } from '@playwright/test';
import { LAB_URL, draftWithBlobs, expect, saveBlob, session, setSettings, sleep, svc, tabIdOf, test } from './helpers.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-capture-video-'));

function probe(file: string): { width: number; height: number; duration: number; codecs: string[] } {
  const fixed = `${file}.remux.webm`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-c', 'copy', fixed]); // MediaRecorder WebM has no duration (S1)
  const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,codec_type,width,height:format=duration', '-of', 'json', fixed]).toString()) as {
    streams: { codec_name: string; codec_type: string; width?: number; height?: number }[];
    format: { duration: string };
  };
  const v = out.streams.find((s) => s.codec_type === 'video')!;
  return { width: v.width!, height: v.height!, duration: Number(out.format.duration), codecs: out.streams.map((s) => s.codec_name) };
}

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

test.describe.configure({ timeout: 120_000 });

test('tab video: countdown, viewport-only video, pause, navigation, upload while recording, draft in under 5 s (J-006, J-029, J-032, J-034, J-087, J-233)', async ({ tab: { context, sw }, mockServer: mock }) => {
  await setSettings(sw, { recordMode: 'tab', mic: false });
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page);
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const s0 = await svc<{ state: string }>(sw, 'startRecording', { tabId });
  expect(s0.state).toBe('countdown'); // 3-2-1, no picker
  const rec = (await waitState(sw, 'recording', 10_000)) as { recordingId: string; startedAt: number };
  const serverId = rec.recordingId;
  expect(mock.captures.get(serverId)?.body).toMatchObject({ kind: 'video' }); // created unlisted at start
  await page.getByTestId('hidden-500').click();
  await page.getByRole('link', { name: 'Form' }).click(); // SPA route change
  await expect(page).toHaveURL(/\/form$/);
  await page.reload(); // full load: the recording continues
  await sleep(1500);
  expect((await session(sw)).state).toBe('recording');
  const t0 = Date.now();
  await svc(sw, 'pauseRecording');
  await sleep(2500);
  await svc(sw, 'resumeRecording');
  const pausedFor = Date.now() - t0;
  await sleep(1500);
  // chunks reached the server during the recording (J-087)
  expect(mock.captures.get(serverId)!.streams.video?.size ?? 0).toBeGreaterThan(2);
  const wallStart = rec.startedAt;
  const stopAt = Date.now();
  await svc(sw, 'stopRecording');
  const d = (await waitState(sw, 'draft', 5000)) as { draftId: string };
  expect(Date.now() - stopAt).toBeLessThan(5000);
  const { draft, events } = await draftWithBlobs(sw, d.draftId);
  expect(draft).toMatchObject({ kind: 'video', recordingId: serverId, mode: 'tab', pageUrl: `${LAB_URL}/` });
  const durationMs = Number(draft.durationMs);
  expect(durationMs).toBeGreaterThan(stopAt - wallStart - pausedFor - 1500);
  expect(durationMs).toBeLessThan(stopAt - wallStart - pausedFor + 1500);
  const file = path.join(tmp, 'tab.webm');
  await saveBlob(sw, String(draft.videoBlobId), file);
  const p = probe(file);
  // only the viewport, no browser chrome; the encoder rounds odd sizes down to even (spike S1: 1270x708)
  expect(vp.w - p.width).toBeGreaterThanOrEqual(0);
  expect(vp.w - p.width).toBeLessThanOrEqual(2);
  expect(vp.h - p.height).toBeGreaterThanOrEqual(0);
  expect(vp.h - p.height).toBeLessThanOrEqual(2);
  expect(p.codecs).toContain('vp9');
  expect(Math.abs(p.duration * 1000 - durationMs)).toBeLessThan(1500); // paused time left out
  const ev = events as { kind: string; ctx: string; data: Record<string, unknown> }[];
  const loads = ev.filter((e) => e.kind === 'nav' && e.data.type === 'load' && e.ctx === 'top');
  expect(loads.map((e) => e.data.cause)).toEqual(['reload']); // events from both documents in one capture
  expect(ev.some((e) => e.kind === 'nav' && e.data.type === 'pushState')).toBe(true);
  expect(ev.some((e) => e.kind === 'net.res' && e.data.status === 500)).toBe(true);
  expect(ev.filter((e) => e.kind === 'media').map((e) => e.data.op)).toEqual(['start', 'pause', 'resume', 'stop']);
  const { rrweb } = await draftWithBlobs(sw, d.draftId);
  expect((rrweb as { type: number }[]).some((r) => r.type === 2)).toBe(true);
  // create: the remaining chunks, events and rrweb upload, every stream completes, finalize
  const res = await svc<{ recordingId: string }>(sw, 'createFromDraft', d.draftId, { title: 'Video' });
  expect(res.recordingId).toBe(serverId);
  const cap = mock.captures.get(serverId)!;
  expect(Object.keys(cap.completed).sort()).toEqual(['events', 'rrweb', 'video']);
  expect(mock.bytes(serverId, 'video').length).toBe(Number((await draftWithBlobs(sw, d.draftId)).blobSizes.videoBlobId));
  expect(cap.finalized).toMatchObject({ title: 'Video', durationMs: Math.round(durationMs) });
  await page.close();
});

test('ten short recordings in a row give ten playable drafts (J-034)', async ({ tab: { context, sw } }) => {
  await setSettings(sw, { recordMode: 'tab', mic: false });
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page);
  for (let i = 0; i < 10; i++) {
    await svc(sw, 'startRecording', { tabId, delaySec: 0 });
    await waitState(sw, 'recording', 10_000);
    await page.getByTestId('works').click();
    await sleep(1200);
    const stopAt = Date.now();
    await svc(sw, 'stopRecording');
    const d = (await waitState(sw, 'draft', 5000)) as { draftId: string };
    expect(Date.now() - stopAt).toBeLessThan(5000);
    const { draft, blobSizes } = await draftWithBlobs(sw, d.draftId);
    expect(Number(draft.durationMs)).toBeGreaterThan(900);
    expect(blobSizes.videoBlobId).toBeGreaterThan(1000);
    if (i === 9) {
      const file = path.join(tmp, `short-${i}.webm`);
      await saveBlob(sw, String(draft.videoBlobId), file);
      expect(probe(file).duration).toBeGreaterThan(0.9);
    }
    await svc(sw, 'discardDraft', d.draftId);
  }
  await page.close();
});

test('desktop recording: no countdown, follows tab switches, logs from both tabs (J-007, J-008, J-224 data)', async ({ context, sw, mock: _ }) => {
  await setSettings(sw, { recordMode: 'desktop', mic: false });
  try {
    const a = await context.newPage();
    await a.goto(LAB_URL);
    await a.bringToFront();
    const tabA = await tabIdOf(sw, a);
    const s0 = await svc<{ state: string }>(sw, 'startRecording', { tabId: tabA });
    expect(s0.state).toBe('starting'); // straight to the picker, no countdown
    await waitState(sw, 'recording', 15_000);
    await a.getByTestId('console').click();
    const b = await context.newPage();
    await b.goto(`${LAB_URL}/live`);
    await b.bringToFront();
    const tabB = await tabIdOf(sw, b);
    await expect.poll(async () => (await session(sw)).tabId, { timeout: 5000 }).toBe(tabB);
    await b.evaluate(() => console.warn('from the second tab'));
    await sleep(1000);
    await svc(sw, 'stopRecording');
    const d = (await waitState(sw, 'draft', 8000)) as { draftId: string; tabId: number };
    expect(d.tabId).toBe(tabB); // the draft opens in the tab active at stop
    const { draft, events } = await draftWithBlobs(sw, d.draftId);
    expect(draft).toMatchObject({ kind: 'screen', mode: 'desktop', tabIds: [tabA, tabB] });
    const ev = events as { kind: string; tab?: number; data: Record<string, unknown> }[];
    expect(ev.some((e) => e.kind === 'console' && e.tab === tabA && (e.data.args as unknown[])[0] === 'log: plain string')).toBe(true);
    expect(ev.some((e) => e.kind === 'console' && e.tab === tabB && (e.data.args as unknown[])[0] === 'from the second tab')).toBe(true);
    expect(ev.filter((e) => e.kind === 'net.req').every((e) => typeof e.tab === 'number')).toBe(true);
    await svc(sw, 'discardDraft', d.draftId);
    await a.close();
    await b.close();
  } finally {
    await setSettings(sw, { recordMode: 'tab' });
  }
});

test('microphone: one-time grant page, voice stream, mute and device switch mid-recording (J-014, J-211)', async ({ context, sw, mock }) => {
  await sw.evaluate(() => chrome.storage.local.set({ 'nib:mic-granted': false }));
  const opened = context.waitForEvent('page', (p) => p.url().includes('/permissions.html'));
  const granted = svc<boolean>(sw, 'requestMic');
  const perm = await opened;
  expect(await granted).toBe(true);
  await perm.waitForEvent('close', { timeout: 5000 }); // the page closes itself after the grant
  await setSettings(sw, { recordMode: 'desktop', mic: true }); // fake devices: picker and mic both answer
  try {
    const page = await context.newPage();
    await page.goto(LAB_URL);
    await page.bringToFront();
    const tabId = await tabIdOf(sw, page);
    await svc(sw, 'startRecording', { tabId });
    const rec = (await waitState(sw, 'recording', 10_000)) as { mic: string; recordingId: string };
    expect(rec.mic).toBe('on');
    await sleep(1500);
    expect(await svc(sw, 'setMic', true)).toBe('muted');
    await sleep(1200);
    expect(await svc(sw, 'setMic', false, 'default')).toBe('on'); // unmute and switch device without stopping
    await sleep(1500);
    expect((await session(sw)).state).toBe('recording');
    await svc(sw, 'stopRecording');
    const d = (await waitState(sw, 'draft', 5000)) as { draftId: string };
    const { draft, events, blobSizes } = await draftWithBlobs(sw, d.draftId);
    expect(blobSizes.voiceBlobId).toBeGreaterThan(1000);
    expect(mock.captures.get(rec.recordingId)!.streams.voice?.size ?? 0).toBeGreaterThan(1);
    const file = path.join(tmp, 'voice.webm');
    await saveBlob(sw, String(draft.voiceBlobId), file);
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', file]).toString().trim();
    expect(out).toBe('opus');
    const mic = (events as { kind: string; data: Record<string, unknown> }[]).filter((e) => e.kind === 'media' && e.data.stream === 'mic').map((e) => e.data.mic);
    expect(mic).toEqual(['on', 'muted', 'on']);
    await svc(sw, 'discardDraft', d.draftId);
    await page.close();
  } finally {
    await setSettings(sw, { mic: false, recordMode: 'tab' });
  }
});

test('discard after a recording deletes the server capture and local chunks (J-189)', async ({ tab: { context, sw }, mockServer: mock }) => {
  await setSettings(sw, { recordMode: 'tab', mic: false });
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page);
  await svc(sw, 'startRecording', { tabId, delaySec: 0 });
  const rec = (await waitState(sw, 'recording', 10_000)) as { recordingId: string };
  await sleep(1500);
  await svc(sw, 'stopRecording');
  const d = (await waitState(sw, 'draft', 5000)) as { draftId: string };
  await svc(sw, 'discardDraft', d.draftId);
  expect(mock.captures.get(rec.recordingId)!.deleted).toBe(true);
  expect(mock.log.some((l) => l.route === 'captures.finalize')).toBe(false);
  await page.close();
});
