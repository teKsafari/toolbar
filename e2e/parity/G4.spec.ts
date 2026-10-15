// Parity group G4, Nib side: viewer and dev tools panels (docs/parity/scenarios.md, S4.1 to
// S4.3). Each test is one scenario, run as scripted on the capture page at 1440x900, and records
// its evidence (lists, counts, clicks, states, timings with the load average, screenshots) in
// e2e/parity-shots/G4/<scenario>.json and .png files. The raw results are written up in
// docs/parity/G4-replica.md.
//
//   cd e2e && PARITY_EXT_BUILD=chrome-mv3-g4 npx playwright test -c playwright.parity.config.ts G4
//   cd e2e && npx playwright test -c playwright.parity.config.ts G4 -g S4.2   # one
//
// Captures: N1 is the S3.1 tab recording of every lab case (id from e2e/parity-shots/G3/S3.1.json,
// or PARITY_N1), N4 the S2.1 annotated screenshot and N5 the S2.2 area screenshot with the full
// viewport kept (ids from e2e/parity-shots/G2/, or PARITY_N4 and PARITY_N5). S4.3 makes a fresh
// instant replay capture through the extension, with real X input as in G1.
//
// The capture page is a web page: Playwright drives it, except the player keys of S4.1 step 4 and
// the arrow keys of step 15, which go through the X server (xdotool) so fullscreen and Escape
// behave as for a person. Every change made to N1 (title, description, speed, panel width, time
// zone) is put back at the end of S4.1.
import { expect, test, type BrowserContext, type Frame, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  Evidence,
  ROOT,
  SERVER,
  LAB_URL,
  api,
  availableMb,
  calm,
  captureOf,
  clickIcon,
  clipboard,
  editorFrame,
  focusWindow,
  launchNib,
  load,
  screencast,
  secs,
  signIn,
  sleep,
  until,
  waitReady,
  xclickEl,
  xclickPopup,
  xdo,
  xkey,
  type Launched,
} from './rig.ts';

const GROUP = 'G4';
const EMAIL = process.env.PARITY_EMAIL ?? 'parity@example.com';
const SHOTS = path.join(ROOT, 'e2e/parity-shots');

function idFrom(env: string, file: string, pick: (j: Record<string, unknown>) => unknown): string {
  if (process.env[env]) return process.env[env]!;
  const j = JSON.parse(fs.readFileSync(path.join(SHOTS, file), 'utf8')) as Record<string, unknown>;
  const id = pick(j);
  if (typeof id !== 'string') throw new Error(`no capture id in ${file}; set ${env}`);
  return id;
}
const N1 = () => idFrom('PARITY_N1', 'G3/S3.1.json', (j) => (j.capture as { id?: string } | undefined)?.id);
const N4 = () => idFrom('PARITY_N4', 'G2/S2.1-23-recording.json', (j) => j.id);
const N5 = () => idFrom('PARITY_N5', 'G2/S2.2.json', (j) => (j['kept-capture'] as { id?: string } | undefined)?.id);

// ---------------------------------------------------------------- one signed-in browser

let rig: Launched | null = null;

async function getRig(): Promise<Launched> {
  if (rig) return rig;
  rig = await launchNib();
  const { popup } = await signIn(rig.context, EMAIL);
  await popup.close().catch(() => undefined);
  for (const p of rig.context.pages()) if (p.url().startsWith(SERVER)) await p.close().catch(() => undefined);
  return rig;
}

test.afterAll(async () => {
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
    ev.set(key, { error: String(e).slice(0, 500) });
    return null;
  }
}

const txt = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- the capture page

type Theme = 'light' | 'dark';
const VARIANTS: [number, number, Theme][] = [
  [1440, 900, 'light'],
  [1440, 900, 'dark'],
  [390, 844, 'light'],
  [390, 844, 'dark'],
];

async function openCap(context: BrowserContext, id: string, o: { w?: number; h?: number; theme?: Theme; query?: string; page?: Page } = {}) {
  const cap = o.page ?? (await context.newPage());
  await cap.setViewportSize({ width: o.w ?? 1440, height: o.h ?? 900 });
  await cap.emulateMedia({ colorScheme: o.theme ?? 'light' });
  await cap.bringToFront();
  await cap.goto(`${SERVER}/c/${id}${o.query ?? ''}`);
  await cap.locator('.page[data-hydrated]').waitFor({ timeout: 30_000 });
  await cap.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(600);
  return cap;
}

const narrow = (cap: Page) => (cap.viewportSize()?.width ?? 1440) <= 720;

/** At phone width the dev tools sit behind the "Dev tools" toggle of the one-column page. */
async function showDevtools(cap: Page) {
  if (narrow(cap)) await cap.getByTestId('narrow-devtools').click();
}

async function tab(cap: Page, id: 'info' | 'console' | 'network' | 'actions') {
  await showDevtools(cap);
  await cap.getByTestId(`tab-${id}`).click();
  await sleep(400);
}

const overflowX = (cap: Page) => cap.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/** One page state at 1440 and 390, light and dark; returns sideways overflow per variant. */
async function shoot4(ev: Evidence, context: BrowserContext, id: string, step: string, setup: (cap: Page) => Promise<void>, o: { query?: string; variants?: typeof VARIANTS } = {}) {
  const out: Record<string, boolean | string> = {};
  for (const [w, h, theme] of o.variants ?? VARIANTS) {
    const cap = await openCap(context, id, { w, h, theme, query: o.query });
    try {
      await setup(cap);
      await sleep(400);
      await cap.screenshot({ path: ev.file(step, String(w), theme) });
      out[`${w}-${theme}`] = await overflowX(cap);
    } catch (e) {
      out[`${w}-${theme}`] = `error: ${String(e).slice(0, 160)}`;
    }
    await cap.close();
  }
  return out;
}

async function boxOf(loc: Locator) {
  const b = await loc.boundingBox();
  return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null;
}

async function videoState(cap: Page) {
  return cap.evaluate(() => {
    const v = document.querySelector('[data-testid="video"]') as HTMLVideoElement | null;
    return {
      paused: v?.paused ?? null,
      t: v ? Math.round(v.currentTime * 10) / 10 : null,
      rate: v?.playbackRate ?? null,
      muted: v?.muted ?? null,
      fullscreen: !!document.fullscreenElement,
      pip: !!document.pictureInPictureElement,
      timeLabel: document.querySelector('[data-testid="time"]')?.textContent?.trim() ?? null,
    };
  });
}

