// Parity group G6, Nib side: dashboard, folders, search and recording links
// (docs/parity/scenarios.md, S6.1 to S6.3). Each test is one scenario, run as scripted, and
// records its evidence (states, counts, clicks, timings with the load average, screenshots) in
// e2e/parity-shots/G6/<scenario>.json and .png files. The raw results are written up in
// docs/parity/G6-replica.md.
//
//   cd e2e && PARITY_EXT_BUILD=chrome-mv3-g6 npx playwright test -c playwright.parity.config.ts G6
//   cd e2e && npx playwright test -c playwright.parity.config.ts G6 -g S6.2   # one
//
// Owner scope (docs/scope.md): Mailpit and every mail check are skipped (S6.3 step 5).
//
// Browsers: the owner is `parity@example.com` in the G1 rig (release extension build, private
// Xvfb display, signed in through the popup); web pages are driven with Playwright, as in G4 and
// G5. Signed-out shots of the recorder page use a second, plain Chromium on the same display with
// a fresh context per shot. The link recipient of S6.3 uses a third Chromium (no extension, no
// profile, no sign-in) on a private display of its own, because Chrome's share picker crashes
// Chromium on Xvfb when other browsers draw on the same display (docs/spikes.md S2); the picker
// gets real X clicks there.
//
// Captures: N1 is the S3.1 tab recording, N4 the S2.1 annotated screenshot (in the workspace
// "Parity", folder "parity"), N5 the S2.2 area screenshot (in "parity's workspace"). S6.1, S6.2
// steps 1 to 4 and S6.3 work in "parity's workspace", the owner's active workspace, which holds
// the folder "parity" and the "parity link" recording links of S1.5.
import { chromium, expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { privateDisplay } from '../fixtures/xvfb.ts';
import { DISPLAY, Evidence, LAB_URL, ROOT, SERVER, api, availableMb, calm, clipboard, launchNib, load, secs, signIn, sleep, waitReady, type Launched } from './rig.ts';

const GROUP = 'G6';
const EMAIL = process.env.PARITY_EMAIL ?? 'parity@example.com';
const SHOTS = path.join(ROOT, 'e2e/parity-shots');
const MAIN_WS = "parity's workspace";

function idFrom(env: string, file: string, pick: (j: Record<string, unknown>) => unknown): string {
  if (process.env[env]) return process.env[env]!;
  const j = JSON.parse(fs.readFileSync(path.join(SHOTS, file), 'utf8')) as Record<string, unknown>;
  const id = pick(j);
  if (typeof id !== 'string') throw new Error(`no capture id in ${file}; set ${env}`);
  return id;
}
const N1 = () => idFrom('PARITY_N1', 'G3/S3.1.json', (j) => (j.capture as { id?: string } | undefined)?.id);
const N4 = () => idFrom('PARITY_N4', 'G2/S2.1-23-recording.json', (j) => j.id);
const N5 = () => idFrom('PARITY_N5', 'G2/S2.2.json', (j) => (j.ids as { kept?: string } | undefined)?.kept);

// ---------------------------------------------------------------- browsers

let rig: Launched | null = null;
let plain: Browser | null = null;

async function getRig(): Promise<Launched> {
  if (rig) return rig;
  rig = await launchNib();
  const { popup } = await signIn(rig.context, EMAIL);
  await popup.close().catch(() => undefined);
  for (const p of rig.context.pages()) if (p.url().startsWith(SERVER)) await p.close().catch(() => undefined);
  return rig;
}

/** A plain Chromium (no extension, no profile) for signed-out shots. */
async function getPlain(): Promise<Browser> {
  if (plain) return plain;
  const free = availableMb();
  if (free < 1600) throw new Error(`only ${free} MB available; a second browser needs about 800 MB and 800 MB must stay free`);
  plain = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY }, args: ['--force-device-scale-factor=1', '--window-position=0,0', '--window-size=1448,991'] });
  return plain;
}

test.afterAll(async () => {
  await plain?.close().catch(() => undefined);
  plain = null;
  await rig?.close();
  rig = null;
});

/** Run one check; a failure is recorded as evidence and does not end the scenario. */
async function probe<T>(ev: Evidence, key: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const v = await fn();
    ev.set(key, v);
    return v;
  } catch (e) {
    ev.set(key, { error: String(e).slice(0, 600) });
    return null;
  }
}

const txt = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

type Theme = 'light' | 'dark';
const VARIANTS: [number, number, Theme][] = [
  [1440, 900, 'light'],
  [1440, 900, 'dark'],
  [390, 844, 'light'],
  [390, 844, 'dark'],
];

