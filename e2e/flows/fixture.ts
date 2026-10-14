// User journeys (docs/jam/flows.md) end to end against the real stack: docker compose on
// SERVER_URL, the lab on LAB_URL, and the extension build a user installs. Nothing is mocked
// and no test hook drives the product: keyboard chords go through the X server with xdotool
// (Chromium routes them to the extension's commands, as for a person), pointer actions go to
// the page, and the editor is the extension frame inside the page.
//
// Build: FLOWS_EXT_BUILD names the folder under apps/extension/.output (default chrome-mv3,
// the release build with its closed shadow root). The in-page bar and toasts are therefore not
// reachable from here; the specs check outcomes through the clipboard, the editor frame, the
// server and the web pages instead.
import { test as base, chromium, expect, type Browser, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const EXT_ID = 'fmongfmimgdafigcahdpofnmmhljpnei';
export const DISPLAY = process.env.E2E_DISPLAY ?? ':120';
export const LAB_URL = process.env.LAB_URL ?? 'http://localhost:5173';
export const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000';
export const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
export const ROOT = path.resolve(import.meta.dirname, '../..');
export const EXT_DIR = path.join(ROOT, 'apps/extension/.output', process.env.FLOWS_EXT_BUILD ?? 'chrome-mv3');
/** Screenshots for a person to review; outside test-results, which every run clears. */
export const SHOTS = path.join(ROOT, 'e2e/flows-shots');

const run = Date.now().toString(36);
/** Second CDP client for the action popup; 9224 to 9226 belong to the shared browser. */
const CDP_PORT = Number(process.env.FLOWS_CDP_PORT ?? 9341);
export const PASSWORD = 'nib flows password';

/** A capture made by a flow, as the share link and the API know it. */
export interface Made {
  id: string;
  shareUrl: string;
  title: string;
}

export interface Nib {
  context: BrowserContext;
  sw: () => Promise<Worker>;
  email: string;
  /** Captures made by earlier flows in this worker, so later flows reuse them. */
  made: Partial<Record<'screenshot' | 'video' | 'replay', Made>>;
}

// ---------------------------------------------------------------- X input

function xdo(...args: string[]) {
  return execFileSync('xdotool', args, { env: { ...process.env, DISPLAY }, encoding: 'utf8' }).trim();
}

/**
 * Press a key chord in the browser window that shows `page`, the way a person does: the
 * window gets X focus and the keys go through the X server, so Chromium's command shortcuts
 * (chrome.commands) fire. Playwright's keyboard goes to the renderer and never reaches them.
 */
export async function chord(page: Page, keys: string) {
  const win = await windowOf(page);
  xdo('windowactivate', '--sync', win);
  xdo('key', '--clearmodifiers', keys);
}

/** The X window that shows `page`: mark the tab title, find the window by it, restore it. */
async function windowOf(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.bringToFront();
    const marker = `nib-${Math.random().toString(36).slice(2, 8)}`;
    const title = await page.title();
    await page.evaluate((m) => (document.title = m), marker);
    let win = '';
    for (let i = 0; i < 30 && !win; i++) {
      try {
        win = xdo('search', '--name', marker).split('\n')[0] ?? '';
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    await page.evaluate((t) => (document.title = t), title);
    if (win) return win;
  }
  // the title did not reach the window manager: with one visible browser window, use it
  const all = xdo('search', '--onlyvisible', '--name', 'Chrom').split('\n').filter(Boolean);
  if (all.length === 1) return all[0]!;
  throw new Error(`no X window for ${page.url()} (${all.length} candidates)`);
}

/** The X clipboard, which is what the user pastes from. */
export function clipboard(): string {
  try {
    return execFileSync('xclip', ['-selection', 'clipboard', '-o'], { env: { ...process.env, DISPLAY }, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- pages

export async function hydrated(page: Page) {
  await page.waitForLoadState('networkidle');
}

export async function labPage(context: BrowserContext, p = '/'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(LAB_URL + p);
  await page.waitForLoadState('load');
  return page;
}

/** Open the toolbar popup with its shortcut (Ctrl+Shift+Y) over `page`. */
export async function openPopup(context: BrowserContext, page: Page): Promise<Page> {
  // Playwright's persistent context does not surface the action popup as a page, and a CDP
  // client attached before the popup opened does not either; a fresh CDP connection does.
  const holder = context as BrowserContext & { __cdp?: Browser };
  const isPopup = (p: Page) => p.url().startsWith(`chrome-extension://${EXT_ID}/popup.html`);
  await holder.__cdp?.close().catch(() => undefined);
  await chord(page, 'ctrl+shift+y');
  let popup: Page | undefined;
  await expect
    .poll(
      async () => {
        await holder.__cdp?.close().catch(() => undefined);
        holder.__cdp = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
        popup = holder.__cdp.contexts().flatMap((c) => c.pages()).find(isPopup);
        return !!popup;
      },
      { timeout: 10_000, message: 'the popup opened' },
    )
    .toBe(true);
  await popup!.locator('[data-popup][data-loading="false"]').waitFor();
  return popup!;
}

/** The editor frame the extension opens over the page after a capture. */
export async function editorFrame(page: Page, timeout = 30_000): Promise<Frame> {
  const t0 = Date.now();
  for (;;) {
    const f = page.frames().find((x) => x.url().startsWith(`chrome-extension://${EXT_ID}/editor.html`));
    if (f) {
      await f.getByTestId('editor').waitFor({ timeout });
      await f.getByTestId('field').waitFor({ timeout });
      return f;
    }
    if (Date.now() - t0 > timeout) throw new Error('the editor did not open');
    await page.waitForTimeout(100);
  }
}

/** Fill the title and create with Ctrl+Enter (J-220); returns the copied share link. */
export async function createFromEditor(page: Page, f: Frame, title: string): Promise<string> {
  await f.getByTestId('field').click();
  await page.keyboard.type(title);
  const before = clipboard();
  await page.keyboard.press('Control+Enter');
  let link = '';
  await expect
    .poll(
      async () => {
        link = clipboard();
        return link === before ? '' : link;
      },
      { timeout: 30_000, message: 'share link on the clipboard' },
    )
    .toMatch(new RegExp(`^${SERVER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/s/[A-Za-z0-9_-]+$`));
  return link;
}

// ---------------------------------------------------------------- server

/** API call with the persistent context's web session (the auth window signed it in). */
export async function api<T>(context: BrowserContext, method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await context.request.fetch(`${SERVER}${p}`, {
    method,
    headers: body === undefined ? { origin: SERVER } : { 'content-type': 'application/json', origin: SERVER },
    data: body === undefined ? undefined : JSON.stringify(body),
    failOnStatusCode: false,
  });
  return { status: r.status(), body: (await r.json().catch(() => null)) as T };
}

/** The capture behind a share link. */
export async function captureOf(context: BrowserContext, shareUrl: string): Promise<{ id: string; status: string; kind: string; title: string }> {
  const token = shareUrl.split('/s/')[1]!;
  const r = await api<{ recordingId: string }>(context, 'GET', `/api/v1/share/${token}`);
  expect(r.status, `resolve ${shareUrl}`).toBe(200);
  const rec = await api<{ id: string; status: string; kind: string; title: string }>(context, 'GET', `/api/v1/recordings/${r.body.recordingId}`);
  expect(rec.status).toBe(200);
  return rec.body;
}

export async function waitReady(context: BrowserContext, id: string, timeout = 120_000) {
  await expect
    .poll(async () => (await api<{ status: string }>(context, 'GET', `/api/v1/recordings/${id}`)).body?.status, { timeout, intervals: [1000], message: `capture ${id} ready` })
    .toBe('ready');
}

/** A picture of the whole X screen: shows the in-page UI in the closed shadow root and popups. */
export function xshot(name: string) {
  try {
    execFileSync('import', ['-window', 'root', saveShot(name)], { env: { ...process.env, DISPLAY } });
  } catch {
    /* imagemagick missing */
  }
}

export function saveShot(name: string) {
  fs.mkdirSync(SHOTS, { recursive: true });
  return path.join(SHOTS, `${name}.png`);
}

// ---------------------------------------------------------------- sign-in (flow O)

/**
 * Connect the extension the way a new user does: popup, Sign in, the auth window opens on the
 * login page, the user creates an account with an email and a password, the window closes and
 * the popup shows the account. Leaves the web session signed in too (the window shares the
 * profile's cookies).
 */
export async function connectExtension(context: BrowserContext, email: string) {
  const lab = await labPage(context);
  const popup = await openPopup(context, lab);
  const card = popup.getByTestId('signed-out');
  await expect(card).toBeVisible();
  const authWindow = context.waitForEvent('page', (p) => p.url().startsWith(SERVER));
  await card.getByRole('button', { name: 'Sign in' }).click();
  const win = await authWindow;
  await win.waitForURL(/\/login\?next=%2Fext%2Fconnect/);
  await expect(win.getByRole('heading', { name: /Connect the Nib extension/ })).toBeVisible();
  await hydrated(win);
  await expect(async () => {
    if (!(await win.getByLabel('Password').isVisible())) await win.getByRole('button', { name: 'Use a password instead' }).click({ timeout: 2000 });
    await expect(win.getByLabel('Password')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await win.getByLabel('Work email').fill(email);
  await win.getByLabel('Password').fill(PASSWORD);
  await win.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(popup.getByTestId('signed-in')).toContainText(email, { timeout: 30_000 });
  return { lab, popup };
}

// ---------------------------------------------------------------- fixture

export const test = base.extend<{ context: BrowserContext }, { nib: Nib }>({
  nib: [
    async ({}, use) => {
      if (!fs.existsSync(path.join(EXT_DIR, 'manifest.json')))
        throw new Error(`No extension build at ${EXT_DIR}. Run: pnpm --filter @toolbar/extension build`);
      if (DISPLAY === ':99') throw new Error('Display :99 belongs to the shared browser');
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-flows-'));
      fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
      fs.writeFileSync(path.join(userDataDir, 'Default', 'Preferences'), JSON.stringify({ extensions: { pinned_extensions: [EXT_ID] } }));
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        env: { ...process.env, DISPLAY },
        viewport: null,
        args: [
          `--disable-extensions-except=${EXT_DIR}`,
          `--load-extension=${EXT_DIR}`,
          `--allowlisted-extension-id=${EXT_ID}`,
          // No --use-fake-ui-for-media-stream or --use-fake-device-for-media-stream: with either
          // one, getUserMedia on a tabCapture stream id fails with "Requested device not found".
          '--window-position=0,0',
          '--window-size=1440,900',
          '--force-device-scale-factor=1',
          `--remote-debugging-port=${CDP_PORT}`,
        ],
      });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: LAB_URL });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });
      const sw = async () => context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`)) ?? (await context.waitForEvent('serviceworker'));
      await sw();
      const email = `flows-${run}@flows${run}.test`;
      const nib: Nib = { context, sw, email, made: {} };
      const { lab, popup } = await connectExtension(context, email);
      await popup.close();
      await lab.close();
      await use(nib);
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  context: async ({ nib }, use) => use(nib.context),
});

export { expect };

/** On failure, keep a picture of the whole X screen: popups and the closed shadow root show there. */
test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus) return;
  try {
    execFileSync('import', ['-window', 'root', info.outputPath('screen.png')], { env: { ...process.env, DISPLAY } });
  } catch {
    /* imagemagick missing */
  }
});
