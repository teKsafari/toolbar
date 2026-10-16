// Part 2, the owner's scenario end to end (PLAN "Part 2 specifics", docs/scope.md) on the lab app
// with the release extension and nothing mocked:
//
//  1. sign in through the popup (mock OIDC of the compose `dev` profile), add the lab as a project
//     and grant its origin from the popup (optional host permissions, D-126);
//  2. a webhook endpoint on this machine subscribes to the workspace;
//  3. Start trace (x), click through the lab buttons and the canvas page, comment on an element (c),
//     highlight text (t), draw an arrow (a), element screenshot with a comment (s), a voice note on
//     the trace (v) from a fake microphone that plays a FLEURS clip, Stop trace (x);
//  4. the server holds a trace with spans of every outcome and the five notes, with the reviewer's
//     identity, the 60 s context and a transcript of the clip;
//  5. `curl ... | tar xz` with a personal token writes the PLAN folder; README.md keeps the PLAN
//     order;
//  6. a real Claude Code run (P2_CLAUDE=1) reads the folder over MCP from a scratch MCP config
//     and resolves the feedback; without it, the API resolves;
//  7. the webhook got feedback.created and feedback.resolved, signed.
//
// The browser is its own (fake audio flags would break the shared browser's tab video), on a
// private display of its own, E2E_DISPLAY plus 59 (:179 under the flows' default :120), so
// Chrome's permission prompt is found in this browser's window and not in the shared one. Release build: FLOWS_EXT_BUILD (default chrome-mv3; the scenario run used the
// unpacked release zip, release-zip). Its shadow root is closed, so the page is driven with keys
// and the mouse only, and every check reads the server.
//   cd e2e && FLOWS_EXT_BUILD=release-zip npx playwright test -c playwright.flows.config.ts p2-
//   P2_CLAUDE=1 adds the Claude Code run over MCP.
import { execFileSync } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { callbackHost } from '../fixtures/net.ts';
import { FAKE_MEDIA, LAB_URL, ROOT, SERVER, api, connectExtension, expect, holdPrivateDisplay, launchExtension, saveShot, test, xshot } from './fixture.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const CLIP = path.join(ROOT, 'apps/server/fixtures/transcribe/fleurs-en_us-1904.webm');
/** Words of the clip (FLEURS en_us 1904) any decent transcript has. */
const CLIP_WORDS = /communication|west|lag/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Item {
  n: number;
  kind: string;
  comment: string;
  quote?: string;
  target?: { testId?: string; tag: string };
  shapes: { type: string }[];
  cropUrl: string | null;
  cropRect?: { w: number; h: number };
  voiceUrl: string | null;
  transcript: { status: string; text: string | null } | null;
  context?: { errors: unknown[]; failedRequests: { status?: number }[] };
  author: { email: string | null; issuer: string | null; subject: string | null; name?: string | null };
}
interface Span {
  id: string;
  outcome: string;
  silent?: string;
  action: { type: string };
  summary: string;
}
interface Delivery {
  event: string;
  body: string;
  signature: string;
  data: { data: { capture: { id: string }; feedback?: { pullCommand: string; resolution: { via: string | null; note: string | null } | null } } };
}

/** A webhook endpoint on 0.0.0.0, reached by the server container through host-gateway. */
async function webhookReceiver() {
  const got: Delivery[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        got.push({ event: String(req.headers['x-toolbar-event']), body, signature: String(req.headers['x-toolbar-signature'] ?? ''), data: JSON.parse(body) });
      } catch {
        /* not JSON */
      }
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '0.0.0.0', r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://${callbackHost()}:${port}/open-toolbar`, got, close: () => server.close() };
}

/** The receiver's check, as docs/configuration.md describes it: HMAC-SHA256 over "<t>.<body>". */
function signed(secret: string, d: Delivery): boolean {
  const parts = Object.fromEntries(d.signature.split(',').map((p) => p.split('=') as [string, string]));
  const want = createHmac('sha256', secret).update(`${parts.t}.${d.body}`).digest();
  const got = Buffer.from(parts.v1 ?? '', 'hex');
  return got.length === want.length && timingSafeEqual(got, want) && Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
}

