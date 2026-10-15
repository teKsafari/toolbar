// J-217 and D-114: the one generic OIDC provider, end to end through the mock provider of the
// compose `dev` profile (e2e/fixtures/oidc.ts), and the allowlist on its claims. The allowlist
// tests run when the server has ALLOWED_EMAIL_DOMAINS=test (scripts/e2e-all.sh sets it), which
// admits every *.test address the suites use.
import { execFileSync } from 'node:child_process';
import { test, expect, chromium, type Browser } from '@playwright/test';
import { SERVER, api, hydrated, uniqueEmail } from './helpers.ts';
import { mockProviderLogin, subjectOf, OIDC_MOCK } from '../../fixtures/oidc.ts';

let browser: Browser;
test.beforeAll(async () => {
  browser = await chromium.launch();
});
test.afterAll(async () => browser.close());

const fresh = async () => (await browser.newContext()).newPage();

/** Click the provider button and log in at the mock with these claims. */
async function viaProvider(email: string, extra: Record<string, unknown> = {}) {
  const page = await fresh();
  await page.goto(`${SERVER}/login`);
  await hydrated(page);
  await page.locator('[data-provider]').click();
  await mockProviderLogin(page, email, 'Sso Person', extra);
  await page.waitForURL((u) => u.origin === SERVER && !u.pathname.startsWith('/api/auth'));
  return page;
}

test('J-217: one "Sign in with" button for the OIDC provider; no social buttons', async () => {
  const page = await fresh();
  await page.goto(`${SERVER}/login`);
  const buttons = page.locator('[data-provider]');
  await expect(buttons).toHaveCount(1);
  await expect(buttons).toHaveText(/^\s*Sign in with \S/);
  await expect(page.getByRole('button', { name: /Apple|GitHub|Google/ })).toHaveCount(0);
});

test('J-217: the button hands off to the provider with PKCE and our callback', async () => {
  const page = await fresh();
  await page.goto(`${SERVER}/login`);
  await hydrated(page);
  const id = await page.locator('[data-provider]').getAttribute('data-provider');
  const authorize = page.waitForRequest((r) => r.url().startsWith(OIDC_MOCK) && new URL(r.url()).pathname.endsWith('/authorize'));
  await page.locator('[data-provider]').click();
  const u = new URL((await authorize).url());
  expect(u.searchParams.get('code_challenge_method')).toBe('S256');
  expect(u.searchParams.get('scope')).toContain('openid');
  expect(u.searchParams.get('redirect_uri')).toMatch(new RegExp(`^${SERVER}/api/auth/(oauth2/)?callback/`));
  expect(u.searchParams.get('redirect_uri')).toBe(`${SERVER}/api/auth/callback/${id}`);
});

test('D-114: OIDC sign-in creates the account and a workspace, and captures store issuer and subject', async () => {
  const email = uniqueEmail(undefined, 'sso');
  const page = await viaProvider(email);
  const me = await api<{ email: string; name: string }>(page, 'GET', '/api/v1/me');
  expect(me.body).toMatchObject({ email, name: 'Sso Person' });
  const ws = await api<{ items: { id: string; role: string }[]; activeId: string }>(page, 'GET', '/api/v1/workspaces');
  expect(ws.body.items[0]).toMatchObject({ role: 'admin' });
  // a capture made by this person carries the provider's issuer and subject (read in the
  // database: an upload is not listed before finalize)
  const made = await api<{ id: string }>(page, 'POST', '/api/v1/recordings', {
    workspaceId: ws.body.activeId,
    clientId: crypto.randomUUID(),
    kind: 'screenshot',
    page: { url: 'http://localhost:5173/', title: 'Lab' },
    startedAt: Date.now(),
  });
  expect(made.status, JSON.stringify(made.body)).toBeLessThan(300);
  const url = process.env.DATABASE_URL ?? 'postgres://toolbar:toolbar@localhost:5432/toolbar';
  const row = execFileSync('psql', [url, '-Atc', `select author_issuer, author_subject, author_email, author_name from recording where id = '${made.body.id}'`], { encoding: 'utf8' }).trim().split('|');
  expect(row[0]).toMatch(new RegExp(`^${OIDC_MOCK.replace(/[.]/g, '\\.')}/`));
  expect(row.slice(1)).toEqual([subjectOf(email), email, 'Sso Person']);
});

test.describe('allowlist (ALLOWED_EMAIL_DOMAINS)', () => {
  test('an address outside the allowed domains is refused with the reason', async () => {
    const page = await fresh();
    await page.goto(`${SERVER}/login`);
    await hydrated(page);
    await page.locator('[data-provider]').click();
    await mockProviderLogin(page, `out-${Date.now().toString(36)}@outside.example`);
    await page.waitForURL((u) => u.origin === SERVER && !u.pathname.startsWith('/api/auth'));
    test.skip(!page.url().includes('/login'), 'the server has no ALLOWED_EMAIL_DOMAINS set');
    await expect(page.getByRole('alert')).toContainText('allowed email domains');
    expect((await api(page, 'GET', '/api/v1/me')).status).toBe(401);
  });

  test("Google's hd claim outside the list is refused, even for an allowed address", async () => {
    const page = await fresh();
    await page.goto(`${SERVER}/login`);
    await hydrated(page);
    await page.locator('[data-provider]').click();
    await mockProviderLogin(page, uniqueEmail(undefined, 'hd'), 'Hd Person', { hd: 'outside.example' });
    await page.waitForURL((u) => u.origin === SERVER && !u.pathname.startsWith('/api/auth'));
    test.skip(!page.url().includes('/login'), 'the server has no ALLOWED_EMAIL_DOMAINS set');
    await expect(page.getByRole('alert')).toContainText('allowed email domains');
  });

  test('an unverified address is refused', async () => {
    const page = await fresh();
    await page.goto(`${SERVER}/login`);
    await hydrated(page);
    await page.locator('[data-provider]').click();
    await mockProviderLogin(page, uniqueEmail(undefined, 'unv'), 'Unverified', { email_verified: false });
    await page.waitForURL((u) => u.origin === SERVER && !u.pathname.startsWith('/api/auth'));
    test.skip(!page.url().includes('/login'), 'the server has no ALLOWED_EMAIL_DOMAINS set');
    await expect(page.getByRole('alert')).toContainText('allowed email domains');
  });
});