async function ready(p: Page) {
  await p.waitForLoadState('domcontentloaded');
  if (/\/(c|s)\//.test(new URL(p.url()).pathname)) await p.locator('.page[data-hydrated]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await p.locator('html[data-app-ready]').waitFor({ state: 'attached', timeout: 15_000 }).catch(() => undefined);
  await p.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await p.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  await sleep(400);
}

async function openUrl(context: BrowserContext, url: string, o: { w?: number; h?: number; theme?: Theme } = {}) {
  const p = await context.newPage();
  await p.setViewportSize({ width: o.w ?? 1440, height: o.h ?? 900 });
  await p.emulateMedia({ colorScheme: o.theme ?? 'light' });
  await p.bringToFront();
  await p.goto(url.startsWith('http') ? url : SERVER + url);
  // in the extension rig a navigation to a signed-in page drops the emulated colour scheme
  // (the login page keeps it), so it is set again once the page is there
  await p.emulateMedia({ colorScheme: o.theme ?? 'light' });
  await ready(p);
  return p;
}

const overflowX = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/** One page state at 1440 and 390, light and dark; returns sideways overflow per variant. */
async function shoot4(ev: Evidence, step: string, open: (w: number, h: number, theme: Theme) => Promise<{ page: Page; done: () => Promise<void> }>, setup: (p: Page, w: number) => Promise<void> = async () => undefined) {
  const out: Record<string, boolean | string> = {};
  for (const [w, h, theme] of VARIANTS) {
    let done: (() => Promise<void>) | null = null;
    try {
      const o = await open(w, h, theme);
      done = o.done;
      await setup(o.page, w);
      await sleep(500);
      await o.page.screenshot({ path: ev.file(step, String(w), theme) });
      out[`${w}-${theme}`] = await overflowX(o.page);
    } catch (e) {
      out[`${w}-${theme}`] = `error: ${String(e).slice(0, 200)}`;
    }
    await done?.().catch(() => undefined);
  }
  return out;
}

const ownerOpen = (context: BrowserContext, url: string) => async (w: number, h: number, theme: Theme) => {
  const page = await openUrl(context, url, { w, h, theme });
  return { page, done: () => page.close() };
};

const anonOpen = (url: string) => async (w: number, h: number, theme: Theme) => {
  const b = await getPlain();
  const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
  const page = await c.newPage();
  await page.goto(url);
  await ready(page);
  return { page, done: () => c.close() };
};

async function boxOf(loc: Locator) {
  const b = await loc.boundingBox();
  return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
}

async function readClipboard(p: Page) {
  const viaPage = await p.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  return viaPage || clipboard();
}

/** Wait for a toast whose text matches; returns its text and the ms from `t0`. */
async function waitToast(p: Page, re: RegExp, t0 = Date.now(), timeout = 15_000) {
  for (;;) {
    const msgs = (await p.locator('.nb-toast .nb-msg').allTextContents().catch(() => [] as string[])).map(txt);
    const hit = msgs.find((m) => re.test(m));
    if (hit) return { toast: hit, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) throw new Error(`no toast ${re}; toasts: ${JSON.stringify(msgs)}`);
    await sleep(16);
  }
}

/** Open the sidebar drawer at phone width so the sidebar shows in a 390 shot. */
async function drawer(p: Page, w: number) {
  if (w < 860 && (await p.getByTestId('menu-button').isVisible())) {
    await p.getByTestId('menu-button').click();
    await sleep(400);
  }
}

async function myWorkspaces(context: BrowserContext) {
  return (await api<{ items: { id: string; name: string; role: string }[]; activeId: string }>(context, 'GET', '/api/v1/workspaces')).body;
}

/** Make `name` the active workspace (setup only, through the same API the workspace menu calls). */
async function activate(context: BrowserContext, name: string) {
  const w = await myWorkspaces(context);
  const ws = w.items.find((x) => x.name === name);
  if (!ws) throw new Error(`no workspace ${name}`);
  if (w.activeId !== ws.id) await api(context, 'PUT', '/api/v1/me/active-workspace', { workspaceId: ws.id });
  return ws;
}

interface FolderRow {
  id: string;
  name: string;
  shortId: string;
  captureCount: number;
}
async function folders(context: BrowserContext, wsId: string): Promise<FolderRow[]> {
  const r = await api<{ items?: FolderRow[] } | FolderRow[]>(context, 'GET', `/api/v1/workspaces/${wsId}/folders`);
  return Array.isArray(r.body) ? r.body : (r.body?.items ?? []);
}

interface Cap {
  id: string;
  title: string;
  kind: string;
  folderId?: string | null;
  createdAt: string;
  recordingLinkId?: string | null;
  url: string;
}
async function listCaps(context: BrowserContext, q: string) {
  return (await api<{ items: Cap[]; total?: number }>(context, 'GET', `/api/v1/recordings?${q}`)).body;
}

async function meId(context: BrowserContext) {
  return (await api<{ id: string; name: string }>(context, 'GET', '/api/v1/me')).body;
}

const card = (p: Page, id: string) => p.locator(`[data-testid="capture-card"][data-id="${id}"]`);

/** Opacity and transform of the card parts that change on hover. */
async function cardState(c: Locator) {
  return c.evaluate((el) => {
    const op = (sel: string) => {
      const n = el.querySelector(sel);
      return n ? Number(getComputedStyle(n).opacity) : null;
    };
    const m = new DOMMatrix(getComputedStyle(el).transform);
    const thumb = el.querySelector('.thumb');
    return { translateY: Math.round(m.m42 * 10) / 10, checkbox: op('.check'), copy: op('.copy'), creator: op('.who'), shadow: thumb ? getComputedStyle(thumb).boxShadow !== 'none' : null };
  });
}

// ================================================================ S6.1

test('S6.1 grid, hover, filters and the palette', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S6.1');
  const { context } = await getRig();
  const ws = await activate(context, MAIN_WS);
  const me = await meId(context);
  ev.set('setup', { workspace: ws.name, me: me.name, loadStart: load() });

  // 1. the grid
  const page = await openUrl(context, '/');
  await page.getByTestId('capture-grid').waitFor();
  await page.screenshot({ path: ev.file('1-grid') });
  await probe(ev, 'step1-grid', async () => {
    const cols = await page.getByTestId('capture-grid').evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    const cards = await page.getByTestId('capture-card').evaluateAll((els) =>
      els.map((el) => ({
        id: el.getAttribute('data-id'),
        href: el.getAttribute('href'),
        thumb: !!el.querySelector('.thumb img'),
        creator: (el.querySelector('.who')?.textContent ?? '').trim(),
        duration: (el.querySelector('[data-testid="duration"]')?.textContent ?? '').trim() || null,
        linkChip: (el.querySelector('.chip')?.textContent ?? '').trim() || null,
        title: (el.querySelector('.title')?.textContent ?? '').trim(),
        time: (el.querySelector('time')?.textContent ?? '').trim(),
        datetime: el.querySelector('time')?.getAttribute('datetime'),
        x: Math.round(el.getBoundingClientRect().x),
        y: Math.round(el.getBoundingClientRect().y),
      })),
    );
    const newestFirst = cards.every((c, i) => i === 0 || (cards[i - 1]!.datetime ?? '') >= (c.datetime ?? ''));
    const rowMajor = cards.slice(0, 6).map((c) => `${c.x},${c.y}`);
    const total = txt(await page.getByTestId('grid-total').textContent());
    const unfiled = await listCaps(context, `workspaceId=${ws.id}&folderId=none&limit=100`);
    const all = await listCaps(context, `workspaceId=${ws.id}&folderId=all&limit=100`);
    const unfiledIds = new Set(unfiled.items.map((c) => c.id));
    const filed = all.items.filter((c) => !unfiledIds.has(c.id));
    const shown = new Set(cards.map((c) => c.id));
    return {
      columnsAt1440: cols,
      cardsLoaded: cards.length,
      totalShown: total,
      apiUnfiled: unfiled.total ?? unfiled.items.length,
      apiAll: all.total ?? all.items.length,
      filedInWorkspace: filed.length,
      filedShownOnGrid: filed.filter((c) => shown.has(c.id)).length,
      newestFirst,
      firstSixPositions: rowMajor,
      parts: {
        withThumb: cards.filter((c) => c.thumb).length,
        withCreator: cards.filter((c) => c.creator).length,
        withDuration: cards.filter((c) => c.duration).length,
        withLinkChip: cards.filter((c) => c.linkChip).length,
        fallbackTitles: cards.filter((c) => !/^parity /i.test(c.title)).map((c) => c.title).slice(0, 5),
        withTime: cards.filter((c) => c.time).length,
      },
      firstCards: cards.slice(0, 4).map(({ x, y, datetime, ...c }) => c),
    };
  });
  ev.set('step1-shots', await shoot4(ev, '1-grid', ownerOpen(context, '/')));
  await probe(ev, 'step1-columns-390', async () => {
    const p = await openUrl(context, '/', { w: 390, h: 844 });
    const cols = await p.getByTestId('capture-grid').evaluate((g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
    await p.close();
    return cols;
  });

  // 2. hover, copy link, middle-click
  const first = page.getByTestId('capture-card').first();
  const firstId = await first.getAttribute('data-id');
  await page.mouse.move(5, 5);
  await sleep(300);
  await probe(ev, 'step2-hover', async () => {
    const before = await cardState(first);
    await first.hover();
    await sleep(400);
    const after = await cardState(first);
    await page.screenshot({ path: ev.file('2-hover') });
    return { before, after };
  });
  await probe(ev, 'step2-copy', async () => {
    const t0 = Date.now();
    await first.getByTestId('card-copy').click();
    const t = await waitToast(page, /Link copied/, t0);
    const clip = await readClipboard(page);
    return { ...t, clipboard: clip.replace(SERVER, ''), urlBefore: page.url().replace(SERVER, ''), clicks: 1 };
  });
  await probe(ev, 'step2-middle-click', async () => {
    const newPage = context.waitForEvent('page', { timeout: 10_000 });
    await first.click({ button: 'middle' });
    const np = await newPage;
    await np.waitForLoadState('domcontentloaded');
    const out = { href: await first.getAttribute('href'), newTabUrl: np.url().replace(SERVER, ''), opensCard: np.url().endsWith(`/c/${firstId}`), sameTabStayed: page.url() === `${SERVER}/` };
    await np.close();
    return out;
  });
  ev.set(
    'step2-shots',
    await shoot4(ev, '2-hover', ownerOpen(context, '/'), async (p) => {
      await p.getByTestId('capture-card').first().hover();
      await sleep(300);
    }),
  );

  // 3. filters: type video, source extension, creator me; reload; clear each chip
  await page.mouse.move(5, 5);
  const filterRuns: Record<string, unknown>[] = [];
  const pickFilter = async (testid: string, option: Locator, param: string, label: string) => {
    const c = await calm();
    await page.getByTestId(testid).click();
    await option.waitFor();
    const resp = page.waitForResponse((r) => r.url().includes('/api/v1/recordings?') && r.request().method() === 'GET', { timeout: 15_000 });
    const t0 = Date.now();
    await option.click();
    await resp;
    await page.waitForFunction((pp) => location.search.includes(`${pp}=`) && !document.querySelector('[aria-busy="true"]') && !!(document.querySelector('[data-testid="capture-grid"]') || document.querySelector('[data-testid="no-results"]')), param, { polling: 'raf' });
    const ms = Date.now() - t0;
    await page.keyboard.press('Escape');
    await sleep(200);
    const total = txt(await page.getByTestId('grid-total').textContent().catch(() => ''));
    filterRuns.push({ filter: label, ms, seconds: secs(ms), load: c.load, reliable: c.reliable, total, clicks: 2, keys: 'Escape' });
  };
  await probe(ev, 'step3-filters', async () => {
    await pickFilter('filter-type', page.getByRole('option', { name: 'Video' }), 'type', 'type: Video');
    await pickFilter('filter-source', page.getByRole('option', { name: 'Extension' }), 'source', 'source: Extension');
    await pickFilter('filter-creator', page.locator(`[role="option"][data-value="${me.id}"]`), 'by', 'creator: me');
    const chips = (await page.getByTestId('filter-chip').allTextContents()).map(txt);
    const heading = txt(await page.locator('h1').first().textContent());
    await page.screenshot({ path: ev.file('3-chips') });
    const url = page.url().replace(SERVER, '');
    await page.reload();
    await ready(page);
    const afterReload = { url: page.url().replace(SERVER, ''), chips: (await page.getByTestId('filter-chip').allTextContents()).map(txt), total: txt(await page.getByTestId('grid-total').textContent().catch(() => '')) };
    const clears: { cleared: string; chipsLeft: number; url: string }[] = [];
    while ((await page.getByTestId('filter-chip').count()) > 0) {
      const chip = page.getByTestId('filter-chip').first();
      const label = txt(await chip.textContent());
      const n = await page.getByTestId('filter-chip').count();
      await chip.getByRole('button').click();
      await expect(page.getByTestId('filter-chip')).toHaveCount(n - 1);
      await ready(page);
      clears.push({ cleared: label, chipsLeft: n - 1, url: page.url().replace(SERVER, '') });
    }
    return { runs: filterRuns, chips, headingWithCreatorMe: heading, url, afterReload, clears, totalAfterClear: txt(await page.getByTestId('grid-total').textContent().catch(() => '')) };
  });
  ev.set('step3-shots', await shoot4(ev, '3-chips', ownerOpen(context, `/?type=video&source=extension&by=${me.id}`)));

  // 4. the palette on the dashboard
  await page.goto(`${SERVER}/`);
  await ready(page);
  const openPalette = async (p: Page) => {
    await p.locator('body').click({ position: { x: 600, y: 5 } }).catch(() => undefined);
    await p.keyboard.press('Control+k');
    await p.getByTestId('palette').waitFor();
    await p.getByTestId('palette-skeleton').first().waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
    await sleep(300);
  };
  await probe(ev, 'step4-empty', async () => {
    await openPalette(page);
    await page.screenshot({ path: ev.file('4-palette-empty') });
    const groups = (await page.locator('.pal .glabel').allTextContents()).map(txt);
    const rows = (await page.locator('.pal [data-row-type]').allTextContents()).map(txt);
    return { opened: await page.getByTestId('palette').isVisible(), groups, rows: rows.length, firstRows: rows.slice(0, 4), footer: txt(await page.locator('.pal .foot').textContent()) };
  });
  const QUERY = 'S3.1 lab';
  const typed: Record<string, unknown>[] = [];
  for (let run = 1; run <= 3; run++) {
    await probe(ev, `step4-typing-run${run}`, async () => {
      if (!(await page.getByTestId('palette').isVisible())) await openPalette(page);
      await page.getByTestId('palette-input').fill('');
      await sleep(400);
      const c = await calm();
      const tFirst = Date.now();
      await page.keyboard.type(QUERY, { delay: 60 });
      const tLast = Date.now();
      await page.waitForFunction(
        () => {
          const rows = [...document.querySelectorAll('.pal [data-row-type="capture"]')];
          return rows.some((r) => /parity S3\.1 lab/.test(r.textContent ?? '')) && !document.querySelector('.pal .field .nb-spin, .pal .field [data-icon="spinner"]');
        },
        undefined,
        { polling: 'raf', timeout: 15_000 },
      );
      const tSeen = Date.now();
      const r = { run, fromLastKeyMs: tSeen - tLast, fromFirstKeyMs: tSeen - tFirst, seconds: secs(tSeen - tLast), load: c.load, reliable: c.reliable };
      typed.push(r);
      return r;
    });
    if (run < 3) {
      await page.keyboard.press('Escape');
      await sleep(300);
    }
  }
  await probe(ev, 'step4-results', async () => {
    await sleep(300);
    await page.screenshot({ path: ev.file('4-palette-results') });
    const groups = (await page.locator('.pal .glabel').allTextContents()).map(txt);
    const rows = await page.locator('.pal [data-row-type]').evaluateAll((els) => els.map((e) => ({ type: e.getAttribute('data-row-type'), text: (e.textContent ?? '').replace(/\s+/g, ' ').trim(), selected: e.getAttribute('aria-selected') })));
    const preview = (await page.getByTestId('palette-preview').isVisible()) ? txt(await page.getByTestId('palette-preview').textContent()) : null;
    const mark = await page.locator('.pal mark').allTextContents();
    return { query: QUERY, groups, rows, preview, highlighted: mark, footer: txt(await page.locator('.pal .foot').textContent()) };
  });
  await probe(ev, 'step4-keys', async () => {
    const sel = () => page.locator('.pal [aria-selected="true"]').getAttribute('data-row-index');
    const start = await sel();
    await page.keyboard.press('ArrowDown');
    await sleep(150);
    const down = await sel();
    await page.keyboard.press('ArrowUp');
    await sleep(150);
    const up = await sel();
    const selectedText = txt(await page.locator('.pal [aria-selected="true"]').textContent());
    const t0 = Date.now();
    await page.keyboard.press('Control+c');
    const toast = await waitToast(page, /Link copied/, t0);
    const clip = await readClipboard(page);
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/c\//, { timeout: 15_000 });
    return { start, down, up, selectedText, copy: { ...toast, clipboard: clip.replace(SERVER, '') }, enterOpened: page.url().replace(SERVER, ''), paletteClosed: !(await page.getByTestId('palette').isVisible()) };
  });
  ev.set('step4-typing-summary', { runs: typed, medianFromLastKeyMs: typed.map((r) => r.fromLastKeyMs as number).sort((a, b) => a - b)[1] ?? null });
  ev.set(
    'step4-shots-empty',
    await shoot4(ev, '4-palette-empty', ownerOpen(context, '/'), async (p) => {
      await openPalette(p);
    }),
  );
  ev.set(
    'step4-shots-results',
    await shoot4(ev, '4-palette-results', ownerOpen(context, '/'), async (p) => {
      await openPalette(p);
      await p.keyboard.type(QUERY, { delay: 30 });
      await p.locator('.pal [data-row-type="capture"]').first().waitFor();
      await sleep(400);
    }),
  );

  // 5. the palette on a capture page; a member row sets the creator filter
  await probe(ev, 'step5-capture-page', async () => {
    const cap = await openUrl(context, `/c/${N1()}`);
    await cap.locator('body').click({ position: { x: 700, y: 5 } }).catch(() => undefined);
    await cap.keyboard.press('Control+k');
    await cap.getByTestId('palette').waitFor();
    const opened = await cap.getByTestId('palette').isVisible();
    await cap.keyboard.type(me.name, { delay: 60 });
    await cap.locator('.pal [data-row-type="member"]').first().waitFor({ timeout: 10_000 });
    await sleep(500);
    await cap.screenshot({ path: ev.file('5-palette-member') });
    const groups = (await cap.locator('.pal .glabel').allTextContents()).map(txt);
    const firstRow = await cap.locator('.pal [aria-selected="true"]').getAttribute('data-row-type');
    const count = txt(await cap.getByTestId('palette-count').textContent());
    const hint = txt(await cap.getByTestId('palette-enter-hint').textContent().catch(() => ''));
    await cap.keyboard.press('Enter');
    await cap.waitForURL(/\/\?by=/, { timeout: 15_000 });
    await ready(cap);
    const chips = (await cap.getByTestId('filter-chip').allTextContents()).map(txt);
    const heading = txt(await cap.locator('h1').first().textContent());
    await cap.screenshot({ path: ev.file('5-creator-list') });
    const out = { paletteOpened: opened, typed: me.name, groups, membersFirst: groups[0] === 'Members', selectedRowType: firstRow, footerCount: count, enterHint: hint, landed: cap.url().replace(SERVER, ''), chips, heading };
    await cap.close();
    return out;
  });
  ev.set(
    'step5-shots',
    await shoot4(ev, '5-palette-member', ownerOpen(context, `/c/${N1()}`), async (p) => {
      await p.locator('body').click({ position: { x: 300, y: 5 } }).catch(() => undefined);
      await p.keyboard.press('Control+k');
      await p.getByTestId('palette').waitFor();
      await p.keyboard.type(me.name, { delay: 30 });
      await p.locator('.pal [data-row-type="member"]').first().waitFor();
      await sleep(400);
    }),
  );
  await page.close().catch(() => undefined);
  ev.set('load-end', load());
});

// ================================================================ S6.2

test('S6.2 folders', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S6.2');
  const { context } = await getRig();
  const ws = await activate(context, MAIN_WS);
  const n5 = N5();
  // N4 lives in the workspace "Parity"; step 4 needs two cards on this workspace's grid, so a
  // second screenshot of this workspace (the S3.3 pre-roll screenshot) stands in for it there.
  const stand = (await listCaps(context, `workspaceId=${ws.id}&folderId=all&limit=100&kinds=screenshot`)).items.find((c) => c.title === 'parity S3.3 pre-roll');
  if (!stand) throw new Error('no "parity S3.3 pre-roll" capture to stand in for N4');
  // setup for a repeatable run: drop folders a broken run left, put both cards back on the grid
  for (const f of await folders(context, ws.id)) if (/^parity-(s1|tmp2?|warn)$/.test(f.name)) await api(context, 'DELETE', `/api/v1/folders/${f.id}`);
  await api(context, 'POST', '/api/v1/recordings/bulk', { action: 'move', ids: [n5, stand.id], folderId: null });
  const parity = (await folders(context, ws.id)).find((f) => f.name === 'parity');
  ev.set('setup', { workspace: ws.name, n5, n4StandIn: { id: stand.id, title: stand.title }, parityFolder: parity ? { shortId: parity.shortId, captures: parity.captureCount } : null, loadStart: load() });

  const page = await openUrl(context, '/');
  const sidebarNames = async () => (await page.getByTestId('folder-list').locator('a .name').allTextContents()).map(txt);

  // 1 and 2. new folders from the sidebar heading
  const makeFolder = async (name: string, step: string) => {
    await page.mouse.move(700, 600);
    await sleep(200);
    const plusBefore = await page.getByTestId('new-folder').evaluate((e) => Number(getComputedStyle(e).opacity));
    await page.getByTestId('folders-heading').hover();
    await sleep(300);
    const plusOnHover = await page.getByTestId('new-folder').evaluate((e) => Number(getComputedStyle(e).opacity));
    if (step === '1') await page.screenshot({ path: ev.file('1-heading-hover') });
    await page.getByTestId('new-folder').click();
    const input = page.getByTestId('new-folder-input');
    await input.waitFor();
    await sleep(200);
    const focused = await input.evaluate((e) => document.activeElement === e);
    let clicks = 1;
    if (!focused) {
      // the field shows but the plus keeps the focus: a person clicks into the field first
      if (step === '1') await page.screenshot({ path: ev.file('1-input-unfocused') });
      await input.click();
      clicks++;
    }
    await page.keyboard.type(name, { delay: 40 });
    if (step === '1') await page.screenshot({ path: ev.file('1-input') });
    const urlBefore = page.url();
    const c = await calm();
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    const toast = await waitToast(page, new RegExp(`Folder "${name}" created`), t0);
    await expect(page.getByTestId('folder-list').getByRole('link', { name })).toBeVisible();
    const listedMs = Date.now() - t0;
    if (step === '1') await page.screenshot({ path: ev.file('1-created') });
    return { name, plusOpacity: { before: plusBefore, onHover: plusOnHover }, inputFocused: focused, ...toast, listedMs, load: c.load, reliable: c.reliable, stayedOnPage: page.url() === urlBefore, url: page.url().replace(SERVER, ''), clicks, keys: 'Enter' };
  };
  // the script makes "parity" here; where it exists already (S1.5 ran first), the same flow makes "parity-s1"
  const step1Name = parity ? 'parity-s1' : 'parity';
  await probe(ev, 'step1-new-folder', () => makeFolder(step1Name, '1'));
  const parityF = parity ?? (await folders(context, ws.id)).find((f) => f.name === 'parity');
  if (!parityF) throw new Error('no folder "parity"');
  await probe(ev, 'step2-second-folder', () => makeFolder('parity-tmp', '2'));
  await probe(ev, 'step2-sidebar', async () => {
    const names = await sidebarNames();
    const icons = await page.getByTestId('folder-list').locator('a').evaluateAll((els) => els.map((a) => !!a.querySelector('svg')));
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    await page.getByTestId('folder-list').getByRole('link', { name: 'parity', exact: true }).click();
    await page.waitForURL(/\/f\//);
    await ready(page);
    const key = new URL(page.url()).pathname.split('/')[2]!;
    await page.screenshot({ path: ev.file('2-parity-folder') });
    return {
      names,
      alphabetical: JSON.stringify(names) === JSON.stringify(sorted),
      everyRowHasIcon: icons.every(Boolean),
      openedUrl: page.url().replace(SERVER, ''),
      idLength: key.length,
      sidebarCount: txt(await page.getByTestId('folder-count').textContent().catch(() => '')),
      title: txt(await page.getByTestId('folder-title').textContent()),
      clicks: 1,
    };
  });
  ev.set('step2-shots', await shoot4(ev, '2-parity-folder', ownerOpen(context, `/f/${parityF.shortId}`), drawer));

  // 3. rename parity-tmp to parity-tmp2, then delete it
  await probe(ev, 'step3-rename', async () => {
    await page.getByTestId('folder-list').getByRole('link', { name: 'parity-tmp', exact: true }).click();
    await page.waitForURL(/\/f\//);
    await ready(page);
    await page.getByTestId('folder-menu').click();
    const items = (await page.locator('.nb-pop [role="menuitem"]').allTextContents()).map(txt);
    await page.screenshot({ path: ev.file('3-folder-menu') });
    await page.getByTestId('folder-rename').click();
    const input = page.getByTestId('rename-input');
    await input.waitFor();
    await sleep(200);
    const sel = await input.evaluate((e: HTMLInputElement) => ({ value: e.value, selStart: e.selectionStart, selEnd: e.selectionEnd, focused: document.activeElement === e }));
    await page.screenshot({ path: ev.file('3-rename') });
    await page.keyboard.type('parity-tmp2');
    const t0 = Date.now();
    await page.keyboard.press('Enter');
    const toast = await waitToast(page, /Renamed to "parity-tmp2"/, t0);
    await expect(page.getByTestId('folder-title')).toContainText('parity-tmp2');
    return { menuItems: items, input: sel, prefilledAndSelected: sel.value === 'parity-tmp' && sel.selStart === 0 && sel.selEnd === sel.value.length && sel.focused, ...toast, title: txt(await page.getByTestId('folder-title').textContent()), sidebar: await sidebarNames(), clicks: 2, keys: 'Enter' };
  });
  await probe(ev, 'step3-delete', async () => {
    // never delete another folder than the one this step renamed
    if (txt(await page.getByTestId('folder-title').textContent().catch(() => '')) !== 'parity-tmp2') throw new Error('not on parity-tmp2; delete skipped');
    await page.getByTestId('folder-menu').click();
    await page.getByTestId('folder-delete').click();
    const dlg = page.getByTestId('confirm-dialog');
    await dlg.waitFor();
    await sleep(300);
    await page.screenshot({ path: ev.file('3-delete-warning-tmp2') });
    const warning = { text: txt(await dlg.textContent()), buttons: (await dlg.getByRole('button').allTextContents()).map(txt) };
    const t0 = Date.now();
    await page.getByTestId('confirm-button').click();
    const toast = await waitToast(page, /Deleted "parity-tmp2"/, t0);
    await page.waitForURL(`${SERVER}/`);
    return { warning, ...toast, landed: page.url().replace(SERVER, ''), sidebar: await sidebarNames(), clicks: 3 };
  });
  ev.set(
    'step3-shots-warning',
    await (async () => {
      // the warning in all four variants, on an empty folder made for it through the API and
      // cancelled each time; the folder is deleted through the API afterwards
      const made = await api<FolderRow>(context, 'POST', `/api/v1/workspaces/${ws.id}/folders`, { name: 'parity-warn' });
      const f = made.body;
      const out: Record<string, unknown> = {};
      for (const [w, h, theme] of VARIANTS) {
        const p = await openUrl(context, `/f/${f.shortId}`, { w, h, theme });
        try {
          if (txt(await p.getByTestId('folder-title').textContent()) !== 'parity-warn') throw new Error('not on parity-warn');
          await p.getByTestId('folder-menu').click();
          await p.getByTestId('folder-delete').click();
          await p.getByTestId('confirm-dialog').waitFor();
          await sleep(400);
          await p.screenshot({ path: ev.file('3-delete-warning', String(w), theme) });
          out[`${w}-${theme}`] = await overflowX(p);
          await p.getByTestId('confirm-dialog').getByRole('button', { name: 'Cancel' }).click();
        } catch (e) {
          out[`${w}-${theme}`] = String(e).slice(0, 200);
        }
        await p.close();
      }
      await api(context, 'DELETE', `/api/v1/folders/${f.id}`);
      return out;
    })(),
  );

  // 4. tick N5, click the stand-in, move both to "parity"; then tick both there, delete, cancel
  await page.goto(`${SERVER}/`);
  await ready(page);
  await probe(ev, 'step4-move', async () => {
    const a = card(page, n5);
    const b = card(page, stand.id);
    await a.scrollIntoViewIfNeeded();
    await a.hover();
    await a.getByTestId('card-check').click();
    await page.getByTestId('selection-bar').waitFor();
    const one = txt(await page.getByTestId('selection-count').textContent());
    const headerGone = !(await page.getByTestId('filter-bar').isVisible().catch(() => false));
    await page.screenshot({ path: ev.file('4-selection-1') });
    await b.scrollIntoViewIfNeeded();
    await b.click();
    await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
    await page.getByTestId('selection-bar').scrollIntoViewIfNeeded();
    await page.screenshot({ path: ev.file('4-selection-2') });
    await page.getByTestId('bulk-move').click();
    await page.getByTestId('folder-picker').waitFor();
    const picker = (await page.getByTestId('folder-picker').getByRole('menuitem').allTextContents()).map(txt);
    await page.screenshot({ path: ev.file('4-move-picker') });
    const c = await calm();
    const t0 = Date.now();
    await page.getByTestId('folder-picker').getByRole('menuitem', { name: 'parity', exact: true }).click();
    const toast = await waitToast(page, /Moved 2 captures to parity/, t0);
    await expect(card(page, n5)).toHaveCount(0);
    await expect(card(page, stand.id)).toHaveCount(0);
    const goneMs = Date.now() - t0;
    const caps = await listCaps(context, `workspaceId=${ws.id}&folderId=${parityF.id}&limit=100`);
    return {
      oneTicked: one,
      headerBecameSelectionBar: headerGone,
      picker,
      ...toast,
      cardsGoneMs: goneMs,
      load: c.load,
      reliable: c.reliable,
      bothInParity: [n5, stand.id].every((id) => caps.items.some((x) => x.id === id)),
      clicks: 4,
      clicksForOneCard: 3,
    };
  });
  ev.set(
    'step4-shots-selection',
    await shoot4(ev, '4-selection', ownerOpen(context, `/f/${parityF.shortId}`), async (p) => {
      const a = card(p, n5);
      await a.hover();
      await a.getByTestId('card-check').click();
      await card(p, stand.id).click();
      await p.getByTestId('selection-bar').waitFor();
      await p.mouse.move(5, 5);
    }),
  );
  await probe(ev, 'step4-delete-cancel', async () => {
    await page.getByTestId('folder-list').getByRole('link', { name: 'parity', exact: true }).click();
    await page.waitForURL(/\/f\//);
    await ready(page);
    const a = card(page, n5);
    await a.hover();
    await a.getByTestId('card-check').click();
    await card(page, stand.id).click();
    await expect(page.getByTestId('selection-count')).toHaveText('2 selected');
    await page.getByTestId('bulk-delete').click();
    const dlg = page.locator('dialog[open][data-testid="confirm-dialog"]');
    await dlg.waitFor();
    await sleep(300);
    await page.screenshot({ path: ev.file('4-delete-confirm') });
    const text = txt(await dlg.textContent());
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(dlg).toHaveCount(0);
    const still = await Promise.all([n5, stand.id].map(async (id) => (await api<{ id: string }>(context, 'GET', `/api/v1/recordings/${id}`)).status));
    const selectionAfter = (await page.getByTestId('selection-bar').isVisible()) ? txt(await page.getByTestId('selection-count').textContent()) : 'cleared';
    if (selectionAfter !== 'cleared') await page.getByRole('button', { name: 'Clear selection' }).click();
    return { confirm: text, cancelled: true, apiStatuses: still, selectionAfterCancel: selectionAfter, clicks: 4 };
  });

  // 5. N4: three-dot, move, no folder; then back into "parity"
  await probe(ev, 'step5-move-from-page', async () => {
    const cap = await openUrl(context, `/c/${N4()}`);
    const chip0 = txt(await cap.getByTestId('folder-chip').textContent());
    const moveVia = async (target: string, re: RegExp, shot?: string) => {
      await cap.getByTestId('more').click();
      await cap.getByRole('menuitem', { name: 'Move to folder' }).click();
      const items = (await cap.getByRole('menuitem').allTextContents()).map(txt);
      if (shot) await cap.screenshot({ path: ev.file(shot) });
      const t0 = Date.now();
      await cap.getByRole('menuitem', { name: target, exact: true }).click();
      const toast = await waitToast(cap, re, t0);
      await sleep(300);
      const chip = txt(await cap.getByTestId('folder-chip').textContent());
      const href = await cap.getByTestId('folder-chip').getAttribute('href');
      return { items, ...toast, chip, chipHref: href, clicks: 3 };
    };
    const out = await moveVia('No folder', /Moved out of the folder/, '5-move-menu');
    await cap.screenshot({ path: ev.file('5-no-folder') });
    const back = await moveVia('parity', /Moved to parity/);
    await cap.screenshot({ path: ev.file('5-back-in-parity') });
    const api1 = await api<{ folderId?: string | null }>(context, 'GET', `/api/v1/recordings/${N4()}`);
    let chipOpens: string | null = null;
    if (back.chipHref) {
      const r = await context.request.get(SERVER + back.chipHref, { failOnStatusCode: false, maxRedirects: 0 });
      chipOpens = String(r.status());
    }
    await cap.reload();
    await ready(cap);
    const chipAfterReload = { text: txt(await cap.getByTestId('folder-chip').textContent()), href: await cap.getByTestId('folder-chip').getAttribute('href') };
    await cap.close();
    return { chipBefore: chip0, out, back, apiFolderId: api1.body?.folderId ?? null, chipHrefStatus: chipOpens, chipAfterReload };
  });
  ev.set('step5-shots', await shoot4(ev, '5-capture-page', ownerOpen(context, `/c/${N4()}`)));

  // cleanup: parity-s1 was made for step 1 only
  await probe(ev, 'cleanup', async () => {
    const f = (await folders(context, ws.id)).find((x) => x.name === 'parity-s1');
    if (f) await api(context, 'DELETE', `/api/v1/folders/${f.id}`);
    return { deleted: f ? 'parity-s1 (API)' : null, folders: (await folders(context, ws.id)).map((x) => x.name) };
  });
  await page.close().catch(() => undefined);
  ev.set('load-end', load());
});

// ================================================================ S6.3

/** One screen pixel on `display`. */
function pixel(display: string, x: number, y: number): [number, number, number] {
  const out = execFileSync('import', ['-window', 'root', '-crop', `1x1+${Math.round(x)}+${Math.round(y)}`, '-depth', '8', 'txt:-'], { env: { ...process.env, DISPLAY: display }, encoding: 'utf8' });
  const m = out.match(/#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})/);
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [0, 0, 0];
}
const white = ([r, g, b]: number[]) => r! > 245 && g! > 245 && b! > 245;
const dimmed = ([r, g, b]: number[]) => r! < 130 && g! < 130 && b! < 130;
function clickOn(display: string, x: number, y: number) {
  const env = { ...process.env, DISPLAY: display };
  execFileSync('xdotool', ['mousemove', '--sync', String(Math.round(x)), String(Math.round(y))], { env });
  execFileSync('xdotool', ['click', '1'], { env });
}

/**
 * Chrome's share picker for a web page: a tab-modal dialog 610 px wide, centred, its top 83 px
 * below the window's top (as in e2e/flows/fixture.ts). Real X clicks: the Entire Screen tab, the
 * screen thumbnail, Share. Returns the clicks, or 0 when no picker showed.
 */
async function pickEntireScreen(display: string, timeout = 15_000): Promise<number> {
  const left = (1440 - 610) / 2;
  const top = 83;
  const up = () => white(pixel(display, left + 8, top + 300)) && dimmed(pixel(display, left - 30, top + 300));
  const t0 = Date.now();
  while (!up()) {
    if (Date.now() - t0 > timeout) return 0;
    await sleep(150);
  }
  await sleep(500);
  execFileSync('import', ['-window', 'root', path.join(SHOTS, GROUP, 'S6.3-4-picker-nib-1440-light.png')], { env: { ...process.env, DISPLAY: display } });
  clickOn(display, left + 491, top + 96);
  await sleep(1000);
  clickOn(display, left + 170, top + 225);
  await sleep(300);
  clickOn(display, left + 610 - 57, top + 574);
  for (let i = 0; i < 50; i++) {
    if (!dimmed(pixel(display, left - 30, top + 300))) return 3;
    await sleep(100);
  }
  throw new Error('the share picker stayed open after Share');
}

class Crash extends Error {}

test('S6.3 recording links page, a recipient recording (N6), the workspace menu', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S6.3');
  const { context } = await getRig();
  const ws = await activate(context, MAIN_WS);
  const parity = (await folders(context, ws.id)).find((f) => f.name === 'parity')!;
  ev.set('setup', { workspace: ws.name, parityFolder: parity.shortId, loadStart: load() });

  // 1. the links page
  const page = await openUrl(context, '/links');
  await page.getByTestId('link-rows').waitFor();
  await page.screenshot({ path: ev.file('1-links') });
  const row = page.getByTestId('link-row').filter({ has: page.getByTestId('link-name').getByText('parity link', { exact: true }) }).first();
  const linkId = (await row.getAttribute('data-id'))!;
  const linkState = async () => {
    const r = await api<{ items: { id: string; uses: number; url: string; name: string }[] }>(context, 'GET', `/api/v1/workspaces/${ws.id}/recording-links?status=all&limit=200`);
    return r.body.items.find((l) => l.id === linkId)!;
  };
  const usesBefore = (await linkState()).uses;
  await probe(ev, 'step1-page', async () => {
    const rows = (await page.getByTestId('link-name').allTextContents()).map(txt);
    const parts = await row.evaluate((el) => ({
      mosaicCells: el.querySelectorAll('.mosaic > *').length,
      mosaicImages: el.querySelectorAll('.mosaic img').length,
      name: (el.querySelector('[data-testid="link-name"]')?.textContent ?? '').trim(),
      creator: (el.querySelector('.by')?.textContent ?? '').trim(),
      uses: (el.querySelector('[data-testid="link-uses"]')?.textContent ?? '').trim(),
      folderChip: (el.querySelector('[data-testid="link-folder"]')?.textContent ?? '').trim(),
      share: !!el.querySelector('[data-testid="link-share"]'),
      openCaptures: el.querySelector('[data-testid="link-open-captures"]')?.getAttribute('href') ?? null,
      more: !!el.querySelector('[data-testid="link-more"]'),
      meta: (el.querySelector('.meta')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    }));
    await row.getByTestId('link-more').click();
    const moreItems = (await page.locator('.nb-pop [role="menuitem"]').allTextContents()).map(txt);
    await page.keyboard.press('Escape');
    const status = (await page.getByTestId('link-status').getByRole('radio').allTextContents()).map(txt);
    const sort = (await page.getByTestId('link-sort').locator('option').allTextContents()).map(txt);
    const creatorFilter = await page.getByTestId('link-creator').isVisible();
    await page.getByTestId('new-link').click();
    await page.getByTestId('new-link-form').waitFor();
    const form = txt(await page.getByTestId('new-link-form').textContent());
    await page.screenshot({ path: ev.file('1-new-link-form') });
    await page.keyboard.press('Escape');
    return { linkId, rows, parts, moreItems, filters: { status, sort, creatorFilter }, newLinkForm: form, lead: txt(await page.locator('p.lead').textContent()) };
  });
  ev.set('step1-shots', await shoot4(ev, '1-links', ownerOpen(context, '/links')));

  // 2. copy the link
  const linkUrl = await probe(ev, 'step2-copy', async () => {
    await row.getByTestId('link-share').click();
    await page.getByTestId('link-copy').waitFor();
    await page.screenshot({ path: ev.file('2-share-popover') });
    const t0 = Date.now();
    await page.getByTestId('link-copy').click();
    const toast = await waitToast(page, /Link copied/, t0);
    const clip = await readClipboard(page);
    return { ...toast, clipboard: clip, matchesApi: clip === (await linkState()).url, clicks: 2 };
  });
  const url = (linkUrl as { clipboard?: string } | null)?.clipboard || (await linkState()).url;
  ev.set('step2-recorder-shots', await shoot4(ev, '2-recorder', anonOpen(url)));

  // 3 and 4. the recipient: a fresh Chromium with no extension, no profile, no sign-in, on a
  // display of its own; voice first (no microphone exists), then screen only through the picker
  const recipient = async (attempt: number) => {
    const free = availableMb();
    if (free < 1600) throw new Error(`only ${free} MB available`);
    const x = await privateDisplay(170);
    const browser = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY: x.display }, args: ['--window-position=0,0', '--window-size=1440,900', '--force-device-scale-factor=1'] });
    let crashed = false;
    let closing = false;
    browser.on('disconnected', () => {
      if (!closing) crashed = true;
    });
    const steps: string[] = [];
    let clicks = 0;
    try {
      const ctx = await browser.newContext({ viewport: null });
      const lab = await ctx.newPage();
      await lab.goto(LAB_URL);
      await lab.waitForLoadState('networkidle');
      const rec = await ctx.newPage();
      const c = await calm();
      const t0 = Date.now();
      await rec.goto(url);
      await rec.waitForLoadState('networkidle');
      steps.push('open the link');
      const heading = txt(await rec.locator('main h1').textContent());
      const eyebrow = txt(await rec.locator('main .eyebrow').textContent().catch(() => ''));
      await rec.screenshot({ path: ev.file('2-recorder-recipient') });
      // 3. screen and voice: the tile click checks the microphone and starts (J-017)
      const helpBeforeStart = await rec.getByTestId('mic-help').isVisible().catch(() => false);
      await rec.getByTestId('choose-voice').click();
      clicks++;
      steps.push('pick screen and voice (starts at once)');
      await rec.getByTestId('mic-help').waitFor({ timeout: 15_000 });
      await sleep(300);
      const micHelp = { reason: await rec.getByTestId('mic-help').getAttribute('data-reason'), text: txt(await rec.getByTestId('mic-help').textContent()), startLabel: txt(await rec.getByTestId('recorder-start').textContent()) };
      await rec.screenshot({ path: ev.file('3-mic-help') });
      // continue without voice: this starts the recording, the picker opens
      await rec.getByTestId('record-without-voice').click();
      clicks++;
      steps.push('record without voice (starts at once)');
      const picked = await pickEntireScreen(x.display);
      if (!picked) throw new Error('the share picker did not open');
      clicks += picked;
      steps.push('picker: Entire Screen, the screen, Share');
      await rec.getByTestId('recorder-live').waitFor({ timeout: 20_000 });
      const liveAt = Date.now() - t0;
      await sleep(800);
      execFileSync('import', ['-window', 'root', ev.file('4-recording-screen')], { env: { ...process.env, DISPLAY: x.display } });
      // the lab tab: Submit order
      await lab.bringToFront();
      clicks++;
      steps.push('switch to the lab tab');
      await sleep(500);
      await lab.getByTestId('hidden-500').click();
      clicks++;
      steps.push('click Submit order');
      await sleep(1500);
      execFileSync('import', ['-window', 'root', ev.file('4-lab-during-recording')], { env: { ...process.env, DISPLAY: x.display } });
      await rec.bringToFront();
      clicks++;
      steps.push('back to the recorder tab');
      await sleep(400);
      await rec.getByTestId('recorder-stop').click();
      clicks++;
      steps.push('stop');
      await rec.getByTestId('recorder-preview').waitFor();
      await sleep(500);
      await rec.screenshot({ path: ev.file('4-review') });
      await rec.getByTestId('recorder-note').click();
      clicks++;
      await rec.keyboard.type('parity recipient');
      steps.push('note "parity recipient"');
      const tSend = Date.now();
      await rec.getByTestId('recorder-submit').click();
      clicks++;
      steps.push('send');
      await rec.getByTestId('recorder-done').waitFor({ timeout: 120_000 });
      const tDone = Date.now();
      await rec.screenshot({ path: ev.file('4-done') });
      const done = txt(await rec.getByTestId('recorder-done').textContent());
      return { attempt, display: x.display, heading, eyebrow, helpBeforeStart, micHelp, pickerClicks: picked, steps, stepCount: steps.length, clicks, liveAfterMs: liveAt, sendToDoneMs: tDone - tSend, openToDoneMs: tDone - t0, openToDoneS: secs(tDone - t0), load: c.load, reliable: c.reliable, done };
    } catch (e) {
      if (crashed) throw new Crash(`the recipient's Chromium went away: ${String(e).split('\n')[0]}`);
      throw e;
    } finally {
      closing = true;
      await browser.close().catch(() => undefined);
      x.stop();
    }
  };
  let sent: Awaited<ReturnType<typeof recipient>> | null = null;
  const attempts: string[] = [];
  for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
    try {
      sent = await recipient(attempt);
    } catch (e) {
      attempts.push(String(e).slice(0, 300));
      if (!(e instanceof Crash)) break;
    }
  }
  ev.set('step3-4-recipient', sent ?? { error: attempts });
  if (attempts.length) ev.set('step3-4-failed-attempts', attempts);

  // 5. back as the owner
  await probe(ev, 'step5-landed', async () => {
    const t0 = Date.now();
    let landed: Cap | undefined;
    while (!landed && Date.now() - t0 < 60_000) {
      landed = (await listCaps(context, `workspaceId=${ws.id}&folderId=all&recordingLinkId=${linkId}&limit=10`)).items[0];
      if (!landed) await sleep(1000);
    }
    if (!landed) throw new Error('no capture through the link');
    await waitReady(context, landed.id, 180_000);
    const full = await api<{ kind: string; title: string; description?: string; folderId?: string | null; status: string; durationMs?: number }>(context, 'GET', `/api/v1/recordings/${landed.id}`);
    const usesAfter = (await linkState()).uses;
    const f = await openUrl(context, `/f/${parity.shortId}`);
    const c = card(f, landed.id);
    await c.waitFor();
    const chip = txt(await c.locator('.chip').textContent().catch(() => ''));
    await f.screenshot({ path: ev.file('5-landed-folder') });
    await f.close();
    const lp = await openUrl(context, '/links');
    const usesShown = txt(await lp.getByTestId('link-row').filter({ has: lp.locator(`[data-id="${linkId}"]`) }).getByTestId('link-uses').textContent().catch(() => ''));
    const usesShown2 = usesShown || txt(await lp.locator(`[data-testid="link-row"][data-id="${linkId}"] [data-testid="link-uses"]`).textContent());
    await lp.screenshot({ path: ev.file('5-links-after') });
    await lp.close();
    return {
      id: landed.id,
      kind: full.body.kind,
      title: full.body.title,
      description: full.body.description,
      status: full.body.status,
      durationMs: full.body.durationMs,
      inParity: full.body.folderId === parity.id,
      cardChip: chip,
      usesBefore,
      usesAfter,
      usesShown: usesShown2,
      mailpit: 'skipped (scope: FEATURE_EMAIL)',
    };
  });
  const landedId = (ev.data['step5-landed'] as { id?: string } | undefined)?.id;
  if (landedId) ev.set('step5-shots', await shoot4(ev, '5-landed-capture', ownerOpen(context, `/c/${landedId}`)));

  // 6. the workspace menu
  await probe(ev, 'step6-workspace-menu', async () => {
    await page.goto(`${SERVER}/`);
    await ready(page);
    await page.getByTestId('workspace-menu').click();
    const menu = page.locator(`#${await page.getByTestId('workspace-menu').getAttribute('aria-controls')}`);
    await menu.waitFor();
    await sleep(300);
    await page.screenshot({ path: ev.file('6-workspace-menu') });
    const text = txt(await menu.textContent());
    const items = (await menu.locator('[role="menuitem"]').allTextContents()).map(txt);
    const current = txt(await menu.locator('.current').textContent().catch(() => ''));
    await page.keyboard.press('Escape');
    await sleep(300);
    return { current, items, text, closedByEscape: !(await menu.isVisible()), clicks: 1 };
  });
  ev.set(
    'step6-shots',
    await shoot4(ev, '6-workspace-menu', ownerOpen(context, '/'), async (p, w) => {
      await drawer(p, w);
      await p.getByTestId('workspace-menu').click();
      await p.locator(`#${await p.getByTestId('workspace-menu').getAttribute('aria-controls')}`).waitFor();
    }),
  );
  await page.close().catch(() => undefined);
  ev.set('load-end', load());
});