/** Drag with the mouse through the given points. */
async function drag(page: Page, pts: [number, number][]) {
  await page.mouse.move(pts[0]![0], pts[0]![1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}

/** The notes the reviewer has not sent yet, across the tabs (the worker's store). */
async function unsent(sw: Worker): Promise<{ kind: string; comment: string }[]> {
  return sw.evaluate(async () => Object.values(((await chrome.storage.session.get('tb:review'))['tb:review'] ?? {}) as Record<string, { items: { kind: string; comment: string }[] }>).flatMap((t) => t.items.map((i) => ({ kind: i.kind, comment: i.comment }))));
}

async function traceRunning(sw: Worker): Promise<string | null> {
  return sw.evaluate(async () => ((await chrome.storage.local.get('tb:trace'))['tb:trace'] as { recordingId: string } | undefined)?.recordingId ?? null);
}

/** Add one note: the composer has the focus, so typing goes there; Enter adds it. */
async function note(page: Page, sw: Worker, text: string, count: number) {
  await page.waitForTimeout(400);
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await unsent(sw)).length, { message: `note ${count} kept` }).toBe(count);
}

function walk(dir: string, root = dir): string[] {
  return fs.readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return fs.statSync(p).isDirectory() ? walk(p, root) : [p.slice(root.length + 1)];
  });
}

test.describe.configure({ mode: 'serial', timeout: 600_000 });

let ctx: BrowserContext;
let close: () => Promise<void>;
let x: Awaited<ReturnType<typeof holdPrivateDisplay>> | undefined;
let sw: Worker;
let lab: Page;
let hook: Awaited<ReturnType<typeof webhookReceiver>>;
let hookSecret = '';
let recId = '';
let token = '';
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-p2-'));
// a domain of its own: the flows' shared account would take it into its workspace as a member
const tag = Date.now().toString(36);
const email = `owner-${tag}@p2${tag}.test`;

test.beforeAll(async () => {
  // Chromium plays a WAV file as the fake microphone
  const wav = path.join(work, 'clip.wav');
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', CLIP, '-ac', '1', '-ar', '48000', wav]);
  x = await holdPrivateDisplay(59);
  console.log(`P2 display ${x.display}`);
  const launched = await launchExtension({ cdpPort: 9361, display: x.display, args: [...FAKE_MEDIA, `--use-file-for-fake-audio-capture=${wav}`] });
  ctx = launched.context;
  close = launched.close;
  sw = await launched.sw();
  hook = await webhookReceiver();
});

test.afterAll(async () => {
  hook?.close();
  await close?.();
  x?.release();
  fs.rmSync(work, { recursive: true, force: true });
});

test('P2.1: sign in from the popup, grant the project origin only, subscribe a webhook', async () => {
  const { lab: page, popup } = await connectExtension(ctx, email);
  await popup.close();
  lab = page;
  // the grant covers the project's origin and nothing else
  const granted = await sw.evaluate(() => chrome.permissions.getAll().then((p: { origins: string[] }) => p.origins));
  expect(granted).toContain(`${LAB_URL}/*`);
  expect(granted.filter((o: string) => !o.startsWith(SERVER) && !o.startsWith(LAB_URL))).toEqual([]);
  await expect.poll(() => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).flatMap((s: { matches: string[] }) => s.matches)), { timeout: 15_000 }).toContain(`${LAB_URL}/*`);

  const ws = await api<{ activeId: string }>(ctx, 'GET', '/api/v1/workspaces');
  const created = await api<{ webhook: { id: string }; secret: string }>(ctx, 'POST', `/api/v1/workspaces/${ws.body.activeId}/webhooks`, { url: hook.url, events: ['feedback.created', 'feedback.resolved'] });
  expect(created.status, 'webhook created (the body holds the signing secret, so it stays out of the log)').toBe(201);
  hookSecret = created.body.secret;
});

