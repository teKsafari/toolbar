// X-05: extension sign-in through chrome.identity.launchWebAuthFlow + PKCE against SERVER_URL.
// Needs the test build made with WXT_SERVER_URL=$SERVER_URL.
import { EXT_ID, expect, test } from '../../fixtures/extension.ts';
import type { Page } from '@playwright/test';
import { SERVER, hydrated, showPassword, signInWithPassword, uniqueEmail } from './helpers.ts';

declare const chrome: {
  runtime: { sendMessage(m: unknown): Promise<unknown> };
  storage: { local: { get(k: string): Promise<Record<string, unknown>> } };
};

/** Send a worker request from an extension page, as the popup does. */
async function bg<T = Record<string, unknown>>(page: Page, msg: Record<string, unknown>): Promise<T> {
  return page.evaluate((m) => chrome.runtime.sendMessage(m), msg) as Promise<T>;
}

test('X-05: signed in on the web, the extension connects in one step and shows under connected browsers', async ({ context }) => {
  const email = uniqueEmail(undefined, 'ext');
  const web = await context.newPage();
  await signInWithPassword(web, email, 'extension test pass');

  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${EXT_ID}/popup.html`);
  expect(await bg(ext, { type: 'auth.state' })).toMatchObject({ ok: true, signedIn: false, serverUrl: SERVER });

  const r = await bg<{ ok: boolean; user?: { email: string }; error?: string; message?: string }>(ext, { type: 'auth.signIn' });
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true, user: { email } });
  expect(await bg(ext, { type: 'auth.state' })).toMatchObject({ ok: true, signedIn: true, user: { email } });

  // The token is a device token; the bootstrap call works with it.
  const stored = (await ext.evaluate(() => chrome.storage.local.get('tb:auth')))['tb:auth'] as { token: string };
  expect(stored.token).toMatch(/^tb_dev_/);
  const boot = await bg<{ ok: boolean; bootstrap: { user: { email: string }; workspaces: unknown[]; activeWorkspaceId: string } }>(ext, {
    type: 'bootstrap.get',
    refresh: true,
  });
  expect(boot.ok).toBe(true);
  expect(boot.bootstrap.user.email).toBe(email);
  expect(boot.bootstrap.workspaces).toHaveLength(1);

  // Settings lists the browser; disconnecting there signs the extension out on its next call.
  await web.goto(`${SERVER}/settings/browsers`);
  await hydrated(web);
  const list = web.getByTestId('device-list');
  await expect(list).toContainText(/on (Linux|macOS|Windows)/);
  await list.getByRole('button', { name: 'Disconnect' }).click();
  await expect(web.getByText('No browser is connected yet.')).toBeVisible();
  const after = await bg<{ ok: boolean; error?: string }>(ext, { type: 'bootstrap.get', refresh: true });
  expect(after).toMatchObject({ ok: false, error: 'not_signed_in' });
  expect(await bg(ext, { type: 'auth.state' })).toMatchObject({ signedIn: false });

  // Sign in again, then sign out from the extension: the device token is revoked on the server.
  expect(await bg(ext, { type: 'auth.signIn' })).toMatchObject({ ok: true });
  const token = ((await ext.evaluate(() => chrome.storage.local.get('tb:auth')))['tb:auth'] as { token: string }).token;
  expect(await bg(ext, { type: 'auth.signOut' })).toMatchObject({ ok: true });
  const res = await web.request.get(`${SERVER}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(401);
  await web.request.post(`${SERVER}/logout`, { headers: { origin: SERVER } });
  await ext.close();
  await web.close();
});

test('X-05: signed out, the auth window shows the login page and returns to the extension', async ({ context }) => {
  await context.clearCookies();
  const email = uniqueEmail(undefined, 'win');
  const ext = await context.newPage();
  await ext.goto(`chrome-extension://${EXT_ID}/popup.html`);
  const authWindow = context.waitForEvent('page', (p) => p.url().startsWith(SERVER));
  const signIn = bg<{ ok: boolean; user?: { email: string } }>(ext, { type: 'auth.signIn' });
  const win = await authWindow;
  await win.waitForURL(/\/login\?next=%2Fext%2Fconnect/);
  await expect(win.getByRole('heading', { name: /Connect the .* extension/ })).toBeVisible();
  await hydrated(win);
  await showPassword(win);
  await win.getByLabel('Work email').fill(email);
  await win.getByLabel('Password').fill('extension window pass');
  await win.getByRole('button', { name: 'Continue', exact: true }).click();
  expect(await signIn).toMatchObject({ ok: true, user: { email } });
  expect(await bg(ext, { type: 'auth.signOut' })).toMatchObject({ ok: true });
  await ext.close();
});

test('X-05: the popup shows sign in when signed out, then the account after the flow', async ({ context }) => {
  await context.clearCookies();
  const email = uniqueEmail(undefined, 'pop');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  const card = popup.getByTestId('signed-out');
  await expect(card).toBeVisible();
  const authWindow = context.waitForEvent('page', (p) => p.url().startsWith(SERVER));
  await card.getByRole('button', { name: 'Sign in' }).click();
  const win = await authWindow;
  await win.waitForURL(/\/login\?next=%2Fext%2Fconnect/);
  await hydrated(win);
  await showPassword(win);
  await win.getByLabel('Work email').fill(email);
  await win.getByLabel('Password').fill('popup flow pass');
  await win.getByRole('button', { name: 'Continue', exact: true }).click();

  await expect(popup.getByTestId('signed-in')).toContainText(email);
  await expect(popup.getByTestId('signed-out')).toHaveCount(0);

  // The web session from the auth window lists this browser.
  const web = await context.newPage();
  await web.goto(`${SERVER}/settings/browsers`);
  await hydrated(web);
  await expect(web.getByTestId('device-list')).toContainText(/on (Linux|macOS|Windows)/);

  // Sign out from the popup: back to the sign-in card.
  await popup.getByTestId('signed-in').getByRole('button', { name: 'Sign out' }).click();
  await expect(popup.getByTestId('signed-out')).toBeVisible();
  await web.reload();
  await expect(web.getByText('No browser is connected yet.')).toBeVisible();
  await web.close();
  await popup.close();
});
