// Agent area e2e against the area server (SERVER_URL) with the seed data: setup page (J-145),
// OAuth consent with DCR and PKCE (J-146), connected agents and removal (J-147), the CLI page
// and install routes (J-155), and the markdown summary (J-153). Runs headed on E2E_DISPLAY.
import { createHash, randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, chromium, type Browser, type Page } from '@playwright/test';
import { SERVER, hydrated, signInWithPassword } from '../auth/helpers.ts';
import { skipUnlessFeature } from '../../fixtures/features.ts';

const DANA = { email: 'dana@toolbar.test', password: 'toolbar-dev-password' };
const SHARE_C3 = process.env.AGENT_SHARE_TOKEN ?? 'SFq1xBEGwjZnpQ2jmqx2-g';
const b64 = (b: Buffer) => b.toString('base64url');
const REDIRECT = 'http://127.0.0.1:47111/callback';
const CLIENT = `E2E Agent ${Date.now().toString(36)}`;

let browser: Browser;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  browser = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY: process.env.E2E_DISPLAY ?? ':117' } });
  page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await signInWithPassword(page, DANA.email, DANA.password);
});

test.afterAll(async () => {
  await browser?.close();
});

test('J-145 MCP page: one card per agent, snippets hold only the server URL', async () => {
  await page.goto(`${SERVER}/settings`);
  await hydrated(page);
  await page.getByRole('link', { name: 'MCP', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/mcp$/);
  await expect(page.getByTestId('mcp-server-url')).toHaveText(`${SERVER}/mcp`);
  for (const id of ['claude-code', 'cursor', 'codex', 'vscode', 'other']) await expect(page.getByTestId(`agent-card-${id}`)).toBeVisible();
  await page.getByTestId('agent-card-claude-code').click();
  const snippet = page.getByTestId('setup-snippet');
  await expect(snippet).toHaveText(`claude mcp add --transport http open-toolbar ${SERVER}/mcp`);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId('agent-card-cursor').click();
  await expect(snippet).toContainText(`"url": "${SERVER}/mcp"`);
  await expect(snippet).not.toContainText('tb_');
  await page.getByRole('button', { name: 'Done' }).click();
});

let accessToken = '';

test('J-146 first MCP use: DCR, consent with workspace picker and two scopes, PKCE exchange, tools list', async () => {
  // what an MCP client does on its first call
  const first = await page.request.post(`${SERVER}/mcp`, { data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
  expect(first.status()).toBe(401);
  const metaUrl = /resource_metadata="([^"]+)"/.exec(first.headers()['www-authenticate'] ?? '')![1]!;
  const resource = (await (await page.request.get(metaUrl)).json()) as { authorization_servers: string[] };
  const as = (await (await page.request.get(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
  const reg = (await (await page.request.post(as.registration_endpoint!, { data: { client_name: CLIENT, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' } })).json()) as { client_id: string };
  const verifier = b64(randomBytes(40));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  const auth = new URL(as.authorization_endpoint!);
  auth.search = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', scope: 'captures:read captures:write' }).toString();

  // the browser half: one approve click with a live session
  let callback = '';
  await page.route('http://127.0.0.1:47111/**', async (route) => {
    callback = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  await page.goto(auth.toString());
  await hydrated(page);
  await expect(page.getByTestId('mcp-client-name')).toHaveText(CLIENT);
  await expect(page.getByTestId('mcp-workspace')).toHaveValue(/.+/);
  await expect(page.getByTestId('mcp-workspace').locator('option')).toContainText(['Lab shop']);
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await page.getByTestId('mcp-approve').click();
  await expect.poll(() => callback).toContain('code=');
  const cb = new URL(callback);
  expect(cb.searchParams.get('state')).toBe('xyz');
  expect(cb.searchParams.get('iss')).toBe(SERVER);

  const tok = await page.request.post(as.token_endpoint!, {
    form: { grant_type: 'authorization_code', code: cb.searchParams.get('code')!, client_id: reg.client_id, code_verifier: verifier, redirect_uri: REDIRECT },
  });
  expect(tok.status()).toBe(200);
  accessToken = ((await tok.json()) as { access_token: string }).access_token;
  const list = await page.request.post(`${SERVER}/mcp`, { headers: { authorization: `Bearer ${accessToken}` }, data: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  const tools = ((await list.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
  expect(tools).toEqual(expect.arrayContaining(['get_capture', 'get_network_requests', 'create_comment']));
});

test('J-147 connected agents: listed after connecting; remove revokes at once', async () => {
  await page.goto(`${SERVER}/settings/mcp`);
  await hydrated(page);
  const row = page.getByTestId('mcp-client').filter({ hasText: CLIENT });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Lab shop');
  await row.getByTestId('mcp-client-menu').click();
  await row.getByTestId('mcp-client-remove').click();
  await page.getByTestId('mcp-client-remove-confirm').click();
  await expect(row).toHaveCount(0);
  const after = await page.request.post(`${SERVER}/mcp`, { headers: { authorization: `Bearer ${accessToken}` }, data: { jsonrpc: '2.0', id: 3, method: 'tools/list' } });
  expect(after.status()).toBe(401);
});

test('J-155 CLI page: install, sign in and skill commands; install routes serve', async () => {
  await skipUnlessFeature(test, 'cli');
  await page.goto(`${SERVER}/settings/cli`);
  await hydrated(page);
  await expect(page.getByTestId('cli-install')).toHaveText(`curl -fsSL ${SERVER}/cli/install.sh | sh`);
  await expect(page.getByTestId('cli-login')).toHaveText(`open-toolbar login --server ${SERVER}`);
  await expect(page.getByTestId('cli-skill')).toHaveText('open-toolbar skill install');
  await page.getByRole('tab', { name: 'Windows' }).click();
  await expect(page.getByTestId('cli-install')).toHaveText(`irm ${SERVER}/cli/install.ps1 | iex`);
  const sh = await page.request.get(`${SERVER}/cli/install.sh`);
  expect(await sh.text()).toContain(`${SERVER}/cli/open-toolbar.mjs`);
  const bundle = await page.request.get(`${SERVER}/cli/open-toolbar.mjs`);
  if (bundle.status() === 200) expect((await bundle.text()).startsWith('#!/usr/bin/env node')).toBe(true);
});

const CLI = new URL('../../../packages/cli/dist/open-toolbar.mjs', import.meta.url).pathname;

test('J-155 open-toolbar login through the browser, then open-toolbar ls lists captures', async () => {
  await skipUnlessFeature(test, 'cli');
  test.skip(!existsSync(CLI), 'build the CLI first: pnpm --filter @toolbar/cli build');
  const env = { ...process.env, TOOLBAR_CONFIG: join(mkdtempSync(join(tmpdir(), 'tb-e2e-')), 'config.json'), TOOLBAR_TOKEN: '', TOOLBAR_SERVER: '' };
  const child = spawn(process.execPath, [CLI, 'login', '--server', SERVER, '--no-open'], { env });
  let err = '';
  let out = '';
  child.stderr.on('data', (d) => (err += d));
  child.stdout.on('data', (d) => (out += d));
  const exited = new Promise<number>((r) => child.on('exit', (c) => r(c ?? 1)));
  await expect.poll(() => /https?:\/\/\S+\/mcp\/authorize\S+/.exec(err)?.[0] ?? '', { timeout: 15_000 }).not.toBe('');
  const url = /https?:\/\/\S+\/mcp\/authorize\S+/.exec(err)![0];
  await page.goto(url);
  await hydrated(page);
  await expect(page.getByTestId('mcp-client-name')).toContainText('open-toolbar CLI on');
  await page.getByTestId('mcp-approve').click();
  await expect(page.getByText('Signed in. You can close this tab')).toBeVisible();
  expect(await exited).toBe(0);
  expect(JSON.parse(out)).toMatchObject({ signedIn: true, as: DANA.email, via: 'oauth' });
  const ls = JSON.parse(execFileSync(process.execPath, [CLI, 'ls'], { env, encoding: 'utf8' })) as { items: { title: string }[]; total: number };
  expect(ls.total).toBeGreaterThanOrEqual(3);
  expect(ls.items.map((i) => i.title)).toContain('Submit order does nothing');
});

test('J-148 read-only CLI key: 30 days, shown once with its prefix, reads work and a write is refused', async () => {
  await skipUnlessFeature(test, 'cli');
  test.skip(!existsSync(CLI), 'build the CLI first: pnpm --filter @toolbar/cli build');
  await page.goto(`${SERVER}/settings/tokens`);
  await hydrated(page);
  await page.getByRole('button', { name: 'Create token' }).click();
  const name = `E2E read key ${Date.now().toString(36)}`;
  await page.getByLabel('Name').fill(name);
  await expect(page.getByLabel('Expires')).toHaveValue('30');
  await expect(page.locator('input[name="cli"][value="read"]')).toBeChecked();
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const secret = (await page.getByTestId('token-secret').locator('code').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^tb_pat_/);
  await page.reload();
  await hydrated(page);
  await expect(page.getByTestId('token-secret')).toHaveCount(0);
  await expect(page.getByText(name)).toBeVisible();

  const env = { ...process.env, TOOLBAR_CONFIG: join(mkdtempSync(join(tmpdir(), 'tb-e2e-')), 'config.json'), TOOLBAR_TOKEN: secret, TOOLBAR_SERVER: SERVER };
  const ls = JSON.parse(execFileSync(process.execPath, [CLI, 'ls'], { env, encoding: 'utf8' })) as { total: number };
  expect(ls.total).toBeGreaterThanOrEqual(3);
  let refused = '';
  try {
    execFileSync(process.execPath, [CLI, 'comment', '019a0000-0000-7000-8000-0000000000c3', 'should not land'], { env, encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    refused = String((e as { stderr?: string }).stderr ?? e);
  }
  expect(refused).toMatch(/read|scope|not allowed|refused|forbidden/i);
});

test('J-153 markdown summary for plain fetches, and the Link header on the HTML', async () => {
  const md = await page.request.get(`${SERVER}/s/${SHARE_C3}.md`, { headers: { cookie: '' } });
  expect(md.headers()['content-type']).toContain('text/markdown');
  const text = await md.text();
  // Part 2 (PLAN "Hand-off to the agent", D-142): the first line pulls the feedback folder; the
  // rest is a summary for link holders, with the title fenced as captured text and no comments.
  expect(text.split('\n')[0]).toMatch(/^curl -fsSL -H "Authorization: Bearer \$TOOLBAR_TOKEN" "[^"]+\/api\/v1\/recordings\/[0-9a-f-]{36}\/folder" \| tar xz$/);
  expect(text).toContain('```text captured source="title" author="Sam Developer"\nDetails form rejects valid input\n```');
  expect(text).toContain('Signals:');
  expect(text).not.toContain('## Comments');
  expect(text).toContain(`${SERVER}/mcp`);
  const neg = await page.request.get(`${SERVER}/s/${SHARE_C3}`, { headers: { accept: 'text/markdown' } });
  expect(await neg.text()).toBe(text);
  // signed out, as a plain fetch is (a member is sent on to /c/<id> instead)
  const html = await page.request.get(`${SERVER}/s/${SHARE_C3}`, { headers: { accept: 'text/html', cookie: '' }, maxRedirects: 0, failOnStatusCode: false });
  expect(html.headers()['link']).toContain(`<${SERVER}/s/${SHARE_C3}.md>; rel="alternate"; type="text/markdown"`);
  const missing = await page.request.get(`${SERVER}/s/AAAAAAAAAAAAAAAAAAAAAA.md`, { failOnStatusCode: false });
  expect(missing.status()).toBe(404);
});
