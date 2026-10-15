// Auth area, web app (J-217, X-06, J-221, J-123, J-234, J-125, J-124, J-148). Runs against
// SERVER_URL with Mailpit on :8025; needs no extension.
import { execFileSync } from 'node:child_process';
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import { SERVER, api, firstUrl, hydrated, mailTo, showPassword, signInByMail, signInWithPassword, uniqueEmail } from './helpers.ts';

let browser: Browser;
test.beforeAll(async () => {
  browser = await chromium.launch();
});
test.afterAll(async () => browser.close());

async function freshPage(): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return ctx.newPage();
}

/**
 * Workspace settings have no API in this area (the settings page is the dashboard's), so the
 * J-124 test flips auto-approve in the area database directly. Needs psql; DATABASE_URL names
 * the database (an area worktree's .env), else the compose one, as the server falls back to.
 */
function setAutoApprove(workspaceId: string, on: boolean) {
  const url = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
  execFileSync('psql', [url, '-qc', `update organization set settings = coalesce(settings, '{}'::jsonb) || '{"autoApproveCreators": ${on}}'::jsonb where id = '${workspaceId}'`]);
}

type Ws = { id: string; name: string; role: string; isOwner: boolean };
const workspaces = async (p: Page) => (await api<{ items: Ws[]; activeId: string }>(p, 'GET', '/api/v1/workspaces')).body;

test('J-217 / X-06: login page, magic link sign-up, personal workspace as admin', async () => {
  const page = await freshPage();
  await page.goto(`${SERVER}/login`);
  await hydrated(page);
  await expect(page.getByRole('heading', { name: /Sign in to/ })).toBeVisible();
  const cont = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(cont).toBeDisabled();
  await page.getByLabel('Work email').fill('not-an-email');
  await expect(cont).toBeDisabled();
  // No Apple button, ever (skip list); provider buttons only when configured.
  await expect(page.getByRole('button', { name: /Apple/ })).toHaveCount(0);

  const email = uniqueEmail(undefined, 'mira');
  await signInByMail(page, email);
  await page.waitForURL(`${SERVER}/`);
  const ws = await workspaces(page);
  expect(ws.items).toHaveLength(1);
  expect(ws.items[0]).toMatchObject({ role: 'admin', isOwner: true, name: expect.stringContaining('workspace') });
  expect(ws.activeId).toBe(ws.items[0]!.id);
  await expect(page.getByTestId('workspace-menu')).toContainText(ws.items[0]!.name);

  // The link is single use.
  const mail = await mailTo(page.request, email, /Sign in/);
  const again = await freshPage();
  await again.goto(firstUrl(mail.text, `${SERVER}/api/auth/magic-link/verify`));
  await expect(again).toHaveURL(/\/login/);
  await expect(again.getByRole('alert')).toContainText(/already used|expired/);
});

test('J-217: password sign-up and sign-in on the same form', async () => {
  const page = await freshPage();
  const email = uniqueEmail(undefined, 'pat');
  await signInWithPassword(page, email, 'correct horse battery');
  expect((await api<{ email: string }>(page, 'GET', '/api/v1/me')).body.email).toBe(email);
  const other = await freshPage();
  await other.goto(`${SERVER}/login`);
  await hydrated(other);
  await showPassword(other);
  await other.getByLabel('Work email').fill(email);
  await other.getByLabel('Password').fill('wrong password here');
  await other.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(other.getByRole('alert')).toBeVisible();
});

test('X-06: /api/v1 without a session is 401', async ({ request }) => {
  for (const p of ['/api/v1/me', '/api/v1/workspaces', '/api/v1/recordings', '/api/v1/ext/bootstrap']) {
    const r = await request.get(`${SERVER}${p}`);
    expect(r.status(), p).toBe(401);
    expect(await r.json()).toMatchObject({ error: 'unauthorized' });
  }
});