test('P2.2: trace with clicks, a comment, a highlight, an arrow, an element screenshot and a voice note', async () => {
  await lab.goto(LAB_URL);
  await lab.bringToFront();
  await expect.poll(() => lab.locator('toolbar-root').count(), { timeout: 15_000, message: 'the toolbar host is on the lab' }).toBe(1);
  await lab.waitForTimeout(600);

  // wake the toolbar and start the trace
  await lab.keyboard.press('Control+Shift+Period');
  await lab.waitForTimeout(300);
  await lab.keyboard.press('x');
  await expect.poll(() => traceRunning(sw), { timeout: 20_000, message: 'the trace started' }).not.toBeNull();
  recId = (await traceRunning(sw))!;
  await lab.waitForTimeout(800);

  // click through the lab: each button is one action with a known outcome
  for (const id of ['works', 'dead', 'hidden-500', 'hangs', 'throws']) {
    await lab.getByTestId(id).click();
    await lab.waitForTimeout(id === 'hangs' ? 11_000 : 3000);
  }
  await lab.getByRole('link', { name: 'Canvas' }).click();
  await lab.waitForURL(/\/canvas$/);
  await lab.waitForTimeout(1500);
  await lab.getByTestId('redraw').click();
  await lab.waitForTimeout(3000);
  await lab.getByRole('link', { name: 'Buttons' }).click();
  await lab.waitForURL((u) => u.pathname === '/');
  await lab.waitForTimeout(2000);

  // comment on an element
  await lab.keyboard.press('c');
  await lab.getByTestId('hidden-500').hover();
  await lab.waitForTimeout(200);
  await lab.getByTestId('hidden-500').click();
  await note(lab, sw, 'Submit order looks fine but the order is never placed', 1);
  await lab.keyboard.press('Escape');

  // highlight text: select the heading with the mouse, then t
  const h1 = (await lab.locator('h1').first().boundingBox())!;
  await drag(lab, [
    [h1.x + 1, h1.y + h1.height / 2],
    [h1.x + h1.width - 1, h1.y + h1.height / 2],
  ]);
  await lab.waitForTimeout(300);
  await lab.keyboard.press('t');
  await note(lab, sw, 'This heading should say what the page is for', 2);

  // an arrow pointing at the Export button
  const dead = (await lab.getByTestId('dead').boundingBox())!;
  await lab.keyboard.press('a');
  await drag(lab, [
    [dead.x + dead.width + 120, dead.y + dead.height + 90],
    [dead.x + dead.width / 2, dead.y + dead.height],
  ]);
  await note(lab, sw, 'Export does nothing at all', 3);
  await lab.keyboard.press('Escape');

  // element screenshot with a comment
  await lab.keyboard.press('s');
  await lab.getByTestId('hangs').hover();
  await lab.waitForTimeout(200);
  await lab.getByTestId('hangs').click();
  await note(lab, sw, 'Sync spins forever', 4);
  await lab.keyboard.press('Escape');
  xshot('p2-notes');

  // a voice note on the trace: the fake microphone plays the FLEURS clip (10.6 s)
  await lab.keyboard.press('v');
  await lab.waitForTimeout(11_500);
  await lab.keyboard.press('v');
  await lab.waitForTimeout(800);
  await lab.keyboard.press('Enter');
  await expect.poll(async () => (await unsent(sw)).map((i) => i.kind), { timeout: 15_000 }).toEqual(['element', 'text', 'draw', 'shot', 'voice']);

  // Stop trace sends the notes onto the trace first
  await lab.keyboard.press('x');
  await expect.poll(() => traceRunning(sw), { timeout: 60_000, message: 'the trace stopped' }).toBeNull();
  await expect.poll(async () => (await unsent(sw)).length, { timeout: 30_000 }).toBe(0);
});

