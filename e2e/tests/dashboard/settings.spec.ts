// Settings (J-171 to J-175, J-120, J-136, J-139, J-142, J-156, J-178, J-222, J-225) on fresh accounts.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { SERVER, go, json, launch, listener, me, newContext, signIn, toast, uniqueEmail } from './helpers.ts';

// One account and page for the whole file; a failure skips the rest instead of re-running setup.
test.describe.configure({ mode: 'serial' });

let browser: Browser;
let page: Page;
let other: Page;
let otherId: string;
let wsId: string;

test.beforeAll(async () => {
  browser = await launch();
  page = await (await newContext(browser)).newPage();
  await signIn(page, uniqueEmail(undefined, 'admin'));
  wsId = (await me(page)).activeWorkspaceId;
  // a second member joins through the invite link (as creator, J-234)
  const link = await json<{ url: string }>(page, 'GET', `/api/v1/workspaces/${wsId}/invite-link`);
  other = await (await newContext(browser)).newPage();
  await signIn(other, uniqueEmail(undefined, 'mate'));
  await json(other, 'POST', `/api/v1/invites/${link.url.split('/').pop()}/accept`);
  otherId = (await me(other)).id;
});
test.afterAll(async () => browser.close());

test('J-171, J-168: settings has its own layout with a back link and grouped nav; the workspace menu leads there', async () => {
  await go(page, '/');
  await page.getByTestId('workspace-menu').click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await expect(page).toHaveURL(`${SERVER}/settings/workspace`);
  const nav = page.getByRole('navigation', { name: 'Settings' });
  for (const g of ['Workspace', 'Apps and tools', 'Account']) await expect(nav.getByText(g, { exact: true })).toBeVisible();
  for (const l of ['General', 'Members', 'Integrations', 'SDK', 'Webhooks', 'MCP', 'CLI', 'Profile', 'Notifications']) await expect(nav.getByRole('link', { name: l, exact: true })).toBeVisible();
  // apps and tools in Jam's order: integrations, SDK, MCP, CLI, webhooks (then our API page)
  const tools = await nav.locator('a[data-testid^="settings-nav-"]').evaluateAll((as) => as.map((a) => a.getAttribute('data-testid')!.slice(13)));
  expect(tools.slice(tools.indexOf('integrations'), tools.indexOf('api') + 1)).toEqual(['integrations', 'sdk', 'mcp', 'cli', 'webhooks', 'api']);
  await nav.getByRole('link', { name: 'SDK', exact: true }).click();
  await expect(page.getByTestId('sdk-snippet')).toContainText('window.toolbar?.setMetadata');
  await page.getByTestId('sdk-copy').click();
  await toast(page, 'Snippet copied');
  await expect(page.getByTestId('nav-all')).toHaveCount(0); // the dashboard sidebar is gone
  await page.getByTestId('settings-back').click();
  await expect(page).toHaveURL(`${SERVER}/`);
});

test('J-172, J-120, J-156, J-178: general settings save at once and nothing is plan-gated', async () => {
  await go(page, '/settings/workspace');
  await page.getByTestId('ws-name').fill('Pen Pals');
  await page.getByTestId('ws-name').press('Enter');
  await expect.poll(async () => (await json<{ name: string }>(page, 'GET', `/api/v1/workspaces/${wsId}`)).name).toBe('Pen Pals');
  await page.getByTestId('ws-default-access').selectOption('workspace');
  await page.getByTestId('ws-ai').click();
  await page.getByTestId('ws-auto-delete').selectOption('90');
  await expect.poll(async () => (await json<{ settings: Record<string, unknown> }>(page, 'GET', `/api/v1/workspaces/${wsId}`)).settings).toMatchObject({ defaultLinkAccess: 'workspace', aiEnabled: false, autoDeleteDays: 90 });
  await expect(page.locator('.badge')).toHaveCount(0); // no plan badges
  await go(page, '/settings/workspace');
  await expect(page.getByTestId('ws-ai')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('workspace-menu')).toHaveCount(0);
  await go(page, '/');
  await expect(page.getByTestId('workspace-menu')).toContainText('Pen Pals');
  // the member who is not an admin sees the page but cannot change it
  await go(other, '/settings/workspace');
  await expect(other.getByTestId('ws-name')).toBeDisabled();
  await expect(other.getByTestId('ws-ai')).toBeDisabled();
});