async function readClipboard(cap: Page) {
  const viaPage = await cap.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  return viaPage || clipboard();
}

async function toastText(cap: Page) {
  return txt(await cap.locator('.nb-toaster').textContent().catch(() => ''));
}

/** Rows of a list (console, network, actions) by their data-row-index. */
async function rowTexts(cap: Page, listTestId: string) {
  return cap.locator(`[data-testid="${listTestId}"] [data-row-index]`).evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
}

async function menuText(cap: Page) {
  return cap.locator('.dd .pop').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
}

// ================================================================ S4.1

test('S4.1 video capture page (N1)', async () => {
  test.setTimeout(2_400_000);
  const ev = new Evidence(GROUP, 'S4.1');
  const { context } = await getRig();
  const id = N1();
  ev.set('capture', id);
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  const detail0 = (await api<{ title: string; description: string; status: string; kind: string; durationMs?: number }>(context, 'GET', `/api/v1/recordings/${id}`)).body;
  if (detail0?.status !== 'ready') throw new Error(`N1 ${id} is not available: ${JSON.stringify(detail0).slice(0, 200)}`);
  ev.set('capture-before', { title: detail0.title, description: detail0.description, kind: detail0.kind });
  const cap = await openCap(context, id);
  const prefs0 = await cap.evaluate(() => localStorage.getItem('nib.viewer.prefs'));
  ev.set('prefs-before', prefs0);

  try {
    // 1. the page, the right panel's share, its tabs, the splitter
    await probe(ev, 'step1-layout (J-090)', async () => {
      const main = (await boxOf(cap.locator('main.layout')))!;
      const right = (await boxOf(cap.getByTestId('right-panel')))!;
      const left = (await boxOf(cap.locator('.left')))!;
      const tabs = await cap.locator('[data-testid="devtools"] [role="tab"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
      const split = (await boxOf(cap.getByTestId('splitter')))!;
      const sx = split.x + split.w / 2;
      const sy = split.y + split.h / 2;
      await cap.mouse.move(sx, sy);
      await cap.mouse.down();
      for (let i = 1; i <= 10; i++) {
        await cap.mouse.move(sx - i * 10, sy);
        await sleep(30);
      }
      await cap.mouse.up();
      await sleep(400);
      const right2 = (await boxOf(cap.getByTestId('right-panel')))!;
      const stored = await cap.evaluate(() => localStorage.getItem('nib.viewer.split'));
      return {
        viewport: cap.viewportSize(),
        main,
        left,
        right,
        rightShareOfMain: Math.round((right.w / main.w) * 1000) / 10,
        rightShareOfViewport: Math.round((right.w / 1440) * 1000) / 10,
        tabs,
        splitterDrag: { from: Math.round(sx), to: Math.round(sx - 100), rightWidthBefore: right.w, rightWidthAfter: right2.w, grewBy: right2.w - right.w, stored },
      };
    });
    await cap.screenshot({ path: ev.file('1-splitter-dragged') });
    // put the splitter back for the shots
    await cap.evaluate(() => localStorage.removeItem('nib.viewer.split'));
    ev.set('step1-shots-overflow', await shoot4(ev, context, id, '1-page', async () => undefined));

    // 2. hide the panel, then show it again
    await cap.reload();
    await cap.locator('.page[data-hydrated]').waitFor();
    await sleep(600);
    await probe(ev, 'step2-toggle (J-091)', async () => {
      const hideBtn = await boxOf(cap.getByTestId('hide-devtools'));
      await cap.getByTestId('hide-devtools').click();
      await sleep(400);
      const main = (await boxOf(cap.locator('main.layout')))!;
      const leftin = (await boxOf(cap.locator('.leftin')))!;
      const hidden = { panelPresent: await cap.getByTestId('right-panel').count(), showButton: await boxOf(cap.getByTestId('show-devtools')), leftin, leftCentreOffset: Math.round(leftin.x + leftin.w / 2 - (main.x + main.w / 2)) };
      await cap.screenshot({ path: ev.file('2-hidden') });
      await cap.getByTestId('show-devtools').click();
      await sleep(400);
      return { hideButton: hideBtn, hidden, shownAgain: (await cap.getByTestId('right-panel').count()) === 1, clicks: 2 };
    });
    ev.set(
      'step2-shots-overflow',
      await shoot4(ev, context, id, '2-hidden', async (c) => {
        if (await c.getByTestId('hide-devtools').isVisible()) {
          await c.getByTestId('hide-devtools').click();
          await sleep(300);
        }
      }),
    );
    // the shots left the panel hidden in the stored prefs: show it again
    await cap.reload();
    await cap.locator('.page[data-hydrated]').waitFor();
    if (await cap.getByTestId('show-devtools').isVisible().catch(() => false)) await cap.getByTestId('show-devtools').click();
    await sleep(500);

    // 3. the controls, speed 1.5x kept over a reload, quality menu, play to the end
    await probe(ev, 'step3-controls (J-092)', async () => {
      const card = cap.getByTestId('video-card');
      const b = (await boxOf(card))!;
      await cap.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
      await sleep(500);
      const controls = await card.locator('button, [role="slider"], .time').evaluateAll((els) =>
        els
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((e) => e.getAttribute('aria-label') ?? e.getAttribute('data-testid') ?? (e.textContent ?? '').trim()),
      );
      await cap.screenshot({ path: ev.file('3-hover-controls') });
      return { controls };
    });
    await probe(ev, 'step3-speed-kept', async () => {
      await cap.getByTestId('speed').click();
      await sleep(300);
      const speeds = await menuText(cap);
      await cap.getByRole('menuitem', { name: '1.5x' }).click();
      await sleep(900); // the account mirror saves after 500 ms
      await cap.reload();
      await cap.locator('.page[data-hydrated]').waitFor();
      await sleep(800);
      const label = txt(await cap.getByTestId('speed').textContent());
      const rate = await cap.evaluate(() => (document.querySelector('[data-testid="video"]') as HTMLVideoElement).playbackRate);
      return { menu: speeds, afterReloadLabel: label, afterReloadVideoRate: rate, clicks: 2 };
    });
    await probe(ev, 'step3-quality-menu', async () => {
      const b = (await boxOf(cap.getByTestId('video-card')))!;
      await cap.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
      await cap.getByTestId('quality').click();
      await sleep(300);
      const items = await cap.locator('.dd .pop [role="menuitem"]').allTextContents();
      await cap.screenshot({ path: ev.file('3-quality') });
      await cap.keyboard.press('Escape');
      return { items: items.map((s) => s.trim()) };
    });
    await probe(ev, 'step3-play-to-end', async () => {
      const t0 = Date.now();
      await cap.getByTestId('big-play').click();
      await cap.getByTestId('replay-prompt').waitFor({ timeout: 300_000 });
      const wall = Date.now() - t0;
      await sleep(300);
      await cap.screenshot({ path: ev.file('3-ended') });
      return { wallSeconds: secs(wall), state: await videoState(cap), prompt: txt(await cap.getByTestId('replay-prompt').textContent()) };
    });
    // back to 1x for the rest (the step 12 timings are wall-clock seconds)
    await cap.mouse.move(700, 300);
    await cap.getByTestId('speed').click();
    await cap.getByRole('menuitem', { name: '1x', exact: true }).click();
    await sleep(700);

    // 4. keys with the player focused (real X keys)
    await probe(ev, 'step4-keys (J-093)', async () => {
      await cap.getByTestId('time').click(); // a plain spot of the player: focus leaves any button
      await focusWindow(cap);
      await sleep(300);
      const out: Record<string, unknown> = { before: await videoState(cap) };
      const press = async (label: string, key: string, wait = 700) => {
        xkey(key);
        await sleep(wait);
        out[label] = await videoState(cap);
      };
      await press('k', 'k');
      await press('Space', 'space');
      await press('m', 'm');
      await press('m-again (unmute)', 'm');
      await press('f', 'f', 1200);
      await cap.screenshot({ path: ev.file('4-fullscreen') }).catch(() => undefined);
      await press('Escape', 'Escape', 1200);
      await press('i', 'i', 1500);
      // close picture in picture the way the page offers: i again
      await press('i-again (close pip)', 'i', 1200);
      // pause first so the seeks read cleanly
      if (!(await videoState(cap)).paused) await press('k-pause', 'k');
      await press('Right', 'Right');
      await press('Left', 'Left');
      await press('5', '5');
      return out;
    });

    // 5. markers above the seek bar
    const markers = await probe(ev, 'step5-markers (J-072)', async () => {
      const ms = cap.locator('[data-testid="video-card"] [data-testid^="marker-"]');
      const n = await ms.count();
      const list: { kind: string; badge: string; aria: string; left: string; tip: string }[] = [];
      for (let i = 0; i < n; i++) {
        const m = ms.nth(i);
        await m.hover();
        await sleep(250);
        list.push({
          kind: ((await m.getAttribute('data-testid')) ?? '').replace('marker-', ''),
          badge: txt(await m.textContent()),
          aria: (await m.getAttribute('aria-label')) ?? '',
          left: await m.evaluate((e) => (e as HTMLElement).style.left),
          tip: txt(await cap.getByTestId('marker-tip').textContent().catch(() => '')),
        });
      }
      return list;
    });

    // 6. hover the 500 marker, then click it
    await probe(ev, 'step6-marker-500 (J-095)', async () => {
      const m = cap.locator('[data-testid="video-card"] [data-testid="marker-net-fail"]', { hasText: '500' }).first();
      await m.hover();
      await sleep(400);
      const tip = txt(await cap.getByTestId('marker-tip').textContent());
      await cap.screenshot({ path: ev.file('6-marker-hover') });
      await m.click();
      await sleep(900);
      const consoleSelected = await cap.getByTestId('tab-console').getAttribute('aria-selected');
      const flashed = txt(await cap.locator('[data-testid="console-list"] .flash').first().textContent().catch(() => ''));
      const flashedVisible = await cap.locator('[data-testid="console-list"] .flash').first().isVisible().catch(() => false);
      await cap.screenshot({ path: ev.file('6-marker-click') });
      return { tip, consoleTabSelected: consoleSelected, flashedRow: flashed, flashedVisible, video: await videoState(cap), clicks: 1 };
    });
    void markers;

    // 7. pause at about 12 s, share at time, open the link
    await probe(ev, 'step7-share-at-time (J-097)', async () => {
      const st = await videoState(cap);
      if (!st.paused) await cap.getByTestId('play').click();
      const bar = (await boxOf(cap.getByTestId('seekbar')))!;
      const dur = await cap.evaluate(() => (document.querySelector('[data-testid="video"]') as HTMLVideoElement).duration);
      const b = (await boxOf(cap.getByTestId('video-card')))!;
      await cap.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
      await cap.mouse.click(bar.x + (bar.w * 12) / dur, bar.y + bar.h / 2);
      await sleep(600);
      const at = await videoState(cap);
      await cap.getByTestId('share-at-time').click();
      await sleep(700);
      const link = await readClipboard(cap);
      const toast = await toastText(cap);
      await cap.screenshot({ path: ev.file('7-share-at-time') });
      const other = await context.newPage();
      await other.setViewportSize({ width: 1440, height: 900 });
      await other.goto(link);
      await other.locator('.page[data-hydrated]').waitFor({ timeout: 30_000 });
      await other.waitForFunction(() => {
        const v = document.querySelector('[data-testid="video"]') as HTMLVideoElement | null;
        return !!v && v.readyState >= 1;
      });
      await sleep(800);
      const opened = { url: other.url(), state: await videoState(other) };
      await other.screenshot({ path: ev.file('7-opened-link') });
      await other.close();
      await cap.bringToFront();
      return { seekedTo: at, pillLabel: txt(await cap.getByTestId('share-at-time').textContent()), link, toast, opened, clicks: 2, note: 'a seek-bar click while paused, then the pill' };
    });

    // 8. download
    await probe(ev, 'step8-download (J-098)', async () => {
      const dl = cap.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
      const b = (await boxOf(cap.getByTestId('video-card')))!;
      await cap.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
      await cap.getByTestId('download').click();
      await sleep(600);
      const toast = await toastText(cap);
      const d = await dl;
      let saved: { bytes: number; path: string } | null = null;
      if (d) {
        const p = await d.path().catch(() => null);
        if (p && fs.existsSync(p)) saved = { bytes: fs.statSync(p).size, path: p };
      }
      const r = await context.request.get(`${SERVER}/api/v1/recordings/${id}/media/video?download=1`);
      const body = await r.body();
      const head = body.subarray(0, 4).toString('hex');
      return { event: d ? { filename: d.suggestedFilename(), url: d.url().replace(SERVER, '') } : null, saved, toast, fetched: { status: r.status(), bytes: body.length, mb: Math.round((body.length / 1048576) * 100) / 100, contentType: r.headers()['content-type'], disposition: r.headers()['content-disposition'], webmMagic: head === '1a45dfa3' }, clicks: 1 };
    });

    // 9. info tab
    await probe(ev, 'step9-info (J-101)', async () => {
      await tab(cap, 'info');
      const rows = await cap.locator('[data-testid="info-tab"] dt').evaluateAll((dts) => dts.map((dt) => [dt.textContent?.trim() ?? '', (dt.nextElementSibling?.textContent ?? '').replace(/\s+/g, ' ').trim()]));
      await cap.screenshot({ path: ev.file('9-info') });
      const setupBtn = await cap.getByTestId('custom-logs-setup').count();
      await cap.getByTestId('zone-menu').click();
      await sleep(300);
      const zones = (await cap.locator('[role="menuitemradio"]').allTextContents()).map((s) => s.trim());
      await cap.screenshot({ path: ev.file('9-zone-menu') });
      const byZone: Record<string, string> = {};
      for (const z of zones) {
        if (!(await cap.locator('[role="menuitemradio"]').first().isVisible().catch(() => false))) await cap.getByTestId('zone-menu').click();
        await cap.getByRole('menuitemradio', { name: z }).click();
        await sleep(300);
        byZone[z] = txt(await cap.getByTestId('timestamp').textContent());
      }
      return { rows, customLogsSetupButton: setupBtn > 0, zones, timestampByZone: byZone };
    });
    ev.set('step9-shots-overflow', await shoot4(ev, context, id, '9-info', (c) => tab(c, 'info')));

    // 10. console filters
    await probe(ev, 'step10-console-filters (J-102)', async () => {
      await tab(cap, 'console');
      const total = (await rowTexts(cap, 'console-list')).length;
      await cap.getByTestId('console-filter').fill('profile');
      await sleep(300);
      const profile = await rowTexts(cap, 'console-list');
      await cap.screenshot({ path: ev.file('10-filter-profile') });
      await cap.getByTestId('console-filter').fill('');
      await sleep(200);
      const cleared = (await rowTexts(cap, 'console-list')).length;
      await cap.getByTestId('level-menu').click();
      await sleep(200);
      const levels = (await cap.locator('.levels label').allTextContents()).map((s) => s.trim());
      await cap.locator('.levels label', { hasText: 'Errors' }).click();
      await sleep(300);
      const errorsOnly = await rowTexts(cap, 'console-list');
      const label = txt(await cap.getByTestId('level-menu').textContent());
      await cap.screenshot({ path: ev.file('10-errors-only') });
      await cap.locator('.levels label', { hasText: 'Errors' }).click();
      await cap.keyboard.press('Escape');
      await sleep(200);
      const chips = await cap.locator('[data-testid^="chip-"]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-testid')!, (e.textContent ?? '').trim()] as [string, string]));
      const perChip: Record<string, { label: string; rowsWhenOff: number; restored: number }> = {};
      for (const [tid, lab] of chips) {
        await cap.getByTestId(tid).click();
        await sleep(250);
        const off = (await rowTexts(cap, 'console-list')).length;
        await cap.getByTestId(tid).click();
        await sleep(250);
        perChip[tid] = { label: lab, rowsWhenOff: off, restored: (await rowTexts(cap, 'console-list')).length };
      }
      return { total, filterProfile: { rows: profile.length, texts: profile }, afterClear: cleared, levelMenu: levels, errorsOnly: { label, rows: errorsOnly.length, texts: errorsOnly.map((s) => s.slice(0, 90)) }, chips: perChip };
    });
    ev.set('step10-shots-overflow', await shoot4(ev, context, id, '10-console', (c) => tab(c, 'console')));

    // 11. hover a row, the gutter triangle, seek and arm, expand, wall-clock time
    await probe(ev, 'step11-row (J-103)', async () => {
      await tab(cap, 'console');
      const row = cap.locator('[data-testid="console-list"] [data-row-index]', { hasText: 'TypeError' }).first();
      await row.scrollIntoViewIfNeeded();
      const gutter = row.locator('.vp-gutter');
      const opacityBefore = await gutter.evaluate((e) => getComputedStyle(e).opacity);
      await row.hover();
      await sleep(300);
      const opacityHover = await gutter.evaluate((e) => getComputedStyle(e).opacity);
      await cap.screenshot({ path: ev.file('11-row-hover') });
      const rowTime = txt(await row.locator('.vp-time').textContent());
      const before = await videoState(cap);
      await gutter.click();
      await sleep(600);
      const after = await videoState(cap);
      const send = cap.getByTestId('send');
      const composer = { sendLabel: await send.getAttribute('aria-label'), sendPill: await send.evaluate((e) => e.classList.contains('pill')) };
      await cap.screenshot({ path: ev.file('11-gutter-armed') });
      await row.locator('button.main').click();
      await sleep(300);
      const expanded = await row.locator('button.main').getAttribute('aria-expanded');
      const detail = txt(await row.locator('.detail').textContent().catch(() => '')).slice(0, 300);
      await cap.screenshot({ path: ev.file('11-row-expanded') });
      const wall = await row.locator('.vp-time').getAttribute('title');
      await row.locator('.vp-time').hover();
      return { row: txt(await row.locator('.msg').textContent()).slice(0, 120), rowTime, gutterOpacity: { before: opacityBefore, hover: opacityHover }, videoBefore: before.t, videoAfterGutter: after.t, composer, expanded, detail, timeTooltip: wall, wallHasMs: /\.\d{3}/.test(wall ?? '') };
    });

    // 12. follow playback, console then network
    for (const panel of ['console', 'network'] as const) {
      await probe(ev, `step12-follow-${panel} (J-104)`, async () => {
        await tab(cap, panel);
        const list = panel === 'console' ? 'console-list' : 'network-list';
        if (panel === 'network' && (await cap.getByTestId('close-detail').isVisible().catch(() => false))) await cap.getByTestId('close-detail').click();
        await cap.getByTestId('time').click();
        await focusWindow(cap);
        if (!(await videoState(cap)).paused) xkey('k');
        xkey('0');
        await sleep(500);
        const c = await calm(60_000);
        xkey('k');
        const samples: { t: number | null; index: number | null; row: string; inView: boolean; borderLeft: string; triangle: string }[] = [];
        const t0 = Date.now();
        while (Date.now() - t0 < 20_000) {
          await sleep(1000);
          samples.push(
            await cap.evaluate((lid) => {
              const v = document.querySelector('[data-testid="video"]') as HTMLVideoElement;
              const l = document.querySelector(`[data-testid="${lid}"]`)!;
              const cur = l.querySelector('.current') as HTMLElement | null;
              const lb = l.getBoundingClientRect();
              const rb = cur?.getBoundingClientRect();
              return {
                t: Math.round(v.currentTime * 10) / 10,
                index: cur ? Number(cur.getAttribute('data-row-index')) : null,
                row: (cur?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70),
                inView: !!rb && rb.top >= lb.top - 1 && rb.bottom <= lb.bottom + 1,
                borderLeft: cur ? getComputedStyle(cur).borderLeftColor : '',
                triangle: cur ? getComputedStyle(cur, '::before').borderLeftColor : '',
              };
            }, list),
          );
          if (samples.length === 10) await cap.screenshot({ path: ev.file(`12-follow-${panel}`) });
        }
        xkey('k');
        await sleep(300);
        const distinct = [...new Set(samples.map((s) => s.index))];
        return { load: c.load, reliable: c.reliable, samples, distinctCurrentRows: distinct.length, allInView: samples.filter((s) => s.index != null).every((s) => s.inView) };
      });
    }

    // 13. network tab: chips, errors only, sorts, text filter
    await probe(ev, 'step13-network (J-105)', async () => {
      await tab(cap, 'network');
      if (await cap.getByTestId('close-detail').isVisible().catch(() => false)) await cap.getByTestId('close-detail').click();
      const total = (await rowTexts(cap, 'network-list')).length;
      const chips = await cap.locator('[data-testid^="type-"]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-testid')!, (e.textContent ?? '').trim()] as [string, string]));
      const perChip: Record<string, { label: string; rows: number }> = {};
      for (const [tid, lab] of chips) {
        await cap.getByTestId(tid).click();
        await sleep(200);
        perChip[tid] = { label: lab, rows: (await rowTexts(cap, 'network-list')).length };
      }
      await cap.getByTestId('type-all').click();
      await cap.getByTestId('errors-only').check();
      await sleep(200);
      const errs = await cap.locator('[data-testid="network-list"] [data-row-index]').evaluateAll((els) => els.map((e) => `${e.querySelector('.c-name')?.textContent?.trim()} ${e.querySelector('.c-s')?.textContent?.trim()}`));
      await cap.screenshot({ path: ev.file('13-errors-only') });
      await cap.getByTestId('errors-only').uncheck();
      const col = (cls: string) => cap.locator(`[data-testid="network-list"] [data-row-index] .${cls}`).allTextContents();
      await cap.getByRole('columnheader', { name: 'Status' }).click();
      await sleep(200);
      const statusAsc = (await col('c-s')).map((s) => s.trim());
      await cap.getByRole('columnheader', { name: /Status/ }).click();
      await sleep(200);
      const statusDesc = (await col('c-s')).map((s) => s.trim());
      await cap.getByRole('columnheader', { name: 'Time' }).click();
      await sleep(200);
      const timeAsc = (await col('c-ms')).map((s) => s.trim());
      await cap.screenshot({ path: ev.file('13-sorted-time') });
      await cap.getByRole('columnheader', { name: '#' }).click();
      await cap.getByTestId('network-filter').fill('api');
      await sleep(300);
      const api = (await col('c-name')).map((s) => s.trim());
      await cap.screenshot({ path: ev.file('13-filter-api') });
      await cap.getByTestId('network-filter').fill('');
      return { total, chips: perChip, errorsOnly: errs, sortStatusAsc: statusAsc, sortStatusDesc: statusDesc, sortTimeAsc: timeAsc, filterApi: { rows: api.length, names: api } };
    });
    ev.set('step13-shots-overflow', await shoot4(ev, context, id, '13-network', (c) => tab(c, 'network')));

    // 14. Submit order row: the list collapses, the detail pane
    const submitRow = () => cap.locator('[data-testid="network-list"] [data-row-index]', { hasText: '/api/fail' }).first();
    await probe(ev, 'step14-detail (J-106)', async () => {
      await tab(cap, 'network');
      const colsBefore = (await cap.locator('[data-testid="network-list"] [role="columnheader"]').allTextContents()).map((s) => s.trim());
      await submitRow().click();
      await sleep(400);
      const colsAfter = (await cap.locator('[data-testid="network-list"] [role="columnheader"]').allTextContents()).map((s) => s.trim());
      const pane = cap.getByTestId('request-detail');
      const subs = (await pane.locator('[role="tab"]').allTextContents()).map((s) => s.trim());
      const dot = await pane.locator('header .dot').evaluate((e) => ({ cls: e.className, colour: getComputedStyle(e).backgroundColor }));
      const head = txt(await pane.locator('header').textContent());
      const listW = (await boxOf(cap.getByTestId('network-list')))!.w;
      const paneW = (await boxOf(pane))!.w;
      await cap.screenshot({ path: ev.file('14-detail') });
      return { columnsBefore: colsBefore, columnsAfter: colsAfter, subTabs: subs, statusDot: dot, header: head, listWidth: listW, paneWidth: paneW, clicks: 1 };
    });
    ev.set(
      'step14-shots-overflow',
      await shoot4(ev, context, id, '14-detail', async (c) => {
        await tab(c, 'network');
        await c.locator('[data-testid="network-list"] [data-row-index]', { hasText: '/api/fail' }).first().click();
      }),
    );

    // 15. response sub-tab, Down three times and Up once
    await probe(ev, 'step15-keys (J-243)', async () => {
      await tab(cap, 'network');
      if (!(await cap.getByTestId('request-detail').isVisible().catch(() => false))) await submitRow().click();
      await cap.getByTestId('sub-response').click();
      await sleep(300);
      await focusWindow(cap);
      const state = async () => ({
        selected: txt(await cap.locator('[data-testid="network-list"] .sel .c-name').textContent().catch(() => '')),
        sub: txt(await cap.locator('[data-testid="request-detail"] [role="tab"][aria-selected="true"]').textContent().catch(() => '')),
        body: txt(await cap.getByTestId('detail-body').textContent().catch(() => '')).slice(0, 80),
      });
      const seq: Record<string, unknown>[] = [{ key: 'start', ...(await state()) }];
      for (const k of ['Down', 'Down', 'Down', 'Up']) {
        xkey(k);
        await sleep(350);
        seq.push({ key: k, ...(await state()) });
      }
      await cap.screenshot({ path: ev.file('15-after-keys') });
      return seq;
    });

    // 16. copy as cURL on Submit order and run it
    await probe(ev, 'step16-curl (J-107)', async () => {
      await submitRow().click();
      await sleep(300);
      await cap.getByTestId('copy-curl').click();
      await sleep(600);
      const curl = await readClipboard(cap);
      const toast = await toastText(cap);
      await cap.screenshot({ path: ev.file('16-curl-copied') });
      const run = execFileSync('bash', ['-c', `${curl} -s -o /dev/null -w '%{http_code}'`], { encoding: 'utf8', timeout: 20_000 }).trim();
      const cookieLine = curl.split('\n').find((l) => /-H '?cookie:/i.test(l)) ?? null;
      return { curl, toast, ranStatus: run, cookieLine, cookiePlaceholder: cookieLine ? /<cookie>/.test(cookieLine) : 'no cookie header', clicks: 2 };
    });

    // 17. actions tab
    await probe(ev, 'step17-actions (J-108)', async () => {
      await tab(cap, 'actions');
      const rows = await rowTexts(cap, 'actions-list');
      const filterBar = await cap.locator('[data-testid="actions-list"]').locator('xpath=..').locator('.vp-bar, input').count();
      const kinds = await cap.locator('[data-testid="actions-list"] [data-row-index]').evaluateAll((els) => els.map((e) => (e.classList.contains('kind-navigation') ? 'navigation' : 'user')));
      const chip = cap.getByTestId('attr-chip').first();
      const chipLabel = txt(await chip.textContent());
      await chip.click();
      await sleep(300);
      const attrs = await cap.getByTestId('attr-list').first().evaluate((dl) => [...dl.querySelectorAll('dt')].map((dt) => `${dt.textContent?.trim()}: ${(dt.nextElementSibling?.textContent ?? '').trim()}`));
      await cap.screenshot({ path: ev.file('17-actions-attrs') });
      return { rows: rows.length, navigationRows: kinds.filter((k) => k === 'navigation').length, userRows: kinds.filter((k) => k === 'user').length, filterBar: filterBar > 0, firstChip: chipLabel, attrs, texts: rows.map((s) => s.slice(0, 80)) };
    });
    ev.set('step17-shots-overflow', await shoot4(ev, context, id, '17-actions', (c) => tab(c, 'actions')));

    // 18. inline title and description
    await probe(ev, 'step18-title-description (J-110)', async () => {
      const before = { title: txt(await cap.getByTestId('title').textContent()), tab: await cap.title() };
      await cap.locator('[data-testid="title"] button').click();
      await sleep(200);
      const input = cap.getByTestId('title-input');
      const caret = await input.evaluate((e) => ({ start: (e as HTMLInputElement).selectionStart, end: (e as HTMLInputElement).selectionEnd, len: (e as HTMLInputElement).value.length }));
      await cap.keyboard.type(' edited', { delay: 40 });
      await cap.keyboard.press('Enter');
      await sleep(1000);
      const afterTitle = { shown: txt(await cap.getByTestId('title').textContent()), tab: await cap.title(), api: (await api<{ title: string }>(context, 'GET', `/api/v1/recordings/${id}`)).body.title };
      await cap.getByTestId('description').click();
      await sleep(300);
      const ta = cap.getByTestId('description-input');
      await ta.press('Control+End');
      await cap.keyboard.press('Enter');
      await cap.keyboard.type('Added line from S4.1.', { delay: 30 });
      await cap.mouse.click(700, 120); // outside: the header strip's empty middle
      await sleep(1200);
      const afterDesc = { shown: txt(await cap.getByTestId('description').textContent()), api: (await api<{ description: string }>(context, 'GET', `/api/v1/recordings/${id}`)).body.description };
      await cap.screenshot({ path: ev.file('18-edited') });
      return { before, caretOnOpen: caret, afterTitle, afterDesc, titleSaved: afterTitle.api === `${before.title} edited` || afterTitle.api?.endsWith(' edited'), tabFollows: afterTitle.tab.startsWith(afterTitle.shown) };
    });

    // 19. the header and each of its controls, closed without acting
    await probe(ev, 'step19-header (J-112)', async () => {
      const hdr = cap.getByTestId('viewer-header');
      const controls = await hdr.locator('a, button').evaluateAll((els) =>
        els
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => ({ id: e.getAttribute('data-testid'), label: e.getAttribute('aria-label') ?? (e.textContent ?? '').trim(), href: e.getAttribute('href'), x: Math.round(e.getBoundingClientRect().x), w: Math.round(e.getBoundingClientRect().width) })),
      );
      await hdr.screenshot({ path: ev.file('19-header') });
      const out: Record<string, unknown> = { controls, height: (await boxOf(hdr))!.h };
      out.home = { href: await cap.getByTestId('home').getAttribute('href') };
      out.folderChip = { href: await cap.getByTestId('folder-chip').getAttribute('href'), text: txt(await cap.getByTestId('folder-chip').textContent()) };
      const openClose = async (trigger: string, shot: string) => {
        if (!(await cap.getByTestId(trigger).isVisible().catch(() => false))) return 'not shown';
        await cap.getByTestId(trigger).click();
        await sleep(350);
        const items = await menuText(cap);
        const sub = await cap.locator('.dd .pop [role="menuitem"]').allTextContents();
        await cap.screenshot({ path: ev.file(`19-${shot}`) });
        await cap.keyboard.press('Escape');
        await sleep(250);
        return { items: sub.length ? sub.map((s) => s.trim()) : items, closed: (await cap.locator('.dd .pop').count()) === 0 };
      };
      out.more = await openClose('more', 'more');
      // the Move to folder submenu opens on hover; read it and leave
      await cap.getByTestId('more').click();
      await sleep(250);
      await cap.getByRole('menuitem', { name: /Move to folder/ }).hover();
      await sleep(300);
      out.moveSubmenu = (await cap.locator('.dd .pop .sub [role="menuitem"]').allTextContents()).map((s) => s.trim());
      await cap.keyboard.press('Escape');
      await sleep(200);
      out.sendSplit = { visible: await cap.getByTestId('send-split').isVisible().catch(() => false), note: 'send to app is a tracker feature, paused (FEATURE_TRACKERS); only opened and closed', caret: await openClose('send-caret', 'send') };
      out.copySplit = { main: txt(await cap.getByTestId('copy-link').textContent()), caret: await openClose('share-caret', 'share') };
      return out;
    });
    ev.set('step19-shots-overflow', await shoot4(ev, context, id, '19-header', async () => undefined, { variants: [[1440, 900, 'dark'], [390, 844, 'light'], [390, 844, 'dark']] }));
  } finally {
    // put N1 back: title, description, speed, time zone, panel width
    await probe(ev, 'restore', async () => {
      const r = await api<unknown>(context, 'PATCH', `/api/v1/recordings/${id}`, { title: detail0.title, description: detail0.description ?? '' });
      await cap.evaluate((p) => {
        if (p) localStorage.setItem('nib.viewer.prefs', p);
        else localStorage.removeItem('nib.viewer.prefs');
        localStorage.removeItem('nib.viewer.split');
      }, prefs0);
      const s = await api<unknown>(context, 'PATCH', '/api/v1/me/settings', { viewer: prefs0 ? JSON.parse(prefs0) : { playbackRate: 1, timeZone: 'capture', devtoolsOpen: true } });
      const after = (await api<{ title: string; description: string }>(context, 'GET', `/api/v1/recordings/${id}`)).body;
      return { patchStatus: r.status, settingsStatus: s.status, title: after.title, description: after.description };
    });
    await cap.close().catch(() => undefined);
    ev.set('load-end', load());
  }
});