test('P2.3: the server holds the trace, its spans, the five notes with who left them, and the transcript', async () => {
  await expect
    .poll(async () => (await api<{ status: string }>(ctx, 'GET', `/api/v1/recordings/${recId}`)).body?.status, { timeout: 120_000, intervals: [1000] })
    .toBe('ready');
  const detail = (await api<{ kind: string; maskingPreset: string; project: { name: string } | null }>(ctx, 'GET', `/api/v1/recordings/${recId}`)).body;
  expect(detail.kind).toBe('trace');
  expect(detail.maskingPreset).toBe('staging');

  const spans = (await api<{ items: Span[] }>(ctx, 'GET', `/api/v1/recordings/${recId}/spans`)).body.items;
  const outcomes = new Set(spans.map((s) => s.outcome));
  console.log(`P2 spans: ${spans.map((s) => `${s.id} ${s.action.type} ${s.outcome}${s.silent ? `/${s.silent}` : ''}`).join(', ')}`);
  for (const o of ['changed', 'dead', 'stuck', 'error']) expect(outcomes, `a ${o} span`).toContain(o);
  expect(spans.some((s) => s.outcome === 'silent' || /\/api\/fail/.test(s.summary)), 'the hidden 500 is in a span').toBe(true);
  expect(spans.filter((s) => s.action.type === 'annotation').length).toBeGreaterThanOrEqual(4);

  let items: Item[] = [];
  await expect
    .poll(
      async () => {
        items = (await api<{ items: Item[] }>(ctx, 'GET', `/api/v1/recordings/${recId}/feedback`)).body.items;
        return items.find((i) => i.kind === 'voice')?.transcript?.status ?? 'none';
      },
      { timeout: 180_000, intervals: [2000], message: 'the voice note is transcribed' },
    )
    .toBe('done');
  expect(items.map((i) => i.kind)).toEqual(['element', 'text', 'draw', 'shot', 'voice']);
  const [comment, text, arrow, shot, voice] = items as [Item, Item, Item, Item, Item];
  expect(comment.target?.testId).toBe('hidden-500');
  expect(comment.context!.failedRequests.some((r) => r.status === 500), 'the comment carries the last 60 s').toBe(true);
  expect(comment.context!.errors.length).toBeGreaterThanOrEqual(1);
  expect(text.quote).toBe('Buttons');
  expect(arrow.shapes[0]!.type).toBe('arrow');
  expect(arrow.cropUrl).toBeTruthy();
  expect(shot.target?.testId).toBe('hangs');
  const png = await ctx.request.get(SERVER + new URL(shot.cropUrl!, SERVER).pathname);
  const box = (await lab.getByTestId('hangs').boundingBox())!;
  const buf = await png.body();
  expect(Math.abs(buf.readUInt32BE(16) - box.width), 'the crop is the element at 1x').toBeLessThanOrEqual(2);
  expect(voice.voiceUrl).toBeTruthy();
  console.log(`P2 transcript: ${voice.transcript?.text}`);
  expect(voice.transcript?.text ?? '').toMatch(CLIP_WORDS);
  for (const it of items) {
    expect(it.author.email).toBe(email);
    expect(it.author.issuer).toContain('oidc.localhost');
    expect(it.author.subject).toBeTruthy();
  }
  const viewer = await ctx.newPage();
  await viewer.goto(`${SERVER}/c/${recId}`);
  await expect(viewer.getByTestId('feedback-item')).toHaveCount(5);
  await viewer.screenshot({ path: saveShot('p2-viewer') });
  await viewer.close();
});

