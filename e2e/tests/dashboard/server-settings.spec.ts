// Settings > Server, instance settings (D-187): the five sections, inline validation, the
// "Set by environment" lock, a section save that applies without a restart, the API key shown
// only by its last four characters, the two test buttons, the admin-only guard, and a workspace's
// defaults for new projects. Signs in as the seeded first account (dana@toolbar.test, the
// instance admin while ADMIN_EMAILS is empty; needs AUTH_DEV_PASSWORD=1). Every change is put
// back at the end, so the other suites see the defaults.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { callbackHost } from '../../fixtures/net.ts';
import { SERVER, go, json, launch, me, newContext, signIn, toast, uniqueEmail } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

type Admin = { values: Record<string, unknown>; locked: Record<string, string | null>; stored: Record<string, boolean>; oidc: { configured: boolean } };

let browser: Browser;
let page: Page;
let initial: Admin;
let stub: Server;
let stubUrl = '';
const seen: string[] = [];

const settings = () => json<Admin>(page, 'GET', '/api/v1/admin/settings');
const field = (key: string) => page.getByTestId(`setting-${key}`);

test.beforeAll(async () => {
  browser = await launch();
  page = await (await newContext(browser)).newPage();
  await signIn(page, 'dana@toolbar.test', 'toolbar-dev-password');
  const r = await page.request.get(`${SERVER}/api/v1/admin/settings`);
  test.skip(r.status() !== 200, `dana@toolbar.test is not the instance admin here (${r.status()}): run on a seeded server with ADMIN_EMAILS empty`);
  initial = (await r.json()) as Admin;
  // a stand-in OpenAI-compatible endpoint for Test connection
  stub = createServer((req, res) => {
    seen.push(`${req.url} ${req.headers.authorization ?? ''}`);
    res.writeHead(req.headers.authorization === 'Bearer sk-e2e-good-00001234' ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'gpt-transcribe' }] }));
  });
  await new Promise<void>((r) => stub.listen(0, '0.0.0.0', () => r()));
  stubUrl = `http://${callbackHost()}:${(stub.address() as { port: number }).port}/v1`;
});

test.afterAll(async () => {
  if (initial) {
    // put back every field this file may have changed that the environment does not lock
    const keys = ['exportMaxMb', 'transcribeProvider', 'transcribeApiKey', 'transcribeBaseUrl', 'defaultMaskingPreset', 'oidcProviderName'];
    const body = Object.fromEntries(keys.filter((k) => !initial.locked[k] && !initial.stored[k]).map((k) => [k, null]));
    if (Object.keys(body).length) await json(page, 'PATCH', '/api/v1/admin/settings', body).catch(() => undefined);
  }
  await new Promise<void>((r) => (stub ? stub.close(() => r()) : r()));
  await browser?.close();
});

test('D-187: Settings > Server shows the five sections below branding', async () => {
  await go(page, '/settings/server');
  for (const s of ['signin', 'transcription', 'capture', 'sharing', 'limits']) await expect(page.getByTestId(`server-${s}`)).toBeVisible();
  await expect(page.getByTestId('server-signin').getByRole('heading', { name: 'Sign-in' })).toBeVisible();
  await expect(page.getByTestId('server-sharing').getByRole('heading', { name: 'Sharing and export' })).toBeVisible();
  // the provider itself comes from the environment, read-only
  await expect(page.getByTestId('server-signin').getByText('Set by environment').first()).toBeVisible();
});

test('D-187: a field the environment sets is locked with a badge', async () => {
  const locked = Object.entries(initial.locked).find(([, v]) => v);
  test.skip(!locked, 'no instance setting is set by the environment on this server (scripts/e2e-all.sh sets ALLOWED_EMAIL_DOMAINS)');
  const [key, envName] = locked!;
  await go(page, '/settings/server');
  const ctl = field(key);
  await expect(ctl).toHaveAttribute('data-locked', 'true');
  await expect(ctl.locator('input, select').first()).toBeDisabled();
  const row = page.locator('.f').filter({ has: ctl });
  await expect(row.getByText('Set by environment')).toBeVisible();
  await expect(row.getByText(`Set by ${envName} on the server.`)).toBeVisible();
  // and the API refuses a change
  const r = await page.request.patch(`${SERVER}/api/v1/admin/settings`, { headers: { origin: SERVER, 'content-type': 'application/json' }, data: JSON.stringify({ [key]: null }) });
  expect(r.status()).toBe(409);
});