// ================================================================ S4.2

test('S4.2 screenshot captures (N4, N5)', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S4.2');
  const { context } = await getRig();
  ev.set('load-start', load());
  const n4 = N4();
  const n5 = N5();
  ev.set('captures', { N4: n4, N5: n5 });

  // 1. N4: the media card, the lightbox, Escape, again, a click outside
  await probe(ev, 'step1-N4-lightbox (J-099)', async () => {
    const cap = await openCap(context, n4);
    const card = cap.getByTestId('screenshot-card');
    const cardBox = await boxOf(card);
    const img = await cap.getByTestId('screenshot').evaluate((e) => ({ natural: `${(e as HTMLImageElement).naturalWidth}x${(e as HTMLImageElement).naturalHeight}`, shown: `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}` }));
    const topControls = await card.locator('.top button, .top .chip').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? (e.textContent ?? '').trim()));
    await card.screenshot({ path: ev.file('1-N4-media-card') });
    await cap.getByTestId('screenshot').click();
    await sleep(400);
    const lb = cap.getByTestId('lightbox');
    const open1 = await lb.isVisible();
    const lbImg = await lb.locator('img').evaluate((e) => `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    await cap.screenshot({ path: ev.file('1-N4-lightbox') });
    await cap.keyboard.press('Escape');
    await sleep(300);
    const afterEsc = await lb.isVisible().catch(() => false);
    await cap.getByTestId('screenshot').click();
    await sleep(400);
    const open2 = await lb.isVisible();
    await cap.mouse.click(8, 450); // the dimmed backdrop, left of the image
    await sleep(300);
    const afterOutside = await lb.isVisible().catch(() => false);
    await cap.close();
    return { cardBox, image: img, topControls, lightboxOpened: open1, lightboxImage: lbImg, closedByEscape: !afterEsc, reopened: open2, closedByOutsideClick: !afterOutside, clicks: { open: 1, closeOutside: 1 } };
  });
  ev.set('step1-N4-shots-overflow', await shoot4(ev, context, n4, '1-N4-page', async () => undefined));
  ev.set(
    'step1-N4-lightbox-shots-overflow',
    await shoot4(ev, context, n4, '1-N4-lightbox', async (c) => {
      await c.getByTestId('screenshot').click();
    }),
  );

  // 2. N5: two thumbnails, crop first and selected; the full viewport; back
  await probe(ev, 'step2-N5-switcher (J-209)', async () => {
    const cap = await openCap(context, n5);
    const sw = cap.getByTestId('switcher');
    const thumbs = await sw.locator('[role="tab"]').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-testid'), selected: e.getAttribute('aria-selected'), title: e.getAttribute('title'), box: `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}` })));
    const shown = async () => cap.getByTestId('screenshot').evaluate((e) => ({ which: e.getAttribute('data-which'), natural: `${(e as HTMLImageElement).naturalWidth}x${(e as HTMLImageElement).naturalHeight}` }));
    const s0 = await shown();
    const below = (await boxOf(sw))!.y > (await boxOf(cap.getByTestId('screenshot')))!.y;
    await cap.getByTestId('screenshot-card').screenshot({ path: ev.file('2-N5-crop') });
    await cap.getByTestId('thumb-full').click();
    await sleep(500);
    await cap.waitForFunction(() => (document.querySelector('[data-testid="screenshot"]') as HTMLImageElement).complete);
    const s1 = await shown();
    const sel1 = await cap.getByTestId('thumb-full').getAttribute('aria-selected');
    await cap.getByTestId('screenshot-card').screenshot({ path: ev.file('2-N5-full') });
    await cap.getByTestId('thumb-crop').click();
    await sleep(500);
    const s2 = await shown();
    await cap.close();
    return { thumbs, thumbsBelowImage: below, initial: s0, afterSecond: { ...s1, fullSelected: sel1 }, afterFirstAgain: s2, clicks: 2 };
  });
  ev.set('step2-N5-shots-overflow', await shoot4(ev, context, n5, '2-N5-page', async () => undefined));
  ev.set(
    'step2-N5-full-shots-overflow',
    await shoot4(ev, context, n5, '2-N5-full', async (c) => {
      await c.getByTestId('thumb-full').click();
    }),
  );
  ev.set('load-end', load());
});

// ================================================================ S4.3

async function openMenu(popup: Page) {
  for (let i = 0; i < 3; i++) {
    await xclickPopup(popup, '[data-menu-button]');
    if (await popup.locator('[data-menu]').waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error('the popup menu did not open');
}

function xtype(text: string) {
  xdo('type', '--delay', '40', text);
}

function setClipboard(text: string) {
  execFileSync('xclip', ['-selection', 'clipboard', '-i'], { input: text, stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, DISPLAY: process.env.PARITY_DISPLAY ?? ':130' } });
}

/** Title the draft and click Create; returns the capture once it is ready. */
async function createDraft(context: BrowserContext, page: Page, f: Frame, title: string) {
  await xclickEl(page, f.getByTestId('field'));
  await sleep(200);
  xtype(title);
  await sleep(500);
  setClipboard(`before-${title}`);
  const opened = context.waitForEvent('page', { timeout: 60_000 }).catch(() => null);
  await xclickEl(page, f.locator('[data-testid="create"]').first());
  const link = (await until(async () => (/\/s\//.test(clipboard()) ? clipboard() : ''), 90_000, 100)).value;
  const cap = await opened;
  await cap?.close().catch(() => undefined);
  const rec = await captureOf(context, link);
  await waitReady(context, rec.id, 300_000);
  await focusWindow(page).catch(() => undefined);
  return { id: rec.id, link };
}

test('S4.3 replay capture', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S4.3');
  const { context } = await getRig();
  ev.set('load-start', load());

  // 1. instant replay on; Submit order and Show profile on /; replay; create
  const page = await context.newPage();
  for (const other of context.pages()) if (other !== page) await other.close().catch(() => undefined);
  await page.goto(LAB_URL + '/');
  await page.waitForLoadState('networkidle');
  await focusWindow(page);
  let popup = await clickIcon(context, page);
  await openMenu(popup);
  await xclickPopup(popup, '[data-menu-item="settings"]');
  const sw = popup.getByRole('switch', { name: 'Instant replay' });
  await sw.waitFor();
  const wasOn = await sw.isChecked();
  if (!wasOn) await xclickPopup(popup, sw);
  await expect(sw).toBeChecked();
  await popup.close().catch(() => undefined);
  ev.set('step1-instant-replay', wasOn ? 'already on' : 'switched on');
  await focusWindow(page);
  xkey('ctrl+r'); // the buffer starts with the page load after the switch
  await page.waitForLoadState('networkidle');
  await sleep(1500);
  await xclickEl(page, page.getByTestId('hidden-500'));
  await sleep(1000);
  await xclickEl(page, page.getByTestId('throws'));
  await sleep(5000);
  popup = await clickIcon(context, page);
  await xclickPopup(popup, '[data-row-main="replay"]');
  const f = await editorFrame(page, 60_000);
  await f.getByTestId('draft-replay').waitFor({ timeout: 60_000 });
  await sleep(1000);
  const made = await createDraft(context, page, f, 'parity S4.3 replay');
  ev.set('step1-capture', made);
  const detail = (await api<{ kind: string; media: { rrwebUrls?: string[]; video?: unknown } }>(context, 'GET', `/api/v1/recordings/${made.id}`)).body;
  ev.set('step1-detail', { kind: detail.kind, rrwebChunks: detail.media?.rrwebUrls?.length ?? null, video: !!detail.media?.video });

  // 2. open it: the loading card with its progress bar, then the replay with its pointer glyph
  const opens: unknown[] = [];
  for (let run = 1; run <= 3; run++) {
    const cap = await context.newPage();
    await cap.setViewportSize({ width: 1440, height: 900 });
    await cap.bringToFront();
    const c = await calm(120_000);
    const cast = run === 1 ? await screencast(cap) : null;
    const t0 = Date.now();
    await cap.goto(`${SERVER}/c/${made.id}`, { waitUntil: 'commit' });
    const loading = await until(async () => (await cap.getByTestId('replay-loading').isVisible().catch(() => false)) || (await cap.getByTestId('play').isVisible().catch(() => false)), 30_000, 20);
    const sawLoading = await cap.getByTestId('replay-loading').isVisible().catch(() => false);
    const loadingAt = loading.at;
    let progressShot = false;
    if (run === 1 && sawLoading) progressShot = await cap.screenshot({ path: ev.file('2-loading') }).then(() => true).catch(() => false);
    await cap.getByTestId('play').waitFor({ timeout: 60_000 });
    const readyAt = Date.now();
    const frames = cast ? await cast.stop() : [];
    if (cast) {
      // the first screencast frames after the loading card appeared, and the first ready frame
      const lf = frames.find((x) => x.t >= loadingAt - 50 && x.t < readyAt);
      if (lf) fs.writeFileSync(path.join(ev.dir, 'S4.3-2-loading-frame-nib-1440-light.jpg'), lf.jpeg);
      const rf = frames.find((x) => x.t >= readyAt);
      if (rf) fs.writeFileSync(path.join(ev.dir, 'S4.3-2-first-frame-nib-1440-light.jpg'), rf.jpeg);
    }
    opens.push({ run, load: c.load, reliable: c.reliable, loadingSeen: sawLoading, loadingShot: progressShot, openToLoadingMs: loadingAt - t0, openToFirstFrameMs: readyAt - t0, seconds: secs(readyAt - t0), frames: frames.length });
    if (run === 1) {
      await sleep(500);
      await cap.screenshot({ path: ev.file('2-ready') });
      await probe(ev, 'step2-playing (J-100)', async () => {
        await cap.getByTestId('play').click();
        await sleep(2500);
        const stage = cap.getByTestId('replay-stage');
        const pointer = await stage.evaluate((h) => {
          const m = h.querySelector('.replayer-mouse') as HTMLElement | null;
          return m ? { present: true, visible: getComputedStyle(m).display !== 'none', box: m.getBoundingClientRect().toJSON() } : { present: false };
        });
        const iframe = await stage.locator('iframe').count();
        await cap.screenshot({ path: ev.file('2-playing') });
        await cap.getByTestId('play').click();
        return { pointer, iframe, time: txt(await cap.getByTestId('time').textContent()) };
      });
      // 3. the bar's controls and the markers over its seek bar
      await probe(ev, 'step3-controls (J-229)', async () => {
        const card = cap.getByTestId('replay-card');
        const controls = await card.locator('.controls button, .controls [role="slider"], .controls .time').evaluateAll((els) =>
          els.filter((e) => !e.closest('.markers')).map((e) => e.getAttribute('aria-label') ?? e.getAttribute('data-testid') ?? (e.textContent ?? '').trim()),
        );
        const markers = await card.locator('[data-testid^="marker-"]').evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute('data-testid'), aria: e.getAttribute('aria-label'), badge: (e.textContent ?? '').trim() })));
        const absent: Record<string, number> = {};
        for (const tid of ['download', 'share-at-time', 'quality', 'chapter-pill', 'cc']) absent[tid] = await card.getByTestId(tid).count();
        absent.mute = await card.getByRole('button', { name: /mute/i }).count();
        const markersAboveBar = (await boxOf(card.locator('.markers')))!.y < (await boxOf(card.getByTestId('seekbar')))!.y;
        await card.locator('.controls').screenshot({ path: ev.file('3-controls') });
        return { controls, markers, markersAboveBar, absentCounts: absent };
      });
    }
    await cap.close();
  }
  ev.set('step2-open-to-first-frame', opens);
  ev.set('step2-shots-overflow', await shoot4(ev, context, made.id, '2-replay', async (c) => {
    await c.getByTestId('play').waitFor({ timeout: 60_000 });
  }));
  ev.set('load-end', load());
});
