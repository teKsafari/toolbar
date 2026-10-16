// A release-style build (no test hooks) made with WXT_SERVER_URL pointing at a local port: the
// popup must leave its spinner, name that server, and send the home button there, never to the
// localhost default. With nothing listening, it must say the server is unreachable (v0.1.0 bug:
// an endless spinner and a home button that opened http://localhost:3000).
import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DISPLAY, EXT_ID } from '../../fixtures/extension.ts';
import { browserEnv } from '../../fixtures/browser-env.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SUFFIX = '-e2e-server';
const EXT_DIR = path.join(ROOT, 'apps/extension/.output', `chrome-mv3${SUFFIX}`);

let port = 0;
let SERVER = '';

async function freePort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const p = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return p;
}

/** The build's server: answers the public branding endpoint and the dashboard root. */
async function startServer(): Promise<{ hits: string[]; close(): Promise<void> }> {
  const hits: string[] = [];
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url?.startsWith('/api/v1/branding')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'open-toolbar', accent: '#000000', onAccent: '#ffffff', version: 'e2e', defaultLogo: true, logo: { light: null, dark: null, icons: {} } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>dashboard</title><p>dashboard');
  });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  return { hits, close: () => new Promise((r) => srv.close(() => r())) };
}

async function launch(): Promise<BrowserContext> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-e2e-server-'));
  return chromium.launchPersistentContext(dir, {
    headless: false,
    env: browserEnv(DISPLAY),
    args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`],
  });
}

async function openPopup(context: BrowserContext): Promise<Page> {
  if (!context.serviceWorkers().length) await context.waitForEvent('serviceworker');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${EXT_ID}/popup.html`);
  // the spinner goes within the popup's own wait (8 s), never stays
  await popup.locator('[data-popup][data-loading="false"]').waitFor({ timeout: 15_000 });
  return popup;
}

/** Clicks home and returns the URL the new tab lands on. */
async function homeTarget(context: BrowserContext, popup: Page): Promise<string> {
  const opened = context.waitForEvent('page', { timeout: 10_000 });
  await popup.locator('[data-home]').click();
  const page = await opened;
  await page.waitForURL((u) => u.protocol.startsWith('http'), { timeout: 10_000 });
  return page.url();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  port = await freePort();
  SERVER = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, WXT_SERVER_URL: SERVER, WXT_OUT_SUFFIX: SUFFIX };
  delete env.WXT_TEST_HOOKS;
  execFileSync('pnpm', ['--filter', '@toolbar/extension', 'exec', 'wxt', 'build'], { cwd: ROOT, env, stdio: 'pipe' });
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8')) as { host_permissions: string[] };
  expect(manifest.host_permissions).toEqual([`${SERVER}/*`]);
});

test('a build for a reachable server: the popup loads, names it, and home opens it', async () => {
  const server = await startServer();
  const context = await launch();
  try {
    const popup = await openPopup(context);
    await expect(popup.locator('[data-popup-loading]')).toHaveCount(0);
    await expect(popup.locator('[data-sign-in]')).toBeVisible();
    await expect(popup.locator('[data-server-url]')).toHaveText(SERVER);
    await expect.poll(() => server.hits.some((h) => h.startsWith('GET /api/v1/branding'))).toBe(true);
    await expect(popup.locator('[data-server-error]')).toHaveCount(0);
    const target = await homeTarget(context, popup);
    expect(target).toBe(`${SERVER}/`);
    expect(target).not.toContain('localhost');
  } finally {
    await context.close();
    await server.close();
  }
});

test('a build for an unreachable server: the popup says so, offers a retry, and home still opens that server', async () => {
  const context = await launch();
  let server: Awaited<ReturnType<typeof startServer>> | null = null;
  try {
    const popup = await openPopup(context);
    await expect(popup.locator('[data-popup-loading]')).toHaveCount(0);
    await expect(popup.locator('[data-server-error]')).toContainText(`Cannot reach 127.0.0.1:${port}`);
    await expect(popup.locator('[data-server-url]')).toHaveText(SERVER);
    // the server comes up: Try again clears the message
    server = await startServer();
    await popup.locator('[data-retry]').click();
    await expect(popup.locator('[data-popup][data-loading="false"]')).toBeVisible();
    await expect(popup.locator('[data-server-error]')).toHaveCount(0);
    await expect(popup.locator('[data-sign-in]')).toBeVisible();
    expect(await homeTarget(context, popup)).toBe(`${SERVER}/`);
  } finally {
    await context.close();
    await server?.close();
  }
});