test('D-187: validation shows inline, a section saves its fields, and Reset puts the default back', async () => {
  test.skip(!!initial.locked.exportMaxMb, 'EXPORT_MAX_MB is set on this server');
  await go(page, '/settings/server');
  const input = field('exportMaxMb').locator('input');
  const save = page.getByTestId('save-sharing');
  await expect(save).toBeDisabled();
  await input.fill('0');
  await expect(page.getByTestId('error-exportMaxMb')).toHaveText('At least 1 MB');
  await expect(save).toBeDisabled();
  await input.fill('150');
  await expect(page.getByTestId('error-exportMaxMb')).toHaveCount(0);
  await save.click();
  await toast(page, 'Settings saved');
  expect((await settings()).values.exportMaxMb).toBe(150);
  await page.reload();
  await expect(field('exportMaxMb').locator('input')).toHaveValue('150');
  await page.getByTestId('reset-exportMaxMb').click();
  await toast(page, 'Export page size reset');
  await expect(field('exportMaxMb').locator('input')).toHaveValue('200');
  expect((await settings()).values.exportMaxMb).toBe(200);
});

test('D-187: transcription: pick the hosted provider, Test connection, the key comes back masked', async () => {
  test.skip(!!initial.locked.transcribeProvider || !!initial.locked.transcribeApiKey || !!initial.locked.transcribeBaseUrl, 'the transcription provider is set by the environment here');
  await go(page, '/settings/server');
  const sec = page.getByTestId('server-transcription');
  await field('transcribeProvider').locator('select').selectOption('openai');
  await expect(field('transcribeApiKey')).toBeVisible();
  await field('transcribeBaseUrl').locator('input').fill(stubUrl);
  await field('transcribeApiKey').locator('input').fill('sk-e2e-wrong-0000');
  await page.getByTestId('test-transcription').click();
  await expect(sec.getByTestId('test-result-transcription')).toContainText('refused the key (HTTP 401)');
  await field('transcribeApiKey').locator('input').fill('sk-e2e-good-00001234');
  await page.getByTestId('test-transcription').click();
  await expect(sec.getByTestId('test-result-transcription')).toHaveText(`${stubUrl} accepted the key and offers gpt-transcribe.`);
  expect(seen.at(-1)).toBe('/v1/models Bearer sk-e2e-good-00001234');
  await page.getByTestId('save-transcription').click();
  await toast(page, 'Settings saved');
  const after = await settings();
  expect(after.values).toMatchObject({ transcribeProvider: 'openai', transcribeApiKey: '...1234', transcribeBaseUrl: stubUrl });
  expect(JSON.stringify(after)).not.toContain('sk-e2e-good');
  await page.reload();
  const key = field('transcribeApiKey').locator('input');
  await expect(key).toHaveValue('');
  await expect(key).toHaveAttribute('placeholder', 'Saved: ...1234. Type to replace');
  // Test connection with the key left blank uses the stored one
  await page.getByTestId('test-transcription').click();
  await expect(sec.getByTestId('test-result-transcription')).toContainText('accepted the key');
  await page.getByTestId('reset-transcribeApiKey').click();
  await toast(page, 'API key reset');
  await expect(page.getByTestId('reset-transcribeApiKey')).toHaveCount(0);
});

test('D-187: Test discovery URL reads the provider of the environment', async () => {
  test.skip(!initial.oidc.configured, 'no OIDC provider on this server');
  await go(page, '/settings/server');
  await page.getByTestId('test-oidc').click();
  await expect(page.getByTestId('test-result-signin')).toContainText('Found the provider');
});

test('D-187: a workspace admin sets the defaults of new projects', async () => {
  await go(page, '/settings/workspace');
  const sec = page.getByTestId('ws-project-defaults');
  await expect(sec).toBeVisible();
  await sec.getByTestId('ws-default-preset').selectOption('production');
  await expect.poll(async () => (await json<{ settings: { defaultMaskingPreset: string | null } }>(page, 'GET', `/api/v1/workspaces/${(await me(page)).activeWorkspaceId}`)).settings.defaultMaskingPreset).toBe('production');
  await go(page, '/settings/projects');
  await page.getByTestId('add-project').click();
  await expect(page.getByTestId('preset-production').locator('input')).toBeChecked();
  await page.keyboard.press('Escape');
  await go(page, '/settings/workspace');
  await page.getByTestId('ws-default-preset').selectOption('');
  await expect.poll(async () => (await json<{ settings: { defaultMaskingPreset: string | null } }>(page, 'GET', `/api/v1/workspaces/${(await me(page)).activeWorkspaceId}`)).settings.defaultMaskingPreset).toBeNull();
});

test('D-187: someone who is not the instance admin gets 404 on the page and 403 from the API', async () => {
  const other = await (await newContext(browser)).newPage();
  await signIn(other, uniqueEmail('test', 'notadmin'));
  const res = await other.goto(`${SERVER}/settings/server`);
  expect(res?.status()).toBe(404);
  const r = await other.request.patch(`${SERVER}/api/v1/admin/settings`, { headers: { origin: SERVER, 'content-type': 'application/json' }, data: '{"shareLinkDays":1}' });
  expect(r.status()).toBe(403);
  await other.close();
});
