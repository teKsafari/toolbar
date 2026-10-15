// Parity group G1, open-toolbar side: capture modes and the in-page recording UI (docs/parity/scenarios.md,
// S1.1 to S1.6). Each test is one scenario, run as scripted, and records its evidence (counts,
// clicks, timings with the load average, screenshots) in e2e/parity-shots/G1/<scenario>.json and
// .png files. The raw results are written up in docs/parity/G1-replica.md.
//
//   cd e2e && npx playwright test -c playwright.parity.config.ts G1           # all six
//   cd e2e && npx playwright test -c playwright.parity.config.ts G1 -g S1.2   # one
//
// Needs the compose stack on :3000, the lab on :5173 and :5174, the release build
// (PARITY_EXT_BUILD, default chrome-mv3), xdotool, xclip and ImageMagick. S1.6 restarts the
// compose server with MAX_RECORDING_MIN=1 and puts it back.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  Evidence,
  LAB2_URL,
  LAB_URL,
  ROOT,
  SERVER,
  api,
  availableMb,
  calm,
  captureOf,
  clickIcon,
  clipboard,
  editorFrame,
  firstMatching,
  focusWindow,
  hasEditor,
  iconPoint,
  openPopup,
  labPage,
  launchExtension,
  load,
  popupBox,
  popupPage,
  recordingCount,
  regionMean,
  screencast,
  secs,
  shadowOne,
  shadowQuery,
  signIn,
  sleep,
  toScreen,
  until,
  viewportOrigin,
  waitReady,
  xclick,
  xclickEl,
  xclickPopup,
  xdo,
  xdrag,
  xkey,
  xmove,
  xup,
  type Launched,
} from './rig.ts';

const GROUP = 'G1';
const EMAIL = process.env.PARITY_EMAIL ?? 'parity@example.com';

// One worker runs the scenarios in order (config); a failed scenario does not skip the next.

// ---------------------------------------------------------------- one signed-in browser

let rig: (Launched & { signedIn: boolean }) | null = null;

async function getRig(): Promise<Launched> {
  if (rig) return rig;
  rig = { ...(await launchExtension()), signedIn: false };
  const { lab, popup } = await signIn(rig.context, EMAIL);
  await popup.close().catch(() => undefined);
  // rig hygiene: the shared parity account starts with instant replay off, as a new account
  // does; an earlier S1.4 that stopped before its step 6 leaves it on (server and extension)
  await api(rig.context, 'PATCH', '/api/v1/me/settings', { extension: { instantReplay: false } });
  await (await rig.sw()).evaluate(async () => {
    const k = 'tb:settings';
    const cur = ((await chrome.storage.local.get(k))[k] ?? {}) as Record<string, unknown>;
    await chrome.storage.local.set({ [k]: { ...cur, instantReplay: false } });
  });
  void lab; // keep one tab: closing the last one closes the window
  for (const p of rig.context.pages()) if (p.url().startsWith(SERVER)) await p.close().catch(() => undefined);
  rig.signedIn = true;
  return rig;
}

async function closeRig() {
  await rig?.close();
  rig = null;
}

test.afterAll(async () => {
  await closeRig();
});

/** One fresh lab tab, the only page open (so the X window and the CDP view agree). */
async function freshLab(context: BrowserContext, p = '/', base = LAB_URL): Promise<Page> {
  const page = await context.newPage();
  for (const other of context.pages()) if (other !== page) await other.close().catch(() => undefined);
  await page.goto(base + p);
  await page.waitForLoadState('networkidle');
  await focusWindow(page);
  return page;
}

async function session(sw: () => Promise<import('@playwright/test').Worker>) {
  return (await (await sw()).evaluate(async () => (await chrome.storage.session.get('tb:session'))['tb:session'])) as { state: string; [k: string]: unknown } | undefined;
}

/** The popup's three-dot menu; a second click if the first did not open it. */
async function openMenu(popup: Page) {
  for (let i = 0; i < 3; i++) {
    await xclickPopup(popup, '[data-menu-button]');
    if (await popup.locator('[data-menu]').waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error('the popup menu did not open');
}

async function rowsOf(popup: Page) {
  return popup.locator('[data-row]').evaluateAll((els) =>
    els.map((e) => ({
      id: e.getAttribute('data-row'),
      label: (e.querySelector('[data-row-main]')?.textContent ?? '').trim(),
      disabled: e.getAttribute('aria-disabled') === 'true',
      extra: (e.querySelector('.extra')?.textContent ?? '').trim(),
      chevron: !!e.querySelector('[data-row-chevron]'),
    })),
  );
}

async function headerOf(popup: Page) {
  return popup.locator('header button, header a, [data-home], [data-menu-button], [data-drafts-pill]').evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute('aria-label') ?? (e.textContent ?? '').trim()))],
  );
}

/** Shoot the popup from the X screen, cropped to its box. */
async function shootPopup(ev: Evidence, step: string, popup: Page) {
  await popup.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => undefined);
  await sleep(600);
  const b = await popupBox(popup);
  return ev.xshot(step, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 });
}

/** Arm screenshot mode the way a person does: icon, screenshot row. Returns the clicks used. */
async function armScreenshot(context: BrowserContext, page: Page) {
  const popup = await clickIcon(context, page);
  await xclickPopup(popup, '[data-row-main="screenshot"]');
  await until(async () => (await shadowOne(page, 'data-nb-ui'))?.attrs['data-session'] === 'arming-screenshot', 10_000);
  return 2;
}

/** The size of the image the editor shows, in image pixels, and its box on the page. */
async function editorImage(f: import('@playwright/test').Frame) {
  return f.evaluate(() => {
    const out: { tag: string; w: number; h: number; boxW: number; boxH: number; src: string }[] = [];
    for (const img of document.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      out.push({ tag: 'img', w: img.naturalWidth, h: img.naturalHeight, boxW: Math.round(r.width), boxH: Math.round(r.height), src: img.src.slice(0, 40) });
    }
    for (const im of document.querySelectorAll('image')) {
      const r = im.getBoundingClientRect();
      out.push({ tag: 'svg-image', w: Number(im.getAttribute('width')), h: Number(im.getAttribute('height')), boxW: Math.round(r.width), boxH: Math.round(r.height), src: (im.getAttribute('href') ?? '').slice(0, 40) });
    }
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      out.push({ tag: 'canvas', w: c.width, h: c.height, boxW: Math.round(r.width), boxH: Math.round(r.height), src: '' });
    }
    return out;
  });
}

async function closeEditor(page: Page) {
  const f = await editorFrame(page);
  await xclickEl(page, f.getByTestId('close'));
  // a video or replay draft asks before it discards; a screenshot draft goes at once
  await sleep(400);
  if (hasEditor(page)) {
    const confirm = f.getByRole('button', { name: /discard/i });
    if (await confirm.count()) await xclickEl(page, confirm.first());
  }
  await until(async () => !hasEditor(page), 15_000);
}

// ================================================================ S1.1

