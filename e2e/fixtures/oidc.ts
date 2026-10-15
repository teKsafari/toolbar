// Sign-in through the mock OpenID Connect provider of the compose `dev` profile (docs/scope.md,
// "Sign-in", D-114): ghcr.io/navikt/mock-oauth2-server with interactive login on
// http://oidc.localhost:3311. Browsers resolve *.localhost to this machine; the server container
// reaches the same name through host-gateway, so both see one issuer.
//
// Server settings for a run (scripts/e2e-all.sh sets them):
//   OIDC_ISSUER=http://oidc.localhost:3311/toolbar OIDC_CLIENT_ID=toolbar OIDC_CLIENT_SECRET=dev
//   OIDC_PROVIDER_NAME="Dev SSO"
import { expect, type Page } from '@playwright/test';

export const OIDC_MOCK = process.env.OIDC_MOCK_URL ?? 'http://oidc.localhost:3311';

/** The subject the mock gives a person: stable per address, so a second sign-in finds the account. */
export const subjectOf = (email: string) => `sub-${email.toLowerCase()}`;

/**
 * On the mock's login page (the browser was sent there by "Sign in with ..."): enter the subject
 * and the ID token claims, submit. The mock signs any claims it is given.
 */
export async function mockProviderLogin(page: Page, email: string, name = email.split('@')[0]!, extra: Record<string, unknown> = {}) {
  await page.waitForURL((u) => u.pathname.endsWith('/authorize'), { timeout: 30_000 });
  await page.locator('input[name=username]').fill(subjectOf(email));
  await page.locator('textarea[name=claims]').fill(JSON.stringify({ email, email_verified: true, name, ...extra }));
  await page.locator('input[type=submit], button[type=submit]').first().click();
}

/**
 * Sign in on the server's login page through its one provider button. `server` is the server's
 * origin; `next` the path to land on. Leaves the page signed in, on `next` (or wherever the
 * server sends a first sign-in).
 */
export async function signInOidc(page: Page, server: string, email: string, opts: { next?: string; name?: string } = {}) {
  const next = opts.next ?? '/';
  await page.goto(`${server}/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`);
  await page.waitForLoadState('networkidle');
  const button = page.locator('[data-provider]');
  await expect(button, 'the server offers no OIDC provider: set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET (e2e/fixtures/oidc.ts)').toHaveCount(1);
  await expect(button).toHaveText(/^\s*Sign in with /);
  await button.click();
  await mockProviderLogin(page, email, opts.name);
  await page.waitForURL((u) => u.origin === new URL(server).origin && !u.pathname.startsWith('/login') && !u.pathname.startsWith('/api/auth'), { timeout: 30_000 });
}
