// J-152 and J-151 on the viewer's capture page (the viewer mounts lib/components/agent/AgentTab.svelte
// through AgentSlot.svelte). Sam starts with no connected agent: the tab shows the setup prompt; after
// Sam approves an agent the presets carry the capture URL. Then that agent comments at a video time
// and reacts, and the capture page shows the time chip and the reaction. Link viewers get the setup
// prompt with the share URL.
import { createHash, randomBytes } from 'node:crypto';
import { expect, test, chromium, type Page } from '@playwright/test';
import { SERVER, hydrated, signInWithPassword } from '../auth/helpers.ts';

const C1 = '019a0000-0000-7000-8000-0000000000c1';
const SHARE_C1 = process.env.AGENT_SHARE_TOKEN_C1 ?? 'BvD6xlMIN86tb1zMiJWuDw';
const REDIRECT = 'http://127.0.0.1:47112/callback';
const b64 = (b: Buffer) => b.toString('base64url');

/** DCR, consent in the signed-in page, PKCE exchange: what an MCP client does on first use. */
async function connectAgent(page: Page, clientName: string): Promise<string> {
  const as = (await (await page.request.get(`${SERVER}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
  const reg = (await (await page.request.post(as.registration_endpoint!, { data: { client_name: clientName, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' } })).json()) as { client_id: string };
  const verifier = b64(randomBytes(40));
  const auth = new URL(as.authorization_endpoint!);
  auth.search = new URLSearchParams({
    response_type: 'code',
    client_id: reg.client_id,
    redirect_uri: REDIRECT,
    code_challenge: b64(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    state: 's',
    scope: 'captures:read captures:write',
  }).toString();
  let callback = '';
  await page.route('http://127.0.0.1:47112/**', async (route) => {
    callback = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  await page.goto(auth.toString());
  await hydrated(page);
  await page.getByTestId('mcp-approve').click();
  await expect.poll(() => callback).toContain('code=');
  const tok = await page.request.post(as.token_endpoint!, {
    form: { grant_type: 'authorization_code', code: new URL(callback).searchParams.get('code')!, client_id: reg.client_id, code_verifier: verifier, redirect_uri: REDIRECT },
  });
  return ((await tok.json()) as { access_token: string }).access_token;
}

async function callTool(page: Page, token: string, name: string, args: Record<string, unknown>) {
  const res = await page.request.post(`${SERVER}/mcp`, { headers: { authorization: `Bearer ${token}` }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  expect(body.result.isError, body.result.content[0]?.text).toBeFalsy();
  return JSON.parse(body.result.content[0]!.text) as Record<string, unknown>;
}

test('J-152 agent tab: setup prompt until an agent connects, then presets with the capture URL; J-151 comment time chip and reaction', async () => {
  const browser = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY: process.env.E2E_DISPLAY ?? ':117' } });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await signInWithPassword(page, 'sam@nib.test', 'nib-dev-password');
  await page.goto(`${SERVER}/c/${C1}`);
  await hydrated(page);
  await expect(page.getByTestId('tab-agent')).toBeVisible();

  // revoke any agent Sam connected in an earlier run, so the tab starts at the setup prompt
  await page.goto(`${SERVER}/settings/mcp`);
  await hydrated(page);
  while (await page.getByTestId('mcp-client').count()) {
    const row = page.getByTestId('mcp-client').first();
    await row.getByTestId('mcp-client-menu').click();
    await row.getByTestId('mcp-client-remove').click();
    await page.getByTestId('mcp-client-remove-confirm').click();
    await expect(page.getByTestId('mcp-client')).toHaveCount((await page.getByTestId('mcp-client').count()) - 1);
  }

  await page.goto(`${SERVER}/c/${C1}`);
  await hydrated(page);
  await page.getByTestId('tab-agent').click();
  await expect(page.getByTestId('agent-setup-prompt')).toContainText(`${SERVER}/mcp`);
  await expect(page.getByTestId('agent-setup-prompt')).toContainText(`${SERVER}/c/${C1}`);
  await expect(page.getByTestId('preset-fix')).toHaveCount(0);
  await page.getByTestId('copy-setup').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`${SERVER}/mcp`);

  const token = await connectAgent(page, `Tab E2E ${Date.now().toString(36)}`);
  await page.goto(`${SERVER}/c/${C1}`);
  await hydrated(page);
  await page.getByTestId('tab-agent').click();
  await expect(page.getByTestId('agent-setup')).toHaveCount(0);
  for (const p of ['fix', 'summarize', 'e2e']) {
    await page.getByTestId(`preset-${p}`).click();
    await expect(page.getByTestId('agent-prompt')).toContainText(`${SERVER}/c/${C1}`);
  }
  // open the tab, pick a preset, copy: three clicks
  await page.getByTestId('preset-fix').click();
  await page.getByTestId('copy-prompt').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`${SERVER}/c/${C1}`);
  await page.getByTestId('copy-for-ai').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('## Failed requests');

  // J-151: the agent comments at 2.63 s and reacts; the capture page shows both
  const body = `Root cause found ${Date.now().toString(36)}: the order handler throws on ink-3.`;
  const made = (await callTool(page, token, 'create_comment', { capture: `${SERVER}/c/${C1}`, body, videoMs: 2630, intent: 'report the cause' })) as { id: string };
  await callTool(page, token, 'add_reaction', { commentId: made.id, reaction: 'check' });
  await page.reload();
  await hydrated(page);
  const item = page.locator(`[data-comment-id="${made.id}"]`);
  await expect(item.getByTestId('comment-body')).toContainText('Root cause found');
  await expect(item.getByTestId('comment-time')).toHaveText('0:02');
  await expect(item.getByTestId('reaction-check')).toBeVisible();
  await expect(item.getByTestId('reaction-check')).toHaveAttribute('aria-pressed', 'true');
  await callTool(page, token, 'remove_reaction', { commentId: made.id, reaction: 'check' });
  await callTool(page, token, 'delete_comment', { commentId: made.id });
  await page.reload();
  await hydrated(page);
  await expect(page.locator(`[data-comment-id="${made.id}"]`)).toHaveCount(0);

  // a logged-out link viewer gets the setup prompt with the share URL
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await anon.newPage();
  await p2.goto(`${SERVER}/s/${SHARE_C1}`);
  await hydrated(p2);
  await p2.getByTestId('tab-agent').click();
  await expect(p2.getByTestId('agent-setup-prompt')).toContainText(`${SERVER}/mcp`);
  await expect(p2.getByTestId('agent-setup-prompt')).toContainText(`${SERVER}/s/${SHARE_C1}`);
  await browser.close();
});
