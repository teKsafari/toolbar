// The uploader against a real server (server-core's upload API), not the mock. Opt-in: runs only
// when TOOLBAR_E2E_TOKEN holds a personal or device token for SERVER_URL and TOOLBAR_E2E_WORKSPACE names
// a workspace of that token's user (the seed's Lab shop works). Run it on a tree with
// area/server-core merged:
//   TOOLBAR_E2E_TOKEN=... TOOLBAR_E2E_WORKSPACE=... SERVER_URL=http://localhost:3102 npx playwright test real-server
import type { Worker } from '@playwright/test';
import { LAB_URL, expect, session, setSettings, sleep, svc, tabIdOf, test } from './helpers.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3102';
const TOKEN = process.env.TOOLBAR_E2E_TOKEN ?? '';
const WS = process.env.TOOLBAR_E2E_WORKSPACE ?? '';

test.skip(!TOKEN || !WS, 'set TOOLBAR_E2E_TOKEN and TOOLBAR_E2E_WORKSPACE to run against a real server');
test.describe.configure({ timeout: 180_000 });

async function signInReal(sw: Worker) {
  await sw.evaluate(
    async ({ serverUrl, token, ws }) => {
      await chrome.storage.local.set({
        'tb:auth': { serverUrl, token, tokenId: 'tok-real', user: { id: 'u', name: 'E2E', email: 'e2e@toolbar.test', image: null }, activeWorkspaceId: ws, signedInAt: Date.now() },
        'tb:server-url': serverUrl,
      });
    },
    { serverUrl: SERVER, token: TOKEN, ws: WS },
  );
  await sw.evaluate(() => (globalThis as unknown as { __tb: { capture: { apply(e: unknown): Promise<unknown> } } }).__tb.capture.apply({ type: 'RESET' }));
}

/** Last status from the server-sent status stream, read for at most `ms`. */
async function lastStatus(id: string, ms = 2000): Promise<{ http: number; status: string | null }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  let last: string | null = null;
  let http = 0;
  try {
    const r = await fetch(`${SERVER}/api/v1/recordings/${id}/status`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: ctl.signal });
    http = r.status;
    if (!r.ok || !r.body) return { http, status: null };
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const m of value.matchAll(/"status":"([a-z_]+)"/g)) last = m[1]!;
      if (last === 'ready' || last === 'failed') break;
    }
  } catch {
    /* aborted after ms */
  } finally {
    clearTimeout(timer);
  }
  return { http, status: last };
}

async function waitReady(id: string) {
  await expect.poll(async () => (await lastStatus(id)).status, { timeout: 120_000, intervals: [1000] }).toMatch(/^(ready|failed)$/);
  return (await lastStatus(id)).status;
}

test('screenshot: create uploads to the real server and the capture becomes ready (J-002, J-086 data path, J-189)', async ({ context, sw }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  await signInReal(sw);
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.getByTestId('hidden-500').click();
  await sleep(500);
  const draft = await svc<{ id: string }>(sw, 'takeScreenshot', null, { tabId, openEditor: false });
  const res = await svc<{ recordingId: string; shareUrl: string; status: string }>(sw, 'createFromDraft', draft.id, { title: 'Real server screenshot', workspaceId: WS });
  expect(res.recordingId).toBeTruthy();
  expect(res.shareUrl).toContain('/');
  expect(await waitReady(res.recordingId)).toBe('ready');
  await page.close();
});

test('tab video: chunks upload while recording, create finalizes, the capture becomes ready (J-006, J-087)', async ({ tabBrowser: { context, sw } }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  await signInReal(sw);
  await setSettings(sw, { recordMode: 'tab', mic: false });
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page);
  await svc(sw, 'startRecording', { tabId, delaySec: 0 });
  await expect.poll(async () => (await session(sw)).state, { timeout: 15_000 }).toBe('recording');
  const rec = await session(sw);
  // made at start, unlisted until create (J-189)
  expect((await lastStatus(rec.recordingId, 1000)).http).toBe(200);
  await page.getByTestId('hidden-500').click();
  await sleep(4000);
  await svc(sw, 'stopRecording');
  await expect.poll(async () => (await session(sw)).state, { timeout: 8000 }).toBe('draft');
  const d = await session(sw);
  const res = await svc<{ recordingId: string }>(sw, 'createFromDraft', d.draftId, { title: 'Real server video', workspaceId: WS });
  expect(res.recordingId).toBe(rec.recordingId);
  expect(await waitReady(res.recordingId)).toBe('ready');
  await page.close();
});
