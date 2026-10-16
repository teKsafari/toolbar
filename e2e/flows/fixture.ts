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
import { test as base, chromium, expect, request, type Browser, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateDisplay } from '../fixtures/xvfb.ts';
import { mockProviderLogin } from '../fixtures/oidc.ts';
import { browserEnv } from '../fixtures/browser-env.ts';
export { signInOidc } from '../fixtures/oidc.ts';
export { featureOn, pausedReason } from '../fixtures/features.ts';

export const EXT_ID = 'laobpjhffglefallhhojihfdbdkoendk';
export const DISPLAY = process.env.E2E_DISPLAY ?? ':120';
/**
 * The display the X helpers below act on: DISPLAY, or a private one while a flow runs a browser
 * there (withPrivateDisplay). One worker runs the flows one at a time, so one setting is enough.
 */
let xDisplay = DISPLAY;
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

/** A capture made by a flow, as the share link and the API know it. */
export interface Made {
  id: string;
  shareUrl: string;
  title: string;
}

export interface Tb {
  context: BrowserContext;
  sw: () => Promise<Worker>;
  email: string;
  /** Captures made by earlier flows in this worker, so later flows reuse them. */
  made: Partial<Record<'screenshot' | 'video' | 'replay', Made>>;
}

// ---------------------------------------------------------------- X input

function xdo(...args: string[]) {
  return execFileSync('xdotool', args, { env: { ...process.env, DISPLAY: xDisplay }, encoding: 'utf8' }).trim();
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
    const marker = `tb-${Math.random().toString(36).slice(2, 8)}`;
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
    return execFileSync('xclip', ['-selection', 'clipboard', '-o'], { env: { ...process.env, DISPLAY: xDisplay }, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** Chrome's share picker window, once it is up; '' when none appeared within `timeout`. */
async function pickerWindow(timeout: number): Promise<string> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const w = xdo('search', '--onlyvisible', '--name', 'Choose what to share').split('\n')[0];
      if (w) return w;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return '';
}

function clickAt(x: number, y: number) {
  xdo('mousemove', '--sync', String(Math.round(x)), String(Math.round(y)));
  xdo('click', '1');
}

/**
 * Pick "Entire Screen" in Chrome's share picker with real pointer clicks: the tab (when
 * `tab` is set; a request for a monitor surface opens on it already), the one screen
 * thumbnail, then Share. The picker is a 600x492 top-level window centred over the browser;
 * the targets are offsets in it (docs/spikes.md S2). Returns the clicks used, or 0 when no
 * picker opened.
 */
export async function pickEntireScreen(opts: { tab?: boolean; timeout?: number } = {}): Promise<number> {
  const win = await pickerWindow(opts.timeout ?? 15_000);
  if (!win) return 0;
  const geo = xdo('getwindowgeometry', win);
  const [, x, y] = geo.match(/Position: (\d+),(\d+)/)!.map(Number);
  const [, w, h] = geo.match(/Geometry: (\d+)x(\d+)/)!.map(Number);
  await new Promise((r) => setTimeout(r, 700)); // thumbnails paint after the window maps
  let clicks = 0;
  if (opts.tab) {
    clickAt(x! + w! * 0.81, y! + 52);
    clicks++;
    await new Promise((r) => setTimeout(r, 700));
  }
  clickAt(x! + 169, y! + 181);
  await new Promise((r) => setTimeout(r, 300));
  clickAt(x! + w! - 57, y! + h! - 39);
  clicks += 2;
  // the picker closes on Share
  for (let i = 0; i < 50; i++) {
    if (!(await pickerWindow(50))) return clicks;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('the share picker stayed open after Share');
}

/** One screen pixel as [r, g, b]. */
function pixel(x: number, y: number): [number, number, number] {
  const out = execFileSync('import', ['-window', 'root', '-crop', `1x1+${Math.round(x)}+${Math.round(y)}`, '-depth', '8', 'txt:-'], { env: { ...process.env, DISPLAY: xDisplay }, encoding: 'utf8' });
  const m = out.match(/#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})/);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [0, 0, 0];
}
const white = ([r, g, b]: number[]) => r! > 245 && g! > 245 && b! > 245;
const dimmed = ([r, g, b]: number[]) => r! < 130 && g! < 130 && b! < 130;

/**
 * For a web page, Chrome's share picker is a tab-modal dialog inside the browser window (no X
 * window of its own): 610 px wide, centred, its top 83 px below the window's top, over a dimmed
 * page. This finds it by its pixels, clicks the Entire Screen tab, the thumbnail and Share, and
 * waits for the page to undim. `win` is the browser window's frame; returns the clicks, or 0
 * when no picker showed within `timeout`.
 */
export async function pickEntireScreenInPage(win = { x: 0, y: 0, w: 1440 }, timeout = 15_000): Promise<number> {
  const left = win.x + (win.w - 610) / 2;
  const top = win.y + 83;
  const up = () => white(pixel(left + 8, top + 300)) && dimmed(pixel(left - 30, top + 300));
  const t0 = Date.now();
  while (!up()) {
    if (Date.now() - t0 > timeout) return 0;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 500));
  const until = async (ok: () => boolean, ms: number) => {
    for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 100))) if (ok()) return true;
    return false;
  };
  // Share is light grey (#e5e5e5) until the screen thumbnail is selected, then blue (#0b57d0).
  // Under load the tab strip, the thumbnail and the button can each take a click late, so every
  // step waits for its outcome on screen instead of a fixed pause, and repeats what did not take
  // (D-178 repeated only the thumbnail and Share, and a full flows run on a busy machine still
  // failed that way, D-179). The user's clicks stay 3.
  const share = { x: left + 610 - 57, y: top + 574 };
  const shareOn = () => { const [r, g, b] = pixel(share.x, share.y); return b > 150 && r < 90 && g < 140; };
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt) console.log(`picker: still open after Share (Share ${shareOn() ? 'enabled' : 'disabled'}), try ${attempt + 1}`);
    if (!shareOn()) {
      clickAt(left + 491, top + 96); // Entire Screen (a request for a screen opens on it already)
      await new Promise((r) => setTimeout(r, attempt ? 1500 : 1000)); // the thumbnail paints
      clickAt(left + 170, top + 225); // the screen
      if (!(await until(shareOn, 4000))) continue;
    }
    clickAt(share.x, share.y);
    if (await until(() => !up(), 6000)) return 3;
  }
  xshot('picker-stuck');
  throw new Error(`the share picker stayed open after Share (Share ${shareOn() ? 'enabled' : 'disabled'}; screen in flows-shots/picker-stuck.png)`);
}

