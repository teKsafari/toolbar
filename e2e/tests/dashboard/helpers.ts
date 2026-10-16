// Helpers for the dashboard e2e specs. Chromium runs headed on the area's private display
// (E2E_DISPLAY, :116 for the dashboard; never :99) with fake media so the recorder page can
// capture a screen without a person.
import { chromium, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type IncomingMessage } from 'node:http';
import { DISPLAY } from '../../fixtures/extension.ts';
import { callbackHost } from '../../fixtures/net.ts';
import { SERVER, hydrated, showPassword, uniqueEmail } from '../auth/helpers.ts';
import { signInOidc } from '../../fixtures/oidc.ts';
import { browserEnv } from '../../fixtures/browser-env.ts';

export { SERVER, uniqueEmail };

export async function launch(): Promise<Browser> {
  return chromium.launch({
    headless: false,
    env: browserEnv(DISPLAY),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--auto-accept-this-tab-capture',
      '--no-first-run',
    ],
  });
}

export async function newContext(browser: Browser, opts: { width?: number; height?: number; dark?: boolean } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    colorScheme: opts.dark ? 'dark' : 'light',
    // microphone: without the grant, navigator.permissions.query reports 'denied' in a Playwright
    // context even though the fake device answers getUserMedia, and the link recorder's pre-check
    // then shows "Your browser blocks the microphone" (links.spec J-017/J-126; D-181)
    permissions: ['clipboard-read', 'clipboard-write', 'microphone'],
  });
  return ctx;
}

/**
 * Sign in, or sign up: the first sign-in creates the account and a workspace. A new address goes
 * through the mock OIDC provider (D-114); a seeded account (dana@toolbar.test) has only a
 * password, which needs AUTH_DEV_PASSWORD=1 on the server.
 */
export async function signIn(page: Page, email: string, password?: string) {
  if (!password) {
    await signInOidc(page, SERVER, email);
    await hydrated(page);
    return;
  }
  await page.goto(`${SERVER}/login`);
  await hydrated(page);
  await showPassword(page);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await hydrated(page);
}

export async function json<T = unknown>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const r = await page.request.fetch(`${SERVER}${path}`, {
    method,
    headers: { origin: SERVER, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(r.ok(), `${method} ${path} -> ${r.status()} ${await r.text()}`).toBe(true);
  return (await r.json()) as T;
}

export async function me(page: Page) {
  return json<{ id: string; activeWorkspaceId: string }>(page, 'GET', '/api/v1/me');
}

/** A toast with this text appears. */
export async function toast(page: Page, text: string | RegExp, timeout = 10_000) {
  await expect(page.getByRole('status').filter({ hasText: text }).or(page.getByRole('alert').filter({ hasText: text })).first()).toBeVisible({ timeout });
}

/** A small HTTP listener for webhook and Slack deliveries. */
/** A local HTTP listener that records what it receives (webhook and integration targets). */
export async function listener() {
  const seen: { url: string; headers: IncomingMessage['headers']; body: string }[] = [];
  let status = 200;
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push({ url: req.url!, headers: req.headers, body: b });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '0.0.0.0', () => r()));
  const port = (srv.address() as { port: number }).port;
  return {
    url: `http://${callbackHost()}:${port}`,
    seen,
    setStatus: (s: number) => (status = s),
    close: () => new Promise<void>((r) => srv.close(() => r())),
  };
}

/** Upload a generated video through the grid's drop zone (J-020). */
export async function dropVideo(page: Page, bytes: Buffer, name = 'clip.mp4', type = 'video/mp4') {
  const b64 = bytes.toString('base64');
  await page.evaluate(
    async ({ b64, name, type }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], name, { type }));
      const target = document.querySelector('[data-testid=grid-wrap]') as HTMLElement;
      target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    { b64, name, type },
  );
}

/** Navigate and wait until the app has hydrated (vite dev loads modules on first visit). */
export async function go(page: Page, path: string) {
  await page.goto(`${SERVER}${path}`);
  await page.waitForFunction(() => document.documentElement.hasAttribute('data-app-ready'), null, { timeout: 30_000 });
}
