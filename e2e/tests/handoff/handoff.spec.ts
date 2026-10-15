// Agent hand-off end to end (PLAN "Hand-off to the agent"): the extension records a tab on the lab
// app against a real server, then an agent's path: fetch the share URL as markdown, run its first
// line (curl ... | tar xz) with a personal token, read README.md, find the hidden 500 and the
// request that never answered, read files over MCP, and resolve. Opt-in like real-server.spec.ts:
// TOOLBAR_E2E_TOKEN (personal token with cli and mcp scopes; scripts/e2e-all.sh passes the seed's)
// and TOOLBAR_E2E_WORKSPACE (default: the seed's Lab shop).
//   TOOLBAR_E2E_TOKEN=... SERVER_URL=http://localhost:3305 E2E_DISPLAY=:185 npx playwright test tests/handoff
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Worker } from '@playwright/test';
import { LAB_URL, expect, session, setSettings, sleep, svc, tabIdOf, test } from '../capture/helpers.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000';
const TOKEN = process.env.TOOLBAR_E2E_TOKEN ?? '';
const WS = process.env.TOOLBAR_E2E_WORKSPACE ?? '019a0000-0000-7000-8000-0000000000a1';

test.skip(!TOKEN, 'set TOOLBAR_E2E_TOKEN to a personal token (cli and mcp scopes) for SERVER_URL');
test.describe.configure({ mode: 'serial', timeout: 240_000 });

const auth = { authorization: `Bearer ${TOKEN}` };

async function signInReal(sw: Worker) {
  await sw.evaluate(
    async ({ serverUrl, token, ws }) => {
      await chrome.storage.local.set({
        'tb:auth': { serverUrl, token, tokenId: 'tok-handoff', user: { id: 'u', name: 'E2E', email: 'e2e@toolbar.test', image: null }, activeWorkspaceId: ws, signedInAt: Date.now() },
        'tb:server-url': serverUrl,
      });
    },
    { serverUrl: SERVER, token: TOKEN, ws: WS },
  );
  await sw.evaluate(() => (globalThis as unknown as { __tb: { capture: { apply(e: unknown): Promise<unknown> } } }).__tb.capture.apply({ type: 'RESET' }));
}

async function ready(id: string) {
  await expect
    .poll(async () => ((await (await fetch(`${SERVER}/api/v1/recordings/${id}`, { headers: auth })).json()) as { status?: string }).status, { timeout: 120_000, intervals: [1000] })
    .toBe('ready');
}

function walk(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p, root) : [p.slice(root.length + 1)];
  });
}

let recId = '';
let shareUrl = '';
const work = mkdtempSync(join(tmpdir(), 'tb-handoff-e2e-'));
test.afterAll(() => rmSync(work, { recursive: true, force: true }));

test('a tab recording on the lab app reaches the server', async ({ tabBrowser: { context, sw } }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  await signInReal(sw);
  await setSettings(sw, { recordMode: 'tab', mic: false });
  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page);
  await svc(sw, 'startRecording', { tabId, delaySec: 0 });
  await expect.poll(async () => (await session(sw)).state, { timeout: 15_000 }).toBe('recording');
  await page.getByTestId('works').click();
  await sleep(800);
  await page.getByTestId('hidden-500').click();
  await sleep(1200);
  await page.getByTestId('hangs').click();
  await sleep(1500);
  await page.getByTestId('throws').click();
  await sleep(1500);
  await svc(sw, 'stopRecording');
  await expect.poll(async () => (await session(sw)).state, { timeout: 8000 }).toBe('draft');
  const d = await session(sw);
  const res = await svc<{ recordingId: string; shareUrl: string }>(sw, 'createFromDraft', d.draftId, { title: 'Hand-off: the order button fails quietly', workspaceId: WS });
  recId = res.recordingId;
  shareUrl = res.shareUrl;
  await ready(recId);
  await page.close();
});