test('S1.1 popup, screenshot mode and the swallowed click', async () => {
  const ev = new Evidence(GROUP, 'S1.1');
  const { context, sw } = await getRig();
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());

  // 1. fresh page, counters
  const page = await freshLab(context);
  await page.evaluate(() => {
    const w = window as unknown as { __pd: number; __cl: number };
    w.__pd = 0;
    w.__cl = 0;
    document.addEventListener('pointerdown', () => w.__pd++, true);
    document.addEventListener('click', () => w.__cl++, true);
  });
  const vp = await viewportOrigin(page);
  ev.set('viewport', vp);

  // 2. icon: the popup (1 click)
  let popup = await clickIcon(context, page);
  ev.set('step2-rows', await rowsOf(popup));
  ev.set('step2-header', await headerOf(popup));
  ev.set('step2-popup-box', await popupBox(popup));
  await shootPopup(ev, '2-popup', popup);

  // 3. the record row's chevron (1 click); every option; Escape
  await xclickPopup(popup, '[data-row-chevron="record"]');
  await popup.locator('[data-row-options="record"]').waitFor();
  const options = await popup.locator('[data-row-options="record"] [data-value], [data-row-options="record"] button').evaluateAll((els) =>
    [...new Set(els.map((e) => `${e.getAttribute('data-value') ?? ''}:${(e.textContent ?? '').trim()}`))],
  );
  ev.set('step3-record-options', options);
  ev.set('step3-camera-option', options.some((o) => /cam/i.test(o)));
  await shootPopup(ev, '3-chevron', popup);
  let focused = '';
  try {
    focused = xdo('getwindowfocus', 'getwindowgeometry');
  } catch {
    /* none */
  }
  ev.set('step3-x-focus', focused.replace(/\s+/g, ' '));
  xkey('Escape'); // a real key into the focused X window
  await sleep(500);
  const afterEsc = await popup.evaluate(() => ({ chevronOpen: !!document.querySelector('[data-row-options="record"]') })).catch(() => ({ popupClosed: true }));
  ev.set('step3-after-escape', afterEsc);

  // 4. screenshot row (1 click); pointer to (700, 400); cursor pill offset; page not dimmed
  const probe = { x: vp.x + 1200, y: vp.y + 600, w: 20, h: 20 };
  const before = regionMean(probe);
  const popupOpen = !(await popup.isClosed()) && (await popup.evaluate(() => true).catch(() => false));
  ev.set('step4-popup-still-open-after-escape', popupOpen);
  if (!popupOpen) popup = await clickIcon(context, page);
  await xclickPopup(popup, '[data-row-main="screenshot"]');
  await until(async () => (await shadowOne(page, 'data-nb-ui'))?.attrs['data-session'] === 'arming-screenshot', 10_000);
  const pt = await toScreen(page, { x: 700, y: 400 });
  xmove(pt.x - 30, pt.y - 20);
  await sleep(100);
  xmove(pt.x, pt.y);
  await sleep(300);
  const pill = await shadowOne(page, 'data-nb-cursor-pill');
  ev.set('step4-cursor-pill', pill ? { box: pill.box, text: pill.text, offsetFromPointer: { x: pill.box.x - 700, y: pill.box.y - 400 } } : null);
  const after = regionMean(probe);
  ev.set('step4-page-dimmed', { before, after, dimmed: after.some((c, i) => Math.abs(c - before[i]!) > 8) });
  ev.xshot('4-cursor-pill', { x: pt.x - 200, y: pt.y - 120, w: 500, h: 260 });

  // 5. click Save (works): the editor opens; the page saw nothing
  const counters = () =>
    page.evaluate(() => {
      const w = window as unknown as { __pd: number; __cl: number };
      return { pd: w.__pd, cl: w.__cl, status: document.querySelector('[data-testid="status"]')?.textContent?.trim() ?? '' };
    });
  const c0 = await counters();
  const t5 = Date.now();
  await xclickEl(page, page.getByTestId('works'));
  const f = await editorFrame(page);
  ev.set('step5-click-to-editor-dom-ms', { ms: Date.now() - t5, load: load() });
  await sleep(800);
  const c1 = await counters();
  ev.set('step5-counters', { before: c0, after: c1, unchanged: c0.pd === c1.pd && c0.cl === c1.cl && c0.status === c1.status });
  ev.set('step5-editor-image', await editorImage(f));
  ev.xshot('5-editor', { x: 0, y: 0, w: 1440, h: 1000 });
  ev.set('step5-clicks-J-002', 'icon, screenshot row, click on page = 3');

  // 6. close (screenshot drafts discard at once)
  const t6 = Date.now();
  await xclickEl(page, f.getByTestId('close'));
  const gone = await until(async () => !hasEditor(page), 5000).catch(() => null);
  ev.set('step6-editor-closed-at-once', gone ? { ms: gone.at - t6, load: load() } : false);
  if (!gone) await closeEditor(page);
  ev.set('step6-session', (await session(sw))?.state);

  // 7. arm again, Escape: the pill goes
  await armScreenshot(context, page);
  xmove(pt.x, pt.y);
  await sleep(300);
  const pillBefore = !!(await shadowOne(page, 'data-nb-cursor-pill'));
  await focusWindow(page);
  xkey('Escape');
  await sleep(500);
  const pillAfter = !!(await shadowOne(page, 'data-nb-cursor-pill'));
  ev.set('step7-escape', { pillBefore, pillAfter, session: (await session(sw))?.state });

  // 8. arm, icon: exit row, other rows greyed; click exit
  await armScreenshot(context, page);
  popup = await clickIcon(context, page);
  ev.set('step8-rows', await rowsOf(popup));
  await shootPopup(ev, '8-exit-row', popup);
  await xclickPopup(popup, '[data-row-main="exit-screenshot"]');
  await sleep(500);
  ev.set('step8-after-exit', { session: (await session(sw))?.state, pill: !!(await shadowOne(page, 'data-nb-cursor-pill')) });
  ev.set('step8-clicks', 'icon, screenshot row (arm), icon, exit row = 4; leaving armed mode costs 2 (icon, exit)');

  // 9. area drag (200,150) to (800,450), held: rectangle and size readout; release
  await armScreenshot(context, page);
  const a = await toScreen(page, { x: 200, y: 150 });
  const b = await toScreen(page, { x: 800, y: 450 });
  await xdrag(a, b, { hold: true, steps: 15 });
  await sleep(300);
  const rect = await shadowOne(page, 'data-nb-shot-rect');
  const size = await shadowOne(page, 'data-nb-shot-size');
  ev.set('step9-drag-rect', rect?.box ?? null);
  ev.set('step9-size-readout', size ? { text: size.text, box: size.box } : null);
  ev.xshot('9-area-drag', { x: a.x - 40, y: a.y - 40, w: 760, h: 420 });
  const t9 = Date.now();
  xup();
  const f9 = await editorFrame(page);
  ev.set('step9-release-to-editor-dom-ms', { ms: Date.now() - t9, load: load() });
  await sleep(800);
  ev.set('step9-editor-image', await editorImage(f9));
  ev.set('step9-keep-full', await f9.getByTestId('keep-full-check').isChecked().catch(() => null));
  ev.xshot('9-area-editor', { x: 0, y: 0, w: 1440, h: 1000 });
  await xclickEl(page, f9.getByTestId('close'));
  if (!(await until(async () => !hasEditor(page), 5000).catch(() => null))) await closeEditor(page);
  ev.set('step9-clicks-J-003', 'icon, screenshot row, one drag = 2 clicks and 1 drag');
  ev.set('load-end', load());
  // the tab stays open: closing the last tab would close the window and the shared browser
});

// ================================================================ shared bits for recordings

