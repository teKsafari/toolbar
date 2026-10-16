// Parity group G8, open-toolbar side: agent hand-off (MCP, markdown, copy for AI), shortcuts, speed,
// errors and empty states (docs/parity/scenarios.md, S8.1 to S8.5). Each test is one scenario,
// run as scripted, and records its evidence (counts, steps, clicks, timings with the load
// average, screenshots) in e2e/parity-shots/G8/<scenario>.json and .png files. The raw results
// are written up in docs/parity/G8-replica.md; the share-page markdown of S8.1 step 7 is kept in
// git under docs/parity/evidence/G8/.
//
//   cd e2e && PARITY_EXT_BUILD=chrome-mv3-g8 npx playwright test -c playwright.parity.config.ts G8
//   cd e2e && npx playwright test -c playwright.parity.config.ts G8 -g S8.3   # one
//
// Owner scope (docs/scope.md): S8.2 (CLI) is paused and not run.
//
// The agent of S8.1 is Claude Code (`claude -p`) with a throwaway --mcp-config in a scratch
// folder under the system temp dir, never the user's own config. `claude -p` cannot run an
// OAuth sign-in (it reports the server as needing authentication), so the spec does the client
// half of the MCP OAuth flow itself, as Claude Code would (discovery, dynamic registration as
// "Claude Code", PKCE), opens the consent page in the rig's browser and approves it with one
// real click, then hands the access token to Claude Code in the scratch config's header.
import { chromium, expect, test, type Browser, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  DISPLAY,
  EXT_ID,
  Evidence,
  LAB_URL,
  ROOT,
  SERVER,
  api,
  availableMb,
  calm,
  clickIcon,
  clipboard,
  dropPopupConnection,
  editorFrame,
  firstMatching,
  focusWindow,
  hasEditor,
  iconPoint,
  launchExtension,
  load,
  popupBox,
  popupPage,
  screencast,
  secs,
  shadowOne,
  signIn,
  sleep,
  toScreen,
  until,
  xclick,
  xclickEl,
  xclickPopup,
  xdo,
  xdrag,
  xkey,
  xmove,
  xup,
  type Launched,
} from './rig.ts';
import { browserEnv } from '../fixtures/browser-env.ts';

const GROUP = 'G8';
const EMAIL = process.env.PARITY_EMAIL ?? 'parity@example.com';
const SHOTS = path.join(ROOT, 'e2e/parity-shots');
const MD_DIR = path.join(ROOT, 'docs/parity/evidence/G8');
const CLIENT_NAME = 'Claude Code';
const REDIRECT_PORT = 47121;
const REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
// the access token lives outside the repo and outside the evidence
const STATE_FILE = path.join(os.tmpdir(), 'tb-parity-g8-state.json');

function idFrom(env: string, file: string, pick: (j: Record<string, unknown>) => unknown): string {
  if (process.env[env]) return process.env[env]!;
  const j = JSON.parse(fs.readFileSync(path.join(SHOTS, file), 'utf8')) as Record<string, unknown>;
  const id = pick(j);
  if (typeof id !== 'string') throw new Error(`no value in ${file}; set ${env}`);
  return id;
}
const N1 = () => idFrom('PARITY_N1', 'G3/S3.1.json', (j) => (j.capture as { id?: string } | undefined)?.id);
const N1_LINK = () => idFrom('PARITY_N1_LINK', 'G3/S3.1.json', (j) => (j.capture as { link?: string } | undefined)?.link);
const N7 = () => idFrom('PARITY_N7', 'G7/S7.2.json', (j) => (j.n7 as { id?: string } | undefined)?.id);

/** One key of an earlier scenario's evidence, copied here (S8.3 step 3, S8.4, S8.5 steps 2 and 3). */
function copied(file: string, key: string): unknown {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(SHOTS, file), 'utf8')) as Record<string, unknown>;
    return key in j ? j[key] : { missing: `${file} has no "${key}"` };
  } catch (e) {
    return { missing: String(e).slice(0, 200) };
  }
}

// ---------------------------------------------------------------- browsers

let rig: Launched | null = null;
let plain: Browser | null = null;

async function getRig(): Promise<Launched> {
  if (rig) return rig;
  rig = await launchExtension();
  const { popup } = await signIn(rig.context, EMAIL);
  await popup.close().catch(() => undefined);
  for (const p of rig.context.pages()) if (p.url().startsWith(SERVER)) await p.close().catch(() => undefined);
  return rig;
}

async function closeRig() {
  await rig?.close();
  rig = null;
}

async function getPlain(): Promise<Browser> {
  if (plain) return plain;
  const free = availableMb();
  if (free < 1600) throw new Error(`only ${free} MB available; a second browser needs about 800 MB and 800 MB must stay free`);
  plain = await chromium.launch({ headless: false, env: browserEnv(DISPLAY), args: ['--force-device-scale-factor=1', '--window-position=0,0', '--window-size=1448,991'] });
  return plain;
}

test.afterAll(async () => {
  await plain?.close().catch(() => undefined);
  plain = null;
  await closeRig();
});

/** Run one check; a failure is recorded as evidence and does not end the scenario. */
async function probe<T>(ev: Evidence, key: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const v = await fn();
    ev.set(key, v);
    return v;
  } catch (e) {
    ev.set(key, { error: String(e).slice(0, 600) });
    return null;
  }
}

const txt = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

type Theme = 'light' | 'dark';
const VARIANTS: [number, number, Theme][] = [
  [1440, 900, 'light'],
  [1440, 900, 'dark'],
  [390, 844, 'light'],
  [390, 844, 'dark'],
];