test('the share URL answers markdown whose first line pulls the folder; link holders get the summary only', async () => {
  const md = await (await fetch(shareUrl, { headers: { accept: 'text/markdown' } })).text();
  const first = md.split('\n')[0]!;
  expect(first).toBe(`curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "${SERVER}/api/v1/recordings/${recId}/folder" | tar xz`);
  expect(md).toContain('```text captured source="title"');
  expect(md).not.toContain('hidden-500');
  const suffix = await (await fetch(`${shareUrl}.md`)).text();
  expect(suffix).toBe(md);
  const head = await fetch(`${shareUrl}.md`);
  expect(head.headers.get('referrer-policy')).toBe('no-referrer');
  expect(head.headers.get('x-robots-tag')).toContain('noindex');
  // the share token alone does not open the folder
  const token = shareUrl.split('/s/')[1]!;
  const refused = await fetch(`${SERVER}/api/v1/recordings/${recId}/folder`, { headers: { 'x-toolbar-share': token } });
  expect(refused.status).toBe(401);

  // what an agent runs: the first line, with its token in the environment
  execFileSync('bash', ['-c', first], { cwd: work, env: { ...process.env, TOOLBAR_TOKEN: TOKEN } });
  const dir = join(work, '.feedback', recId);
  const files = walk(dir).sort();
  for (const f of ['README.md', 'feedback.json', 'spans.jsonl', 'console.jsonl', 'network.jsonl', 'raw/network.har', 'raw/rrweb-000.json.gz']) expect(files).toContain(f);
  expect(files.some((f) => /^keyframes\/k\d\d\.png$/.test(f))).toBe(true);
  expect(files.every((f) => /^(README\.md|feedback\.json|spans\.jsonl|console\.jsonl|network\.jsonl|annotations\/a\d\d\.(png|shapes\.json|locator\.json)|keyframes\/k\d\d\.png|outline\/[\w-]+\.md|text\/[\w-]+\.md|voice\/(transcript\.vtt|audio\.webm)|raw\/(rrweb-\d{3}\.json\.gz|network\.har))$/.test(f))).toBe(true);

  const readme = readFileSync(join(dir, 'README.md'), 'utf8');
  expect(readme.length / 3.5).toBeLessThan(8000);
  expect(readme.indexOf('## What did not happen')).toBeLessThan(readme.indexOf('## Timeline'));
  const notHappened = readme.slice(readme.indexOf('## What did not happen'), readme.indexOf('## Timeline'));
  // the request that never answered is in "what did not happen" with spans or without; the hidden
  // 500 is at least in the timeline (the span engine may call it changed when the page text moves)
  expect(notHappened).toMatch(/stuck/);
  expect(notHappened).toContain('/api/hang');
  expect(readme.slice(readme.indexOf('## Timeline'))).toMatch(/\/api\/fail.*500|500.*\/api\/fail/);
  expect(readme).toContain('```text captured source="title"');
  const net = readFileSync(join(dir, 'network.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { status: number | null; url: string; responseBody: string | null });
  expect(net.some((n) => n.status === 500)).toBe(true);
  expect(net.every((n) => (n.responseBody?.length ?? 0) <= 256 * 1024)).toBe(true);
  const fb = JSON.parse(readFileSync(join(dir, 'feedback.json'), 'utf8')) as { id: string; reviewer: { email: string | null } };
  expect(fb.id).toBe(recId);
});

test('MCP serves the same folder, and resolving marks it in the next pull', async () => {
  const call = async (name: string, args: Record<string, unknown>) =>
    (
      (await (
        await fetch(`${SERVER}/mcp`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        })
      ).json()) as { result: { content: { type: string; text?: string; mimeType?: string }[]; isError?: boolean } }
    ).result;
  const folder = await call('get_feedback_folder', { capture: shareUrl });
  expect(folder.isError).toBeFalsy();
  const listing = JSON.parse(folder.content[1]!.text!) as { files: { path: string }[] };
  const png = listing.files.find((f) => f.path.endsWith('.png'))!.path;
  const img = await call('get_feedback_file', { capture: recId, path: png });
  expect(img.content.map((c) => c.type)).toEqual(['text', 'image']);
  expect(readFileSync(join(work, '.feedback', recId, 'README.md'), 'utf8')).toBe(folder.content[0]!.text);

  const r = await fetch(`${SERVER}/api/v1/recordings/${recId}/resolve`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ note: 'The order handler hid a 500; it now shows the error', commit: 'e2e0001' }) });
  expect(r.status).toBe(200);
  const again = mkdtempSync(join(tmpdir(), 'tb-handoff-e2e-'));
  try {
    execFileSync('bash', ['-c', `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "${SERVER}/api/v1/recordings/${recId}/folder" | tar xz`], { cwd: again, env: { ...process.env, TOOLBAR_TOKEN: TOKEN } });
    expect(readFileSync(join(again, '.feedback', recId, 'README.md'), 'utf8')).toMatch(/\| Status \| resolved .* in `e2e0001` \|/);
    expect(existsSync(join(again, '.feedback', recId, 'feedback.json'))).toBe(true);
  } finally {
    rmSync(again, { recursive: true, force: true });
  }
  const skill = await (await fetch(`${SERVER}/api/v1/skill`)).text();
  expect(skill).toMatch(/^---\nname: open-toolbar-feedback\n/);
});