test('J-221: workspace menu, create a workspace, it becomes active', async () => {
  const page = await freshPage();
  await signInByMail(page, uniqueEmail(undefined, 'cora'));
  await page.getByTestId('workspace-menu').click();
  await page.getByRole('menuitem', { name: 'Create or join a workspace' }).click();
  await hydrated(page);
  await expect(page.getByRole('heading', { name: 'Create a workspace' })).toBeVisible();
  const next = page.getByRole('button', { name: 'Next' });
  await expect(next).toBeDisabled();
  const domainBox = page.getByRole('checkbox');
  await expect(domainBox).toBeChecked();
  await page.getByLabel('Workspace name').fill('Zephyr support');
  await expect(page.locator('.avatar')).toHaveText('Z');
  await expect(next).toBeEnabled();
  await next.click();
  await page.waitForURL(/\/\?created=1/);
  await hydrated(page);
  await expect(page.getByTestId('workspace-menu')).toContainText('Zephyr support');
  const ws = await workspaces(page);
  const z = ws.items.find((w) => w.name === 'Zephyr support')!;
  expect(z).toMatchObject({ role: 'admin', isOwner: true });
  expect(ws.activeId).toBe(z.id);

  // Switch back from the menu.
  await page.getByTestId('workspace-menu').click();
  const other = ws.items.find((w) => w.id !== z.id)!;
  await page.getByRole('menuitem', { name: new RegExp(other.name) }).click();
  await expect(page.getByTestId('workspace-menu')).toContainText(other.name);
  expect((await workspaces(page)).activeId).toBe(other.id);
});

test('J-123 / J-234 / J-124: invite modal, email invite as viewer, invite link as creator, seats enforced', async () => {
  const admin = await freshPage();
  await signInByMail(admin, uniqueEmail(undefined, 'ada'));
  const wsId = (await workspaces(admin)).activeId;

  await admin.getByTestId('invite-button').click();
  const dlg = admin.getByTestId('invite-dialog');
  await expect(dlg.getByLabel('Invite link')).toHaveValue(new RegExp(`${SERVER}/invite/`));
  const linkUrl = await dlg.getByLabel('Invite link').inputValue();
  const inviteBtn = dlg.getByRole('button', { name: 'Invite', exact: true });
  await expect(inviteBtn).toBeDisabled();
  const viewerEmail = uniqueEmail(undefined, 'vic');
  await dlg.getByLabel('Email address').fill('vic@');
  await expect(inviteBtn).toBeDisabled();
  await dlg.getByLabel('Email address').fill(viewerEmail);
  await dlg.getByLabel('Seat').selectOption('viewer');
  await expect(inviteBtn).toBeEnabled();
  await inviteBtn.click();
  await expect(dlg.getByText(viewerEmail)).toBeVisible();

  // The invitee gets the mail, signs in from the join page and joins as viewer.
  const mail = await mailTo(admin.request, viewerEmail, /invited you/);
  const joinUrl = firstUrl(mail.text, `${SERVER}/invite/`);
  const viewer = await freshPage();
  await viewer.goto(joinUrl);
  await expect(viewer.getByRole('heading', { name: /Join/ })).toBeVisible();
  await viewer.getByRole('link', { name: 'Sign in to join' }).click();
  await signInByMail(viewer, viewerEmail, new URL(joinUrl).pathname);
  await hydrated(viewer);
  await viewer.getByRole('button', { name: /^Join/ }).click();
  await viewer.waitForURL(/joined=1/);
  const vws = await workspaces(viewer);
  expect(vws.items.find((w) => w.id === wsId)).toMatchObject({ role: 'viewer' });
  expect(vws.activeId).toBe(wsId);

  // J-124: a viewer cannot invite or reset the link; the dashboard hides the invite button.
  expect((await api(viewer, 'POST', `/api/v1/workspaces/${wsId}/invites`, { emails: ['x@y.test'] })).status).toBe(403);
  expect((await api(viewer, 'POST', `/api/v1/workspaces/${wsId}/invite-link/reset`)).status).toBe(403);
  await expect(viewer.getByTestId('invite-button')).toHaveCount(0);

  // J-124: creating a capture as a viewer. With auto-approve off the API refuses (403) before
  // the handler runs; with it on (the default) the viewer becomes a creator and gets through.
  const create = () => api(viewer, 'POST', '/api/v1/recordings', { workspaceId: wsId, clientId: 'e2e-j124', mode: 'screenshot' });
  setAutoApprove(wsId, false);
  expect((await create()).status).toBe(403);
  expect((await workspaces(viewer)).items.find((w) => w.id === wsId)).toMatchObject({ role: 'viewer' });
  setAutoApprove(wsId, true);
  expect((await create()).status).not.toBe(403);
  expect((await workspaces(viewer)).items.find((w) => w.id === wsId)).toMatchObject({ role: 'creator' });

  // J-234: someone joining through the link comes in as creator.
  const linker = await freshPage();
  await signInByMail(linker, uniqueEmail(undefined, 'lin'));
  await linker.goto(linkUrl);
  await hydrated(linker);
  await linker.getByRole('button', { name: /^Join/ }).click();
  await linker.waitForURL(/joined=1/);
  expect((await workspaces(linker)).items.find((w) => w.id === wsId)).toMatchObject({ role: 'creator' });
  // A creator may invite (role creator), but not reset the link (admin).
  expect((await api(linker, 'GET', `/api/v1/workspaces/${wsId}/invite-link`)).status).toBe(200);
  expect((await api(linker, 'POST', `/api/v1/workspaces/${wsId}/invite-link/reset`)).status).toBe(403);

  // Reset: the old link stops working.
  const reset = await api<{ url: string }>(admin, 'POST', `/api/v1/workspaces/${wsId}/invite-link/reset`);
  expect(reset.status).toBe(200);
  expect(reset.body.url).not.toBe(linkUrl);
  expect((await linker.request.get(`${SERVER}/api/v1/invites/${new URL(linkUrl).pathname.split('/').pop()}`)).status()).toBe(404);
});