async function ready(p: Page) {
  await p.waitForLoadState('domcontentloaded');
  if (/\/(c|s)\//.test(new URL(p.url()).pathname)) await p.locator('.page[data-hydrated]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await p.locator('html[data-app-ready]').waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
  await p.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await p.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  await sleep(400);
}

async function openUrl(context: BrowserContext, url: string, o: { w?: number; h?: number; theme?: Theme } = {}) {
  const p = await context.newPage();
  await p.setViewportSize({ width: o.w ?? 1440, height: o.h ?? 900 });
  await p.emulateMedia({ colorScheme: o.theme ?? 'light' });
  await p.bringToFront();
  await p.goto(url.startsWith('http') ? url : SERVER + url);
  // in the extension rig a navigation to a signed-in page drops the emulated colour scheme
  await p.emulateMedia({ colorScheme: o.theme ?? 'light' });
  await ready(p);
  return p;
}

const overflowX = (p: Page) => p.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

async function shoot4(ev: Evidence, step: string, open: (w: number, h: number, theme: Theme) => Promise<{ page: Page; done: () => Promise<void> }>, setup: (p: Page, w: number) => Promise<void> = async () => undefined) {
  const out: Record<string, number | string> = {};
  for (const [w, h, theme] of VARIANTS) {
    let done: (() => Promise<void>) | null = null;
    try {
      const o = await open(w, h, theme);
      done = o.done;
      await setup(o.page, w);
      await sleep(500);
      await ev.shot(o.page, step, String(w), theme);
      out[`${w}-${theme}`] = await overflowX(o.page);
    } catch (e) {
      out[`${w}-${theme}`] = `error: ${String(e).slice(0, 200)}`;
    }
    await done?.().catch(() => undefined);
  }
  return out;
}

const ownerOpen = (context: BrowserContext, url: string) => async (w: number, h: number, theme: Theme) => {
  const page = await openUrl(context, url, { w, h, theme });
  return { page, done: () => page.close() };
};

async function readClipboard(p: Page) {
  const viaPage = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  return viaPage || clipboard();
}

async function waitToast(p: Page, re: RegExp, t0 = Date.now(), timeout = 15_000) {
  for (;;) {
    const msgs = (await p.locator('.nb-toast').allTextContents().catch(() => [] as string[])).map(txt);
    const hit = msgs.find((m) => re.test(m));
    if (hit) return { toast: hit, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) throw new Error(`no toast ${re}; toasts: ${JSON.stringify(msgs)}`);
    await sleep(16);
  }
}

async function settingsDrawer(p: Page, w: number) {
  if (w < 860 && (await p.getByTestId('settings-menu').isVisible().catch(() => false))) {
    await p.getByTestId('settings-menu').click();
    await sleep(400);
  }
}

async function myWorkspaces(context: BrowserContext) {
  return (await api<{ items: { id: string; name: string; role: string }[]; activeId: string }>(context, 'GET', '/api/v1/workspaces')).body;
}

/** Make the workspace that holds N1 the active one (setup, through the API the workspace menu calls). */
async function activateN1Workspace(context: BrowserContext) {
  const rec = (await api<{ workspaceId?: string; workspace?: { id?: string }; title?: string }>(context, 'GET', `/api/v1/recordings/${N1()}`)).body;
  const w = await myWorkspaces(context);
  const wsId = rec?.workspaceId ?? rec?.workspace?.id ?? w.activeId;
  if (wsId && w.activeId !== wsId) await api(context, 'PUT', '/api/v1/me/active-workspace', { workspaceId: wsId });
  return { workspaceId: wsId, workspace: w.items.find((x) => x.id === wsId)?.name, n1Title: rec?.title };
}

/** The dev tools' agent tab on a capture page, at any width. */
async function agentTab(p: Page) {
  if (!(await p.getByTestId('tab-agent').isVisible().catch(() => false))) {
    if (await p.getByTestId('narrow-devtools').isVisible().catch(() => false)) await p.getByTestId('narrow-devtools').click();
    else if (await p.getByTestId('show-devtools').isVisible().catch(() => false)) await p.getByTestId('show-devtools').click();
    await sleep(400);
  }
  await p.getByTestId('tab-agent').click();
  await p.getByTestId('agent-tab').waitFor();
  await sleep(600);
}

// ---------------------------------------------------------------- extension helpers (as in G1)

async function session(sw: () => Promise<import('@playwright/test').Worker>) {
  return (await (await sw()).evaluate(async () => (await chrome.storage.session.get('tb:session'))['tb:session'])) as { state: string; [k: string]: unknown } | undefined;
}

async function freshLab(context: BrowserContext, p = '/'): Promise<Page> {
  const page = await context.newPage();
  for (const other of context.pages()) if (other !== page) await other.close().catch(() => undefined);
  await page.goto(LAB_URL + p);
  await page.waitForLoadState('networkidle');
  await focusWindow(page);
  return page;
}

async function openMenu(popup: Page) {
  for (let i = 0; i < 3; i++) {
    await xclickPopup(popup, '[data-menu-button]');
    if (await popup.locator('[data-menu]').waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error('the popup menu did not open');
}

async function shootPopup(ev: Evidence, step: string, popup: Page) {
  await popup.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => undefined);
  await sleep(600);
  const b = await popupBox(popup);
  return ev.xshot(step, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 });
}

async function popupOpen(context: BrowserContext) {
  const port = (context as BrowserContext & { __cdpPort?: number }).__cdpPort;
  const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { url: string }[];
  return list.some((t) => t.url.startsWith(`chrome-extension://${EXT_ID}/popup.html`));
}

async function closeEditor(page: Page) {
  const f = await editorFrame(page);
  await xclickEl(page, f.getByTestId('close'));
  await sleep(400);
  if (hasEditor(page)) {
    const confirm = f.getByRole('button', { name: /discard/i });
    if (await confirm.count()) await xclickEl(page, confirm.first());
  }
  await until(async () => !hasEditor(page), 15_000);
}

async function editorBox(f: Frame) {
  const b = (await f.getByTestId('editor').boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

/** Icon, menu, Settings: the popup's settings screen. */
async function openExtSettings(context: BrowserContext, page: Page) {
  const popup = await clickIcon(context, page);
  await openMenu(popup);
  await xclickPopup(popup, '[data-menu-item="settings"]');
  await popup.locator('[data-screen="settings"]').waitFor();
  await sleep(300);
  return popup;
}

/** Instant replay on or off through the popup's settings; returns the value it had. */
async function setReplay(context: BrowserContext, page: Page, on: boolean) {
  const popup = await openExtSettings(context, page);
  const sw = popup.getByRole('switch', { name: 'Instant replay' });
  await sw.waitFor();
  const was = await sw.isChecked();
  if (was !== on) await xclickPopup(popup, sw);
  await expect(sw).toBeChecked({ checked: on });
  await popup.close().catch(() => undefined);
  await focusWindow(page);
  return was;
}

// ---------------------------------------------------------------- MCP and the agent

let rpcId = 1;
async function rpc(token: string, method: string, params: unknown = {}, headers: Record<string, string> = {}) {
  const r = await fetch(`${SERVER}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  });
  const text = await r.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    const m = text.match(/^data: (.+)$/m);
    body = m ? JSON.parse(m[1]!) : text.slice(0, 400);
  }
  return { status: r.status, body: body as { result?: { content?: { type: string; text: string }[]; isError?: boolean; structuredContent?: unknown }; error?: { message: string } } };
}

/** A tool's answer as JSON (its first text part), with its status. */
async function tool(token: string, name: string, args: Record<string, unknown>, headers: Record<string, string> = {}) {
  const r = await rpc(token, 'tools/call', { name, arguments: args }, headers);
  const t = r.body?.result?.content?.find((c) => c.type === 'text')?.text ?? '';
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(t) as Record<string, unknown>;
  } catch {
    /* plain text */
  }
  return { status: r.status, isError: !!r.body?.result?.isError, error: r.body?.error?.message ?? null, json, text: t.slice(0, 600) };
}

interface AgentRun {
  ms: number;
  load: number;
  toolCalls: { name: string; input: unknown }[];
  toolResults: { total?: number; returned?: number; isError?: boolean; head: string }[];
  answer: string;
  json: unknown;
}

// Claude Code remembers servers that answered 401 (by name) in this file and then skips them for a
// while; a run that saw the server refuse (step 8) would make the next run skip it. The spec drops
// the "open-toolbar" entry before each run and puts the file back as it found it at the end.
const NEEDS_AUTH = path.join(os.homedir(), '.claude', 'mcp-needs-auth-cache.json');
let needsAuthBefore: string | null | undefined;
function forgetNeedsAuth() {
  try {
    const raw = fs.readFileSync(NEEDS_AUTH, 'utf8');
    if (needsAuthBefore === undefined) needsAuthBefore = raw;
    const j = JSON.parse(raw) as Record<string, unknown>;
    if ('open-toolbar' in j) {
      delete j['open-toolbar'];
      fs.writeFileSync(NEEDS_AUTH, JSON.stringify(j));
    }
  } catch {
    if (needsAuthBefore === undefined) needsAuthBefore = null;
  }
}
function restoreNeedsAuth() {
  // the "open-toolbar" entry is already gone (forgetNeedsAuth); a file this spec created goes too
  if (needsAuthBefore !== null) return;
  try {
    if (fs.readFileSync(NEEDS_AUTH, 'utf8').trim() === '{}') fs.rmSync(NEEDS_AUTH, { force: true });
  } catch {
    /* none */
  }
}

/** One headless Claude Code run with the scratch MCP config; the raw stream lands in the evidence folder. */
function agent(ev: Evidence, step: string, cwd: string, prompt: string): AgentRun {
  forgetNeedsAuth();
  const t0 = Date.now();
  const l = load();
  let out = '';
  try {
    out = execFileSync(
      'claude',
      ['-p', prompt, '--mcp-config', path.join(cwd, 'mcp.json'), '--strict-mcp-config', '--allowedTools', 'mcp__open-toolbar', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--max-turns', '30'],
      { cwd, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 << 20, input: '' },
    );
  } catch (e) {
    out = String((e as { stdout?: string }).stdout ?? e);
  }
  fs.writeFileSync(path.join(ev.dir, `${ev.scenario}-agent-${step}.jsonl`), out);
  const run: AgentRun = { ms: Date.now() - t0, load: l, toolCalls: [], toolResults: [], answer: '', json: null };
  for (const line of out.split('\n')) {
    let m: { type?: string; message?: { content?: unknown[] }; result?: string };
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.type === 'assistant')
      for (const c of (m.message?.content ?? []) as { type: string; name?: string; input?: unknown }[]) if (c.type === 'tool_use') run.toolCalls.push({ name: c.name!.replace(/^mcp__open-toolbar__/, ''), input: c.input });
    if (m.type === 'user')
      for (const c of (m.message?.content ?? []) as { type: string; content?: unknown; is_error?: boolean }[]) {
        if (c.type !== 'tool_result') continue;
        const text = typeof c.content === 'string' ? c.content : ((c.content as { type: string; text?: string }[] | undefined) ?? []).map((x) => x.text ?? '').join('');
        const total = text.match(/"total"\s*:\s*(\d+)/);
        const returned = text.match(/"returned"\s*:\s*(\d+)/);
        run.toolResults.push({ total: total ? Number(total[1]) : undefined, returned: returned ? Number(returned[1]) : undefined, isError: c.is_error, head: text.slice(0, 300) });
      }
    if (m.type === 'result') run.answer = String(m.result ?? '');
  }
  const j = run.answer.match(/\{[\s\S]*\}/);
  if (j)
    try {
      run.json = JSON.parse(j[0]);
    } catch {
      /* prose */
    }
  return run;
}

const b64 = (b: Buffer) => b.toString('base64url');

interface G8State {
  token?: string;
  clientId?: string;
  scratch?: string;
}
const readState = (): G8State => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as G8State;
  } catch {
    return {};
  }
};
const writeState = (s: G8State) => fs.writeFileSync(STATE_FILE, JSON.stringify(s), { mode: 0o600 });

// ================================================================ S8.1

test('S8.1 MCP, markdown and copy for AI (N1)', async () => {
  test.setTimeout(3_600_000);
  const ev = new Evidence(GROUP, 'S8.1');
  const { context } = await getRig();
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  const n1 = N1();
  const n1Link = N1_LINK();
  const ws = await activateN1Workspace(context);
  ev.set('setup', { n1, n1Share: n1Link.replace(SERVER, ''), ...ws });
  const n1Title = ws.n1Title ?? 'parity S3.1 lab';

  // setup for a repeatable run: no "Claude Code" agent left connected by an earlier run
  await probe(ev, 'setup-old-clients', async () => {
    const p = await openUrl(context, '/settings/mcp');
    let removed = 0;
    for (let i = 0; i < 10; i++) {
      const row = p.getByTestId('mcp-client').filter({ hasText: CLIENT_NAME }).first();
      if (!(await row.count())) break;
      await row.getByTestId('mcp-client-menu').click();
      await row.getByTestId('mcp-client-remove').click();
      await p.getByTestId('mcp-client-remove-confirm').click();
      await sleep(800);
      removed++;
    }
    const left = (await p.getByTestId('mcp-client').allTextContents()).map(txt);
    await p.close();
    return { removed, otherClients: left };
  });

  // 1. dashboard, workspace menu, Settings, MCP (3 clicks); the Claude Code card's snippet
  const page = await openUrl(context, '/');
  await probe(ev, 'step1-mcp-page (J-145)', async () => {
    await page.getByTestId('workspace-menu').click();
    const menu = page.locator(`#${await page.getByTestId('workspace-menu').getAttribute('aria-controls')}`);
    await menu.waitFor();
    await menu.getByRole('menuitem', { name: 'Settings' }).click();
    await page.waitForURL(/\/settings/);
    await ready(page);
    await page.getByRole('link', { name: 'MCP', exact: true }).click();
    await page.waitForURL(/\/settings\/mcp$/);
    await ready(page);
    await page.screenshot({ path: ev.file('1-mcp-page') });
    const cards = await page.locator('[data-testid^="agent-card-"]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-testid')!.replace('agent-card-', '')}: ${(e.textContent ?? '').replace(/\s+/g, ' ').trim()}`));
    const headings = (await page.locator('main h1, main h2').allTextContents()).map(txt);
    await page.getByTestId('agent-card-claude-code').click();
    const snippet = page.getByTestId('setup-snippet');
    await snippet.waitFor();
    await sleep(300);
    await page.screenshot({ path: ev.file('1-claude-code-card') });
    const dialog = txt(await page.locator('dialog[open]').first().textContent());
    await page.getByTestId('copy-snippet').click();
    await sleep(300);
    const clip = await readClipboard(page);
    await page.getByRole('button', { name: 'Done' }).click();
    return {
      clicksToPage: 3,
      serverUrl: txt(await page.getByTestId('mcp-server-url').textContent()),
      headings,
      cards,
      dialog: dialog.slice(0, 600),
      snippet: txt(await snippet.textContent().catch(() => '')) || null,
      clipboard: clip,
      holdsServerUrl: clip.includes(`${SERVER}/mcp`),
      holdsToken: /tb_|bearer|token/i.test(clip),
      clicksToCopy: 'card, Copy = 2',
    };
  });
  ev.set('step1-shots', await shoot4(ev, '1-mcp-page', ownerOpen(context, '/settings/mcp'), settingsDrawer));

  // 2. the agent's first call: 401, discovery, registration as "Claude Code", consent, one click
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-g8-agent-'));
  const state: G8State = { scratch };
  await probe(ev, 'step2-consent (J-146)', async () => {
    const first = await fetch(`${SERVER}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    const wwwAuth = first.headers.get('www-authenticate') ?? '';
    const metaUrl = /resource_metadata="([^"]+)"/.exec(wwwAuth)?.[1];
    if (!metaUrl) throw new Error(`no resource_metadata in ${first.status} ${wwwAuth}`);
    const resource = (await (await fetch(metaUrl)).json()) as { authorization_servers: string[]; scopes_supported?: string[] };
    const as = (await (await fetch(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
    const reg = (await (await fetch(as.registration_endpoint!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: CLIENT_NAME, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) })).json()) as { client_id: string };
    const verifier = b64(randomBytes(40));
    const challenge = b64(createHash('sha256').update(verifier).digest());
    const auth = new URL(as.authorization_endpoint!);
    const st = randomUUID();
    auth.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: st, scope: (resource.scopes_supported ?? ['captures:read', 'captures:write']).join(' '), resource: `${SERVER}/mcp` }).toString();

    // consent shots first (the page is a GET; nothing is granted until Allow)
    const shots = await shoot4(ev, '2-consent', ownerOpen(context, auth.toString()));

    // the callback a local agent listens on
    let callback = '';
    const server = http.createServer((req, res) => {
      // the browser also asks for /favicon.ico; keep the callback itself
      if (req.url?.startsWith('/callback')) callback = `http://127.0.0.1:${REDIRECT_PORT}${req.url}`;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Signed in. You can close this tab.');
    });
    await new Promise<void>((r) => server.listen(REDIRECT_PORT, '127.0.0.1', () => r()));
    try {
      const p = await openUrl(context, auth.toString());
      await focusWindow(p);
      await p.getByTestId('mcp-consent').waitFor();
      const consent = {
        heading: txt(await p.locator('h1').first().textContent()),
        client: txt(await p.getByTestId('mcp-client-name').textContent()),
        lines: (await p.getByTestId('mcp-consent').locator('p').allTextContents()).map(txt),
        workspaces: (await p.getByTestId('mcp-workspace').locator('option').allTextContents()).map(txt),
        workspaceDefault: await p.getByTestId('mcp-workspace').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex]?.text ?? ''),
        scopes: (await p.getByTestId('mcp-consent').locator('li').allTextContents()).map(txt),
        buttons: (await p.getByTestId('mcp-consent').locator('button').allTextContents()).map(txt),
      };
      await p.screenshot({ path: ev.file('2-consent-approve') });
      const c = await calm();
      const t0 = Date.now();
      await xclickEl(p, p.getByTestId('mcp-approve'));
      await until(async () => callback.includes('code='), 30_000, 20);
      const approveMs = Date.now() - t0;
      await sleep(500);
      const landed = txt(await p.locator('body').textContent().catch(() => ''));
      await p.close().catch(() => undefined);
      const cb = new URL(callback);
      const tok = await fetch(as.token_endpoint!, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: cb.searchParams.get('code')!, client_id: reg.client_id, code_verifier: verifier, redirect_uri: REDIRECT }).toString(),
      });
      const tj = (await tok.json()) as { access_token?: string; scope?: string; expires_in?: number; refresh_token?: string };
      if (!tj.access_token) throw new Error(`token exchange ${tok.status} ${JSON.stringify(tj)}`);
      state.token = tj.access_token;
      state.clientId = reg.client_id;
      writeState(state);
      fs.writeFileSync(path.join(scratch, 'mcp.json'), JSON.stringify({ mcpServers: { 'open-toolbar': { type: 'http', url: `${SERVER}/mcp`, headers: { Authorization: `Bearer ${tj.access_token}` } } } }), { mode: 0o600 });
      const tools = await rpc(tj.access_token, 'tools/list');
      return {
        firstCall: { status: first.status, wwwAuthenticate: wwwAuth.replace(SERVER, '<server>') },
        discovery: { authorizationServer: resource.authorization_servers[0], scopesSupported: resource.scopes_supported ?? null, registration: !!as.registration_endpoint, pkce: as.code_challenge_methods_supported ?? null },
        consent,
        clicks: 1,
        approveToCallbackMs: approveMs,
        load: c.load,
        landedText: landed.slice(0, 200),
        callbackHasState: cb.searchParams.get('state') === st,
        token: { status: tok.status, scope: tj.scope ?? null, expiresIn: tj.expires_in ?? null, refresh: !!tj.refresh_token },
        toolsListed: ((tools.body as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name),
        shots,
      };
    } finally {
      server.close();
    }
  });
  const token = state.token;
  if (!token) throw new Error('no access token; steps 3 to 8 need one');

  // 3. details, console, network (5xx only), user events: entries per tool
  await probe(ev, 'step3-direct-counts (J-149)', async () => {
    const det = await tool(token, 'get_capture', { capture: n1Link });
    const con = await tool(token, 'get_console_logs', { capture: n1Link, limit: 100 });
    const con2 = await tool(token, 'get_console_logs', { capture: n1Link, kinds: ['console', 'error'], limit: 100 });
    const net = await tool(token, 'get_network_requests', { capture: n1Link, status: ['5xx'] });
    const netAll = await tool(token, 'get_network_requests', { capture: n1Link, limit: 100, bodies: 'none', headers: false });
    const ue = await tool(token, 'get_user_events', { capture: n1Link, limit: 100 });
    const items = (j: Record<string, unknown> | null) => ((j?.items as Record<string, unknown>[] | undefined) ?? []);
    const n5 = items(net.json)[0] ?? {};
    return {
      get_capture: { status: det.status, keys: Object.keys(det.json ?? {}), title: (det.json as { title?: string } | null)?.title, text: det.json ? undefined : det.text },
      get_console_logs: { total: con.json?.total, returned: con.json?.returned, kinds: [...new Set(items(con.json).map((i) => String(i.kind)))], consoleAndErrorTotal: con2.json?.total },
      get_network_requests_5xx: { total: net.json?.total, returned: net.json?.returned, rows: items(net.json).map((i) => `${i.method} ${String(i.url).replace(LAB_URL, '')} ${i.status}`), fields: Object.keys(n5), hasRequestHeaders: JSON.stringify(n5).includes('equestHeaders') || 'headers' in n5, hasResponseBody: /responseBody|"body"/.test(JSON.stringify(n5)), hasFrame: 'frame' in n5 || 'frameId' in n5 },
      get_network_requests_all: { total: netAll.json?.total, returned: netAll.json?.returned },
      get_user_events: { total: ue.json?.total, returned: ue.json?.returned, types: [...new Set(items(ue.json).map((i) => String(i.type)))], fields: Object.keys(items(ue.json)[0] ?? {}) },
      viewerCounts_S3_1: { console: 45, network: 17, actions: 25, fiveXX: 1 },
    };
  });
  await probe(ev, 'step3-agent (J-149)', async () => {
    const run = agent(
      ev,
      '3',
      scratch,
      `Use the open-toolbar MCP tools on this capture: ${n1Link}\n` +
        'Fetch: its details; its console logs (every row); its network requests with status 5xx only; its user events (every row). ' +
        'Then answer with only a JSON object, no prose: {"title": string, "console": {"total": number, "returned": number}, "network5xx": {"total": number, "rows": [string]}, "userEvents": {"total": number, "returned": number}, "networkFields": [string] (the field names one 5xx request carries), "has": {"requestHeaders": bool, "responseHeaders": bool, "responseBody": bool, "frameId": bool}}',
    );
    return run;
  });

  // 4. find N1 by its URL and by "parity"; folders and members
  await probe(ev, 'step4-agent (J-150)', () =>
    Promise.resolve(
      agent(
        ev,
        '4',
        scratch,
        `With the open-toolbar MCP tools: (a) find the capture at ${n1Link} by passing that URL to search; (b) search for "parity"; (c) list the folders; (d) list the workspace members. ` +
          'Answer with only a JSON object: {"byUrl": {"found": bool, "id": string, "title": string}, "parity": {"total": number, "titles": [string]}, "folders": [{"name": string, "captures": number}], "members": [{"email": string, "role": string}]}',
      ),
    ),
  );
  await probe(ev, 'step4-direct (J-150)', async () => {
    const byUrl = await tool(token, 'search', { query: n1Link });
    const byWord = await tool(token, 'search', { query: 'parity' });
    const f = await tool(token, 'list_folders', {});
    const m = await tool(token, 'list_members', {});
    const items = (j: Record<string, unknown> | null) => ((j?.items as Record<string, unknown>[] | undefined) ?? []);
    return {
      byUrl: { total: byUrl.json?.total, first: items(byUrl.json)[0] ? { id: items(byUrl.json)[0]!.id, title: items(byUrl.json)[0]!.title } : byUrl.text.slice(0, 200) },
      byWord: { total: byWord.json?.total, returned: byWord.json?.returned },
      folders: items(f.json).map((x) => `${x.name} (${x.captureCount ?? x.captures ?? '?'})`),
      members: items(m.json).map((x) => `${x.email ?? (x as { person?: { email?: string } }).person?.email} ${x.role ?? x.seat}`),
    };
  });

  // 5. the agent comments at 0:10 and renames; both show on the capture page; then undone
  const run5 = await probe(ev, 'step5-agent-write (J-151)', () =>
    Promise.resolve(
      agent(
        ev,
        '5a',
        scratch,
        `With the open-toolbar MCP tools, on the capture ${n1Link}: add the comment "agent parity check" pinned at 0:10 of the video (videoMs 10000), and set the capture's title to "parity S3.1 lab (agent)". ` +
          'Answer with only a JSON object: {"commentId": string, "videoMs": number, "title": string}',
      ),
    ),
  );
  const commentId = (run5?.json as { commentId?: string } | null)?.commentId;
  await probe(ev, 'step5-capture-page (J-151)', async () => {
    const p = await openUrl(context, `/c/${n1}`);
    const title = txt(await p.getByTestId('title').textContent().catch(() => ''));
    const item = p.locator('[data-testid="comment"]', { hasText: 'agent parity check' }).first();
    await item.waitFor({ timeout: 15_000 }).catch(() => undefined);
    const shown = (await item.count()) > 0;
    const out = { title, titleChanged: title === 'parity S3.1 lab (agent)', commentShown: shown, chip: shown ? txt(await item.getByTestId('comment-time').textContent().catch(() => '')) : null, author: shown ? txt(await item.textContent()).slice(0, 160) : null, markerOnSeekbar: await p.getByTestId('marker-comment').count() };
    await p.screenshot({ path: ev.file('5-agent-comment') });
    await p.close();
    return out;
  });
  await probe(ev, 'step5-agent-undo (J-151)', () =>
    Promise.resolve(
      agent(
        ev,
        '5b',
        scratch,
        `With the open-toolbar MCP tools, on the capture ${n1Link}: set its title back to "${n1Title}"${commentId ? ` and delete the comment with id ${commentId}` : ' and delete your comment "agent parity check"'}. Answer with only a JSON object: {"title": string, "commentDeleted": bool}`,
      ),
    ),
  );
  await probe(ev, 'step5-after-undo', async () => {
    const rec = (await api<{ title: string }>(context, 'GET', `/api/v1/recordings/${n1}`)).body;
    const comments = await tool(token, 'list_comments', { capture: n1Link });
    const left = JSON.stringify(comments.json ?? comments.text).includes('agent parity check');
    if (rec.title !== n1Title) await api(context, 'PATCH', `/api/v1/recordings/${n1}`, { title: n1Title });
    return { title: rec.title, titleBack: rec.title === n1Title, commentLeft: left };
  });

  // 6. the dev tools agent tab: shot, each preset copied, each holds N1's URL
  await probe(ev, 'step6-agent-tab (J-152)', async () => {
    const p = await openUrl(context, `/c/${n1}`);
    let clicks = 0;
    const hidden = !(await p.getByTestId('tab-agent').isVisible().catch(() => false));
    await agentTab(p);
    clicks += hidden ? 2 : 1;
    await p.screenshot({ path: ev.file('6-agent-tab') });
    const setupShown = await p.getByTestId('agent-setup').isVisible().catch(() => false);
    const presets = await p.locator('[data-testid^="preset-"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid')!.replace('preset-', ''), label: (e.textContent ?? '').trim() })));
    const copiedPrompts: Record<string, unknown> = {};
    for (const pr of presets) {
      await p.getByTestId(`preset-${pr.id}`).click();
      await sleep(200);
      await p.getByTestId('copy-prompt').click();
      await sleep(300);
      const clip = await readClipboard(p);
      copiedPrompts[pr.id] = { label: pr.label, length: clip.length, holdsN1Url: clip.includes(`/c/${n1}`) || clip.includes(n1Link), firstLine: clip.split('\n')[0]!.slice(0, 160) };
    }
    const tabText = txt(await p.getByTestId('agent-tab').textContent()).slice(0, 800);
    const copyForAi = await p.getByTestId('copy-for-ai').count();
    let copyForAiClip: unknown = null;
    if (copyForAi) {
      await p.getByTestId('copy-for-ai').first().click();
      await sleep(600);
      const c = await readClipboard(p);
      copyForAiClip = { length: c.length, head: c.slice(0, 300), holdsN1Url: c.includes(n1) || c.includes(n1Link) };
    }
    await p.close();
    return { clicksToTab: clicks, setupShown, presets, copiedPrompts, clicksPerPreset: 'tab, preset, Copy prompt = 3 (the first preset is selected at open: 2)', tabText, copyForAiButton: copyForAi, copyForAiClip };
  });
  ev.set(
    'step6-shots',
    await shoot4(ev, '6-agent-tab', ownerOpen(context, `/c/${n1}`), agentTab),
  );

  // 7. the share page as markdown: Accept header, .md suffix, the Link header
  await probe(ev, 'step7-markdown (J-153)', async () => {
    fs.mkdirSync(MD_DIR, { recursive: true });
    const accept = execFileSync('curl', ['-s', '-H', 'Accept: text/markdown', n1Link], { encoding: 'utf8' });
    const suffix = execFileSync('curl', ['-s', `${n1Link}.md`], { encoding: 'utf8' });
    const head = execFileSync('curl', ['-sI', n1Link], { encoding: 'utf8' });
    const headMd = execFileSync('curl', ['-s', '-D', '-', '-o', '/dev/null', '-H', 'Accept: text/markdown', n1Link], { encoding: 'utf8' });
    const headOnlyMd = execFileSync('curl', ['-sI', '-H', 'Accept: text/markdown', n1Link], { encoding: 'utf8' });
    const unknown = execFileSync('curl', ['-s', '-w', '\\n%{http_code}', `${SERVER}/s/not-a-real-token.md`], { encoding: 'utf8' });
    // the token in the share URL is replaced in the copy kept in git
    const tokenPart = n1Link.split('/s/')[1]!;
    const scrub = (s: string) => s.split(tokenPart).join('<share-token>');
    fs.writeFileSync(path.join(MD_DIR, 'N1-share-accept.md'), scrub(accept));
    fs.writeFileSync(path.join(MD_DIR, 'N1-share-suffix.md'), scrub(suffix));
    fs.writeFileSync(path.join(MD_DIR, 'N1-share-head.txt'), scrub(head.replace(/^(set-cookie|date):.*$/gim, '$1: <omitted>')));
    fs.writeFileSync(path.join(MD_DIR, 'N1-share-head-accept-md.txt'), scrub(headOnlyMd.replace(/^(set-cookie|date):.*$/gim, '$1: <omitted>')));
    const front = accept.match(/^---\n([\s\S]*?)\n---/);
    return {
      sameForBoth: accept === suffix,
      bytes: accept.length,
      frontMatterKeys: front ? front[1]!.split('\n').map((l) => l.split(':')[0]!.trim()).filter(Boolean) : null,
      headings: accept.split('\n').filter((l) => /^#{1,3} /.test(l)),
      countsLine: accept.split('\n').find((l) => /console|network|error/i.test(l) && /\d/.test(l) && !l.startsWith('#'))?.slice(0, 300) ?? null,
      mentionsMcp: /mcp/i.test(accept),
      mentionsCli: /\bopen-toolbar (get|console|network|frames)\b|\bCLI\b/.test(accept),
      mentionsHttpApi: /HTTP API/.test(accept),
      contentTypeMd: headMd.match(/^content-type:.*$/im)?.[0] ?? null,
      varyMd: headMd.match(/^vary:.*$/im)?.[0] ?? null,
      headRequestWithAcceptMd: headOnlyMd.match(/^content-type:.*$/im)?.[0] ?? null,
      linkHeader: head.match(/^link:.*$/im)?.[0]?.split(tokenPart).join('<share-token>') ?? null,
      htmlContentType: head.match(/^content-type:.*$/im)?.[0] ?? null,
      unknownToken: unknown.slice(-200),
      files: ['docs/parity/evidence/G8/N1-share-accept.md', 'docs/parity/evidence/G8/N1-share-suffix.md', 'docs/parity/evidence/G8/N1-share-head.txt', 'docs/parity/evidence/G8/N1-share-head-accept-md.txt'],
    };
  });

  // 8. the MCP page lists the client; remove it; the agent's next call fails
  await probe(ev, 'step8-remove (J-147)', async () => {
    const p = await openUrl(context, '/settings/mcp');
    const row = p.getByTestId('mcp-client').filter({ hasText: CLIENT_NAME });
    const listed = { count: await row.count(), text: txt(await row.first().textContent().catch(() => '')) };
    await p.screenshot({ path: ev.file('8-connected') });
    await row.first().getByTestId('mcp-client-menu').click();
    await sleep(300);
    await p.screenshot({ path: ev.file('8-row-menu') });
    await row.first().getByTestId('mcp-client-remove').click();
    await sleep(300);
    const confirmText = txt(await p.locator('dialog[open]').last().textContent().catch(() => ''));
    await p.screenshot({ path: ev.file('8-remove-confirm') });
    const c = await calm();
    const t0 = Date.now();
    await p.getByTestId('mcp-client-remove-confirm').click();
    const gone = await until(async () => (await row.count()) === 0, 10_000, 20).then((r) => r.at - t0).catch(() => null);
    await sleep(300);
    await p.screenshot({ path: ev.file('8-removed') });
    const after = await rpc(token, 'tools/list');
    await p.close();
    return { listed, confirmText, clicks: 3, rowGoneWithoutReloadMs: gone, load: c.load, nextCallStatus: after.status };
  });
  await probe(ev, 'step8-agent-after-remove', () => Promise.resolve(agent(ev, '8', scratch, `Use the open-toolbar MCP tools to fetch the details of ${n1Link}. Answer with only a JSON object: {"ok": bool, "what_happened": string}`)));
  ev.set('step8-shots', await shoot4(ev, '8-mcp-page-after', ownerOpen(context, '/settings/mcp'), settingsDrawer));

  // 9. a 30-day token with the defaults (MCP and HTTP API read only; the CLI is paused): shown
  // once with its prefix; reads work on MCP and REST, writes are refused on both
  await probe(ev, 'step9-token (J-148)', async () => {
    const p = await openUrl(context, '/settings/tokens');
    await p.getByRole('button', { name: 'Create token' }).click();
    const dlg = p.locator('dialog[open]');
    await dlg.waitFor();
    await sleep(300);
    await p.screenshot({ path: ev.file('9-create-dialog') });
    const defaults = {
      expires: await dlg.locator('select[name="expires"]').evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex]?.text ?? ''),
      cli: await dlg.locator('input[name="cli"]:checked').getAttribute('value'),
      mcp: await dlg.locator('input[name="mcp"]:checked').getAttribute('value'),
      fields: (await dlg.locator('label, legend').allTextContents()).map(txt),
    };
    const name = `parity G8 read ${Date.now().toString(36)}`;
    await dlg.getByLabel('Name').fill(name);
    await dlg.getByRole('button', { name: 'Create' }).click();
    const secretBox = p.getByTestId('token-secret');
    await secretBox.waitFor();
    await sleep(300);
    await p.screenshot({ path: ev.file('9-token-once') });
    const secret = txt(await secretBox.locator('code').textContent());
    const listRow = txt(await p.locator('li', { hasText: name }).textContent().catch(() => ''));
    await p.reload();
    await ready(p);
    const shownAfterReload = (await p.getByTestId('token-secret').count()) > 0 || (await p.locator('body').textContent())!.includes(secret);
    const prefix = secret.slice(0, 7);
    // an agent over MCP: a read and a write; then the HTTP API: a read and a write
    const read = await tool(secret, 'get_capture', { capture: n1Link });
    const write = await tool(secret, 'create_comment', { capture: n1Link, body: 'parity token write' });
    const viaMcp = await rpc(secret, 'tools/list');
    const restRead = await fetch(`${SERVER}/api/v1/recordings/${n1}`, { headers: { authorization: `Bearer ${secret}` } });
    const restWrite = await fetch(`${SERVER}/api/v1/recordings/${n1}`, { method: 'PATCH', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'parity token write' }) });
    const titleAfter = (await api<{ title: string }>(context, 'GET', `/api/v1/recordings/${n1}`)).body.title;
    // clean up: revoke it
    await p.locator('li', { hasText: name }).getByRole('button', { name: 'Revoke' }).click();
    await sleep(800);
    const revoked = (await p.locator('li', { hasText: name }).count()) === 0;
    await p.close();
    return {
      defaults,
      shownOnce: { prefix, length: secret.length, shownAfterReload },
      listRow: listRow.replace(secret, '<secret>'),
      mcpRead: { status: read.status, isError: read.isError, error: read.error, ok: !!read.json },
      mcpWrite: { status: write.status, isError: write.isError, error: write.error, text: write.text.slice(0, 200) },
      mcpSurface: { status: viaMcp.status, error: viaMcp.body?.error?.message ?? null },
      restRead: { status: restRead.status },
      restWrite: { status: restWrite.status, titleUnchanged: titleAfter === n1Title },
      revoked,
      clicks: 'Create token, Create = 2 (name typed; defaults are 30 days, MCP and HTTP API read only)',
    };
  });
  ev.set('step9-shots', await shoot4(ev, '9-tokens-page', ownerOpen(context, '/settings/tokens'), settingsDrawer));

  // the scratch folder and the token go
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.rmSync(STATE_FILE, { force: true });
  forgetNeedsAuth();
  restoreNeedsAuth();
  await page.close().catch(() => undefined);
  ev.set('load-end', load());
});