/**
 * Run `fn` with a private X display (Xvfb plus openbox) that the X helpers act on meanwhile.
 * Chrome's share picker reads every window on its display and dies with X BadWindow far more
 * often when other browsers draw there (docs/spikes.md S2).
 */
export async function withPrivateDisplay<T>(fn: (display: string) => Promise<T>): Promise<T> {
  const x = await privateDisplay(Number(DISPLAY.slice(1)) + 40);
  const before = xDisplay;
  xDisplay = x.display;
  try {
    return await fn(x.display);
  } finally {
    xDisplay = before;
    x.stop();
  }
}

/**
 * Take a private X display (Xvfb plus openbox) for a flow that runs a browser of its own across
 * several tests: the X helpers act on it until `release`. The display number is DISPLAY plus
 * `offset` or the next free one (:179 for the Part 2 scenario under the default :120).
 */
export async function holdPrivateDisplay(offset: number): Promise<{ display: string; release(): void }> {
  const x = await privateDisplay(Number(DISPLAY.slice(1)) + offset);
  const before = xDisplay;
  xDisplay = x.display;
  return {
    display: x.display,
    release: () => {
      xDisplay = before;
      x.stop();
    },
  };
}

/** Chromium went away under a flow (the picker crash), as opposed to a failed check. */
export class BrowserCrash extends Error {}

/** Chromium flags that answer the share picker by themselves with a synthetic screen. */
export const FAKE_MEDIA = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];

/**
 * Run a flow that goes through Chrome's share picker. `run` launches its own browser and throws
 * BrowserCrash when that browser died. A crash gets another try; after three, the flow runs with
 * FAKE_MEDIA (no picker) and the test carries a "limitation" annotation. Any other failure
 * fails at once. FLOWS_PICKER=fake skips straight to the fallback.
 */