const parseTimer = (t: string) => {
  const m = t.match(/(\d+):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

async function barOf(page: Page) {
  return shadowOne(page, 'data-nb-bar');
}

async function timerOf(page: Page): Promise<string> {
  return (await shadowOne(page, 'data-nb-timer'))?.text ?? '';
}

/** A real click on the centre of an in-page UI element (closed shadow root). */
async function xclickShadow(page: Page, attr: string, value?: string) {
  const all = await shadowQuery(page, attr);
  const n = value === undefined ? all.find((x) => x.visible) : all.find((x) => x.attrs[attr] === value && x.visible);
  if (!n) throw new Error(`no visible [${attr}${value ? `=${value}` : ''}] in the in-page UI`);
  const s = await toScreen(page, { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2 });
  xclick(s.x, s.y);
  return n;
}

async function xhoverShadow(page: Page, attr: string, value?: string) {
  const all = await shadowQuery(page, attr);
  const n = value === undefined ? all.find((x) => x.visible) : all.find((x) => x.attrs[attr] === value && x.visible);
  if (!n) throw new Error(`no visible [${attr}] in the in-page UI`);
  const s = await toScreen(page, { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2 });
  xmove(s.x - 6, s.y - 3);
  await sleep(80);
  xmove(s.x, s.y);
  return n;
}

/** Shoot the bar from the X screen with some room around it. */
async function shootBar(ev: Evidence, step: string, page: Page, pad = 40) {
  const b = await barOf(page);
  if (!b) return ev.xshot(step);
  const s = await toScreen(page, { x: b.box.x, y: b.box.y });
  return ev.xshot(step, { x: s.x - pad - 60, y: s.y - pad - 40, w: b.box.w + 2 * pad + 120, h: b.box.h + 2 * pad + 40 });
}

function saveFrame(ev: Evidence, name: string, jpeg: Buffer) {
  const out = path.join(ev.dir, `${ev.scenario}-${name}-nib-1440-light.jpg`);
  fs.writeFileSync(out, jpeg);
  return out;
}

/** The editor box on the page, for frame matching. */
async function editorBox(f: import('@playwright/test').Frame) {
  const b = (await f.getByTestId('editor').boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

// ================================================================ S1.2

test('S1.2 tab recording with the recording bar', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S1.2');
  const { context, sw } = await getRig();
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  const clicks: Record<string, string> = {};

  // 1. icon, record row (2 clicks); the veil at 2; record-row click to the first live frame
  let page = await freshLab(context);
  const c1 = await calm();
  let popup = await clickIcon(context, page);
  const cast1 = await screencast(page);
  const tRecord = Date.now();
  await xclickPopup(popup, '[data-row-main="record"]');
  clicks['step1'] = '2 (icon, record row)';
  const two = await until(async () => (await shadowOne(page, 'data-nb-count'))?.text === '2', 10_000, 30).catch(() => null);
  if (two) ev.xshot('1-veil-2', { x: 0, y: 0, w: 1460, h: 1000 });
  ev.set('step1-veil-read-2', !!two);
  const veil = await shadowOne(page, 'data-nb-veil');
  ev.set('step1-veil', veil ? { box: veil.box, text: veil.text } : null);
  const live = await until(async () => (await barOf(page))?.attrs['data-state'] === 'recording', 30_000, 30);
  await sleep(1500);
  const frames1 = await cast1.stop();
  const stop1 = await shadowOne(page, 'data-nb-stop');
  const ref1 = frames1.filter((f) => f.t <= live.at + 1200).pop() ?? frames1[frames1.length - 1]!;
  const first1 = stop1 ? firstMatching(frames1, tRecord, stop1.box, { ref: ref1 }) : null;
  if (first1) saveFrame(ev, '1-first-live-frame', frames1[first1.index]!.jpeg);
  ev.set('step1-key-to-live (J-195)', {
    frameMs: first1 ? Math.round(first1.t - tRecord) : null,
    seconds: first1 ? secs(first1.t - tRecord) : null,
    domMs: live.at - tRecord,
    load: c1.load,
    reliable: c1.reliable,
    frames: frames1.length,
  });

  // 2. the bar: box, position, controls; hover the mic
  await sleep(500);
  const bar = (await barOf(page))!;
  const vp = await viewportOrigin(page);
  ev.set('step2-bar', { box: bar.box, centreOffsetX: Math.round(bar.box.x + bar.box.w / 2 - vp.w / 2), bottomGap: Math.round(vp.h - (bar.box.y + bar.box.h)) });
  const controls = (await shadowQuery(page, 'data-tip')).filter((n) => n.visible).map((n) => n.attrs['aria-label'] ?? n.attrs['data-tip']);
  const timerNode = await shadowOne(page, 'data-nb-timer');
  ev.set('step2-controls', { buttons: controls, timer: timerNode?.text });
  await shootBar(ev, '2-bar', page);
  const mic = await xhoverShadow(page, 'data-nb-mic');
  await sleep(1200);
  ev.set('step2-mic', { state: mic.attrs['data-nb-mic'], tip: mic.attrs['data-tip'], ariaDisabled: mic.attrs['aria-disabled'] });
  await shootBar(ev, '2-mic-hover', page, 60);

  // 3. browser cues: the action icon and Chrome's tab indicator
  const icon = await iconPoint(page);
  ev.xshot('3-toolbar-icon', { x: icon.x - 60, y: icon.y - 25, w: 160, h: 50 });
  ev.xshot('3-tab-strip', { x: 0, y: 0, w: 420, h: 40 });
  const badge = await (await sw()).evaluate(async () => { const a = (chrome as unknown as { action: { getBadgeText(o: object): Promise<string>; getTitle(o: object): Promise<string> } }).action; return { text: await a.getBadgeText({}), title: await a.getTitle({}) }; }).catch((e) => ({ error: String(e) }));
  ev.set('step3-action', badge);

  // 4. Submit order
  await xclickEl(page, page.getByTestId('hidden-500'));
  ev.set('step4-status', await page.getByTestId('status').textContent());

  // 5. 10 s, then drag the bar by its timer to the middle of the page
  await sleep(10_000);
  const tm = (await shadowOne(page, 'data-nb-timer'))!;
  const from = await toScreen(page, { x: tm.box.x + tm.box.w / 2, y: tm.box.y + tm.box.h / 2 });
  const to = await toScreen(page, { x: vp.w / 2, y: vp.h / 2 });
  const tBefore = await timerOf(page);
  await xdrag(from, to, { steps: 20 });
  await sleep(2200);
  const moved = (await barOf(page))!;
  const tAfter = await timerOf(page);
  ev.set('step5-drag', { barBox: moved.box, timerBefore: tBefore, timerAfter2s: tAfter, keepsCounting: parseTimer(tAfter) > parseTimer(tBefore) });
  await shootBar(ev, '5-dragged', page);
  clicks['step5'] = '1 drag';

  // 6. pause, 5 s by the wall clock, resume
  await xclickShadow(page, 'data-nb-pause');
  await sleep(400);
  const atPause = await timerOf(page);
  await shootBar(ev, '6-paused', page);
  const wall0 = Date.now();
  await sleep(5000 - 400);
  const stillPaused = await timerOf(page);
  await xclickShadow(page, 'data-nb-pause');
  const pausedWallMs = Date.now() - wall0 + 400;
  await sleep(1500);
  const afterResume = await timerOf(page);
  await shootBar(ev, '6-resumed', page);
  const sess6 = await session(sw);
  ev.set('step6-pause', { atPause, after5s: stillPaused, afterResume1500ms: afterResume, frozen: atPause === stillPaused, pausedWallMs, pausedMsInSession: sess6?.pausedMs });
  clicks['step6'] = '2 (pause, resume)';

  // 7. pen: colour row, two strokes, how long each stays, done
  await xclickShadow(page, 'data-nb-tool', 'pen');
  await sleep(400);
  const swatches = (await shadowQuery(page, 'data-nb-swatch')).map((n) => ({ colour: n.attrs['data-nb-swatch'], checked: n.attrs['aria-checked'] }));
  ev.set('step7-swatches', swatches);
  await shootBar(ev, '7-pen-colours', page);
  const row = (await page.getByTestId('works').boundingBox())!;
  const rowEnd = (await page.getByTestId('rejects').boundingBox())!;
  const s1a = await toScreen(page, { x: row.x, y: row.y + row.height / 2 });
  const s1b = await toScreen(page, { x: row.x + 600, y: row.y + row.height / 2 + 10 });
  await xdrag(s1a, s1b, { steps: 20, stepMs: 15 });
  const stroke1Done = Date.now();
  await sleep(150);
  ev.xshot('7-strokes', { x: s1a.x - 40, y: s1a.y - 80, w: 760, h: 200 });
  const s2a = await toScreen(page, { x: rowEnd.x, y: rowEnd.y + rowEnd.height / 2 });
  const s2b = await toScreen(page, { x: rowEnd.x + 400, y: rowEnd.y + rowEnd.height / 2 - 20 });
  await xdrag(s2a, s2b, { steps: 20, stepMs: 15 });
  const stroke2Done = Date.now();
  await sleep(150);
  ev.xshot('7-two-strokes', { x: s1a.x - 40, y: s1a.y - 80, w: 760, h: 200 });
  const strokesNow = (await shadowQuery(page, 'data-nb-stroke')).length;
  // how long each stays: poll the stroke count
  const gone1 = await until(async () => (await shadowQuery(page, 'data-nb-stroke')).length < strokesNow, 15_000, 50).catch(() => null);
  const gone2 = await until(async () => (await shadowQuery(page, 'data-nb-stroke')).length === 0, 15_000, 50).catch(() => null);
  ev.set('step7-strokes', {
    drawn: strokesNow,
    stroke1StaysMs: gone1 ? gone1.at - stroke1Done : null,
    stroke2StaysMs: gone2 ? gone2.at - stroke2Done : null,
    load: load(),
  });
  await xclickShadow(page, 'data-nb-tool-done');
  clicks['step7'] = '2 clicks (pen, done) and 2 drags';

  // 8. blur: hover the cross-origin image card, blur, unblur, blur, undo, blur, done
  const card = page.locator('section.card', { has: page.getByRole('heading', { name: 'Cross-origin image' }) });
  await card.scrollIntoViewIfNeeded();
  await sleep(300);
  const timerBeforeBlur = parseTimer(await timerOf(page));
  const blurT0 = Date.now();
  await xclickShadow(page, 'data-nb-tool', 'blur');
  await sleep(300);
  const cb = (await card.boundingBox())!;
  const cardPt = await toScreen(page, { x: cb.x + cb.width - 60, y: cb.y + cb.height / 2 });
  xmove(cardPt.x - 10, cardPt.y);
  await sleep(100);
  xmove(cardPt.x, cardPt.y);
  await sleep(400);
  const hover = await shadowOne(page, 'data-nb-blur-hover');
  ev.set('step8-hover-outline', hover ? { box: hover.box, cardBox: cb } : null);
  ev.xshot('8-blur-hover', { x: cardPt.x - cb.width - 20, y: cardPt.y - cb.height / 2 - 30, w: cb.width + 120, h: cb.height + 60 });
  const blurredCount = () => page.evaluate(() => document.querySelectorAll('[data-tb-blurred]').length);
  const seq: Record<string, number> = {};
  xclick(cardPt.x, cardPt.y);
  await sleep(400);
  seq['click1'] = await blurredCount();
  ev.xshot('8-blurred', { x: cardPt.x - cb.width - 20, y: cardPt.y - cb.height / 2 - 30, w: cb.width + 120, h: cb.height + 60 });
  xclick(cardPt.x, cardPt.y);
  await sleep(400);
  seq['click2-unblur'] = await blurredCount();
  xclick(cardPt.x, cardPt.y);
  await sleep(400);
  seq['click3'] = await blurredCount();
  await xclickShadow(page, 'data-nb-blur-undo');
  await sleep(400);
  seq['undo'] = await blurredCount();
  xclick(cardPt.x, cardPt.y);
  await sleep(400);
  seq['click4'] = await blurredCount();
  await shootBar(ev, '8-blur-bar', page);
  await xclickShadow(page, 'data-nb-tool-done');
  const blurWall = Date.now() - blurT0;
  await sleep(600);
  const timerAfterBlur = parseTimer(await timerOf(page));
  const s8 = await session(sw);
  ev.set('step8-blur', { sequence: seq, finalBlurred: await blurredCount(), timerAdvancedS: timerAfterBlur - timerBeforeBlur, wallS: secs(blurWall + 600), timerStopsWhileBlur: timerAfterBlur - timerBeforeBlur < (blurWall + 600) / 1000 - 1.5, pausedMs: s8?.pausedMs });
  clicks['step8'] = 'blur, card, card, card, undo, card, done = 7';

  // 9. Show profile and Log at every level
  await page.getByTestId('throws').scrollIntoViewIfNeeded();
  await xclickEl(page, page.getByTestId('throws'));
  await sleep(300);
  await xclickEl(page, page.getByTestId('console'));
  await sleep(500);

  // 10. the Form link (SPA change): the bar and timer stay
  const beforeNav = await timerOf(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await xclickEl(page, page.getByRole('link', { name: 'Form', exact: true }));
  await page.waitForURL(/\/form$/);
  await sleep(1200);
  const afterNav = await barOf(page);
  ev.set('step10-spa', { url: page.url(), bar: !!afterNav, state: afterNav?.attrs['data-state'], timerBefore: beforeNav, timerAfter: await timerOf(page), barBox: afterNav?.box });

  // 11. reload with Ctrl+R: the gap while the document loads, the bar back with the timer counting
  const cast11 = await screencast(page);
  const before11 = await timerOf(page);
  await focusWindow(page);
  const tReload = Date.now();
  xkey('ctrl+r');
  await page.waitForLoadState('domcontentloaded');
  const back = await until(async () => (await barOf(page))?.attrs['data-state'] === 'recording' ? await barOf(page) : null, 20_000, 50);
  await sleep(1500);
  const frames11 = await cast11.stop().catch(() => [] as import('./rig.ts').ScreenFrame[]);
  const after11 = await timerOf(page);
  // the gap: frames between the reload and the bar's return
  const gapFrame = frames11.find((f) => f.t > tReload + 50 && f.t < back.at);
  if (gapFrame) saveFrame(ev, '11-gap', gapFrame.jpeg);
  await shootBar(ev, '11-bar-back', page);
  ev.set('step11-reload', { timerBefore: before11, timerAfter: after11, keepsCounting: parseTimer(after11) > parseTimer(before11), barBackMs: back.at - tReload, barBox: back.value?.box, load: load() });

  // 12. at 1:00 or more: the popup during a recording, then stop from it
  await until(async () => parseTimer(await timerOf(page)) >= 60, 120_000, 500);
  const c13 = await calm(60_000);
  popup = await clickIcon(context, page);
  ev.set('step12-rows', await rowsOf(popup));
  await shootPopup(ev, '12-popup-recording', popup);
  const cast13 = await screencast(page);
  const tStop = Date.now();
  await xclickPopup(popup, '[data-row-main="stop"]');
  clicks['step12'] = '2 (icon, stop row)';
  const left = await until(async () => { const st = (await session(sw))?.state; return st && st !== 'recording' ? st : null; }, 8000, 50).catch(() => null);
  ev.set('step12-after-stop-click', left ? { state: left.value, ms: left.at - tStop } : { state: (await session(sw))?.state, note: 'still recording 8 s after the stop click' });
  const stopping = await until(async () => (await barOf(page))?.attrs['data-state'] === 'stopping', 10_000, 30).catch(() => null);
  if (stopping) await shootBar(ev, '13-processing', page);
  ev.set('step13-processing-state', stopping ? { seenAfterMs: stopping.at - tStop, text: (await barOf(page))?.text ?? 'gone' } : 'not seen (too short to catch)');

  // 13. stop to editor (J-196); a healthy draft
  const f = await editorFrame(page, 60_000);
  const domAt = Date.now();
  await sleep(1500);
  const frames13 = await cast13.stop();
  const region = await editorBox(f);
  const ref13 = frames13.filter((x) => x.t <= domAt + 1200).pop() ?? frames13[frames13.length - 1]!;
  const first13 = firstMatching(frames13, tStop, region, { ref: ref13 });
  if (first13) saveFrame(ev, '13-first-editor-frame', frames13[first13.index]!.jpeg);
  ev.set('step13-stop-to-editor (J-196)', { frameMs: first13 ? Math.round(first13.t - tStop) : null, seconds: first13 ? secs(first13.t - tStop) : null, domMs: domAt - tStop, load: c13.load, reliable: c13.reliable });
  const length = (await f.getByTestId('length').textContent().catch(() => ''))?.trim();
  await xclickEl(page, f.getByTestId('play'));
  await sleep(2000);
  const playback = await f.evaluate(() => {
    const v = document.querySelector('video');
    return v ? { currentTime: v.currentTime, duration: v.duration, paused: v.paused } : null;
  });
  ev.set('step13-draft', { length, playback, healthy: !!playback && playback.currentTime > 0 });
  ev.xshot('13-editor', { x: 0, y: 0, w: 1460, h: 1000 });
  // pause the playback again, so the draft sits still
  await xclickEl(page, f.getByTestId('play')).catch(() => undefined);

  // 14. the popup: unfinished-draft pill, capture rows disabled
  popup = await clickIcon(context, page);
  const pill = popup.locator('[data-drafts-pill]');
  ev.set('step14-pill', { count: await pill.getAttribute('data-drafts-pill').catch(() => null), disabled: await pill.isDisabled().catch(() => null), title: await pill.getAttribute('title').catch(() => null) });
  ev.set('step14-rows', await rowsOf(popup));
  await shootPopup(ev, '14-draft-pill', popup);

  // 15. restart the extension from the menu; the editor closes; the pill opens the drafts list
  await openMenu(popup);
  await xclickPopup(popup, '[data-menu-item="restart"]');
  const tRestart = Date.now();
  const closed = await until(async () => !hasEditor(page), 15_000, 100).catch(() => null);
  ev.set('step15-editor-closed-after-restart', closed ? { ms: closed.at - tRestart } : 'no: the editor frame stays over the page');
  await sleep(2000);
  ev.xshot('15-after-restart', { x: 0, y: 0, w: 1460, h: 1000 });
  const reopened = await openPopup(context, page);
  popup = reopened.popup;
  ev.set('step15-popup-open-after-restart-without-a-click', !reopened.clicked);
  const pill2 = popup.locator('[data-drafts-pill]');
  ev.set('step15-pill', { count: await pill2.getAttribute('data-drafts-pill').catch(() => null), disabled: await pill2.isDisabled().catch(() => null) });
  await xclickPopup(popup, '[data-drafts-pill]');
  await popup.locator('[data-screen="drafts"]').waitFor();
  const drafts = await popup.locator('[data-draft]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
  ev.set('step15-drafts', drafts);
  await shootPopup(ev, '15-drafts-list', popup);
  clicks['step15'] = 'icon, menu, restart, icon, pill = 5';
  ev.set('clicks', clicks);

  // After-check (scenario: after S2.4 creates the capture). open-toolbar has no capture budget, so the
  // draft is created here from the drafts list and its video is checked: the bar at its dragged
  // spot, the card blurred, the length about 5 s shorter than the wall time.
  const wallMs = tStop - live.at;
  const allEditors = () => context.pages().flatMap((p) => p.frames().filter((x) => x.url().includes('/editor.html')).map((fr) => ({ p, fr })));
  const framesBefore = allEditors().map((x) => x.fr);
  await xclickPopup(popup, popup.locator('[data-draft-view]').first());
  // the frame left over from before the restart is still in the page: take the new one, in
  // this tab or another
  // (in practice the old iframe is reused: the same frame navigates to the draft)
  await sleep(2500);
  const found = allEditors().find((x) => !framesBefore.includes(x.fr)) ?? allEditors().pop()!;
  const f2 = found.fr;
  if (found.p !== page) page = found.p;
  await f2.getByTestId('field').waitFor({ timeout: 60_000 });
  ev.set('after-editor', { framesInLabTab: page.frames().filter((x) => x.url().includes('/editor.html')).length, sameTab: found.p === page, url: found.p.url() });
  await xclickEl(page, f2.getByTestId('field'));
  await page.keyboard.type('parity S1.2 tab recording');
  const clipBefore = clipboard();
  await page.keyboard.press('Control+Enter');
  const link = (await until(async () => (clipboard() !== clipBefore && /\/s\//.test(clipboard()) ? clipboard() : ''), 60_000, 200)).value;
  const rec = await captureOf(context, link);
  await waitReady(context, rec.id);
  const full = await api<{ durationMs?: number | null; kind: string }>(context, 'GET', `/api/v1/recordings/${rec.id}`);
  ev.set('after-capture', { id: rec.id, link, kind: full.body.kind, durationMs: full.body.durationMs, wallMs, shorterByS: full.body.durationMs ? secs(wallMs - full.body.durationMs) : null });
  // frames: just after the drag (bar moved), after the blur (card blurred)
  const dur = full.body.durationMs ?? 60_000;
  for (const at of [3000, 20_000, Math.round(dur * 0.55), Math.round(dur * 0.65), dur - 2000]) {
    const r = await context.request.get(`${SERVER}/api/v1/recordings/${rec.id}/frames?at=${at}`, { headers: { origin: SERVER } });
    if (r.ok()) fs.writeFileSync(path.join(ev.dir, `S1.2-after-frame-${at}ms.jpg`), await r.body());
  }
  ev.set('load-end', load());
  // the tab stays open: closing the last tab would close the window and the shared browser
});

// ================================================================ S1.3

/** Chrome's share picker for an extension request is a window of its own on this display. */
async function pickEntireScreen(timeout = 20_000): Promise<number> {
  const t0 = Date.now();
  let win = '';
  while (!win && Date.now() - t0 < timeout) {
    try {
      win = xdo('search', '--onlyvisible', '--name', 'Choose what to share').split('\n')[0] ?? '';
    } catch {
      await sleep(100);
    }
  }
  if (!win) return 0;
  const geo = xdo('getwindowgeometry', win);
  const [, x, y] = geo.match(/Position: (\d+),(\d+)/)!.map(Number);
  const [, w, h] = geo.match(/Geometry: (\d+)x(\d+)/)!.map(Number);
  await sleep(900); // thumbnails paint after the window maps
  xclick(x! + 169, y! + 181); // the one screen thumbnail (Entire Screen is the open tab for a monitor request)
  await sleep(300);
  xclick(x! + w! - 57, y! + h! - 39); // Share
  for (let i = 0; i < 50; i++) {
    try {
      xdo('search', '--onlyvisible', '--name', 'Choose what to share');
    } catch {
      return 2;
    }
    await sleep(100);
  }
  throw new Error('the share picker stayed open after Share');
}

test('S1.3 desktop recording across tabs', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S1.3');
  // Chrome's picker reads every window on its display: the shared rig browser goes first
  await closeRig();
  ev.set('load-start', load());
  ev.set('note-second-origin', 'The lab serves only assets on :5174 (404 at /), so tab B is http://127.0.0.1:5173/, a second origin with the same page.');
  let attempt = 0;
  let mode: 'picker' | 'fake' = 'picker';
  for (;;) {
    attempt++;
    const b = await launchExtension({ cdpPort: 9362, args: mode === 'fake' ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] : [] });
    let crashed = false;
    let closing = false;
    b.context.on('close', () => {
      if (!closing) crashed = true;
    });
    try {
      await runS13(ev, b, mode);
      ev.set('picker-mode', { mode, attempts: attempt });
      return;
    } catch (e) {
      ev.set(`attempt-${attempt}-error`, String((e as Error).message).split('\n')[0]);
      if (!crashed || attempt >= 4) throw e;
      if (attempt >= 3) mode = 'fake';
    } finally {
      closing = true;
      await b.close();
    }
  }
});

async function runS13(ev: Evidence, b: Launched, mode: 'picker' | 'fake') {
  const { context, sw } = b;
  const { lab, popup: p0 } = await signIn(context, EMAIL);
  await p0.close().catch(() => undefined);
  for (const p of context.pages()) if (p.url().startsWith(SERVER)) await p.close().catch(() => undefined);
  const clicks: Record<string, string> = {};

  // 1. tab A on :5173, tab B on the second origin; back to tab A
  const tabA = lab;
  await tabA.goto(LAB_URL + '/');
  const tabB = await context.newPage();
  await tabB.goto('http://127.0.0.1:5173/');
  await tabB.waitForLoadState('networkidle');
  await focusWindow(tabA);
  await tabA.waitForLoadState('networkidle');

  // 2. icon, chevron, Screen (desktop), shoot, record row
  let popup = await clickIcon(context, tabA);
  await xclickPopup(popup, '[data-row-chevron="record"]');
  await xclickPopup(popup, '[data-row-options="record"] [data-value="desktop"]');
  await sleep(300);
  ev.set('step2-record-label', (await popup.locator('[data-row-main="record"]').textContent())?.trim());
  ev.set('step2-record-options', await popup.locator('[data-row-options="record"] [data-value]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-value')}:${(e.textContent ?? '').trim()}:${e.getAttribute('aria-checked') ?? e.getAttribute('aria-pressed') ?? ''}`)));
  await shootPopup(ev, '2-chevron-desktop', popup);
  await xclickPopup(popup, '[data-row-main="record"]');
  clicks['step2'] = '4 (icon, chevron, Screen, record row)';

  // 3. the picker: the screen and Share; no countdown
  let picked = 0;
  if (mode === 'picker') {
    picked = await pickEntireScreen();
    if (!picked) throw new Error('the share picker did not open');
  }
  const tPicked = Date.now();
  clicks['step3-picker'] = mode === 'picker' ? `${picked} (screen thumbnail, Share)` : 'fake media: no picker';
  const states: string[] = [];
  const live = await until(async () => {
    const st = (await session(sw))?.state;
    if (st && states[states.length - 1] !== st) states.push(st);
    return st === 'recording' ? st : null;
  }, 30_000, 50);
  ev.set('step3-live', { afterShareMs: live.at - tPicked, statesSeen: states, countdownSeen: states.includes('countdown'), load: load() });
  await sleep(800);
  ev.xshot('3-sharing-strip', { x: 0, y: 0, w: 1460, h: 1000 });

  // 4. tab A: Submit order; then tab B by its tab in the strip; the bar there, timer going
  await xclickEl(tabA, tabA.getByTestId('hidden-500'));
  await sleep(800);
  const tA = await timerOf(tabA);
  // the second tab in the tab strip
  const o = await tabA.evaluate(() => ({ x: window.screenX, y: window.screenY }));
  xclick(o.x + 330, o.y + 20);
  await sleep(1500);
  const visB = await tabB.evaluate(() => document.visibilityState);
  const barB = await until(async () => (await barOf(tabB))?.attrs['data-state'] === 'recording', 10_000, 100).catch(() => null);
  const tB = await timerOf(tabB);
  ev.set('step4-tab-switch', { tabBVisible: visB, barInTabB: !!barB, timerInA: tA, timerInB: tB, continues: parseTimer(tB) >= parseTimer(tA) });
  await shootBar(ev, '4-bar-tab-b', tabB);
  ev.xshot('4-tab-b-screen', { x: 0, y: 0, w: 1460, h: 1000 });

  // 5. tab B: Save and Log at every level
  await xclickEl(tabB, tabB.getByTestId('works'));
  await sleep(300);
  await xclickEl(tabB, tabB.getByTestId('console'));
  await sleep(1500);

  // 6. stop with the bar in tab B; stop to editor; the editor opens in tab B
  const cast = await screencast(tabB);
  const c6 = await calm(60_000);
  const tStop = Date.now();
  await xclickShadow(tabB, 'data-nb-stop');
  const f = await editorFrame(tabB, 60_000);
  const domAt = Date.now();
  await sleep(1500);
  const frames = await cast.stop();
  const ref = frames.filter((x) => x.t <= domAt + 1200).pop() ?? frames[frames.length - 1]!;
  const first = firstMatching(frames, tStop, await editorBox(f), { ref });
  if (first) saveFrame(ev, '6-first-editor-frame', frames[first.index]!.jpeg);
  ev.set('step6-stop-to-editor (J-196)', { frameMs: first ? Math.round(first.t - tStop) : null, seconds: first ? secs(first.t - tStop) : null, domMs: domAt - tStop, load: c6.load, reliable: c6.reliable, editorInTabB: true, editorInTabA: hasEditor(tabA) });
  ev.xshot('6-editor', { x: 0, y: 0, w: 1460, h: 1000 });
  clicks['step6'] = '1 (stop on the bar)';

  // 7. create with the button; per-tab counts; the video shows browser chrome
  await f.getByTestId('field').click();
  await tabB.keyboard.type('parity S1.3 desktop');
  const before = clipboard();
  await xclickEl(tabB, f.getByTestId('create'));
  clicks['step7'] = '1 (create)';
  const link = (await until(async () => (clipboard() !== before && /\/s\//.test(clipboard()) ? clipboard() : ''), 60_000, 200)).value;
  const rec = await captureOf(context, link);
  await waitReady(context, rec.id);
  const net = await api<{ items: { url: string; status: number | null; tabId?: number | null }[] }>(context, 'GET', `/api/v1/recordings/${rec.id}/network?limit=200`);
  const con = await api<{ items: { level?: string; tabId?: number | null; args?: unknown; text?: string }[] }>(context, 'GET', `/api/v1/recordings/${rec.id}/console?limit=500`);
  const byTab = <T extends { tabId?: number | null }>(items: T[]) => items.reduce<Record<string, number>>((m, x) => ((m[String(x.tabId ?? 'none')] = (m[String(x.tabId ?? 'none')] ?? 0) + 1), m), {});
  ev.set('step7-capture', { id: rec.id, kind: rec.kind, link });
  ev.set('step7-network-per-tab', { total: net.body?.items?.length, byTab: byTab(net.body?.items ?? []), urls: (net.body?.items ?? []).map((r) => `${r.tabId}:${r.status}:${r.url.replace(/^https?:\/\//, '')}`).slice(0, 40) });
  // console rows in the panel API carry no tab id; the raw events do (J-224)
  const evs = await api<{ items?: { offsetMs: number; event: { kind: string; tab?: number } }[] }>(context, 'GET', `/api/v1/recordings/${rec.id}/events?limit=500`);
  const rows = (evs.body?.items ?? []).map((x) => x.event);
  const kinds = rows.reduce<Record<string, number>>((m, x) => ((m[x.kind] = (m[x.kind] ?? 0) + 1), m), {});
  ev.set('step7-event-kinds', { status: evs.status, kinds });
  const consoleEvents = rows.filter((e) => e.kind === 'console');
  const consoleByTab = consoleEvents.reduce<Record<string, number>>((m, x) => ((m[String(x.tab ?? 'none')] = (m[String(x.tab ?? 'none')] ?? 0) + 1), m), {});
  ev.set('step7-console-per-tab', { panelRows: con.body?.items?.length, consoleEvents: consoleEvents.length, byTab: consoleByTab });
  const frame = await context.request.get(`${SERVER}/api/v1/recordings/${rec.id}/frames?at=2000`, { headers: { origin: SERVER } });
  if (frame.ok()) fs.writeFileSync(path.join(ev.dir, 'S1.3-7-video-frame-2s.jpg'), await frame.body());
  // capture page at 1440 and 390, light and dark
  const cap = await context.newPage();
  for (const [w, h] of [[1440, 900], [390, 844]] as const)
    for (const theme of ['light', 'dark'] as const) {
      await cap.setViewportSize({ width: w, height: h });
      await cap.emulateMedia({ colorScheme: theme });
      await cap.goto(`${SERVER}/c/${rec.id}`);
      await cap.waitForLoadState('networkidle').catch(() => undefined);
      await sleep(1500);
      await ev.shot(cap, '7-capture-page', String(w), theme);
      ev.set(`step7-capture-page-${w}-${theme}-overflow`, await cap.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
    }
  await cap.close();

  // 8. the record row still offers desktop; back to tab
  popup = await clickIcon(context, tabB);
  ev.set('step8-record-label-sticky', (await popup.locator('[data-row-main="record"]').textContent())?.trim());
  await xclickPopup(popup, '[data-row-chevron="record"]');
  await xclickPopup(popup, '[data-row-options="record"] [data-value="tab"]');
  await sleep(300);
  ev.set('step8-record-label-after-reset', (await popup.locator('[data-row-main="record"]').textContent())?.trim());
  await popup.close().catch(() => undefined);
  ev.set('clicks', clicks);
  ev.set('load-end', load());
}

// ================================================================ S1.4

test('S1.4 instant replay', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S1.4');
  const { context, sw } = await getRig();
  ev.set('load-start', load());
  const count0 = await recordingCount(context);

  // 1. menu, settings, instant replay on (one-time setup)
  let page = await freshLab(context);
  let popup = await clickIcon(context, page);
  await openMenu(popup);
  await xclickPopup(popup, '[data-menu-item="settings"]');
  const sw1 = popup.getByRole('switch', { name: 'Instant replay' });
  await sw1.waitFor();
  const wasOn = await sw1.isChecked();
  if (!wasOn) await xclickPopup(popup, sw1);
  await expect(sw1).toBeChecked();
  ev.set('step1-setup-clicks', wasOn ? 'already on' : '4 (icon, menu, Settings, switch)');
  await shootPopup(ev, '1-settings', popup);
  await popup.close().catch(() => undefined);

  // 2 and 3, three times: reload, Submit order and Show profile, 10 s, icon, replay row
  const timings: unknown[] = [];
  for (let run = 1; run <= 3; run++) {
    await focusWindow(page);
    xkey('ctrl+r');
    await page.waitForLoadState('networkidle');
    await sleep(800);
    await xclickEl(page, page.getByTestId('hidden-500'));
    await sleep(300);
    await xclickEl(page, page.getByTestId('throws'));
    await sleep(10_000);
    const c = await calm(120_000);
    popup = await clickIcon(context, page);
    if (run === 1) ev.set('step3-rows', await rowsOf(popup));
    const cast = await screencast(page);
    const t0 = Date.now();
    await xclickPopup(popup, '[data-row-main="replay"]');
    const f = await editorFrame(page, 60_000);
    await f.getByTestId('draft-replay').waitFor({ timeout: 60_000 });
    const domAt = Date.now();
    await sleep(2000);
    const frames = await cast.stop();
    const ref = frames.filter((x) => x.t <= domAt + 1800).pop() ?? frames[frames.length - 1]!;
    const first = firstMatching(frames, t0, await editorBox(f), { ref });
    timings.push({ run, frameMs: first ? Math.round(first.t - t0) : null, seconds: first ? secs(first.t - t0) : null, domMs: domAt - t0, load: c.load, reliable: c.reliable });
    if (run === 1) {
      const info = await f.evaluate(() => {
        const stage = document.querySelector('[data-testid="draft-replay"]');
        const track = document.querySelector('[data-testid="trim-track"]');
        return {
          length: document.querySelector('[data-testid="length"]')?.textContent?.trim(),
          pointer: !!stage?.querySelector('.replayer-mouse, [class*="mouse"], [class*="pointer"], [class*="cursor"]'),
          iframe: !!stage?.querySelector('iframe'),
          cutStartPct: (document.querySelector('[data-testid="cut-start"]') as HTMLElement | null)?.style.width,
          trackChildren: track ? [...track.querySelectorAll('*')].map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}${e.getAttribute('title') ? `[${e.getAttribute('title')}]` : ''}`).slice(0, 30) : [],
          markers: [...document.querySelectorAll('[data-marker], [class*="marker"], [class*="tick"]')].map((e) => `${e.className}:${e.getAttribute('title') ?? e.getAttribute('aria-label') ?? ''}`).slice(0, 20),
        };
      });
      ev.set('step3-draft', info);
      await xclickEl(page, f.getByTestId('play')).catch(() => undefined);
      await sleep(2500);
      ev.xshot('3-replay-draft', { x: 0, y: 0, w: 1460, h: 1000 });
      ev.set('step3-pointer-after-play', await f.evaluate(() => !!document.querySelector('[data-testid="draft-replay"] .replayer-mouse')));
    }
    await closeEditor(page);
  }
  ev.set('step3-replay-to-editor (J-194, J-009)', timings);

  // 4. Save every 10 s for 150 s, replay, handles fully out: at most 120 s and above 0
  await focusWindow(page);
  xkey('ctrl+r');
  await page.waitForLoadState('networkidle');
  const tLoad = Date.now();
  for (let i = 0; i < 15; i++) {
    await xclickEl(page, page.getByTestId('works'));
    await sleep(10_000);
  }
  popup = await clickIcon(context, page);
  await xclickPopup(popup, '[data-row-main="replay"]');
  const f4 = await editorFrame(page, 60_000);
  await f4.getByTestId('draft-replay').waitFor({ timeout: 60_000 });
  await sleep(1500);
  const lenDefault = (await f4.getByTestId('length').textContent())?.trim();
  const track = (await f4.getByTestId('trim-track').boundingBox())!;
  const gs = (await f4.getByTestId('grip-start').boundingBox())!;
  const gsFrom = await toScreen(page, { x: gs.x + gs.width / 2, y: gs.y + gs.height / 2 });
  const gsTo = await toScreen(page, { x: track.x - 30, y: gs.y + gs.height / 2 });
  await xdrag(gsFrom, gsTo, { steps: 15 });
  await sleep(500);
  const ge = (await f4.getByTestId('grip-end').boundingBox())!;
  const geFrom = await toScreen(page, { x: ge.x + ge.width / 2, y: ge.y + ge.height / 2 });
  const geTo = await toScreen(page, { x: track.x + track.width + 30, y: ge.y + ge.height / 2 });
  await xdrag(geFrom, geTo, { steps: 15 });
  await sleep(500);
  const lenFull = (await f4.getByTestId('length').textContent())?.trim();
  const spanMs = await f4.evaluate(() => {
    const v = document.querySelector('[data-testid="draft-replay"]');
    return v ? (v as HTMLElement).dataset.durationMs ?? null : null;
  });
  ev.set('step4-replay-span (J-010)', { sinceLoadS: secs(Date.now() - tLoad), defaultLength: lenDefault, fullLength: lenFull, spanMs });
  ev.xshot('4-replay-full-span', { x: 0, y: 0, w: 1460, h: 1000 });
  await closeEditor(page);

  // 5. nothing reached the server
  const count1 = await recordingCount(context);
  ev.set('step5-recordings (J-189)', { before: count0, after: count1, unchanged: count0 === count1 });

  // 6. put the setting back (default off); a Jam-side step, best effort here
  try {
    popup = await clickIcon(context, page);
    await openMenu(popup);
    await xclickPopup(popup, '[data-menu-item="settings"]');
    const sw6 = popup.getByRole('switch', { name: 'Instant replay' });
    if (await sw6.isChecked()) await xclickPopup(popup, sw6);
    await popup.close().catch(() => undefined);
  } catch {
    await (await sw()).evaluate(async () => {
      const k = 'tb:settings';
      const cur = ((await chrome.storage.local.get(k))[k] ?? {}) as Record<string, unknown>;
      await chrome.storage.local.set({ [k]: { ...cur, instantReplay: false } });
    });
  }
  ev.set('load-end', load());
  // the tab stays open: closing the last tab would close the window and the shared browser
});

// ================================================================ S1.5

test('S1.5 recording link from the popup', async () => {
  const ev = new Evidence(GROUP, 'S1.5');
  const { context } = await getRig();
  ev.set('load-start', load());
  // the folder "parity" (S6.2 makes it on Jam; open-toolbar makes it here through the API if missing)
  const boot = await api<{ activeWorkspaceId?: string; workspaces?: { id: string }[] }>(context, 'GET', '/api/v1/ext/bootstrap');
  let ws = boot.body?.activeWorkspaceId ?? boot.body?.workspaces?.[0]?.id;
  if (!ws) {
    const list = await api<{ items?: { id: string }[] } | { id: string }[]>(context, 'GET', '/api/v1/workspaces');
    const items = Array.isArray(list.body) ? list.body : list.body?.items ?? [];
    ws = items[0]?.id;
  }
  // rig hygiene: links named "parity link ..." from earlier runs go, so each run leaves three
  const oldLinks = await api<{ items?: { id: string; name: string }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/recording-links`);
  let removed = 0;
  for (const l of oldLinks.body?.items ?? []) if (/^parity link( \d+)?$/.test(l.name) && (await api(context, 'DELETE', `/api/v1/recording-links/${l.id}`)).status < 300) removed++;
  ev.set('setup-old-parity-links-removed', removed);
  const folders = await api<{ items?: { id: string; name: string }[] } | { id: string; name: string }[]>(context, 'GET', `/api/v1/workspaces/${ws}/folders`);
  const fl = Array.isArray(folders.body) ? folders.body : folders.body?.items ?? [];
  if (!fl.some((f) => f.name === 'parity')) {
    const made = await api(context, 'POST', `/api/v1/workspaces/${ws}/folders`, { name: 'parity' });
    ev.set('folder-made-through-api', made.status);
    // the extension keeps its bootstrap (folders included) for 60 s; on Jam the folder exists
    // long before this scenario (S6.2), so wait out the cache
    await sleep(61_000);
  }

  const runs: unknown[] = [];
  for (let run = 1; run <= 3; run++) {
    const page = await freshLab(context);
    let popup = await clickIcon(context, page);
    await xclickPopup(popup, '[data-row-main="link"]');
    await popup.locator('[data-link-name]').waitFor();
    if (run === 1) await shootPopup(ev, '1-link-form', popup);
    if (run === 1)
      ev.set('step1-form', {
        domain: (await popup.locator('[data-link-domain]').textContent())?.trim(),
        folders: await popup.locator('[data-link-folder] option').allTextContents(),
      });
    await xclickPopup(popup, '[data-link-name]');
    await popup.keyboard.type(run === 1 ? 'parity link' : `parity link ${run}`);
    // the folder select is a native select: a click opens it, the keyboard picks
    await popup.locator('[data-link-folder]').selectOption({ label: 'parity' });
    const before = clipboard();
    const c = await calm(60_000);
    const t0 = Date.now();
    await xclickPopup(popup, '[data-link-create]');
    const got = await until(async () => (clipboard() !== before && clipboard().startsWith(SERVER) ? clipboard() : ''), 30_000, 20);
    await popup.locator('[data-link-done]').waitFor();
    const shown = await popup.locator('[data-link-url]').inputValue();
    runs.push({ run, createToClipboardMs: got.at - t0, seconds: secs(got.at - t0), load: c.load, reliable: c.reliable, clipboard: got.value, shownMatches: shown === got.value, copyButton: (await popup.locator('[data-link-copy]').count()) > 0 });
    if (run === 1) await shootPopup(ev, '3-link-done', popup);
    await popup.close().catch(() => undefined);
    popup = undefined as unknown as Page;
  }
  ev.set('runs', runs);
  ev.set('clicks', 'icon, link row, (name field), folder select, create = 4 clicks plus typing; 3 without the folder');
  ev.set('load-end', load());
});

// ================================================================ S1.6

/**
 * The rig server's sign-in (docs/parity/fix-round-2.md, "Rerun setup"): the parity accounts sign in
 * with the dev-only password and the mock OIDC provider. Both default to off since J-217, so a
 * restart that passed only the caller's variables left the server, and every later group, without
 * them. Values in the environment win, so a run can still point the rig elsewhere.
 */
const RIG_SERVER_ENV: Record<string, string> = {
  AUTH_DEV_PASSWORD: '1',
  OIDC_1_ID: 'company',
  OIDC_1_NAME: 'Company SSO',
  OIDC_1_CLIENT_ID: 'toolbar',
  OIDC_1_CLIENT_SECRET: 'dev',
  OIDC_1_DISCOVERY_URL: 'http://oidc.localhost:3311/company/.well-known/openid-configuration',
  AUTH_ALLOWED_DOMAINS: 'example.com',
};

function compose(env: Record<string, string>) {
  const base = Object.fromEntries(Object.entries(RIG_SERVER_ENV).map(([k, v]) => [k, process.env[k] || v]));
  execFileSync('docker', ['compose', 'up', '-d', 'server'], { cwd: ROOT, env: { ...process.env, ...base, ...env }, stdio: 'ignore', timeout: 300_000 });
}

async function healthy() {
  await until(async () => {
    const r = await fetch(`${SERVER}/api/health`).catch(() => null);
    return r?.ok ? true : null;
  }, 180_000, 1000);
}

test('S1.6 microphone and the recording cap', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S1.6');
  ev.set('load-start', load());

  // 1. the mic pill on a machine with no input device
  {
    const { context, sw } = await getRig();
    const page = await freshLab(context);
    await (await sw()).evaluate(() => chrome.storage.local.set({ 'tb:mic-granted': false }));
    const popup = await clickIcon(context, page);
    const opened = context.waitForEvent('page', { predicate: (p) => p.url().includes('/permissions.html'), timeout: 15_000 }).catch(() => null);
    const tClick = Date.now();
    await xclickPopup(popup, '[data-mic-pill]');
    const perm = await opened;
    let shot = false;
    if (perm) {
      await sleep(150);
      try {
        ev.xshot('1-permission-tab', { x: 0, y: 0, w: 1460, h: 1000 });
        shot = true;
      } catch {
        /* gone already */
      }
    }
    const closedAt = perm ? await perm.waitForEvent('close', { timeout: 15_000 }).then(() => Date.now()).catch(() => null) : null;
    await sleep(800);
    const settings = (await (await sw()).evaluate(async () => (await chrome.storage.local.get('tb:settings'))['tb:settings'])) as { mic?: boolean } | undefined;
    const p2 = (await openPopup(context, page)).popup;
    const pill = await p2.locator('[data-mic-pill]').getAttribute('data-mic-pill');
    const err = (await p2.locator('[data-popup-error]').count()) ? await p2.locator('[data-popup-error]').textContent() : null;
    await shootPopup(ev, '1-pill-after', p2);
    ev.set('step1-no-device (J-014)', { permissionTabOpened: !!perm, shot, tabClosedAfterMs: closedAt ? closedAt - tClick : null, micSetting: settings?.mic ?? false, pill, popupMessage: err });
    await p2.close().catch(() => undefined);
    await page.close().catch(() => undefined);
  }

  // 3 first (needs a server restart): MAX_RECORDING_MIN=1, a tab recording runs into the cap
  await closeRig();
  compose({ MAX_RECORDING_MIN: '1' });
  await healthy();
  try {
    const b = await launchExtension({ cdpPort: 9363 });
    try {
      const { lab: page, popup: p0 } = await signIn(b.context, EMAIL);
      await p0.close().catch(() => undefined);
      for (const p of b.context.pages()) if (p !== page) await p.close().catch(() => undefined);
      await page.goto(LAB_URL + '/');
      await focusWindow(page);
      const popup = await clickIcon(b.context, page);
      await xclickPopup(popup, '[data-row-main="record"]');
      const live = await until(async () => (await barOf(page))?.attrs['data-state'] === 'recording', 30_000, 50);
      const stages: { stage: string; timer: string; atS: number }[] = [];
      let last = '';
      let shotWarn = false;
      let shotDanger = false;
      let shotBefore = false;
      const stopped = await until(
        async () => {
          const bar = await barOf(page);
          if (!bar || bar.attrs['data-state'] !== 'recording') return 'left recording';
          const stage = bar.attrs['data-stage'] ?? '';
          const timer = (await timerOf(page)) || '';
          if (stage !== last) {
            stages.push({ stage, timer, atS: secs(Date.now() - live.at) });
            last = stage;
          }
          if (stage === 'warn' && !shotWarn) {
            await shootBar(ev, '3-timer-warn', page);
            shotWarn = true;
          }
          if (stage === 'danger' && !shotDanger) {
            await shootBar(ev, '3-timer-danger', page);
            shotDanger = true;
          }
          if (parseTimer(timer) >= 58 && !shotBefore) {
            await shootBar(ev, '3-timer-before-cap', page);
            shotBefore = true;
          }
          return null;
        },
        120_000,
        200,
      );
      const stopAt = Date.now();
      const f = await editorFrame(page, 60_000);
      await sleep(1500);
      const length = (await f.getByTestId('length').textContent().catch(() => ''))?.trim();
      const s = await (await b.sw()).evaluate(async () => (await chrome.storage.session.get('tb:session'))['tb:session']);
      ev.set('step3-cap (J-013)', { stages, stoppedAfterS: secs(stopAt - live.at), draftLength: length, sessionAfter: (s as { state?: string } | undefined)?.state, editorOpened: true, why: stopped.value, load: load() });
      ev.xshot('3-draft-after-cap', { x: 0, y: 0, w: 1460, h: 1000 });
      await closeEditor(page);
    } finally {
      await b.close();
    }
  } finally {
    compose({ MAX_RECORDING_MIN: '' });
    await healthy();
  }

  // 2. fake microphone: grant once, record, mute and unmute from the bar, (switch), stop
  // Tab capture fails with the fake-device flags (e2e/flows/fixture.ts), so this recording is a
  // desktop one, which the fake UI flag answers without a picker, as in the capture suite's
  // J-211 test. The fake device is Chromium's default (a beep), not a speech WAV.
  const b = await launchExtension({ cdpPort: 9364, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    const { lab: page, popup: p0 } = await signIn(b.context, EMAIL);
    await p0.close().catch(() => undefined);
    for (const p of b.context.pages()) if (p !== page) await p.close().catch(() => undefined);
    await page.goto(LAB_URL + '/');
    await focusWindow(page);
    await (await b.sw()).evaluate(() => chrome.storage.local.set({ 'tb:mic-granted': false }));
    let popup = await clickIcon(b.context, page);
    const opened = b.context.waitForEvent('page', { predicate: (p) => p.url().includes('/permissions.html'), timeout: 15_000 }).catch(() => null);
    await xclickPopup(popup, '[data-mic-pill]');
    const perm = await opened;
    const permClosed = perm ? await perm.waitForEvent('close', { timeout: 15_000 }).then(() => true).catch(() => false) : false;
    await sleep(800);
    popup = (await openPopup(b.context, page)).popup;
    const pillAfterGrant = await popup.locator('[data-mic-pill]').getAttribute('data-mic-pill');
    // the popup closed when the permission tab took the focus, before it could turn the mic
    // on: a second click on the pill (now granted, no tab) turns it on
    let secondClick = false;
    if (pillAfterGrant !== 'on') {
      await xclickPopup(popup, '[data-mic-pill]');
      await sleep(800);
      secondClick = true;
    }
    const pillAfterSecond = await popup.locator('[data-mic-pill]').getAttribute('data-mic-pill');
    await xclickPopup(popup, '[data-row-chevron="record"]');
    await xclickPopup(popup, '[data-row-options="record"] [data-value="desktop"]');
    const tRec = Date.now();
    await xclickPopup(popup, '[data-row-main="record"]');
    const live = await until(async () => (await barOf(page))?.attrs['data-state'] === 'recording', 30_000, 50);
    await sleep(2000);
    const micOn = (await shadowOne(page, 'data-nb-mic'))?.attrs['data-nb-mic'];
    await xclickShadow(page, 'data-nb-mic');
    await sleep(600);
    const micMuted = (await shadowOne(page, 'data-nb-mic'))?.attrs['data-nb-mic'];
    await shootBar(ev, '2-muted', page);
    await sleep(2000);
    await xclickShadow(page, 'data-nb-mic');
    await sleep(600);
    const micBack = (await shadowOne(page, 'data-nb-mic'))?.attrs['data-nb-mic'];
    // a second microphone: look for any device control on the bar or the popup
    const deviceControls = (await shadowQuery(page, 'data-nb-mic-device')).length + (await shadowQuery(page, 'data-nb-mic-menu')).length + (await shadowQuery(page, 'data-nb-mic-pick')).length;
    // the bar's microphone picker (J-211): open it, list the devices, pick one, the recording goes on
    let deviceSwitch: Record<string, unknown> | null = null;
    if ((await shadowQuery(page, 'data-nb-mic-pick')).length) {
      await xclickShadow(page, 'data-nb-mic-pick');
      await sleep(800);
      const devices = await shadowQuery(page, 'data-nb-mic-device');
      if (devices.length) {
        await xclickShadow(page, 'data-nb-mic-device');
        await sleep(1000);
      }
      deviceSwitch = { menu: true, devices: devices.length, micAfterSwitch: (await shadowOne(page, 'data-nb-mic'))?.attrs['data-nb-mic'] ?? null, stillRecording: (await shadowQuery(page, 'data-nb-stop')).length > 0 };
      ev.set('step2-device-switch (J-211)', deviceSwitch);
    }
    await sleep(2000);
    await xclickShadow(page, 'data-nb-stop');
    const f = await editorFrame(page, 60_000);
    await f.getByTestId('field').click();
    await page.keyboard.type('parity S1.6 voice');
    const before = clipboard();
    await page.keyboard.press('Control+Enter');
    const link = (await until(async () => (clipboard() !== before && /\/s\//.test(clipboard()) ? clipboard() : ''), 60_000, 200)).value;
    const rec = await captureOf(b.context, link);
    await waitReady(b.context, rec.id);
    const events = await api<{ items: { offsetMs: number; event: { kind: string; data: Record<string, unknown> } }[] }>(b.context, 'GET', `/api/v1/recordings/${rec.id}/events?limit=500`);
    const micEvents = (events.body?.items ?? []).filter((x) => x.event.kind === 'media' && x.event.data?.stream === 'mic').map((x) => `${secs(x.offsetMs)}s:${String(x.event.data.mic ?? x.event.data.op)}`);
    const full = await api<{ streams?: { stream: string; bytes?: number; size?: number }[] }>(b.context, 'GET', `/api/v1/recordings/${rec.id}`);
    ev.set('step2-fake-mic (J-211)', {
      permissionTab: !!perm,
      permissionTabClosedItself: permClosed,
      pillAfterGrant,
      secondPillClickNeeded: secondClick,
      pillAfterSecondClick: pillAfterSecond,
      liveAfterMs: live.at - tRec,
      micStates: { start: micOn, afterMute: micMuted, afterUnmute: micBack },
      micEventsInCapture: micEvents,
      deviceSwitchControls: deviceControls,
      streams: full.body?.streams ?? null,
      capture: rec.id,
    });
  } finally {
    await b.close();
  }
  ev.set('load-end', load());
});