// ================================================================ S8.2

test('S8.2 CLI (paused by owner scope)', async () => {
  test.skip(true, 'Paused by owner scope (docs/scope.md, FEATURE_CLI): J-155, J-244, J-245, J-246, J-247 stay "paused".');
});

// ================================================================ S8.3

test('S8.3 shortcuts', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S8.3');
  const { context, sw } = await getRig();
  ev.set('load-start', load());
  let page = await freshLab(context);

  // 1. Ctrl+Shift+Y: the popup opens
  await probe(ev, 'step1-ctrl-shift-y (J-179)', async () => {
    await dropPopupConnection(context);
    await focusWindow(page);
    const c = await calm();
    const t0 = Date.now();
    xkey('ctrl+shift+y');
    const popup = await popupPage(context, 10_000);
    const ms = Date.now() - t0;
    const rows = await popup.locator('[data-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row')));
    await shootPopup(ev, '1-popup-by-chord', popup);
    await popup.keyboard.press('Escape').catch(() => undefined);
    await popup.close().catch(() => undefined);
    await sleep(400);
    return { opened: true, chordToReadyMs: ms, load: c.load, rows, closedAfter: !(await popupOpen(context)) };
  });

  // 2. Ctrl+Shift+S: time to the cursor pill; click the page; discard
  const pillRuns: unknown[] = [];
  for (let run = 1; run <= 3; run++) {
    const r = await probe(ev, `step2-run${run}`, async () => {
      await focusWindow(page);
      const pt = await toScreen(page, { x: 700, y: 400 });
      xmove(pt.x, pt.y);
      await sleep(300);
      const c = await calm();
      const cast = await screencast(page);
      const t0 = Date.now();
      xkey('ctrl+shift+s');
      // a person's hand rests on the mouse: the pointer moves by a pixel now and then
      let armedAt = 0;
      let pillAt = 0;
      let moves = 0;
      while (Date.now() - t0 < 5000 && !pillAt) {
        const ui = await shadowOne(page, 'data-nb-ui');
        if (!armedAt && ui?.attrs['data-session'] === 'arming-screenshot') armedAt = Date.now();
        if (armedAt && !pillAt) {
          xmove(pt.x + (moves % 2), pt.y);
          moves++;
          const pill = await shadowOne(page, 'data-nb-cursor-pill');
          if (pill?.visible) pillAt = Date.now();
        }
        await sleep(15);
      }
      await sleep(400);
      const frames = await cast.stop();
      const pill = await shadowOne(page, 'data-nb-cursor-pill');
      const region = pill ? { x: Math.max(0, pill.box.x - 4), y: Math.max(0, pill.box.y - 4), w: pill.box.w + 8, h: pill.box.h + 8 } : null;
      const veil = firstMatching(frames, t0, { x: 100, y: 100, w: 300, h: 200 });
      const pf = region ? firstMatching(frames, t0, region) : null;
      if (run === 1) ev.xshot('2-cursor-pill', { x: pt.x - 200, y: pt.y - 120, w: 500, h: 260 });
      // click the page: the editor; discard
      xclick(pt.x, pt.y);
      await editorFrame(page);
      await sleep(500);
      await closeEditor(page);
      return {
        chordToArmedDomMs: armedAt ? armedAt - t0 : null,
        chordToPillDomMs: pillAt ? pillAt - t0 : null,
        chordToVeilFrameMs: veil ? Math.round(veil.t - t0) : null,
        chordToPillFrameMs: pf ? Math.round(pf.t - t0) : null,
        pointerMovesBeforePill: moves,
        pillText: pill?.text ?? null,
        load: c.load,
        reliable: c.reliable,
        session: (await session(sw))?.state,
      };
    });
    pillRuns.push(r);
  }
  ev.set('step2-summary (J-180)', pillRuns);

  // 3. copied from G3 S3.1 steps 3 and 19
  ev.set('step3-from-S3.1 (J-181)', { chordToLive: copied('G3/S3.1.json', 'step3-chord-to-live (J-195)'), stopChordToEditor: copied('G3/S3.1.json', 'step19-stop-to-editor (J-196)') });

  // 4. instant replay on, Ctrl+Shift+X: the replay draft with no popup; time; discard; setting back
  const replayWas = await probe(ev, 'step4-replay-setting-before', () => setReplay(context, page, true));
  page = await freshLab(context);
  await xclickEl(page, page.getByTestId('works'));
  await sleep(6000);
  const replayRuns: unknown[] = [];
  for (let run = 1; run <= 3; run++) {
    replayRuns.push(
      await probe(ev, `step4-run${run}`, async () => {
        await focusWindow(page);
        const c = await calm();
        const cast = await screencast(page);
        const t0 = Date.now();
        xkey('ctrl+shift+x');
        const f = await editorFrame(page, 60_000);
        const shellAt = Date.now();
        await f.getByTestId('draft-replay').waitFor({ timeout: 60_000 });
        const loadedAt = Date.now();
        await sleep(1500);
        const frames = await cast.stop();
        const first = firstMatching(frames, t0, await editorBox(f), { ref: frames.filter((x) => x.t <= loadedAt + 1200).pop() });
        const popupShown = await popupOpen(context);
        // paused AI (docs/scope.md, FEATURE_AI off on the rig): no AI switch beside Create
        const aiSwitch = await f.getByTestId('ai-switch').count();
        if (run === 1) ev.xshot('4-replay-draft', { x: 0, y: 0, w: 1460, h: 1000 });
        await closeEditor(page);
        await sleep(3000);
        return { chordToEditorShellDomMs: shellAt - t0, chordToReplayLoadedDomMs: loadedAt - t0, chordToFirstEditorFrameMs: first ? Math.round(first.t - t0) : null, popupShown, aiSwitch, load: c.load, reliable: c.reliable };
      }),
    );
  }
  ev.set('step4-summary (J-182)', replayRuns);
  if (replayWas === false) await probe(ev, 'step4-replay-setting-restored', async () => (await setReplay(context, page, false), 'off'));

  // 5. popup settings, the shortcuts link: chrome://extensions/shortcuts in a new tab
  await probe(ev, 'step5-shortcuts-page (J-184)', async () => {
    const popup = await openExtSettings(context, page);
    const before = context.pages().length;
    const opened = context.waitForEvent('page', { timeout: 15_000 });
    await xclickPopup(popup, '[data-open-shortcuts]');
    const sp = await opened;
    await sp.waitForLoadState('domcontentloaded');
    await sleep(1500);
    const url = sp.url();
    await sp.screenshot({ path: ev.file('5-shortcuts-page') });
    const rows2 = await shortcutRows(sp);
    // one scope menu, open (a native menu: shot from the X screen)
    let scopeShot = false;
    const sel = sp.locator('.command-entry select').first();
    if (await sel.count()) {
      await focusWindow(sp);
      await xclickEl(sp, sel);
      await sleep(700);
      ev.xshot('5-scope-menu', { x: 0, y: 0, w: 1460, h: 1000 });
      xkey('Escape');
      scopeShot = true;
    }
    return { clicks: 'icon, menu, Settings, Change = 4 (the menu item "Keyboard shortcuts" = 3)', newTab: context.pages().length > before, url, rows: rows2, scopeShot };
  });

  // rebind "Take a screenshot" to Alt+Shift+S, check it works and the tooltip shows it, set back
  await probe(ev, 'step5-rebind (J-184)', async () => {
    const sp = context.pages().find((p) => p.url().startsWith('chrome://extensions/shortcuts')) ?? (await (async () => {
      const p = await context.newPage();
      await p.goto('chrome://extensions/shortcuts');
      return p;
    })());
    const row = sp.locator('.command-entry', { hasText: 'Take a screenshot' });
    const value = async () => (await shortcutRows(sp)).find((r) => r.name === 'Take a screenshot')?.value ?? '';
    const rebind = async (chord: string) => {
      await focusWindow(sp);
      await xclickEl(sp, row.locator('#edit, [aria-label*="dit"]').first());
      await sleep(400);
      xkey(chord);
      await sleep(600);
      xkey('Escape');
      await sleep(300);
      return value();
    };
    const before = await value();
    const newVal = await rebind('alt+shift+s');
    await sp.screenshot({ path: ev.file('5-rebound') });
    const commands = await (await sw()).evaluate(async () => (await chrome.commands.getAll()).map((c) => `${c.name}=${c.shortcut}`));
    // the new chord arms screenshot mode on the lab
    await focusWindow(page);
    xkey('alt+shift+s');
    const armed = await until(async () => (await shadowOne(page, 'data-nb-ui'))?.attrs['data-session'] === 'arming-screenshot', 5000).then(() => true).catch(() => false);
    xkey('Escape');
    await sleep(500);
    // the popup tooltip on the screenshot row
    const popup = await clickIcon(context, page);
    const r = (await popup.locator('[data-row="screenshot"] .row').boundingBox())!;
    const o = await popupBox(popup);
    xmove(o.x + r.x + r.width / 2, o.y + r.y + r.height / 2);
    const tip = await popup.locator('[data-row-tip]').first().waitFor({ timeout: 5000 }).then(async () => txt(await popup.locator('[data-row-tip]').first().textContent())).catch(() => null);
    await shootPopup(ev, '5-tooltip-rebound', popup);
    await popup.close().catch(() => undefined);
    // back to Ctrl+Shift+S
    const restored = await rebind('ctrl+shift+s');
    const after = await (await sw()).evaluate(async () => (await chrome.commands.getAll()).find((c) => c.name === 'screenshot-mode')?.shortcut);
    await sp.close().catch(() => undefined);
    return { before, newVal, commands, newChordArms: armed, tooltip: tip, restored, after };
  });
  ev.set('load-end', load());
});

