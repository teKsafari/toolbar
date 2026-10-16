// The open-toolbar rig for the parity scenarios (docs/parity/scenarios.md, "Rigs"): Playwright 1.63.0
// Chromium with the release build of the extension (closed shadow root) on a private Xvfb display
// with openbox. Pointer and keyboard input that a person gives goes through the X server with
// xdotool: the toolbar icon, the in-page UI (cursor pill, bar, pen, blur), chords and the share
// picker. The popup and the editor are pages Playwright reaches over CDP, as in e2e/flows.
//
// Measurement only (never input) reads the closed shadow root through the DevTools protocol's
// pierce mode: boxes, text and states of the in-page UI. Timings come from the page's own
// screencast frames (CDP Page.startScreencast): each frame carries the compositor's wall-clock
// timestamp, so "first frame that shows the result" is read from pixels, as with a screen
// recording. The ffmpeg on this VM has no x11grab, so the screencast replaces it.
import { chromium, expect, type Browser, type BrowserContext, type CDPSession, type Frame, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserEnv } from '../fixtures/browser-env.ts';

export const EXT_ID = 'laobpjhffglefallhhojihfdbdkoendk';
export const DISPLAY = process.env.PARITY_DISPLAY ?? ':130';
if (DISPLAY === ':99') throw new Error('Display :99 belongs to the shared browser');
export const LAB_URL = process.env.LAB_URL ?? 'http://localhost:5173';
export const LAB2_URL = process.env.LAB2_URL ?? 'http://localhost:5174';
export const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000';
export const ROOT = path.resolve(import.meta.dirname, '../..');
export const EXT_DIR = path.join(ROOT, 'apps/extension/.output', process.env.PARITY_EXT_BUILD ?? 'chrome-mv3');
export const PASSWORD = 'toolbar parity password';
/** Browser window: its frame is 4 px each side, so 1448x991 gives a 1440x900 page viewport (screen 1460x1000). */
export const WINDOW = { w: 1448, h: 991 };

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- machine

/** The 1-minute load average, written next to every timing. */
export function load(): number {
  return Number(fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0]);
}

/** MB of memory available; the rig keeps at least 10 percent (800 MB) free. */
export function availableMb(): number {
  const m = fs.readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
  return m ? Math.round(Number(m[1]) / 1024) : 0;
}

/** Wait up to 5 minutes for the load to drop to 6 or below; returns the load and whether it is reliable. */
export async function calm(maxMs = 300_000): Promise<{ load: number; reliable: boolean }> {
  const t0 = Date.now();
  while (load() > 6 && Date.now() - t0 < maxMs) await sleep(5000);
  const l = load();
  return { load: l, reliable: l <= 6 };
}

// ---------------------------------------------------------------- X input

let xDisplay = DISPLAY;
export function onDisplay(d: string) {
  xDisplay = d;
}

export function xdo(...args: string[]) {
  return execFileSync('xdotool', args, { env: { ...process.env, DISPLAY: xDisplay }, encoding: 'utf8' }).trim();
}

export function xmove(x: number, y: number) {
  xdo('mousemove', '--sync', String(Math.round(x)), String(Math.round(y)));
}

export function xclick(x: number, y: number) {
  xmove(x, y);
  xdo('click', '1');
}