test('J-178: the audit log lists settings and role changes', async () => {
  await json(page, 'PATCH', `/api/v1/workspaces/${wsId}/members/${otherId}`, { role: 'viewer' });
  await json(page, 'PATCH', `/api/v1/workspaces/${wsId}/members/${otherId}`, { role: 'creator' });
  await go(page, '/settings/audit');
  await expect(page.getByTestId('audit-table').locator('tr[data-action="member.role_changed"]')).toHaveCount(2);
  await expect(page.getByTestId('audit-table').locator('tr[data-action="workspace.updated"]').first()).toBeVisible();
  await page.getByTestId('audit-filter').click();
  await page.getByRole('option', { name: 'changed a role' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('audit-table').locator('tbody tr')).toHaveCount(2);
});

test('J-173, J-222: members page: invite link with copy and reset, restrict invites, change a seat, remove', async () => {
  await go(page, '/settings/members');
  await expect(page.getByTestId('member-table').locator('tbody tr')).toHaveCount(2);
  const url1 = await page.getByTestId('invite-link-url').inputValue();
  expect(url1).toContain('/invite/');
  await expect(page.getByTestId('invite-link-section')).toContainText(/Expires in 2[89] days/);
  await page.getByTestId('invite-link-copy').click();
  await toast(page, 'Invite link copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url1);
  await page.getByTestId('invite-link-reset').click();
  await toast(page, 'New invite link made');
  await expect(page.getByTestId('invite-link-url')).not.toHaveValue(url1);
  const row = page.getByTestId('member-table').locator(`tr[data-user="${otherId}"]`);
  await expect(row.getByTestId('role-button')).toContainText('Creator');
  await row.getByTestId('role-button').click();
  await page.getByRole('menuitemradio', { name: /Viewer/ }).click();
  await toast(page, 'is now viewer');
  await expect(row.getByTestId('role-button')).toContainText('Viewer');
  expect((await json<{ items: { userId: string; role: string }[] }>(page, 'GET', `/api/v1/workspaces/${wsId}/members`)).items.find((m) => m.userId === otherId)!.role).toBe('viewer');
  // J-124: a viewer seat cannot create
  const denied = await other.request.post(`${SERVER}/api/v1/workspaces/${wsId}/folders`, { headers: { origin: SERVER, 'content-type': 'application/json' }, data: { name: 'x' } });
  expect(denied.status()).toBe(403);
  await page.getByTestId('restrict-invites').click();
  await expect.poll(async () => (await json<{ settings: { restrictInvites: boolean } }>(page, 'GET', `/api/v1/workspaces/${wsId}`)).settings.restrictInvites).toBe(true);
  await page.getByTestId('restrict-invites').click();
  await page.getByTestId('add-members').click();
  await expect(page.getByRole('dialog', { name: /Invite/ }).or(page.locator('dialog[open]')).first()).toBeVisible();
  await page.keyboard.press('Escape');
});

test('J-136: notification toggles save at once and turn-off-all gates them', async () => {
  await go(page, '/settings/notifications');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/settings') && r.request().method() === 'PATCH');
  await page.getByTestId('notify-firstView').click();
  await saved;
  await expect(page.getByTestId('notify-firstView')).toHaveAttribute('aria-checked', 'false');
  await go(page, '/settings/notifications');
  await expect(page.getByTestId('notify-firstView')).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByTestId('notify-recordingLinkUsed')).toHaveAttribute('aria-checked', 'true');
  const saved2 = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/settings') && r.request().method() === 'PATCH');
  await page.getByTestId('notify-allOff').click();
  await saved2;
  await expect(page.getByTestId('notify-recordingLinkUsed')).toBeDisabled();
  const s = await json<{ notifications: Record<string, boolean> }>(page, 'GET', '/api/v1/me/settings');
  expect(s.notifications).toMatchObject({ firstView: false, allOff: true, recordingLinkUsed: true });
  await page.getByTestId('notify-allOff').click();
  await expect(page.locator('[role=status]').filter({ hasText: /saved/i })).toHaveCount(0); // no toast for toggles
});

test('J-139, J-251: integrations grid: search, connect Slack through an incoming webhook, and it belongs to this workspace', async () => {
  const slack = await listener();
  try {
    await go(page, '/settings/integrations');
    await page.getByTestId('integration-search').fill('git');
    await expect(page.getByTestId('integration-grid').locator('article')).toHaveCount(2);
    await page.getByTestId('integration-search').fill('');
    await expect(page.getByTestId('integration-grid').locator('article')).toHaveCount(6);
    await page.getByTestId('connect-github').click();
    await page.getByTestId('token-input').fill('not-a-real-token-123');
    await page.getByTestId('base-url').fill(slack.url); // answers 200 {} so "user" has no login
    slack.setStatus(401);
    await page.getByTestId('connect-submit').click();
    await expect(page.getByTestId('connect-error')).toContainText('The connection test failed');
    slack.setStatus(200);
    await page.keyboard.press('Escape');
    await page.getByTestId('connect-slack').click();
    await page.getByTestId('slack-url').fill(`${slack.url}/services/T0/B0/XYZ`);
    await page.getByTestId('connect-submit').click();
    await toast(page, 'connected');
    await expect(page.locator('[data-tile=slack]').getByTestId('connection')).toHaveCount(1);
    const list = await json<{ items: { type: string; workspaceId: string }[] }>(page, 'GET', `/api/v1/workspaces/${wsId}/integrations`);
    expect(list.items).toEqual([expect.objectContaining({ type: 'slack', workspaceId: wsId })]);
    // the member sees it but cannot connect or remove (admins only)
    await go(other, '/settings/integrations');
    await expect(other.locator('[data-tile=slack]').getByTestId('connection')).toHaveCount(1);
    await expect(other.getByTestId('connect-github')).toHaveCount(0);
    await page.locator('[data-tile=slack]').getByTestId('disconnect').click();
    await page.locator('[data-testid=confirm-dialog][open]').getByTestId('confirm-button').click();
    await toast(page, 'disconnected');
  } finally {
    await slack.close();
  }
});

test('J-142: add a webhook, the secret shows once, a test delivery is signed, a failing endpoint logs a retry', async () => {
  const hook = await listener();
  try {
    await go(page, '/settings/webhooks');
    await page.getByTestId('add-webhook').click();
    await page.getByTestId('webhook-url').fill(`${hook.url}/hook`);
    await page.getByTestId('webhook-save').click();
    await expect(page.getByTestId('webhook-secret')).toHaveText(/^whsec_/);
    const secret = (await page.getByTestId('webhook-secret').textContent())!.trim();
    expect(secret).toMatch(/^whsec_/);
    await page.locator('[data-testid=webhook-secret-dialog][open]').getByRole('button', { name: 'Done' }).click();
    const row = page.getByTestId('webhook-row').first();
    await row.getByTestId('webhook-test').click();
    await toast(page, 'Test delivered (HTTP 200)');
    const got = hook.seen.at(-1)!;
    const [t, v1] = String(got.headers['x-toolbar-signature']).split(',').map((p) => p.split('=')[1]);
    expect(createHmac('sha256', secret).update(`${t}.${got.body}`).digest('hex')).toBe(v1);
    expect(JSON.parse(got.body)).toMatchObject({ event: 'capture.created', workspaceId: wsId });
    hook.setStatus(500);
    await row.getByTestId('webhook-test').click();
    await toast(page, /Test failed: HTTP 500/);
    await row.getByTestId('webhook-log-toggle').click();
    const log = page.getByTestId('webhook-log');
    await expect(log.locator('tr[data-status=pending]')).toHaveCount(1);
    await expect(log.locator('tr[data-status=ok]')).toHaveCount(1);
    // the retry goes out after its backoff (10 s) and is logged as a second attempt
    hook.setStatus(200);
    await expect.poll(async () => {
      const id = (await json<{ items: { id: string }[] }>(page, 'GET', `/api/v1/workspaces/${wsId}/webhooks`)).items[0]!.id;
      const d = await json<{ items: { status: string; attempts: number }[] }>(page, 'GET', `/api/v1/webhooks/${id}/deliveries`);
      return d.items.find((x) => x.attempts >= 2)?.status;
    }, { timeout: 40_000 }).toBe('ok');
  } finally {
    await hook.close();
  }
});

test('J-175: profile names, role hint and a locked email', async () => {
  await go(page, '/settings/profile');
  await page.getByTestId('first-name').fill('Ada');
  await page.getByTestId('last-name').fill('Pen');
  await page.getByTestId('last-name').press('Enter');
  await expect.poll(async () => (await json<{ name: string }>(page, 'GET', '/api/v1/me')).name).toBe('Ada Pen');
  const before = await page.getByTestId('role-hint-line').textContent();
  await page.getByTestId('role-hint').selectOption('support');
  await expect(page.getByTestId('role-hint-line')).not.toHaveText(before!);
  await expect(page.getByLabel('Email')).toBeDisabled();
});

test('J-225: deleting the account lists the workspaces that go and needs DELETE typed', async () => {
  // the admin of a shared workspace is blocked until someone else is admin
  await go(page, '/settings/profile');
  await page.getByTestId('delete-account').click();
  await expect(page.getByTestId('delete-blocked')).toContainText('Pen Pals');
  await page.keyboard.press('Escape');
  // the member: their own personal workspace goes, the shared one stays
  await go(other, '/settings/profile');
  await other.getByTestId('delete-account').click();
  await expect(other.getByTestId('delete-workspaces')).toContainText("workspace");
  const confirm = other.getByTestId('delete-confirm');
  await expect(confirm).toBeDisabled();
  await other.getByTestId('delete-confirm-input').fill('delete');
  await expect(confirm).toBeDisabled();
  await other.getByTestId('delete-confirm-input').fill('DELETE');
  await confirm.click();
  await other.waitForURL(/\/login/);
  const members = await json<{ items: { userId: string }[] }>(page, 'GET', `/api/v1/workspaces/${wsId}/members`);
  expect(members.items.map((m) => m.userId)).not.toContain(otherId);
});
