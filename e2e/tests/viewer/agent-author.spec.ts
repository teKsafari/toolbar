// An agent writing for a person (owner, D-207). Dana connects an MCP client that registers as
// "Claude Code (open-toolbar)", the way Claude Code names itself; it comments, replies and resolves
// the feedback through MCP. The capture page draws each of those as the agent's square mark (the
// Claude logo, D-208) with Dana's avatar small at its bottom-right corner, and the name line reads
// "Dana Reviewer via Claude Code". Dana's own comments keep the round avatar alone. The Agent tab lists the agent
// the same way.
import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { captureUrl, IDS, open, reseed, SERVER, signIn } from './helpers.ts';

const REDIRECT = 'http://127.0.0.1:47113/callback';
const CLIENT = 'Claude Code (open-toolbar)';
const b64 = (b: Buffer) => b.toString('base64url');

/** DCR, consent in the signed-in page, PKCE exchange: what an MCP client does on first use. */
async function connectAgent(page: Page): Promise<{ token: string; clientId: string }> {
  const as = (await (await page.request.get(`${SERVER}/.well-known/oauth-authorization-server`)).json()) as Record<string, string>;
  const reg = (await (await page.request.post(as.registration_endpoint!, { data: { client_name: CLIENT, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' } })).json()) as { client_id: string };
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
  await page.goto(auth.toString());
  await page.waitForLoadState('networkidle');
  // the approve answers 303 to the client's loopback callback; nothing listens there, so read the
  // code from the request the browser makes
  const cb = page.waitForRequest((r) => r.url().startsWith(REDIRECT));
  await page.getByTestId('mcp-approve').click();
  const callback = (await cb).url();
  expect(callback).toContain('code=');
  const tok = await page.request.post(as.token_endpoint!, {
    form: { grant_type: 'authorization_code', code: new URL(callback).searchParams.get('code')!, client_id: reg.client_id, code_verifier: verifier, redirect_uri: REDIRECT },
  });
  return { token: ((await tok.json()) as { access_token: string }).access_token, clientId: reg.client_id };
}

async function callTool(page: Page, token: string, name: string, args: Record<string, unknown>) {
  const res = await page.request.post(`${SERVER}/mcp`, { headers: { authorization: `Bearer ${token}` }, data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } });
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  expect(body.result.isError, body.result.content[0]?.text).toBeFalsy();
  return JSON.parse(body.result.content[0]!.text) as Record<string, unknown>;
}

/** Remove every agent Dana connected, so runs do not pile them up. */
async function removeAgents(page: Page) {
  const list = (await (await page.request.get(`${SERVER}/api/v1/mcp/clients`)).json()) as { items: { id: string }[] };
  for (const c of list.items) await page.request.delete(`${SERVER}/api/v1/mcp/clients/${c.id}`, { headers: { origin: SERVER } });
}

test.beforeAll(() => reseed());

test('an agent comment, reply and resolution show the stacked author and "via Claude Code"', async ({ page, context }) => {
  await signIn(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await removeAgents(page);
  const { token } = await connectAgent(page);

  // Dana's own comment first, then the agent's comment and its reply to Dana
  const mine = (await (await page.request.post(`${SERVER}/api/v1/recordings/${IDS.feedback}/comments`, { headers: { origin: SERVER }, data: { body: 'Dana herself' } })).json()) as { id: string };
  const agentComment = await callTool(page, token, 'create_comment', { capture: IDS.feedback, body: 'Root cause: the price is rounded twice.' });
  await callTool(page, token, 'create_comment', { capture: IDS.feedback, body: 'Fixed in the cart reducer.', parentId: mine.id });
  await callTool(page, token, 'resolve_feedback', { capture: IDS.feedback, note: 'Rounded once, in the reducer.', commit: 'abc1234def5678' });

  await open(page, captureUrl(IDS.feedback));
  const agentRow = page.locator(`[data-comment-id="${agentComment.id}"]`);
  await expect(agentRow).toBeVisible();

  // the stack: one labelled element, the agent's square mark, Dana's round avatar at its corner
  const stack = agentRow.getByTestId('author-stack').first();
  await expect(stack).toHaveAttribute('aria-label', 'Dana Reviewer via Claude Code');
  await expect(stack).toHaveAttribute('title', 'Dana Reviewer via Claude Code');
  await expect(stack).toHaveAttribute('role', 'img');
  const mark = stack.getByTestId('agent-mark');
  await expect(mark).toHaveAttribute('data-agent', 'Claude Code');
  // Claude Code shows the Claude logo (D-208): an svg titled "Claude", no monogram
  const logo = mark.locator('svg');
  await expect(logo).toHaveCount(1);
  await expect(logo.locator('title')).toHaveText('Claude');
  await expect(mark).toHaveAttribute('data-logo', 'claude');
  await expect(mark).not.toContainText('CC');
  const m = (await mark.boundingBox())!;
  const p = (await stack.getByTestId('author-person').boundingBox())!;
  expect(m.width).toBe(28);
  expect(p.width, 'the person is smaller than the mark').toBeLessThan(m.width * 0.7);
  // overlapping and offset to the bottom-right, not covering the mark
  expect(p.x).toBeGreaterThan(m.x + m.width / 2);
  expect(p.y).toBeGreaterThan(m.y + m.height / 2);
  expect(p.x).toBeLessThan(m.x + m.width);
  expect(p.x + p.width).toBeGreaterThan(m.x + m.width);
  // the person's avatar (with its 2 px ring) stays clear of the logo's box
  const l = (await logo.boundingBox())!;
  const cx = p.x + p.width / 2;
  const cy = p.y + p.height / 2;
  const nearest = Math.hypot(cx - Math.min(cx, l.x + l.width), cy - Math.min(cy, l.y + l.height));
  expect(nearest, 'the avatar does not cover the logo').toBeGreaterThan(p.width / 2 + 2);
  const radius = await mark.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
  expect(radius, 'the mark is a rounded square, not a circle').toBeLessThan(10);

  // the name line: the person, then the agent as a quiet label, cleaned of "(open-toolbar)"
  const name = agentRow.getByTestId('author-name').first();
  await expect(name).toHaveText('Dana Reviewer via Claude Code');
  await expect(name.getByTestId('author-via')).toHaveText(' via Claude Code');
  await expect(agentRow).not.toContainText('open-toolbar');
  const [whoW, viaW] = await name.evaluate((el) => [getComputedStyle(el.querySelector('.who')!).fontWeight, getComputedStyle(el.querySelector('.via')!).fontWeight]);
  expect(Number(whoW)).toBeGreaterThan(Number(viaW));

  // the reply carries the same author at the reply size; Dana's own comment has no stack
  const mineRow = page.locator(`[data-comment-id="${mine.id}"]`);
  const replyRow = page.getByTestId('comment').filter({ hasText: 'Fixed in the cart reducer.' });
  await expect(replyRow.getByTestId('author-stack')).toHaveAttribute('aria-label', 'Dana Reviewer via Claude Code');
  await expect(replyRow.getByTestId('agent-mark')).toHaveCSS('width', '22px');
  await expect(mineRow.getByTestId('author-stack')).toHaveCount(0);
  await expect(mineRow.getByTestId('author-name')).toHaveText('Dana Reviewer');

  // the feedback list's history line: resolved by Dana via Claude Code
  const hist = page.getByTestId('feedback-resolution');
  await expect(hist).toContainText('Resolved by Dana Reviewer via Claude Code');
  await expect(hist).toContainText('abc1234def56');
  await expect(hist.getByTestId('author-stack')).toHaveAttribute('aria-label', 'Dana Reviewer via Claude Code');

  // the Agent tab lists the connected agent with the same author
  await page.getByTestId('tab-agent').click();
  const item = page.getByTestId('agent-connected-item');
  await expect(item).toHaveCount(1);
  await expect(item.getByTestId('author-stack')).toHaveAttribute('aria-label', 'Dana Reviewer via Claude Code');
  await expect(item).toContainText('Dana Reviewer via Claude Code');

  // light and dark: the logo keeps 3:1 against its tile (WCAG 1.4.11)
  const logoRatio = () => mark.evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const cs = getComputedStyle(el);
    const [a, b] = [lum(parse(cs.color)), lum(parse(cs.backgroundColor))].sort((x, y) => y - x);
    return (a! + 0.05) / (b! + 0.05);
  });
  expect(await logoRatio(), 'light').toBeGreaterThanOrEqual(3);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await logoRatio(), 'dark').toBeGreaterThanOrEqual(3);

  // at 390 px the name line wraps inside the row, no side scroll
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, captureUrl(IDS.feedback));
  await expect(page.locator(`[data-comment-id="${agentComment.id}"]`).getByTestId('author-name').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await removeAgents(page);
});