test('J-125: join by email domain lands as viewer and mails the admins', async () => {
  const domain = `dom-${Date.now().toString(36)}.test`;
  const admin = await freshPage();
  const adminEmail = uniqueEmail(domain, 'boss');
  await signInByMail(admin, adminEmail);
  const created = await api<{ id: string }>(admin, 'POST', '/api/v1/workspaces', { name: 'Domain crew', domainJoin: true });
  expect(created.status).toBe(201);

  const newbie = await freshPage();
  const newbieEmail = uniqueEmail(domain, 'newbie');
  await signInByMail(newbie, newbieEmail);
  const ws = await workspaces(newbie);
  expect(ws.items.find((w) => w.id === created.body.id)).toMatchObject({ role: 'viewer' });
  expect(ws.activeId).toBe(created.body.id);
  const note = await mailTo(admin.request, adminEmail, /joined Domain crew/);
  expect(note.text).toContain(newbieEmail);
});

test('J-148: personal token, shown once with its prefix; read-only refuses a write', async () => {
  const page = await freshPage();
  await signInByMail(page, uniqueEmail(undefined, 'tok'));
  await page.goto(`${SERVER}/settings/tokens`);
  await hydrated(page);
  await page.getByRole('button', { name: 'Create token' }).click();
  await page.getByLabel('Name').fill('CI reader');
  await page.getByLabel('Expires').selectOption('30');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const secretBox = page.getByTestId('token-secret');
  await expect(secretBox).toContainText('tb_pat_');
  const secret = (await secretBox.locator('code').textContent())!.trim();
  await expect(page.getByText('HTTP API, read only')).toBeVisible();

  const auth = { authorization: `Bearer ${secret}` };
  const me = await page.request.get(`${SERVER}/api/v1/me`, { headers: auth });
  expect(me.status()).toBe(200);
  expect((await me.json()).via).toBe('personal');
  const ws = (await (await page.request.get(`${SERVER}/api/v1/workspaces`, { headers: auth })).json()) as { activeId: string };
  const write = await page.request.put(`${SERVER}/api/v1/me/active-workspace`, { headers: auth, data: { workspaceId: ws.activeId } });
  expect(write.status()).toBe(403);
  // Session-only routes refuse tokens altogether.
  expect((await page.request.get(`${SERVER}/api/v1/tokens`, { headers: auth })).status()).toBe(403);

  // The secret is not shown again after a reload; revoking makes it stop working.
  await page.reload();
  await hydrated(page);
  await expect(page.getByTestId('token-secret')).toHaveCount(0);
  await page.getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('No tokens yet.')).toBeVisible();
  expect((await page.request.get(`${SERVER}/api/v1/me`, { headers: auth })).status()).toBe(401);
});