/** Press at a, move in steps to b, and release unless `hold` (then call xup()). */
export async function xdrag(a: { x: number; y: number }, b: { x: number; y: number }, opts: { steps?: number; hold?: boolean; stepMs?: number } = {}) {
  const steps = opts.steps ?? 12;
  // a person's pointer arrives at the start point before pressing
  xmove(a.x - 15, a.y - 10);
  await sleep(120);
  xmove(a.x, a.y);
  await sleep(120);
  xdo('mousedown', '1');
  for (let i = 1; i <= steps; i++) {
    xmove(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
    await sleep(opts.stepMs ?? 25);
  }
  if (!opts.hold) xdo('mouseup', '1');
}

export function xup() {
  xdo('mouseup', '1');
}

/** A key or chord into the focused X window (the browser has the focus on this display). */
export function xkey(keys: string) {
  xdo('key', '--clearmodifiers', keys);
}

/** Raise the browser window that shows `page` and give it X focus. */
export async function focusWindow(page: Page) {
  await page.bringToFront();
  try {
    const wins = xdo('search', '--onlyvisible', '--class', 'chromium').split('\n').filter(Boolean);
    if (wins.length) xdo('windowactivate', '--sync', wins[wins.length - 1]!);
  } catch {
    /* one window: it has the focus already */
  }
}

/** The X clipboard, which is what the user pastes from. */
export function clipboard(): string {
  try {
    return execFileSync('xclip', ['-selection', 'clipboard', '-o'], { env: { ...process.env, DISPLAY: xDisplay }, encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- evidence

export class Evidence {
  readonly dir: string;
  readonly scenario: string;
  readonly data: Record<string, unknown> = {};
  constructor(group: string, scenario: string) {
    this.scenario = scenario;
    this.dir = path.join(ROOT, 'e2e/parity-shots', group);
    fs.mkdirSync(this.dir, { recursive: true });
  }
  set(key: string, value: unknown) {
    this.data[key] = value;
    console.log(`${this.scenario} ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    this.save();
  }
  file(step: string, size: string = '1440', theme = 'light') {
    return path.join(this.dir, `${this.scenario}-${step}-nib-${size}-${theme}.png`);
  }
  /**
   * A page shot in one theme. The theme is pinned on the page itself (the emulated colour scheme
   * plus the app's own `data-theme` switch on <html>), because in the extension's persistent
   * context a navigation can drop the emulated scheme: 33 "dark" shots of fix rounds 1 to 3 were
   * byte-identical to their light twins. The page background must then read dark or light, and a
   * shot must differ from its twin of the other theme taken in this run.
   */
  async shot(page: Page, step: string, size: string = '1440', theme: 'light' | 'dark' = 'light', o: { fullPage?: boolean } = {}) {
    const bg = await pinTheme(page, theme);
    const out = this.file(step, size, theme);
    await page.screenshot({ path: out, fullPage: o.fullPage });
    const twin = this.file(step, size, theme === 'dark' ? 'light' : 'dark');
    const twinFresh = this.written.has(twin);
    const same = twinFresh && fs.readFileSync(twin).equals(fs.readFileSync(out));
    this.themeChecks[path.basename(out)] = { bg, lum: bg.lum, twinCompared: twinFresh, sameAsTwin: same };
    this.set('theme-checks', this.themeChecks);
    this.written.add(out);
    expect(same, `${path.basename(out)} is byte-identical to its ${theme === 'dark' ? 'light' : 'dark'} twin`).toBe(false);
    return out;
  }
  private readonly written = new Set<string>();
  private readonly themeChecks: Record<string, unknown> = {};
  /** The whole X screen (shows the popup and the closed shadow root), optionally cropped. */
  xshot(step: string, crop?: { x: number; y: number; w: number; h: number }, size = '1440', theme = 'light') {
    const out = this.file(step, size, theme);
    const args = ['-window', 'root'];
    if (crop) args.push('-crop', `${Math.round(crop.w)}x${Math.round(crop.h)}+${Math.round(crop.x)}+${Math.round(crop.y)}`, '+repage');
    execFileSync('import', [...args, out], { env: { ...process.env, DISPLAY: xDisplay } });
    return out;
  }
  save() {
    fs.writeFileSync(path.join(this.dir, `${this.scenario}.json`), JSON.stringify(this.data, null, 2) + '\n');
  }
}

/**
 * Pin a page to one theme: the emulated colour scheme and the app's `data-theme` on <html>
 * (packages/ui/src/tokens.css honours both). Returns the page background it then reads, and fails
 * when that background does not match the theme (dark below 80 luminance, light above 180).
 */
export async function pinTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme });
  const bg = await page.evaluate(async (t) => {
    document.documentElement.setAttribute('data-theme', t);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const pick = (el: Element) => getComputedStyle(el).backgroundColor;
    const transparent = (c: string) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    const color = [document.body, document.documentElement, document.querySelector('main')].map((el) => (el ? pick(el) : '')).find((c) => c && !transparent(c)) ?? 'rgba(0, 0, 0, 0)';
    return { color, dark: matchMedia('(prefers-color-scheme: dark)').matches, attr: document.documentElement.getAttribute('data-theme') };
  }, theme);
  const [r, g, b] = (bg.color.match(/[\d.]+/g) ?? ['255', '255', '255']).map(Number) as [number, number, number];
  const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  if (bg.color !== 'rgba(0, 0, 0, 0)') expect(theme === 'dark' ? lum < 80 : lum > 180, `page background ${bg.color} (luminance ${lum}) in ${theme}`).toBe(true);
  return { ...bg, lum };
}

/**
 * Network table alignment (J-058, J-105): the left x of each header cell against the first row's
 * cell of the same column, the largest gap, and the header labels that do not fit their cell.
 */
export async function networkColumns(page: Page) {
  return page.getByTestId('network-list').evaluate((list) => {
    const row = list.querySelector<HTMLElement>('.nrow');
    const cols = [...list.querySelectorAll<HTMLElement>('.hrow [data-col]')].map((h) => {
      const cell = row?.querySelector<HTMLElement>(`[data-col="${h.dataset.col}"]`);
      const hx = h.getBoundingClientRect().left;
      const cx = cell ? cell.getBoundingClientRect().left : null;
      return { col: h.dataset.col!, label: (h.textContent ?? '').trim(), headX: Math.round(hx * 10) / 10, cellX: cx == null ? null : Math.round(cx * 10) / 10, clipped: h.scrollWidth > h.clientWidth + 1 };
    });
    const deltas = cols.map((c) => (c.cellX == null ? Infinity : Math.abs(c.headX - c.cellX)));
    return { columns: cols.length, maxDeltaPx: Math.round(Math.max(0, ...deltas) * 10) / 10, clipped: cols.filter((c) => c.clipped).map((c) => c.label), cols };
  });
}

/** Mean of one screen region's RGB, from the X server. */
export function regionMean(r: { x: number; y: number; w: number; h: number }): [number, number, number] {
  const out = execFileSync('import', ['-window', 'root', '-crop', `${Math.round(r.w)}x${Math.round(r.h)}+${Math.round(r.x)}+${Math.round(r.y)}`, '+repage', '-resize', '1x1!', '-depth', '8', 'txt:-'], {
    env: { ...process.env, DISPLAY: xDisplay },
    encoding: 'utf8',
  });
  const m = out.match(/#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})/);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [0, 0, 0];
}

// ---------------------------------------------------------------- browser

export interface Launched {
  context: BrowserContext;
  sw: () => Promise<Worker>;
  cdpPort: number;
  close: () => Promise<void>;
}

/** Chromium with the extension on a fresh profile, the action pinned, window at 0,0. */
export async function launchExtension(opts: { cdpPort?: number; args?: string[]; userDataDir?: string } = {}): Promise<Launched> {
  if (!fs.existsSync(path.join(EXT_DIR, 'manifest.json'))) throw new Error(`No extension build at ${EXT_DIR}`);
  const free = availableMb();
  if (free < 1600) throw new Error(`only ${free} MB available; a browser needs about 800 MB and 800 MB must stay free`);
  const cdpPort = opts.cdpPort ?? 9361;
  // a given profile folder survives close() (G8 S8.4 relaunches it for a cold popup open)
  const keep = !!opts.userDataDir;
  const userDataDir = opts.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'tb-parity-'));
  const fresh = !fs.existsSync(path.join(userDataDir, 'Default', 'Preferences'));
  fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
  // developer mode on, as for anyone who loads the extension unpacked: without it a runtime
  // reload (the popup's restart item) leaves the extension disabled
  if (fresh) fs.writeFileSync(path.join(userDataDir, 'Default', 'Preferences'), JSON.stringify({ extensions: { pinned_extensions: [EXT_ID], ui: { developer_mode: true } } }));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    env: browserEnv(xDisplay),
    viewport: null,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      `--allowlisted-extension-id=${EXT_ID}`,
      '--window-position=0,0',
      `--window-size=${WINDOW.w},${WINDOW.h}`,
      '--force-device-scale-factor=1',
      `--remote-debugging-port=${cdpPort}`,
      ...(opts.args ?? []),
    ],
  });
  for (const origin of [LAB_URL, LAB2_URL, SERVER]) await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const sw = async () => context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`)) ?? (await context.waitForEvent('serviceworker'));
  await sw();
  (context as BrowserContext & { __cdpPort?: number }).__cdpPort = cdpPort;
  return {
    context,
    sw,
    cdpPort,
    close: async () => {
      await (context as BrowserContext & { __cdp?: Browser }).__cdp?.close().catch(() => undefined);
      await context.close().catch(() => undefined);
      await sleep(500); // Chromium's helpers let go of the profile a moment after close
      if (!keep) fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
}

export async function labPage(context: BrowserContext, p = '/', base = LAB_URL): Promise<Page> {
  const blank = context.pages().find((x) => x.url() === 'about:blank');
  const page = blank ?? (await context.newPage());
  await page.goto(base + p);
  await page.waitForLoadState('networkidle');
  return page;
}

/** Where the page's viewport origin sits on the X screen. */
export async function viewportOrigin(page: Page): Promise<{ x: number; y: number; w: number; h: number }> {
  // the window frame is the same width on the left, right and bottom; the tab strip and
  // toolbar sit on top
  return page.evaluate(() => {
    const side = (window.outerWidth - window.innerWidth) / 2;
    return { x: window.screenX + side, y: window.screenY + window.outerHeight - window.innerHeight - side, w: window.innerWidth, h: window.innerHeight };
  });
}

/** Screen point of a page point. */
export async function toScreen(page: Page, p: { x: number; y: number }) {
  const o = await viewportOrigin(page);
  return { x: o.x + p.x, y: o.y + p.y };
}

/** Click the centre of an element of the page with a real X click. */
export async function xclickEl(page: Page, loc: import('@playwright/test').Locator) {
  const b = (await loc.boundingBox())!;
  const s = await toScreen(page, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  xclick(s.x, s.y);
}

/**
 * The pinned action icon, found by its pixels: a blue square in the toolbar row, right of the
 * address bar. Its place moves when Chrome adds toolbar items (the media control after a video
 * played, for one), so it is looked up on every click.
 */
export async function iconPoint(page: Page) {
  const w = await page.evaluate(() => ({ x: window.screenX, y: window.screenY, ow: window.outerWidth }));
  const strip = { x: w.x + w.ow - 360, y: w.y + 50, w: 360, h: 26 };
  const raw = execFileSync('import', ['-window', 'root', '-crop', `${strip.w}x${strip.h}+${strip.x}+${strip.y}`, '+repage', '-depth', '8', 'rgb:-'], { env: { ...process.env, DISPLAY: xDisplay }, maxBuffer: 8 << 20 });
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < strip.h; y++)
    for (let x = 0; x < strip.w; x++) {
      const i = (y * strip.w + x) * 3;
      const r = raw[i]!;
      const g = raw[i + 1]!;
      const b = raw[i + 2]!;
      const idle = Math.abs(r - 52) < 18 && Math.abs(g - 70) < 18 && Math.abs(b - 207) < 18;
      const recording = r > 190 && g < 80 && b < 80; // the red recording glyph
      if (idle || recording) {
        sx += x;
        sy += y;
        n++;
      }
    }
  if (n < 20) return { x: w.x + w.ow - 154, y: w.y + 63 }; // not drawn yet: the usual place
  return { x: strip.x + Math.round(sx / n), y: strip.y + Math.round(sy / n) };
}

const isPopup = (p: Page) => p.url().startsWith(`chrome-extension://${EXT_ID}/popup.html`);

/** Drop the CDP connection that reached the last popup (before the next popup starts). */
export async function dropPopupConnection(context: BrowserContext) {
  const holder = context as BrowserContext & { __cdp?: Browser };
  await holder.__cdp?.close().catch(() => undefined);
  holder.__cdp = undefined;
}

/**
 * The open popup over CDP (a fresh connection sees it; the persistent context does not). It
 * waits for the popup target to show in /json/list before it attaches: a connection that
 * attaches while the popup is still starting and then closes makes Chromium open a DevTools
 * window for the popup, which takes the X focus.
 */
export async function popupPage(context: BrowserContext, timeout = 30_000): Promise<Page> {
  const holder = context as BrowserContext & { __cdp?: Browser; __cdpPort?: number };
  const t0 = Date.now();
  for (;;) {
    const list = (await (await fetch(`http://127.0.0.1:${holder.__cdpPort}/json/list`)).json()) as { type: string; url: string }[];
    if (list.some((t) => t.url.startsWith(`chrome-extension://${EXT_ID}/popup.html`))) break;
    if (Date.now() - t0 > timeout) throw new Error('the popup did not open');
    await sleep(50);
  }
  await sleep(300);
  await dropPopupConnection(context);
  let popup: Page | undefined;
  for (let i = 0; i < 20 && !popup; i++) {
    holder.__cdp ??= await chromium.connectOverCDP(`http://127.0.0.1:${holder.__cdpPort}`);
    popup = holder.__cdp.contexts().flatMap((c) => c.pages()).find(isPopup);
    if (!popup) await sleep(200);
  }
  if (!popup) throw new Error('the popup target is not reachable over CDP');
  await popup.locator('[data-popup][data-loading="false"]').waitFor();
  return popup;
}

/** A person's click on the pinned icon; returns the popup page once its content is complete. */
export async function clickIcon(context: BrowserContext, page: Page): Promise<Page> {
  await dropPopupConnection(context);
  await focusWindow(page);
  const p = await iconPoint(page);
  xclick(p.x, p.y);
  return popupPage(context);
}

/** The popup if one is open now, else a click on the icon opens it. */
export async function openPopup(context: BrowserContext, page: Page): Promise<{ popup: Page; clicked: boolean }> {
  const port = (context as BrowserContext & { __cdpPort?: number }).__cdpPort;
  const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { url: string }[];
  if (list.some((t) => t.url.startsWith(`chrome-extension://${EXT_ID}/popup.html`))) return { popup: await popupPage(context), clicked: false };
  return { popup: await clickIcon(context, page), clicked: true };
}

/** The popup's box on the X screen. */
export async function popupBox(popup: Page) {
  return popup.evaluate(() => ({ x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight }));
}

/** A real X click on an element of the popup. */
export async function xclickPopup(popup: Page, sel: string | import('@playwright/test').Locator) {
  const loc = typeof sel === 'string' ? popup.locator(sel) : sel;
  await loc.first().waitFor();
  const b = (await loc.first().boundingBox())!;
  const o = await popupBox(popup);
  xclick(o.x + b.x + b.width / 2, o.y + b.y + b.height / 2);
}

/** Close the popup the way a person does: Escape in it. */
export async function closePopup(popup: Page) {
  await popup.keyboard.press('Escape').catch(() => undefined);
  await popup.close().catch(() => undefined);
}

/** Sign the extension in as `email` (account made on first sign-in) through the popup. */
export async function signIn(context: BrowserContext, email: string) {
  const lab = await labPage(context);
  const popup = await clickIcon(context, lab);
  if (await popup.getByTestId('signed-in').count()) return { lab, popup };
  const authWindow = context.waitForEvent('page', (p) => p.url().startsWith(SERVER));
  await popup.getByTestId('signed-out').getByRole('button', { name: 'Sign in' }).click();
  const win = await authWindow;
  await win.waitForURL(/\/login/);
  await win.waitForLoadState('networkidle');
  await expect(async () => {
    if (!(await win.getByLabel('Password').isVisible())) await win.getByRole('button', { name: 'Use a password instead' }).click({ timeout: 2000 });
    await expect(win.getByLabel('Password')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await win.getByLabel('Work email').fill(email);
  await win.getByLabel('Password').fill(PASSWORD);
  await win.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(popup.getByTestId('signed-in')).toContainText(email, { timeout: 30_000 });
  return { lab, popup: await allowLab(context, lab, popup) };
}

/** The lab's origins: the page origin and the same page on 127.0.0.1 (second-origin scenarios). */
export const LAB_ORIGINS = [LAB_URL, LAB_URL.replace('localhost', '127.0.0.1')];

/**
 * D-126: the release build records only on project origins the person allowed. Add the lab as a
 * project of the account's workspace (once) and allow it from the popup with X input, accepting
 * Chrome's permission prompt (Deny has the focus: Tab, then Return, in the browser window).
 * Returns the popup, reopened.
 */
export async function allowLab(context: BrowserContext, lab: Page, popup: Page): Promise<Page> {
  const ws = await api<{ items: { id: string }[]; activeId: string | null }>(context, 'GET', '/api/v1/workspaces');
  const wsId = ws.body.activeId ?? ws.body.items[0]!.id;
  const have = await api<{ items: { origins: string[] }[] }>(context, 'GET', `/api/v1/workspaces/${wsId}/projects`);
  if (!have.body.items.some((p) => LAB_ORIGINS.every((o) => p.origins.includes(o)))) {
    const r = await api(context, 'POST', `/api/v1/workspaces/${wsId}/projects`, { name: 'Lab', origins: LAB_ORIGINS });
    expect(r.status).toBe(201);
  }
  await closePopup(popup);
  let p = await clickIcon(context, lab);
  const card = p.getByTestId('site-access');
  if (!(await card.count())) return p;
  await expect(card).toHaveAttribute('data-state', 'needs-grant', { timeout: 20_000 });
  await xclickPopup(p, p.getByTestId('site-allow'));
  await sleep(700);
  const win = xdo('search', '--onlyvisible', '--name', 'Chrom')
    .split('\n')
    .filter(Boolean)
    .find((w) => !xdo('getwindowname', w).startsWith('DevTools'));
  if (!win) throw new Error('no browser window for the permission prompt');
  xdo('windowactivate', '--sync', win);
  await sleep(200);
  xkey('Tab');
  xkey('Return');
  const sw = context.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${EXT_ID}/`))!;
  await expect
    .poll(() => sw.evaluate((o) => (globalThis as unknown as { chrome: { permissions: { contains(p: object): Promise<boolean> } } }).chrome.permissions.contains({ origins: [`${o}/*`] }), LAB_URL), { timeout: 15_000 })
    .toBe(true);
  await dropPopupConnection(context);
  await lab.reload(); // the parity scenarios time the page from its first load with the scripts in
  p = await clickIcon(context, lab);
  await expect(p.getByTestId('site-access')).toHaveCount(0);
  return p;
}

/** The editor frame the extension opens over the page after a capture. */
export async function editorFrame(page: Page, timeout = 60_000): Promise<Frame> {
  const t0 = Date.now();
  for (;;) {
    const f = page.frames().find((x) => x.url().startsWith(`chrome-extension://${EXT_ID}/editor.html`));
    if (f) {
      await f.getByTestId('editor').waitFor({ timeout });
      return f;
    }
    if (Date.now() - t0 > timeout) throw new Error('the editor did not open');
    await sleep(50);
  }
}

export function hasEditor(page: Page) {
  return page.frames().some((x) => x.url().startsWith(`chrome-extension://${EXT_ID}/editor.html`));
}

// ---------------------------------------------------------------- server

export async function api<T>(context: BrowserContext, method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> {
  const r = await context.request.fetch(`${SERVER}${p}`, {
    method,
    headers: body === undefined ? { origin: SERVER } : { 'content-type': 'application/json', origin: SERVER },
    data: body === undefined ? undefined : JSON.stringify(body),
    failOnStatusCode: false,
  });
  return { status: r.status(), body: (await r.json().catch(() => null)) as T };
}

export async function recordingCount(context: BrowserContext): Promise<number> {
  const r = await api<{ items?: unknown[]; total?: number }>(context, 'GET', '/api/v1/recordings?limit=100');
  return r.body?.total ?? r.body?.items?.length ?? -1;
}

export async function captureOf(context: BrowserContext, shareUrl: string): Promise<{ id: string; status: string; kind: string; title: string; durationMs?: number }> {
  const token = shareUrl.split('/s/')[1]!;
  const r = await api<{ recordingId: string }>(context, 'GET', `/api/v1/share/${token}`);
  const rec = await api<{ id: string; status: string; kind: string; title: string }>(context, 'GET', `/api/v1/recordings/${r.body.recordingId}`);
  return rec.body;
}

export async function waitReady(context: BrowserContext, id: string, timeout = 180_000) {
  await expect
    .poll(async () => (await api<{ status: string }>(context, 'GET', `/api/v1/recordings/${id}`)).body?.status, { timeout, intervals: [1000], message: `capture ${id} ready` })
    .toBe('ready');
}

// ---------------------------------------------------------------- closed shadow root (measurement only)

export interface ShadowNode {
  attrs: Record<string, string>;
  box: { x: number; y: number; w: number; h: number };
  text: string;
  visible: boolean;
}

interface DomNode {
  nodeId: number;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
  contentDocument?: DomNode;
}

const sessions = new WeakMap<Page, CDPSession>();
async function cdpOf(page: Page) {
  let s = sessions.get(page);
  if (!s) {
    s = await page.context().newCDPSession(page);
    sessions.set(page, s);
  }
  return s;
}

/**
 * Elements of the in-page UI that carry `attr` (for example `data-nb-bar`), read through the
 * DevTools protocol, which sees into closed shadow roots. Never used to give input.
 */
export async function shadowQuery(page: Page, attr: string): Promise<ShadowNode[]> {
  const cdp = await cdpOf(page);
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
  const hits: number[] = [];
  const walk = (n: DomNode) => {
    const a = n.attributes ?? [];
    for (let i = 0; i < a.length; i += 2) if (a[i] === attr) hits.push(n.nodeId);
    for (const c of n.shadowRoots ?? []) walk(c);
    for (const c of n.children ?? []) walk(c);
  };
  walk(root);
  const out: ShadowNode[] = [];
  for (const nodeId of hits) {
    try {
      const { object } = (await cdp.send('DOM.resolveNode', { nodeId })) as { object: { objectId: string } };
      const { result } = (await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: `function () {
          const r = this.getBoundingClientRect();
          const attrs = {};
          for (const a of this.attributes) attrs[a.name] = a.value;
          const cs = getComputedStyle(this);
          return { attrs, box: { x: r.x, y: r.y, w: r.width, h: r.height }, text: (this.textContent || '').trim(), visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0 };
        }`,
        returnByValue: true,
      })) as { result: { value: ShadowNode } };
      out.push(result.value);
      await cdp.send('Runtime.releaseObject', { objectId: object.objectId }).catch(() => undefined);
    } catch {
      /* the node went away between the walk and the read */
    }
  }
  return out;
}

export async function shadowOne(page: Page, attr: string): Promise<ShadowNode | null> {
  return (await shadowQuery(page, attr))[0] ?? null;
}

/** Poll until `fn` returns a truthy value; returns it with the wall time it was first seen. */
export async function until<T>(fn: () => Promise<T>, timeout = 30_000, every = 50): Promise<{ value: T; at: number }> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null as T);
    if (v) return { value: v, at: Date.now() };
    if (Date.now() - t0 > timeout) throw new Error(`timed out after ${timeout} ms`);
    await sleep(every);
  }
}

// ---------------------------------------------------------------- screencast timing

export interface ScreenFrame {
  t: number; // wall-clock ms
  jpeg: Buffer;
}

/**
 * Records the page's compositor frames with their wall-clock timestamps until stop(). Only
 * changed frames arrive, so the first frame after an input that shows the result is the moment
 * a person would see it (one frame, about 16 ms, of precision; the scenario asks for 0.1 s).
 */
export async function screencast(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const frames: ScreenFrame[] = [];
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    frames.push({ t: (f.metadata.timestamp ?? Date.now() / 1000) * 1000, jpeg: Buffer.from(f.data, 'base64') });
    void cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, everyNthFrame: 1 });
  return {
    frames,
    async stop() {
      await cdp.send('Page.stopScreencast').catch(() => undefined);
      await cdp.detach().catch(() => undefined);
      return frames;
    },
  };
}

/** Grey pixels of one region of a JPEG frame (page CSS pixels). */
export function grey(jpeg: Buffer, r: { x: number; y: number; w: number; h: number }): Buffer {
  return execFileSync('magick', ['jpeg:-', '-crop', `${Math.round(r.w)}x${Math.round(r.h)}+${Math.round(r.x)}+${Math.round(r.y)}`, '+repage', '-colorspace', 'gray', '-depth', '8', 'gray:-'], { input: jpeg, maxBuffer: 64 << 20 });
}

export function meanDiff(a: Buffer, b: Buffer): number {
  if (a.length !== b.length || !a.length) return 255;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!);
  return s / a.length;
}

/**
 * The first frame at or after `from` whose `region` has come at least 80 percent of the way
 * from the last frame before `from` to the reference frame (default: the last frame), in mean
 * grey levels. Returns its time and index.
 */
export function firstMatching(frames: ScreenFrame[], from: number, region: { x: number; y: number; w: number; h: number }, opts: { ref?: ScreenFrame; share?: number } = {}) {
  const ref = opts.ref ?? frames[frames.length - 1];
  if (!ref) return null;
  const want = grey(ref.jpeg, region);
  const before = [...frames].reverse().find((f) => f.t < from) ?? frames[0]!;
  const d0 = meanDiff(grey(before.jpeg, region), want);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    if (f.t < from) continue;
    if (meanDiff(grey(f.jpeg, region), want) <= d0 * (1 - (opts.share ?? 0.8))) return { t: f.t, index: i, d0 };
  }
  return null;
}

/** Seconds with one decimal. */
export const secs = (ms: number) => Math.round(ms / 100) / 10;