export async function throughPicker(label: string, run: (mode: 'picker' | 'fake') => Promise<void>) {
  // FLOWS_PICKER=fake runs the fallback straight away, to check it still works
  for (let attempt = 1; attempt <= 3 && process.env.FLOWS_PICKER !== 'fake'; attempt++) {
    try {
      await run('picker');
      return;
    } catch (e) {
      if (!(e instanceof BrowserCrash)) throw e;
      console.log(`${label}: attempt ${attempt}: ${e.message}`);
    }
  }
  const why = process.env.FLOWS_PICKER === 'fake' ? 'FLOWS_PICKER=fake' : "Chrome's share picker crashed Chromium on Xvfb three times";
  base.info().annotations.push({ type: 'limitation', description: `${label}: ${why}; covered with fake media, no picker (docs/spikes.md S2)` });
  console.log(`${label}: LIMITATION: ${why}; running with fake media instead`);
  await run('fake');
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
  const holder = context as BrowserContext & { __cdp?: Browser; __cdpPort?: number };
  const isPopup = (p: Page) => p.url().startsWith(`chrome-extension://${EXT_ID}/popup.html`);
  await holder.__cdp?.close().catch(() => undefined);
  await chord(page, 'ctrl+shift+y');
  let popup: Page | undefined;
  await expect
    .poll(
      async () => {
        await holder.__cdp?.close().catch(() => undefined);
        holder.__cdp = await chromium.connectOverCDP(`http://127.0.0.1:${holder.__cdpPort ?? CDP_PORT}`);
        popup = holder.__cdp.contexts().flatMap((c) => c.pages()).find(isPopup);
        return !!popup;
      },
      { timeout: 30_000, message: 'the popup opened' }, // over 10 s at a load average near 15
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

/** The newest mail to an address in Mailpit (all dev mail lands there), with its text. */
export async function mailTo(context: BrowserContext, to: string, subject: RegExp, timeout = 30_000): Promise<{ subject: string; text: string }> {
  let id = '';
  await expect
    .poll(
      async () => {
        const r = await context.request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
        const list = ((await r.json()) as { messages?: { ID: string; Subject: string }[] }).messages ?? [];
        id = list.find((m) => subject.test(m.Subject))?.ID ?? '';
        return !!id;
      },
      { timeout, message: `mail to ${to} matching ${subject}` },
    )
    .toBe(true);
  const m = (await (await context.request.get(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Subject: string; Text: string };
  return { subject: m.Subject, text: m.Text };
}

/** The first link in a mail's text that starts with `prefix`. */
export function linkIn(text: string, prefix: string): string {
  const m = text.match(new RegExp(`${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\s"<>)]+`));
  if (!m) throw new Error(`no ${prefix} link in:\n${text}`);
  return m[0].replace(/&amp;/g, '&');
}

/** A picture of the whole X screen: shows the in-page UI in the closed shadow root and popups. */
export function xshot(name: string) {
  try {
    execFileSync('import', ['-window', 'root', saveShot(name)], { env: { ...process.env, DISPLAY: xDisplay } });
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
 * login page, the user clicks "Sign in with <provider>" and logs in at the identity provider (the
 * mock OIDC server of the compose `dev` profile, e2e/fixtures/oidc.ts; D-114), the window closes
 * and the popup shows the account. Leaves the web session signed in too (the window shares the
 * profile's cookies).
 */
export async function connectExtension(context: BrowserContext, email: string, opts: { allowLab?: boolean } = {}) {
  const lab = await labPage(context);
  const popup = await openPopup(context, lab);
  const card = popup.getByTestId('signed-out');
  await expect(card).toBeVisible();
  const authWindow = context.waitForEvent('page', (p) => p.url().startsWith(SERVER));
  await card.getByRole('button', { name: 'Sign in' }).click();
  const win = await authWindow;
  await win.waitForURL(/\/login\?next=%2Fext%2Fconnect/);
  await expect(win.getByRole('heading', { name: /Connect the open-toolbar extension/ })).toBeVisible();
  await hydrated(win);
  const provider = win.locator('[data-provider]');
  await expect(provider, 'the server needs the mock OIDC provider: scripts/e2e-all.sh, or OIDC_* in e2e/fixtures/oidc.ts').toHaveCount(1);
  await expect(provider).toHaveText(/Sign in with /);
  await win.screenshot({ path: saveShot('o-login') });
  await provider.click();
  await mockProviderLogin(win, email, 'Flow Reviewer');
  await expect(popup.getByTestId('signed-in')).toContainText(email, { timeout: 30_000 });
  if (opts.allowLab === false) return { lab, popup };
  // D-202: every site is granted at install. Add the lab as a project (so captures carry the name
  // Lab in both modes, and the strict mode records there), then wait for the popup to allow it.
  await addProject(context, [LAB_URL]);
  await popup.close();
  const again = await openPopup(context, lab);
  await allowFromPopup(context, again);
  return { lab, popup: again };
}

// ---------------------------------------------------------------- projects (D-123, D-126)

/** Add a project to the signed-in user's active workspace with the web session. */
export async function addProject(context: BrowserContext, origins: string[], name = 'Lab', maskingPreset: 'staging' | 'production' = 'staging') {
  const ws = await api<{ items: { id: string }[]; activeId: string | null }>(context, 'GET', '/api/v1/workspaces');
  const id = ws.body.activeId ?? ws.body.items[0]!.id;
  const r = await api<{ id: string }>(context, 'POST', `/api/v1/workspaces/${id}/projects`, { name, origins, maskingPreset });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { workspaceId: id, projectId: r.body.id };
}

/**
 * Chrome's "requested additional permissions" prompt: a dialog inside the browser window with
 * Deny focused. Tab moves to Allow and Return presses it, through the X server like a person's
 * keys. The keys go to the browser window, not to a DevTools window that may hold the focus.
 */
export async function acceptPermissionPrompt(timeout = 10_000) {
  await new Promise((r) => setTimeout(r, 700));
  const t0 = Date.now();
  let win = '';
  while (!win && Date.now() - t0 < timeout) {
    try {
      win =
        xdo('search', '--onlyvisible', '--name', 'Chrom')
          .split('\n')
          .filter(Boolean)
          .find((w) => !xdo('getwindowname', w).startsWith('DevTools')) ?? '';
    } catch {
      /* not yet */
    }
    if (!win) await new Promise((r) => setTimeout(r, 100));
  }
  if (!win) throw new Error('no browser window for the permission prompt');
  xdo('windowactivate', '--sync', win);
  await new Promise((r) => setTimeout(r, 200));
  xdo('key', 'Tab');
  xdo('key', 'Return');
}

/**
 * Switch the server's site access mode (D-200), `null` to reset it to the default. Uses the
 * context's web session when its account is the instance admin (the first account of a fresh
 * server), else the seeded admin (dana@toolbar.test, password sign-in, AUTH_DEV_PASSWORD=1).
 * Returns false when neither may change it, or SITE_ACCESS locks the field.
 */
export async function setSiteAccess(context: BrowserContext, mode: 'all' | 'projects' | null): Promise<boolean> {
  const own = await api(context, 'PATCH', '/api/v1/admin/settings', { siteAccess: mode });
  if (own.status === 200) return true;
  const req = await request.newContext({ baseURL: SERVER, extraHTTPHeaders: { origin: SERVER } });
  try {
    const signIn = await req.post('/api/auth/sign-in/email', { data: { email: 'dana@toolbar.test', password: 'toolbar-dev-password' }, failOnStatusCode: false });
    if (!signIn.ok()) return false;
    const r = await req.patch('/api/v1/admin/settings', { data: { siteAccess: mode }, failOnStatusCode: false });
    return r.ok();
  } finally {
    await req.dispose();
  }
}

/**
 * In the popup over a project page: wait until the extension may record there. Release builds
 * hold every site from install (D-202), so the popup normally asks nothing; if it does (site
 * access turned off in Chrome), click Allow and accept Chrome's prompt.
 */
export async function allowFromPopup(context: BrowserContext, popup: Page) {
  const card = popup.getByTestId('site-access');
  const ready = popup.getByTestId('site-all-sites').or(popup.getByTestId('site-strict')).or(popup.getByTestId('site-project'));
  await expect(card.or(ready).first()).toBeVisible({ timeout: 15_000 });
  if (await card.count()) {
    await expect(card).toHaveAttribute('data-state', /^(needs-grant|needs-all-sites)$/, { timeout: 15_000 });
    const all = (await card.getAttribute('data-state')) === 'needs-all-sites';
    await popup.getByTestId(all ? 'site-allow-all' : 'site-allow').click();
    await acceptPermissionPrompt();
  }
  const sw = context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`))!;
  await expect
    .poll(() => sw.evaluate((o) => (globalThis as unknown as { chrome: { permissions: { contains(p: object): Promise<boolean> } } }).chrome.permissions.contains({ origins: [`${o}/*`] }), LAB_URL), { timeout: 15_000 })
    .toBe(true);
}

// ---------------------------------------------------------------- fixture

export interface Launched {
  context: BrowserContext;
  sw: () => Promise<Worker>;
  close: () => Promise<void>;
}

/**
 * Start Chromium with the extension on a fresh profile, the way the worker fixture does. A flow
 * that may crash the browser (Chrome's share picker on Xvfb, docs/spikes.md S2) runs in a
 * browser of its own, so a crash cannot take the shared one down. `cdpPort` must differ from
 * every other open browser's; `args` adds Chromium flags.
 */
export async function launchExtension(opts: { cdpPort?: number; args?: string[]; display?: string } = {}): Promise<Launched> {
  if (!fs.existsSync(path.join(EXT_DIR, 'manifest.json'))) throw new Error(`No extension build at ${EXT_DIR}. Run: pnpm --filter @toolbar/extension build`);
  if (DISPLAY === ':99') throw new Error('Display :99 belongs to the shared browser');
  const cdpPort = opts.cdpPort ?? CDP_PORT;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-flows-'));
  fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'Default', 'Preferences'), JSON.stringify({ extensions: { pinned_extensions: [EXT_ID] } }));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    env: browserEnv(opts.display ?? DISPLAY),
    viewport: null,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      `--allowlisted-extension-id=${EXT_ID}`,
      // No --use-fake-ui-for-media-stream or --use-fake-device-for-media-stream by default: with
      // either one, getUserMedia on a tabCapture stream id fails with "Requested device not found".
      '--window-position=0,0',
      '--window-size=1440,900',
      '--force-device-scale-factor=1',
      `--remote-debugging-port=${cdpPort}`,
      ...(opts.args ?? []),
    ],
  });
  (context as BrowserContext & { __cdpPort?: number }).__cdpPort = cdpPort;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: LAB_URL });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });
  const sw = async () => context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`)) ?? (await context.waitForEvent('serviceworker'));
  await sw();
  return {
    context,
    sw,
    close: async () => {
      await (context as BrowserContext & { __cdp?: Browser }).__cdp?.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

let accounts = 0;
/**
 * A fresh address for a new account in this run. `domain` gives the account an email domain of
 * its own: on the shared `flows<run>.test` domain a new account joins the workspace flow N made
 * with "same domain can join" on, as a member and not the owner of its own workspace (D-169).
 */
export const newEmail = (who = 'flows', domain = 'flows') => `${who}-${run}-${++accounts}@${domain}${run}.test`;

/**
 * The worker's shared browser once a flow asked for it. The hook below reads it from here, so a
 * flow that runs a browser of its own (the Part 2 scenario) does not start the shared one too.
 */
let shared: Tb | undefined;

export const test = base.extend<{ context: BrowserContext }, { tb: Tb }>({
  tb: [
    async ({}, use) => {
      const { context, sw, close } = await launchExtension();
      const email = `flows-${run}@flows${run}.test`;
      const tb: Tb = { context, sw, email, made: {} };
      const { lab, popup } = await connectExtension(context, email);
      await popup.close();
      await lab.close();
      shared = tb;
      await use(tb);
      shared = undefined;
      await close();
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  context: async ({ tb }, use) => use(tb.context),
});

export { expect };

/**
 * After each flow, close the app's pages it left open (the capture tab the extension opens after
 * create, for one). A person's background tabs are hidden and drop their comment streams, but
 * Playwright reports every page as visible, so left-over capture tabs would each keep a stream
 * and use up the browser's six connections to the server. On failure, keep a picture of the
 * whole X screen first: popups and the closed shadow root show there.
 */
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    try {
      execFileSync('import', ['-window', 'root', info.outputPath('screen.png')], { env: { ...process.env, DISPLAY } });
    } catch {
      /* imagemagick missing */
    }
  }
  for (const p of shared?.context.pages() ?? []) if (p.url().startsWith(SERVER)) await p.close().catch(() => undefined);
});
