// J-217 provider buttons. Runs when E2E_PROVIDERS=1 and the server was started with
//   GITHUB_CLIENT_ID, GOOGLE_CLIENT_ID (any value: the test stops at the provider's page) and
//   OIDC_1_ID=mocksso OIDC_1_NAME="Mock SSO" OIDC_1_DISCOVERY_URL=<mock>/mocksso/.well-known/openid-configuration
// with a mock OIDC provider, e.g. docker run -p 3311:8080 -e JSON_CONFIG='{"interactiveLogin":true}'
//   ghcr.io/navikt/mock-oauth2-server:2.1.10
import { test, expect, chromium, type Browser } from '@playwright/test';
import { SERVER, api, hydrated, uniqueEmail } from './helpers.ts';

test.skip(process.env.E2E_PROVIDERS !== '1', 'set E2E_PROVIDERS=1 with providers configured on the server');

let browser: Browser;
test.beforeAll(async () => {
  browser = await chromium.launch();
});
test.afterAll(async () => browser.close());

test('J-217: GitHub, Google and generic OIDC buttons in order, no Apple', async () => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${SERVER}/login`);
  const names = await page.locator('[data-provider]').allTextContents();
  expect(names.map((n) => n.replace(/^[\s\S]*Continue with /, '').trim())).toEqual(['GitHub', 'Google', 'Mock SSO']);
  await expect(page.getByRole('button', { name: /Apple/ })).toHaveCount(0);
});

for (const [id, host] of [
  ['github', 'https://github.com/'],
  ['google', 'https://accounts.google.com/'],
] as const) {
  test(`J-217: ${id} hands off to the provider with our callback`, async () => {
    const page = await (await browser.newContext()).newPage();
    await page.goto(`${SERVER}/login`);
    await hydrated(page);
    // The first request to the provider is its authorize URL (redirects are not routable, so
    // stop the page right after it instead of loading the provider).
    const authorize = page.waitForRequest((r) => r.url().startsWith(host));
    await page.locator(`[data-provider="${id}"]`).click();
    const u = new URL((await authorize).url());
    await page.goto('about:blank');
    expect(u.searchParams.get('client_id')).toMatch(/^dummy/);
    expect(u.searchParams.get('redirect_uri')).toBe(`${SERVER}/api/auth/callback/${id}`);
  });
}

test('J-217: generic OIDC sign-in end to end creates the account and a workspace', async () => {
  const page = await (await browser.newContext()).newPage();
  const email = uniqueEmail(undefined, 'sso');
  await page.goto(`${SERVER}/login`);
  await hydrated(page);
  await page.locator('[data-provider="mocksso"]').click();
  await page.waitForURL(/\/mocksso\/authorize/);
  await page.locator('input[name=username]').fill(`sso-${email}`);
  await page.locator('textarea[name=claims]').fill(JSON.stringify({ email, email_verified: true, name: 'Sso Person' }));
  await page.getByRole('button', { name: 'Sign-in' }).or(page.locator('input[type=submit]')).first().click();
  await page.waitForURL(`${SERVER}/`);
  const me = await api<{ email: string; name: string }>(page, 'GET', '/api/v1/me');
  expect(me.body).toMatchObject({ email, name: 'Sso Person' });
  const ws = await api<{ items: { role: string }[] }>(page, 'GET', '/api/v1/workspaces');
  expect(ws.body.items[0]).toMatchObject({ role: 'admin' });
});