test('P2.4: curl | tar xz with a personal token writes the PLAN folder, README in the PLAN order', async () => {
  const t = await api<{ secret: string }>(ctx, 'POST', '/api/v1/tokens', { name: 'p2 scenario', scopes: ['cli:read', 'cli:write', 'mcp:read', 'mcp:write'], expiresInDays: 7 });
  expect(t.status).toBe(201);
  token = t.body.secret;

  // the share URL's markdown: its first line is the pull command
  const share = (await api<{ link: { url: string; expiresAt: string | null } }>(ctx, 'GET', `/api/v1/recordings/${recId}/share`)).body.link;
  const days = (Date.parse(share.expiresAt ?? '') - Date.now()) / 86_400_000;
  expect(days, 'share links expire after 14 days').toBeGreaterThan(13.9);
  expect(days).toBeLessThanOrEqual(14);
  expect(share.url).toMatch(new RegExp(`/s/[A-Za-z0-9_-]{22,}$`));
  const res = await fetch(share.url, { headers: { accept: 'text/markdown' } });
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('x-robots-tag')).toContain('noindex');
  const md = await res.text();
  const pull = md.split('\n')[0]!;
  expect(pull).toBe(`curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "${SERVER}/api/v1/recordings/${recId}/folder" | tar xz`);
  execFileSync('bash', ['-c', pull], { cwd: work, env: { ...process.env, TOOLBAR_TOKEN: token } });

  const dir = path.join(work, '.feedback', recId);
  const files = walk(dir).sort();
  console.log(`P2 folder (${files.length} files):\n  ${files.join('\n  ')}`);
  // the voice note on the trace is annotation a05: its audio and transcript, joined into the
  // trace's voice/transcript.vtt (the trace has no voice track of its own, D-160)
  for (const f of ['README.md', 'feedback.json', 'spans.jsonl', 'console.jsonl', 'network.jsonl', 'voice/transcript.vtt', 'voice/a05.webm', 'voice/a05.vtt', 'raw/network.har', 'raw/rrweb-000.json.gz'])
    expect(files, f).toContain(f);
  for (let n = 1; n <= 5; n++) {
    const a = `annotations/a0${n}`;
    expect(files.filter((f) => f.startsWith(a)).length, `${a}.*`).toBeGreaterThanOrEqual(2);
    expect(files, `${a}.locator.json`).toContain(`${a}.locator.json`);
  }
  // element, text, drawing and element screenshot each have their crop (D-160)
  for (const n of [1, 2, 3, 4]) expect(files).toContain(`annotations/a0${n}.png`);
  expect(files).toContain('annotations/a03.shapes.json');
  const keyframes = files.filter((f) => /^keyframes\/k\d\d\.png$/.test(f));
  expect(keyframes.length).toBeGreaterThanOrEqual(2);
  expect(keyframes.length).toBeLessThanOrEqual(10);
  expect(files.some((f) => f.startsWith('outline/'))).toBe(true);
  expect(files.every((f) => /^(README\.md|feedback\.json|spans\.jsonl|console\.jsonl|network\.jsonl|annotations\/a\d\d\.(png|shapes\.json|locator\.json)|keyframes\/k\d\d\.png|outline\/[\w-]+\.md|text\/[\w-]+\.md|voice\/(transcript\.vtt|audio\.webm|a\d\d\.(webm|vtt))|raw\/(rrweb-\d{3}\.json\.gz|network\.har))$/.test(f)), 'no file outside the PLAN layout').toBe(true);
  expect(fs.readFileSync(path.join(dir, 'voice/transcript.vtt'), 'utf8')).toMatch(/^WEBVTT/);

  // README.md order (PLAN): header, the fence rule, the reviewer's words, what did not happen,
  // the timeline, search hints and files
  const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  const at = (s: string | RegExp) => (typeof s === 'string' ? readme.indexOf(s) : readme.search(s));
  const order = [at(/^# /m), at(/fenced/i), at("## The reviewer's words"), at('## What did not happen'), at('## Timeline'), at('## Search hints and files')];
  console.log(`P2 README sections at ${order.join(', ')}; ${readme.length} chars`);
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  const head = readme.slice(0, at("## The reviewer's words"));
  for (const k of [email, 'staging', 'Chrom']) expect(head, `header names ${k}`).toContain(k);
  const words = readme.slice(at("## The reviewer's words"), at('## What did not happen'));
  for (const w of ['Submit order looks fine', 'Sync spins forever']) expect(words).toContain(w);
  expect(words).toMatch(/```text captured source="[^"]+" author=/);
  expect(words).toMatch(CLIP_WORDS);
  const missing = readme.slice(at('## What did not happen'), at('## Timeline'));
  expect(missing).toMatch(/dead/);
  expect(missing).toMatch(/stuck/);
  expect(missing).toContain('/api/hang');
  expect(readme.slice(at('## Timeline'))).toMatch(/-> open (annotations|keyframes)\/\w+\.png/);
  expect(readme).toContain('-> open voice/a05.vtt');
  // the lab's iframe loading is not a route change of the page (D-161)
  expect(readme).not.toMatch(/went to \/embed/);
  expect(readme.length / 3.5, 'README under 8k tokens').toBeLessThan(8000);
  fs.copyFileSync(path.join(dir, 'README.md'), path.join(ROOT, 'e2e/flows-shots/p2-README.md'));

  const fb = JSON.parse(fs.readFileSync(path.join(dir, 'feedback.json'), 'utf8')) as { id: string; reviewer: { email: string } };
  expect(fb.id).toBe(recId);
  expect(fb.reviewer.email).toBe(email);
});

test('P2.5: an agent reads the folder over MCP and resolves it; the webhook got both events, signed', async () => {
  await expect.poll(() => hook.got.filter((d) => d.event === 'feedback.created' && d.data.data.capture.id === recId).length, { timeout: 60_000, message: 'feedback.created delivered' }).toBe(1);
  const created = hook.got.find((d) => d.event === 'feedback.created' && d.data.data.capture.id === recId)!;
  expect(signed(hookSecret, created), 'feedback.created is signed').toBe(true);
  expect(created.data.data.feedback!.pullCommand).toContain(`/api/v1/recordings/${recId}/folder`);

  let via = 'api';
  if (process.env.P2_CLAUDE === '1') {
    // a real Claude Code run with a scratch MCP config that names only this server; the token
    // stays in the environment, the config refers to it by name
    const cfg = path.join(work, 'mcp.json');
    fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { toolbar: { type: 'http', url: `${SERVER}/mcp`, headers: { Authorization: 'Bearer ${TOOLBAR_TOKEN}' } } } }));
    const prompt = [
      `Use the toolbar MCP server only. Call get_feedback_folder for capture ${recId}, read the README it returns,`,
      'then open the element screenshot of the Sync button with get_feedback_file.',
      'Then call resolve_feedback for that capture with the note "p2 scenario: read over MCP" and no commit.',
      'Answer with one JSON object and nothing else: {"first_heading": <the first markdown heading line of README.md>,',
      '"stuck_request": <the URL path of the request that never answered>, "failed_500": <the URL path that returned 500>,',
      '"image": <the folder path of the image you opened>, "resolved": <true or false>}',
    ].join(' ');
    const out = execFileSync(
      'claude',
      ['-p', prompt, '--mcp-config', cfg, '--strict-mcp-config', '--allowedTools', 'mcp__toolbar__get_feedback_folder,mcp__toolbar__get_feedback_file,mcp__toolbar__resolve_feedback', '--max-turns', '12', '--output-format', 'stream-json', '--verbose'],
      { cwd: work, env: { ...process.env, TOOLBAR_TOKEN: token }, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    );
    // what the agent did, from its own transcript: the tool calls and the final answer
    const msgs = out.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { type: string; result?: string; message?: { content?: { type: string; name?: string; input?: Record<string, unknown> }[] } });
    const calls = msgs.filter((m) => m.type === 'assistant').flatMap((m) => m.message?.content ?? []).filter((c) => c.type === 'tool_use').map((c) => ({ name: String(c.name), input: c.input ?? {} }))
      // Claude Code may load the deferred MCP tools with its own ToolSearch first
      .filter((c) => c.name.startsWith('mcp__toolbar__'));
    console.log(`P2 Claude Code tool calls: ${calls.map((c) => `${c.name.replace('mcp__toolbar__', '')}(${JSON.stringify(c.input).slice(0, 120)})`).join(', ')}`);
    const result = String(msgs.find((m) => m.type === 'result')?.result ?? '');
    console.log(`P2 Claude Code answer: ${result}`);
    expect(calls[0]?.name, 'the agent starts with the folder (README first)').toBe('mcp__toolbar__get_feedback_folder');
    expect(calls.some((c) => c.name === 'mcp__toolbar__get_feedback_file' && /^annotations\/a04\.png$/.test(String(c.input.path))), 'it opened the Sync screenshot').toBe(true);
    expect(calls.some((c) => c.name === 'mcp__toolbar__resolve_feedback')).toBe(true);
    const answer = JSON.parse(result.slice(result.indexOf('{'), result.lastIndexOf('}') + 1)) as Record<string, unknown>;
    expect(String(answer.first_heading)).toMatch(/^# /);
    expect(String(answer.stuck_request)).toContain('/api/hang');
    expect(String(answer.failed_500)).toContain('/api/fail');
    expect(answer.resolved).toBe(true);
    via = 'mcp';
  } else {
    test.info().annotations.push({ type: 'skip', description: 'Claude Code over MCP runs with P2_CLAUDE=1 (it calls a model); resolved through the API instead' });
    const r = await fetch(`${SERVER}/api/v1/recordings/${recId}/resolve`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ note: 'p2 scenario: resolved through the API' }) });
    expect(r.status).toBe(200);
  }

  const res = await (await fetch(`${SERVER}/api/v1/recordings/${recId}/resolve`, { headers: { authorization: `Bearer ${token}` } })).json();
  console.log(`P2 resolution: ${JSON.stringify(res)}`);
  expect(JSON.stringify(res)).toContain('p2 scenario');
  await expect.poll(() => hook.got.filter((d) => d.event === 'feedback.resolved' && d.data.data.capture.id === recId).length, { timeout: 60_000, message: 'feedback.resolved delivered' }).toBe(1);
  const resolved = hook.got.find((d) => d.event === 'feedback.resolved')!;
  expect(signed(hookSecret, resolved)).toBe(true);
  expect(resolved.data.data.feedback!.resolution!.note).toContain('p2 scenario');
  if (via === 'mcp') expect(String(resolved.data.data.feedback!.resolution!.via ?? '')).not.toBe('api');
});
