// Flow J: hand a capture to a coding agent. Settings, MCP page, the Claude Code card and its
// snippet; the first MCP use registers a client and opens the consent page, one approve click;
// the agent reads the capture and its failing request. With FLOWS_CLAUDE=1 a real Claude Code
// run (a throwaway --mcp-config, nothing written to the user's agent settings) fetches it too.
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SERVER, expect, hydrated, test } from './fixture.ts';
import { recordLabErrors } from './journeys.ts';

const b64 = (b: Buffer) => b.toString('base64url');
const REDIRECT = 'http://127.0.0.1:47123/callback';

test('J: MCP page snippet, consent in one click, the agent reads the capture and the 500', async ({ tb, context }) => {
  const video = await recordLabErrors(tb);
  const page = await context.newPage();
  await page.goto(`${SERVER}/settings`);
  await hydrated(page);
  await page.getByRole('link', { name: 'MCP', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/mcp$/);
  await page.getByTestId('agent-card-claude-code').click();
  await expect(page.getByTestId('setup-snippet')).toHaveText(`claude mcp add --transport http open-toolbar ${SERVER}/mcp`);
  await page.getByRole('button', { name: 'Done' }).click();

  // what the agent does on its first call
  const first = await page.request.post(`${SERVER}/mcp`, { data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, failOnStatusCode: false });
  expect(first.status()).toBe(401);
  const metaUrl = /resource_metadata="([^"]+)"/.exec(first.headers()['www-authenticate'] ?? '')![1]!;
  const resource = (await (await page.request.get(metaUrl)).json()) as { authorization_servers: string[] };
  const as = (await (await page.request.get(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
  const client = `Flows agent ${Date.now().toString(36)}`;
  const reg = (await (await page.request.post(as.registration_endpoint!, { data: { client_name: client, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' } })).json()) as { client_id: string };
  const verifier = b64(randomBytes(40));
  const auth = new URL(as.authorization_endpoint!);
  auth.search = new URLSearchParams({
    response_type: 'code',
    client_id: reg.client_id,
    redirect_uri: REDIRECT,
    code_challenge: b64(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    state: 'flows',
    scope: 'captures:read captures:write',
  }).toString();
  let callback = '';
  await page.route('http://127.0.0.1:47123/**', async (route) => {
    callback = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  await page.goto(auth.toString());
  await hydrated(page);
  await expect(page.getByTestId('mcp-client-name')).toHaveText(client);
  await page.getByTestId('mcp-approve').click(); // the one approve click
  await expect.poll(() => callback).toContain('code=');
  const tok = await page.request.post(as.token_endpoint!, {
    form: { grant_type: 'authorization_code', code: new URL(callback).searchParams.get('code')!, client_id: reg.client_id, code_verifier: verifier, redirect_uri: REDIRECT },
  });
  expect(tok.status()).toBe(200);
  const access = ((await tok.json()) as { access_token: string }).access_token;

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await page.request.post(`${SERVER}/mcp`, {
      headers: { authorization: `Bearer ${access}`, accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } },
    });
    const j = (await r.json()) as { result?: { content: { type: string; text?: string }[]; isError?: boolean }; error?: unknown };
    expect(j.result, JSON.stringify(j).slice(0, 400)).toBeTruthy();
    return j.result!.content.map((c) => c.text ?? '').join('\n');
  };
  const details = await call('get_capture', { capture: video.shareUrl, intent: 'flows e2e' });
  expect(details).toContain(video.title);
  const failing = await call('get_network_requests', { capture: video.id, status: ['5xx'] });
  expect(failing).toContain('/api/fail');
  expect(failing).toContain('database_unavailable');
  const errors = await call('get_console_logs', { capture: video.id, levels: ['error'] });
  expect(errors.length).toBeGreaterThan(0);

  // the connected agent shows on the MCP page
  await page.goto(`${SERVER}/settings/mcp`);
  await hydrated(page);
  await expect(page.getByTestId('mcp-client').filter({ hasText: client })).toHaveCount(1);

  if (process.env.FLOWS_CLAUDE === '1') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-claude-'));
    const cfg = path.join(dir, 'mcp.json');
    // the token goes in a file only this run reads; it is revoked below
    fs.writeFileSync(cfg, JSON.stringify({ mcpServers: { 'open-toolbar': { type: 'http', url: `${SERVER}/mcp`, headers: { Authorization: `Bearer ${access}` } } } }), { mode: 0o600 });
    const out = execFileSync(
      'claude',
      [
        '-p',
        `Use the open-toolbar MCP tools. Call get_network_requests for the capture ${video.shareUrl} with status ["5xx"]. Reply with one line: the failing request's path and the "error" field of its JSON response body.`,
        '--mcp-config',
        cfg,
        '--strict-mcp-config',
        '--allowedTools',
        'mcp__open-toolbar__get_network_requests,mcp__open-toolbar__get_capture',
        '--output-format',
        'text',
      ],
      { cwd: dir, encoding: 'utf8', timeout: 240_000 },
    );
    console.log('J: Claude Code answered:', out.trim());
    expect(out).toContain('/api/fail');
    expect(out).toContain('database_unavailable');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // remove the agent: its token stops working at once
  const row = page.getByTestId('mcp-client').filter({ hasText: client });
  await row.getByTestId('mcp-client-menu').click();
  await row.getByTestId('mcp-client-remove').click();
  await page.getByTestId('mcp-client-remove-confirm').click();
  await expect(row).toHaveCount(0);
  await page.close();
});