/** Each command row of chrome://extensions/shortcuts: name, chord and scope, read through the open shadow roots. */
async function shortcutRows(sp: Page) {
  return sp.locator('.command-entry').evaluateAll((els) =>
    els.map((e) => {
      const texts: string[] = [];
      const walk = (n: Element | ShadowRoot) => {
        for (const c of n.children) {
          if (c instanceof HTMLInputElement && c.value) texts.push(c.value);
          else if (!c.children.length && !c.shadowRoot && /^(Ctrl|Alt|Shift|Not set)/.test((c.textContent ?? '').trim())) texts.push((c.textContent ?? '').trim());
          if (c.shadowRoot) walk(c.shadowRoot);
          walk(c);
        }
      };
      walk(e);
      const sel = e.querySelector('select') as HTMLSelectElement | null;
      return { name: (e.querySelector('.command-name')?.textContent ?? '').trim(), value: texts.find((t) => t !== (sel?.value ?? '')) ?? '', scope: sel ? (sel.options[sel.selectedIndex]?.text ?? '') : '', scopeDisabled: sel?.disabled ?? null, scopes: sel ? [...sel.options].map((o) => o.text) : [] };
    }),
  );
}

// ================================================================ S8.4

test('S8.4 speed', async () => {
  test.setTimeout(2_400_000);
  const ev = new Evidence(GROUP, 'S8.4');
  ev.set('load-start', load());
  // a browser of its own on a kept profile, so the cold open is the first open after a start
  await closeRig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-parity-g8-cold-'));
  let b: Launched | null = await launchExtension({ userDataDir: dir });
  try {
    const { popup } = await signIn(b.context, EMAIL);
    await popup.close().catch(() => undefined);
    await sleep(2000);
    await b.close();
    b = null;
    await sleep(3000);

    /** Icon click to the popup's first paint (header and spinner) and to its last content paint. */
    const popupTiming = async (bb: Launched, page: Page) => {
      await dropPopupConnection(bb.context);
      await focusWindow(page);
      const p = await iconPoint(page);
      xmove(p.x, p.y);
      await sleep(200);
      const c = await calm();
      const t0 = Date.now();
      xdo('click', '1');
      const popup = await popupPage(bb.context);
      const attachedAt = Date.now();
      const perf = await popup.evaluate(async () => {
        const lcp: { t: number; tag: string; text: string }[] = [];
        await new Promise<void>((r) => {
          try {
            new PerformanceObserver((l) => {
              for (const e of l.getEntries() as (PerformanceEntry & { renderTime?: number; element?: Element })[]) lcp.push({ t: e.renderTime || e.startTime, tag: e.element?.tagName ?? '', text: (e.element?.textContent ?? '').trim().slice(0, 40) });
            }).observe({ type: 'largest-contentful-paint', buffered: true });
          } catch {
            /* none */
          }
          setTimeout(r, 400);
        });
        return {
          origin: performance.timeOrigin,
          paint: performance.getEntriesByType('paint').map((e) => ({ name: e.name, t: e.startTime })),
          lcp,
          rows: document.querySelectorAll('[data-row]').length,
        };
      });
      const fcp = perf.paint.find((x) => x.name === 'first-contentful-paint')?.t;
      const last = perf.lcp.length ? perf.lcp[perf.lcp.length - 1]!.t : null;
      await popup.close().catch(() => undefined);
      await sleep(600);
      return {
        clickToDocumentMs: Math.round(perf.origin - t0),
        clickToFirstPaintMs: fcp != null ? Math.round(perf.origin + fcp - t0) : null,
        clickToFullContentMs: last != null ? Math.round(perf.origin + last - t0) : null,
        clickToReadyAttachedMs: attachedAt - t0,
        lcp: perf.lcp.map((x) => ({ ms: Math.round(perf.origin + x.t - t0), el: `${x.tag} ${x.text}` })),
        rows: perf.rows,
        load: c.load,
        reliable: c.reliable,
      };
    };

    // J-193: cold, then three warm
    b = await launchExtension({ userDataDir: dir });
    const page = await (async () => {
      const pg = b!.context.pages()[0] ?? (await b!.context.newPage());
      await pg.goto(LAB_URL + '/');
      await pg.waitForLoadState('networkidle');
      return pg;
    })();
    await sleep(1500);
    await probe(ev, 'J-193-cold', () => popupTiming(b!, page));
    const warm: unknown[] = [];
    for (let i = 1; i <= 3; i++) warm.push(await probe(ev, `J-193-warm${i}`, () => popupTiming(b!, page)));

    // J-194: screenshot click to editor on `/`
    for (let i = 1; i <= 3; i++)
      await probe(ev, `J-194-screenshot-click${i}`, async () => {
        const popup = await clickIcon(b!.context, page);
        await xclickPopup(popup, '[data-row-main="screenshot"]');
        await until(async () => (await shadowOne(page, 'data-nb-ui'))?.attrs['data-session'] === 'arming-screenshot', 10_000);
        const pt = await toScreen(page, { x: 1200, y: 600 });
        xmove(pt.x, pt.y);
        await sleep(400);
        const c = await calm();
        const cast = await screencast(page);
        const t0 = Date.now();
        xdo('click', '1');
        const f = await editorFrame(page);
        const domAt = Date.now();
        await sleep(1500);
        const frames = await cast.stop();
        const first = firstMatching(frames, t0, await editorBox(f), { ref: frames.filter((x) => x.t <= domAt + 1200).pop() });
        await closeEditor(page);
        return { frameMs: first ? Math.round(first.t - t0) : null, domMs: domAt - t0, load: c.load, reliable: c.reliable };
      });
    // area drag release to editor
    for (let i = 1; i <= 3; i++)
      await probe(ev, `J-194-area-release${i}`, async () => {
        const popup = await clickIcon(b!.context, page);
        await xclickPopup(popup, '[data-row-main="screenshot"]');
        await until(async () => (await shadowOne(page, 'data-nb-ui'))?.attrs['data-session'] === 'arming-screenshot', 10_000);
        const a = await toScreen(page, { x: 200, y: 150 });
        const z = await toScreen(page, { x: 800, y: 450 });
        await xdrag(a, z, { hold: true, steps: 15 });
        await sleep(300);
        const c = await calm();
        const cast = await screencast(page);
        const t0 = Date.now();
        xup();
        const f = await editorFrame(page);
        const domAt = Date.now();
        await sleep(1500);
        const frames = await cast.stop();
        const first = firstMatching(frames, t0, await editorBox(f), { ref: frames.filter((x) => x.t <= domAt + 1200).pop() });
        await closeEditor(page);
        return { frameMs: first ? Math.round(first.t - t0) : null, domMs: domAt - t0, load: c.load, reliable: c.reliable };
      });
    // replay key to editor shell and to loaded
    const replayWas = await probe(ev, 'J-194-replay-setting-before', () => setReplay(b!.context, page, true));
    await page.reload();
    await page.waitForLoadState('networkidle');
    await xclickEl(page, page.getByTestId('works'));
    await sleep(6000);
    for (let i = 1; i <= 3; i++)
      await probe(ev, `J-194-replay-key${i}`, async () => {
        await focusWindow(page);
        const c = await calm();
        const cast = await screencast(page);
        const t0 = Date.now();
        xkey('ctrl+shift+x');
        const f = await editorFrame(page, 60_000);
        const shellAt = Date.now();
        await f.getByTestId('draft-replay').waitFor({ timeout: 60_000 });
        const loadedAt = Date.now();
        await sleep(1500);
        const frames = await cast.stop();
        const first = firstMatching(frames, t0, await editorBox(f), { ref: frames.filter((x) => x.t <= loadedAt + 1200).pop() });
        await closeEditor(page);
        await sleep(3000);
        return { shellDomMs: shellAt - t0, loadedDomMs: loadedAt - t0, firstEditorFrameMs: first ? Math.round(first.t - t0) : null, load: c.load, reliable: c.reliable };
      });
    if (replayWas === false) await probe(ev, 'J-194-replay-setting-restored', async () => (await setReplay(b!.context, page, false), 'off'));
  } finally {
    await b?.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }

  // J-195 to J-198 come from the recordings and captures of earlier groups
  ev.set('J-195-from', { 'S1.2 step 1': copied('G1/S1.2.json', 'step1-key-to-live (J-195)'), 'S3.1 step 3': copied('G3/S3.1.json', 'step3-chord-to-live (J-195)') });
  ev.set('J-196-from', { 'S1.2 step 13': copied('G1/S1.2.json', 'step13-stop-to-editor (J-196)'), 'S1.3 step 6': copied('G1/S1.3.json', 'step6-stop-to-editor (J-196)'), 'S3.1 step 19': copied('G3/S3.1.json', 'step19-stop-to-editor (J-196)') });
  ev.set('J-197-from', { 'S2.1 step 21': copied('G2/S2.1.json', 'step21-create (J-086, J-197)'), 'S2.2': copied('G2/S2.2.json', 'kept-capture'), 'S2.4 step 9': copied('G2/S2.4.json', 'step9-create (J-086, J-087, J-197)'), 'S3.1 step 19': copied('G3/S3.1.json', 'capture') });
  ev.set('J-198-from', { 'S5.1 step 4': copied('G5/S5.1.json', 'step4-signed-out-load (J-198)') });
  ev.set('load-end', load());
});

// ================================================================ S8.5

test('S8.5 errors and empty states', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S8.5');
  const { context, sw } = await getRig();
  ev.set('load-start', load());

  // 1. chrome://extensions: the restricted-page popup; Ctrl+Shift+S does nothing
  await probe(ev, 'step1-restricted (J-199)', async () => {
    const page = await context.newPage();
    for (const other of context.pages()) if (other !== page) await other.close().catch(() => undefined);
    await page.goto('chrome://extensions');
    await sleep(1500);
    await focusWindow(page);
    const popup = await clickIcon(context, page);
    const restricted = await popup.locator('[data-screen="restricted"]').count();
    const text = txt(await popup.locator('[data-popup]').textContent());
    const rows = await popup.locator('[data-row]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-row')}${e.getAttribute('aria-disabled') === 'true' ? ' (disabled)' : ''}`));
    await shootPopup(ev, '1-restricted-popup', popup);
    await popup.keyboard.press('Escape').catch(() => undefined);
    await popup.close().catch(() => undefined);
    await sleep(500);
    const pagesBefore = context.pages().length;
    const before = (await session(sw))?.state;
    await focusWindow(page);
    xkey('ctrl+shift+s');
    await sleep(2500);
    const after = (await session(sw))?.state;
    ev.xshot('1-after-chord', { x: 0, y: 0, w: 1460, h: 1000 });
    const out = { restrictedScreen: restricted > 0, popupText: text.slice(0, 400), rows, chord: { sessionBefore: before, sessionAfter: after, newTabs: context.pages().length - pagesBefore, popupOpened: await popupOpen(context) } };
    await page.goto(LAB_URL + '/');
    return out;
  });

  // 2 and 3. copied from G1 S1.2 step 2, G6 S6.3 step 3 and G2 S2.1 step 22
  ev.set('step2-from (J-200)', { 'S1.2 step 2 mic': copied('G1/S1.2.json', 'step2-mic'), 'S6.3 step 3': copied('G6/S6.3.json', 'step3-4-recipient') });
  ev.set('step3-from (J-202)', copied('G2/S2.1.json', 'step22-clipboard-prompt (J-202)'));

  // 4. an empty folder "parity-empty": heading, help line, make-a-capture button; then deleted
  const ws = await activateN1Workspace(context);
  const page = await openUrl(context, '/');
  const folderKey = await probe(ev, 'step4-make-folder', async () => {
    const wsId = ws.workspaceId!;
    // a folder of that name left by an earlier run goes first
    const list = (await api<{ items?: { id: string; name: string }[] } | { id: string; name: string }[]>(context, 'GET', `/api/v1/workspaces/${wsId}/folders`)).body;
    for (const f of Array.isArray(list) ? list : (list.items ?? [])) if (f.name === 'parity-empty') await api(context, 'DELETE', `/api/v1/folders/${f.id}`);
    await page.reload();
    await ready(page);
    await page.getByTestId('folders-heading').hover();
    await sleep(300);
    await page.getByTestId('new-folder').click();
    const input = page.getByTestId('new-folder-input');
    await input.waitFor();
    await sleep(200);
    if (!(await input.evaluate((e) => document.activeElement === e))) await input.click();
    await page.keyboard.type('parity-empty', { delay: 40 });
    await page.keyboard.press('Enter');
    await waitToast(page, /Folder "parity-empty" created/);
    await page.getByTestId('folder-list').getByRole('link', { name: 'parity-empty', exact: true }).click();
    await page.waitForURL(/\/f\//);
    await ready(page);
    const key = new URL(page.url()).pathname.split('/')[2]!;
    const empty = page.getByTestId('folder-empty');
    await empty.waitFor({ timeout: 10_000 }).catch(() => undefined);
    return {
      key,
      title: txt(await page.getByTestId('folder-title').textContent().catch(() => '')),
      headings: (await empty.locator('h1, h2, h3').allTextContents()).map(txt),
      paragraphs: (await empty.locator('p').allTextContents()).map(txt).filter(Boolean).slice(0, 6),
      buttons: (await empty.locator('button, a').allTextContents()).map(txt).filter(Boolean).slice(0, 12),
      box: await empty.boundingBox(),
      clicksToFolder: 'hover the heading, plus, type, Enter, then the folder = 2 clicks',
      filterBar: await page.getByTestId('filter-bar').count().catch(() => 0),
    };
  });
  if (folderKey?.key) {
    ev.set('step4-shots', await shoot4(ev, '4-empty-folder', ownerOpen(context, `/f/${folderKey.key}`)));
    await probe(ev, 'step4-delete', async () => {
      if (txt(await page.getByTestId('folder-title').textContent().catch(() => '')) !== 'parity-empty') throw new Error('not on parity-empty; delete skipped');
      await page.getByTestId('folder-menu').click();
      await page.getByTestId('folder-delete').click();
      await page.getByTestId('confirm-dialog').waitFor();
      const warning = txt(await page.getByTestId('confirm-dialog').textContent());
      await page.getByTestId('confirm-button').click();
      const toast = await waitToast(page, /Deleted "parity-empty"/);
      await page.waitForURL((u) => !u.pathname.startsWith('/f/'), { timeout: 5000 }).catch(() => undefined);
      const left = (await api<{ items?: { name: string }[] } | { name: string }[]>(context, 'GET', `/api/v1/workspaces/${ws.workspaceId}/folders`)).body;
      return { warning, ...toast, landed: page.url().replace(SERVER, ''), stillListed: (Array.isArray(left) ? left : (left.items ?? [])).some((f) => f.name === 'parity-empty') };
    });
  }

  // 5. N7 (deleted in S7.4) and a made-up capture URL: one not-found line
  const notFound = async (url: string) => {
    const p = await openUrl(context, url);
    const r = { url: url.replace(SERVER, ''), title: await p.title(), visibleText: txt(await p.locator('body').innerText()).slice(0, 300), headings: (await p.locator('h1, h2').allTextContents()).map(txt) };
    await p.close();
    return r;
  };
  const n7 = N7();
  const fake = randomUUID();
  await probe(ev, 'step5-n7 (J-205)', async () => {
    const s = await context.request.get(`${SERVER}/c/${n7}`, { maxRedirects: 0, failOnStatusCode: false });
    return { ...(await notFound(`/c/${n7}`)), status: s.status() };
  });
  ev.set('step5-n7-shots', await shoot4(ev, '5-n7-not-found', ownerOpen(context, `/c/${n7}`)));
  await probe(ev, 'step5-made-up (J-205)', async () => ({ ...(await notFound(`/c/${fake}`)), id: fake, status: (await context.request.get(`${SERVER}/c/${fake}`, { maxRedirects: 0, failOnStatusCode: false })).status() }));
  ev.set('step5-made-up-shots', await shoot4(ev, '5-made-up-not-found', ownerOpen(context, `/c/${fake}`)));
  await page.close().catch(() => undefined);
  ev.set('load-end', load());
});
