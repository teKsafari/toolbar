// Parity group G2, Nib side: annotation, editor and submit (docs/parity/scenarios.md, S2.1 to
// S2.4). Each test is one scenario, run as scripted, and records its evidence (shape states,
// clicks, timings with the load average, screenshots) in e2e/parity-shots/G2/<scenario>.json and
// .png files. The raw results are written up in docs/parity/G2-replica.md.
//
//   cd e2e && PARITY_EXT_BUILD=chrome-mv3-g2 npx playwright test -c playwright.parity.config.ts G2
//   cd e2e && npx playwright test -c playwright.parity.config.ts G2 -g S2.3   # one
//
// Paused rows (docs/scope.md) are not run: S2.1 step 17 (J-079, destination menu) and S2.4
// steps 4 and 5 (J-083, J-230, AI ghost text).
//
// Input that a person gives goes through the X server (xdotool): the icon, the popup rows, the
// page click, every drag on the preview, the tool pill, the menus, the trim grip, and the keys
// (T, V, Delete, Escape, Ctrl+Z, Ctrl+Enter). Typing goes in as X key events too. The editor's
// shape list is read, never written, from the draft the editor autosaves to the extension's
// IndexedDB.
import { test, expect, type BrowserContext, type Frame, type Page, type Worker } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  Evidence,
  LAB_URL,
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
  labPage,
  meanDiff,
  launchNib,
  load,
  openPopup,
  popupBox,
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
  type Launched,
} from './rig.ts';

const GROUP = 'G2';
const EMAIL = process.env.PARITY_EMAIL ?? 'parity@example.com';

// ---------------------------------------------------------------- one signed-in browser

let rig: (Launched & { ws?: WsSetup }) | null = null;

interface WsSetup {
  firstId: string;
  firstName: string;
  parityId: string;
  folderInParity: string;
}

async function getRig(): Promise<Launched & { ws?: WsSetup }> {
  if (rig) return rig;
  rig = await launchNib();
  const { lab, popup } = await signIn(rig.context, EMAIL);
  await popup.close().catch(() => undefined);
  void lab;
  for (const p of rig.context.pages()) if (p.url().startsWith(SERVER)) await p.close().catch(() => undefined);
  return rig;
}

test.afterAll(async () => {
  await rig?.close();
  rig = null;
});

/**
 * S2.1 step 18 runs with a second workspace named "Parity" that holds a folder "parity" (S6.2
 * makes the folder on Jam). Made through the API when missing; the account's first workspace
 * stays the active one. The extension caches its bootstrap for 60 s; the cached copy is dropped
 * so the editor sees the new workspace (the same as waiting out the cache).
 */
async function ensureWorkspaces(context: BrowserContext, sw: () => Promise<Worker>, ev: Evidence): Promise<WsSetup> {
  type Ws = { id: string; name: string };
  const list = await api<{ items: Ws[]; activeId: string | null }>(context, 'GET', '/api/v1/workspaces');
  const items = list.body.items;
  const first = items.find((w) => w.id === list.body.activeId && w.name !== 'Parity') ?? items.find((w) => w.name !== 'Parity')!;
  let parity = items.find((w) => w.name === 'Parity');
  if (!parity) {
    const made = await api<Ws & { workspace?: Ws }>(context, 'POST', '/api/v1/workspaces', { name: 'Parity' });
    parity = made.body.workspace ?? made.body;
    ev.set('setup-workspace-made', { status: made.status, id: parity.id });
  }
  await api(context, 'PUT', '/api/v1/me/active-workspace', { workspaceId: first.id });
  for (const ws of [first, parity]) {
    const f = await api<{ items: { id: string; name: string }[] }>(context, 'GET', `/api/v1/workspaces/${ws.id}/folders`);
    if (!f.body.items.some((x) => x.name === 'parity')) {
      const made = await api(context, 'POST', `/api/v1/workspaces/${ws.id}/folders`, { name: 'parity' });
      ev.set(`setup-folder-made-in-${ws.name}`, made.status);
    }
  }
  const pf = await api<{ items: { id: string; name: string }[] }>(context, 'GET', `/api/v1/workspaces/${parity.id}/folders`);
  await (await sw()).evaluate(async () => {
    await chrome.storage.local.remove('nib:bootstrap');
  });
  const out = { firstId: first.id, firstName: first.name, parityId: parity.id, folderInParity: pf.body.items.find((x) => x.name === 'parity')!.id };
  ev.set('setup-workspaces', out);
  return out;
}

/** One fresh lab tab, the only page open (so the X window and the CDP view agree). */
async function freshLab(context: BrowserContext, p = '/'): Promise<Page> {
  const page = await context.newPage();
  for (const other of context.pages()) if (other !== page) await other.close().catch(() => undefined);
  await page.goto(LAB_URL + p);
  await page.waitForLoadState('networkidle');
  await focusWindow(page);
  return page;
}

async function session(sw: () => Promise<Worker>) {
  return (await (await sw()).evaluate(async () => (await chrome.storage.session.get('nib:session'))['nib:session'])) as { state: string; [k: string]: unknown } | undefined;
}

/** Drafts the extension keeps in IndexedDB (read only). */
interface DraftRow {
  id: string;
  kind: string;
  status: string;
  updatedAt: number;
  recordingId: string | null;
  title: string;
  description: string;
  folderId: string | null;
  workspaceId: string | null;
  trim: { startMs: number; endMs: number } | null;
  durationMs: number | null;
  annotations: { shapes: Shape[] }[];
  reopenedAt: number | null;
}
interface Shape {
  id: string;
  type: string;
  color: string;
  rot: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  bend?: number;
  text?: string;
  size?: number;
  sw?: number;
  pts?: number[][];
}

async function drafts(sw: () => Promise<Worker>): Promise<DraftRow[]> {
  return (await sw()).evaluate(
    () =>
      new Promise<DraftRow[]>((resolve, reject) => {
        const req = indexedDB.open('nib');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const all = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(all.result as DraftRow[]);
          };
          all.onerror = () => reject(all.error);
        };
      }),
  );
}

async function draftById(sw: () => Promise<Worker>, id: string) {
  return (await drafts(sw)).find((d) => d.id === id) ?? null;
}

/** The shapes of the open draft once the editor's autosave (400 ms) has run. */
async function shapes(sw: () => Promise<Worker>, id: string): Promise<Shape[]> {
  await sleep(900);
  return (await draftById(sw, id))?.annotations?.[0]?.shapes ?? [];
}

const hash = (t: string) => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
};

const round = (s: Shape) => {
  const o: Record<string, unknown> = { type: s.type, color: s.color };
  for (const k of ['x', 'y', 'w', 'h', 'x1', 'y1', 'x2', 'y2', 'bend', 'size', 'rot'] as const) if (typeof s[k] === 'number') o[k] = Math.round((s[k] as number) * 100) / 100;
  if (s.text !== undefined) o.text = s.text;
  if (s.pts) o.points = s.pts.length;
  return o;
};

/** The draft id the open editor shows. */
async function draftIdOf(f: Frame) {
  return new URL(f.url()).searchParams.get('draft') ?? '';
}

/** The annotation layer's box in the frame and its image size. */
async function layer(f: Frame) {
  return f.locator('svg[aria-label="Annotation layer"]').evaluate((el) => {
    const b = el.getBoundingClientRect();
    const vb = (el as SVGSVGElement).viewBox.baseVal;
    return { x: b.x, y: b.y, w: b.width, h: b.height, iw: vb.width, ih: vb.height, tool: el.getAttribute('data-active-tool') };
  });
}

/** Screen point of an image point of the preview (the editor frame covers the viewport). */
async function img(page: Page, f: Frame, p: { x: number; y: number }) {
  const l = await layer(f);
  return toScreen(page, { x: l.x + (p.x * l.w) / l.iw, y: l.y + (p.y * l.h) / l.ih });
}

/** A drag on the preview, in image coordinates, with real X input. */
async function dragImg(page: Page, f: Frame, a: { x: number; y: number }, b: { x: number; y: number }, steps = 14) {
  const sa = await img(page, f, a);
  const sb = await img(page, f, b);
  await xdrag(sa, sb, { steps, stepMs: 20 });
  await sleep(250);
}

async function clickImg(page: Page, f: Frame, p: { x: number; y: number }) {
  const s = await img(page, f, p);
  xclick(s.x, s.y);
  await sleep(250);
}

/** A real click on a control of the editor frame. */
async function xclickF(page: Page, f: Frame, sel: string) {
  await xclickEl(page, f.locator(sel).first());
  await sleep(250);
}

async function selectedIds(f: Frame) {
  return f.locator('[data-selection]').evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-selection')))]);
}

async function undoRedo(f: Frame) {
  return { undoDisabled: await f.getByTestId('undo').isDisabled(), redoDisabled: await f.getByTestId('redo').isDisabled() };
}

/** Grey pixels of a screen region, from the X server. */
function greyRegion(r: { x: number; y: number; w: number; h: number }): Buffer {
  return execFileSync('import', ['-window', 'root', '-crop', `${Math.round(r.w)}x${Math.round(r.h)}+${Math.round(r.x)}+${Math.round(r.y)}`, '+repage', '-colorspace', 'gray', '-depth', '8', 'gray:-'], {
    env: { ...process.env, DISPLAY: process.env.PARITY_DISPLAY ?? ':130' },
    maxBuffer: 16 << 20,
  });
}

/** Screen box of an image box of the preview. */
async function imgBox(page: Page, f: Frame, b: { x: number; y: number; w: number; h: number }) {
  const a = await img(page, f, { x: b.x, y: b.y });
  const c = await img(page, f, { x: b.x + b.w, y: b.y + b.h });
  return { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y };
}

/** Type text as X key events into the focused element. */
function xtype(text: string) {
  xdo('type', '--delay', '40', text);
}

/** Put text on the X clipboard. xclip stays behind to serve it, so no pipe may stay open. */
function setClipboard(text: string) {
  execFileSync('xclip', ['-selection', 'clipboard', '-i'], { input: text, stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, DISPLAY: process.env.PARITY_DISPLAY ?? ':130' } });
}

/** Arm screenshot mode the way a person does: icon, screenshot row. */
async function armScreenshot(context: BrowserContext, page: Page) {
  const popup = await clickIcon(context, page);
  await xclickPopup(popup, '[data-row-main="screenshot"]');
  await until(async () => (await shadowOne(page, 'data-nb-ui'))?.attrs['data-session'] === 'arming-screenshot', 10_000);
}

async function editorBox(f: Frame) {
  const b = (await f.getByTestId('editor').boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

async function editorToasts(f: Frame) {
  return f.locator('.nb-toast').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
}

async function pageToasts(page: Page) {
  // toasts carry data-kind (success, error, info) in the in-page UI's closed shadow root
  return (await shadowQuery(page, 'data-kind')).filter((n) => n.visible && (n.attrs.class ?? '').includes('nb-toast')).map((n) => n.text.replace(/\s+/g, ' '));
}

/** The lab layout in viewport pixels; the screenshot is the viewport at 1x, so image pixels too. */
async function labLayout(page: Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      const r = el!.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const status = document.querySelector('[data-testid="status"]')!;
    const line = document.createRange();
    line.selectNodeContents(status.parentElement!);
    const lr = line.getBoundingClientRect();
    const cards = [...document.querySelectorAll('section.card')];
    const card = (t: string) => box(cards.find((c) => c.querySelector('h2')?.textContent?.includes(t)) ?? null);
    return {
      statusLine: { x: Math.round(lr.x), y: Math.round(lr.y), w: Math.round(lr.width), h: Math.round(lr.height) },
      statusText: box(status),
      save: box(document.querySelector('[data-testid="works"]')),
      submit: box(document.querySelector('[data-testid="hidden-500"]')),
      buttonRow: box(document.querySelector('[data-testid="works"]')!.parentElement),
      consoleCard: card('Console'),
      modalCard: card('Modal'),
    };
  });
}

/** The capture page at 1440 and 390, light and dark. */
async function shootCapturePage(ev: Evidence, context: BrowserContext, id: string, step: string) {
  const cap = await context.newPage();
  const out: Record<string, unknown> = {};
  for (const [w, h] of [[1440, 900], [390, 844]] as const)
    for (const theme of ['light', 'dark'] as const) {
      await cap.setViewportSize({ width: w, height: h });
      await cap.emulateMedia({ colorScheme: theme });
      await cap.goto(`${SERVER}/c/${id}`);
      await cap.waitForLoadState('networkidle').catch(() => undefined);
      await sleep(1500);
      await cap.screenshot({ path: ev.file(step, String(w), theme) });
      out[`${w}-${theme}-overflow`] = await cap.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    }
  await cap.close();
  return out;
}

async function openMenu(popup: Page) {
  for (let i = 0; i < 3; i++) {
    await xclickPopup(popup, '[data-menu-button]');
    if (await popup.locator('[data-menu]').waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error('the popup menu did not open');
}

async function rowsOf(popup: Page) {
  return popup.locator('[data-row]').evaluateAll((els) =>
    els.map((e) => ({ id: e.getAttribute('data-row'), label: (e.querySelector('[data-row-main]')?.textContent ?? '').trim(), disabled: e.getAttribute('aria-disabled') === 'true' })),
  );
}

async function shootPopup(ev: Evidence, step: string, popup: Page) {
  await sleep(600);
  const b = await popupBox(popup);
  return ev.xshot(step, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 });
}

const FULL = { x: 0, y: 0, w: 1460, h: 1000 };

/** Tab order and the active tab of the window, from the extension's worker (read only). */
async function tabsOf(sw: () => Promise<Worker>) {
  return (await sw()).evaluate(async () => (await chrome.tabs.query({ currentWindow: true })).map((t) => ({ index: t.index, active: t.active, url: (t.url ?? t.pendingUrl ?? '').slice(0, 60) })));
}

// ================================================================ S2.1

test('S2.1 annotated screenshot to a link', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S2.1');
  const r = await getRig();
  const { context, sw } = r;
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  r.ws ??= await ensureWorkspaces(context, sw, ev);
  const clicks: Record<string, string> = {};

  // 1. load /, Submit order, Log at every level
  const page = await freshLab(context);
  const L = await labLayout(page);
  ev.set('lab-layout', L);
  await xclickEl(page, page.getByTestId('hidden-500'));
  await sleep(400);
  await xclickEl(page, page.getByTestId('console'));
  const tPreroll = Date.now();

  // 2. wait 20 s by the wall clock
  await sleep(20_000);
  ev.set('step2-waited-ms', Date.now() - tPreroll);

  // 3. arm from the popup, click the page; click to editor; modal box and split; caret in the title
  await armScreenshot(context, page);
  const c3 = await calm(60_000);
  const cast = await screencast(page);
  const pagePt = await toScreen(page, { x: 1200, y: 480 });
  xmove(pagePt.x - 20, pagePt.y - 10);
  await sleep(200);
  const t3 = Date.now();
  xclick(pagePt.x, pagePt.y);
  const f = await editorFrame(page);
  const domAt = Date.now();
  await f.getByTestId('field').waitFor();
  await sleep(1500);
  const frames = await cast.stop();
  const eb = await editorBox(f);
  const ref = frames.filter((x) => x.t <= domAt + 1200).pop() ?? frames[frames.length - 1]!;
  const first = firstMatching(frames, t3, eb, { ref });
  if (first) fs.writeFileSync(path.join(ev.dir, 'S2.1-3-first-editor-frame-nib-1440-light.jpg'), frames[first.index]!.jpeg);
  ev.set('step3-click-to-editor', { seconds: first ? secs(first.t - t3) : null, frameMs: first ? Math.round(first.t - t3) : null, domMs: domAt - t3, load: c3.load, reliable: c3.reliable });
  clicks['step3'] = '3 (icon, screenshot row, page)';
  const split = await f.evaluate(() => {
    const b = (s: string) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return { modal: b('[data-testid="editor"]'), media: b('.nb-ed-media'), form: b('.nb-ed-form'), viewport: { w: innerWidth, h: innerHeight } };
  });
  ev.set('step3-modal', { ...split, mediaShare: Math.round((split.media.w / split.modal.w) * 100), formShare: Math.round((split.form.w / split.modal.w) * 100) });
  const focus3 = await f.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return { testid: a?.getAttribute('data-testid') ?? null, editable: !!a?.isContentEditable, hasFocus: document.hasFocus() };
  });
  ev.set('step3-caret (J-077)', focus3);
  ev.set('step3-undo-redo-at-open', await undoRedo(f));
  ev.set('step3-image', await layer(f));
  ev.xshot('3-editor', FULL);
  const id = await draftIdOf(f);

  // 4. pen from the start: a stroke on the empty right side
  ev.set('step4-active-tool-at-open', (await layer(f)).tool);
  const penA = { x: 1060, y: 330 };
  const pts = [penA, { x: 1120, y: 300 }, { x: 1190, y: 345 }, { x: 1260, y: 305 }, { x: 1320, y: 340 }];
  {
    const s0 = await img(page, f, pts[0]!);
    xmove(s0.x - 10, s0.y);
    await sleep(100);
    xmove(s0.x, s0.y);
    xdo('mousedown', '1');
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      for (let k = 1; k <= 8; k++) {
        const s = await img(page, f, { x: a.x + ((b.x - a.x) * k) / 8, y: a.y + ((b.y - a.y) * k) / 8 });
        xmove(s.x, s.y);
        await sleep(15);
      }
    }
    xdo('mouseup', '1');
    await sleep(300);
  }
  let sh = await shapes(sw, id);
  const pen = sh.find((s) => s.type === 'pen');
  const penPath = await f.locator(`[data-shape="${pen?.id}"] path`).first().evaluate((p) => ({ fill: p.getAttribute('fill'), stroke: p.getAttribute('stroke'), quadratic: (p.getAttribute('d') ?? '').split('Q').length - 1, closed: (p.getAttribute('d') ?? '').trim().endsWith('Z') })).catch(() => null);
  ev.set('step4-pen (J-038)', { shape: pen ? round(pen) : null, path: penPath, toolAfter: (await layer(f)).tool });
  ev.xshot('4-pen', await imgBox(page, f, { x: 1020, y: 260, w: 340, h: 130 }));
  clicks['step4'] = '0 clicks, 1 drag (the pen is active at open)';

  // 5. rectangle around the status line; falls back to select with the box selected
  await xclickF(page, f, '[data-tool="rect"]');
  const rectBox = { x: L.statusLine.x - 8, y: L.statusLine.y - 7, w: L.statusLine.w + 16, h: L.statusLine.h + 14 };
  await dragImg(page, f, { x: rectBox.x, y: rectBox.y }, { x: rectBox.x + rectBox.w, y: rectBox.y + rectBox.h });
  sh = await shapes(sw, id);
  const rect = sh.find((s) => s.type === 'rect')!;
  ev.set('step5-rect (J-039)', { shape: round(rect), toolAfter: (await layer(f)).tool, selected: await selectedIds(f), selectedIsRect: (await selectedIds(f))[0] === rect.id });
  ev.xshot('5-rect', FULL);
  clicks['step5'] = '1 click (tool), 1 drag';

  // 6. ellipse: a wide box around Save
  await xclickF(page, f, '[data-tool="ellipse"]');
  await dragImg(page, f, { x: L.save.x - 12, y: L.save.y - 10 }, { x: L.save.x + L.save.w + 12, y: L.save.y + L.save.h + 10 });
  sh = await shapes(sw, id);
  const ell = sh.find((s) => s.type === 'ellipse')!;
  ev.set('step6-ellipse (J-040)', { shape: round(ell), ratio: Math.round((ell.w! / ell.h!) * 100) / 100, notCircle: Math.abs(ell.w! - ell.h!) > 10, toolAfter: (await layer(f)).tool });
  ev.xshot('6-ellipse', FULL);
  clicks['step6'] = '1 click, 1 drag';

  // 7. arrow from Submit order to the status line, then bend it by its middle handle
  await xclickF(page, f, '[data-tool="arrow"]');
  const arrA = { x: L.submit.x + L.submit.w / 2, y: L.submit.y };
  const arrB = { x: L.statusLine.x + L.statusLine.w + 12, y: L.statusLine.y + L.statusLine.h / 2 };
  await dragImg(page, f, arrA, arrB);
  sh = await shapes(sw, id);
  let arrow = sh.find((s) => s.type === 'arrow')!;
  const before7 = round(arrow);
  const mid = { x: (arrow.x1! + arrow.x2!) / 2, y: (arrow.y1! + arrow.y2!) / 2 };
  await dragImg(page, f, mid, { x: mid.x + 60, y: mid.y + 60 }, 10);
  sh = await shapes(sw, id);
  arrow = sh.find((s) => s.type === 'arrow')!;
  ev.set('step7-arrow (J-041)', { before: before7, after: round(arrow), bends: Math.abs(arrow.bend ?? 0) > 5, toolAfter: (await layer(f)).tool });
  ev.xshot('7-arrow', FULL);
  clicks['step7'] = '1 click, 2 drags (draw, bend)';

  // 8. line under the console card
  await xclickF(page, f, '[data-tool="line"]');
  const lineY = L.consoleCard.y + L.consoleCard.h + 8;
  await dragImg(page, f, { x: L.consoleCard.x + 10, y: lineY }, { x: L.consoleCard.x + 380, y: lineY });
  sh = await shapes(sw, id);
  const line = sh.find((s) => s.type === 'line')!;
  ev.set('step8-line (J-042)', { shape: round(line), straight: (line.bend ?? 0) === 0 && Math.abs(line.y1! - line.y2!) < 3 });
  ev.xshot('8-line', FULL);
  clicks['step8'] = '1 click, 1 drag';

  // 9. T, click above the modal card, type, click elsewhere; double-click edits with the text selected; Escape
  await focusWindow(page);
  xkey('t');
  await sleep(300);
  const toolT = (await layer(f)).tool;
  const textAt = { x: L.modalCard.x + 560, y: L.modalCard.y - 2 };
  await clickImg(page, f, textAt);
  const editorUp = await f.getByTestId('text-editor').isVisible().catch(() => false);
  xtype('500 here');
  await sleep(300);
  await clickImg(page, f, { x: 1300, y: 820 }); // empty space
  sh = await shapes(sw, id);
  const text = sh.find((s) => s.type === 'text');
  ev.set('step9-text-placed (J-043)', { toolAfterKeyT: toolT, editorOpened: editorUp, shape: text ? round(text) : null, toolAfter: (await layer(f)).tool });
  // double-click the label
  const tCentre = text ? { x: text.x! + 30, y: text.y! + text.size! * 0.7 } : textAt;
  const ts = await img(page, f, tCentre);
  xmove(ts.x, ts.y);
  await sleep(150);
  xdo('click', '--repeat', '2', '--delay', '90', '1');
  await sleep(500);
  const dbl = await f.evaluate(() => {
    const ed = document.querySelector('[data-testid="text-editor"]') as HTMLElement | null;
    return { editing: !!ed, text: ed?.innerText ?? null, selection: document.getSelection()?.toString() ?? '' };
  });
  ev.xshot('9-text-edit', FULL);
  xkey('Escape');
  await sleep(500);
  ev.set('step9-double-click', { ...dbl, allSelected: !!dbl.text && dbl.selection.trim() === dbl.text.trim(), editorAfterEscape: await f.getByTestId('text-editor').count(), draftStillOpen: hasEditor(page) });
  clicks['step9'] = '1 key (T) + 1 click + typing + 1 click to finish; edit: 1 double-click';

  // 10. blur over the status text, then move the box 100 px right: the old spot is sharp again
  await xclickF(page, f, '[data-tool="blur"]');
  const bz = { x: L.statusText.x - 10, y: L.statusText.y - 6, w: L.statusText.w + 60, h: L.statusText.h + 12 };
  const ob = await imgBox(page, f, bz);
  const oldSpot = { x: ob.x + 7, y: ob.y + 7, w: ob.w - 14, h: ob.h - 14 };
  const sharpBefore = greyRegion(oldSpot);
  await dragImg(page, f, { x: bz.x, y: bz.y }, { x: bz.x + bz.w, y: bz.y + bz.h });
  await sleep(300);
  const sharpBlurred = greyRegion(oldSpot);
  sh = await shapes(sw, id);
  const blur0 = round(sh.find((s) => s.type === 'blur')!);
  ev.xshot('10-blur', await imgBox(page, f, { x: 0, y: 120, w: 500, h: 100 }));
  const lay = await layer(f);
  const px100 = (100 * lay.iw) / lay.w; // 100 screen px in image px
  {
    const c = { x: bz.x + bz.w / 2, y: bz.y + bz.h / 2 };
    const sa = await img(page, f, c);
    await xdrag(sa, { x: sa.x + 100, y: sa.y }, { steps: 12, stepMs: 25 });
    await sleep(400);
  }
  const sharpAfter = greyRegion(oldSpot);
  sh = await shapes(sw, id);
  const blur1 = round(sh.find((s) => s.type === 'blur')!);
  ev.set('step10-blur (J-044)', { before: blur0, after: blur1, movedImagePx: Math.round(((blur1.x as number) - (blur0.x as number)) * 10) / 10, screenPx: 100, imagePxFor100: Math.round(px100), oldSpotScreen: oldSpot, meanGreyDiffFromSharp: { whileBlurred: Math.round(meanDiff(sharpBefore, sharpBlurred) * 10) / 10, afterMove: Math.round(meanDiff(sharpBefore, sharpAfter) * 10) / 10 } });
  ev.xshot('10-blur-moved', await imgBox(page, f, { x: 0, y: 120, w: 500, h: 100 }));
  clicks['step10'] = '1 click, 2 drags';

  // 11. select the rectangle, colour dot, red
  await focusWindow(page);
  xkey('v');
  await sleep(200);
  sh = await shapes(sw, id);
  const rectNow = sh.find((s) => s.type === 'rect')!;
  await clickImg(page, f, { x: rectNow.x!, y: rectNow.y! + rectNow.h! / 2 }); // its left edge
  const selRect = (await selectedIds(f))[0] === rectNow.id;
  await xclickF(page, f, '[data-testid="colour-dot"]');
  await f.getByTestId('palette').waitFor();
  const swatches = await f.locator('[data-testid="palette"] [data-colour]').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label')}:${e.getAttribute('data-colour')}`));
  ev.xshot('11-palette', FULL);
  await xclickF(page, f, '[data-testid="palette"] [aria-label="Red"]');
  sh = await shapes(sw, id);
  const red = swatches.find((s) => s.startsWith('Red:'))?.split(':')[1];
  ev.set('step11-colour (J-045)', { rectSelected: selRect, swatches, rectColour: sh.find((s) => s.type === 'rect')!.color, red, rectIsRed: sh.find((s) => s.type === 'rect')!.color === red, dotNow: await f.locator('[data-testid="colour-dot"] [data-colour]').getAttribute('data-colour') });
  clicks['step11'] = '1 click to select, 2 clicks (dot, swatch)';

  // 12. V; move the rectangle 40 px, resize from a corner, rotate outside a corner; resize the text: its font scales
  xkey('v');
  await sleep(200);
  sh = await shapes(sw, id);
  let r0 = sh.find((s) => s.type === 'rect')!;
  // press on the top edge a third of the way along (the handles sit on corners and mid-edges)
  await dragImg(page, f, { x: r0.x! + r0.w! / 3, y: r0.y! }, { x: r0.x! + r0.w! / 3 + 40, y: r0.y! });
  sh = await shapes(sw, id);
  const r1 = sh.find((s) => s.type === 'rect')!;
  await dragImg(page, f, { x: r1.x! + r1.w!, y: r1.y! + r1.h! }, { x: r1.x! + r1.w! + 30, y: r1.y! + r1.h! + 20 }, 8);
  sh = await shapes(sw, id);
  const r2 = sh.find((s) => s.type === 'rect')!;
  const l12 = await layer(f);
  const k = l12.iw / l12.w; // image px per screen px
  const ne = { x: r2.x! + r2.w! + 9 * k, y: r2.y! - 9 * k };
  await dragImg(page, f, ne, { x: ne.x + 10 * k, y: ne.y + 90 * k }, 10);
  sh = await shapes(sw, id);
  const r3 = sh.find((s) => s.type === 'rect')!;
  ev.set('step12-rect (J-046)', { start: round(r0), moved: round(r1), resized: round(r2), rotated: round(r3), moveDx: Math.round(r1.x! - r0.x!), resizeDw: Math.round(r2.w! - r1.w!), rotDeg: Math.round((r3.rot * 180) / Math.PI) });
  ev.xshot('12-rect', FULL);
  const t0 = sh.find((s) => s.type === 'text')!;
  await clickImg(page, f, { x: t0.x! + 20, y: t0.y! + t0.size! * 0.6 });
  const selText = (await selectedIds(f))[0] === t0.id;
  const tb = await f.locator(`[data-selection="${t0.id}"] [data-handle="se"]`).evaluate((h) => ({ x: Number(h.getAttribute('x')) + Number(h.getAttribute('width')) / 2, y: Number(h.getAttribute('y')) + Number(h.getAttribute('height')) / 2 })).catch(() => null);
  if (tb) await dragImg(page, f, tb, { x: tb.x + 40, y: tb.y + 20 }, 8);
  sh = await shapes(sw, id);
  const t1 = sh.find((s) => s.type === 'text')!;
  ev.set('step12-text (J-046)', { selected: selText, before: round(t0), after: round(t1), fontScaled: (t1.size ?? 0) > (t0.size ?? 0) });
  ev.xshot('12-text', FULL);
  r0 = r3;
  clicks['step12'] = '1 key (V), 1 click to select, 3 drags on the rectangle; 1 click and 1 drag on the text';

  // 13. a marquee from empty space that touches the ellipse and the line
  sh = await shapes(sw, id);
  const e13 = sh.find((s) => s.type === 'ellipse')!;
  const l13 = sh.find((s) => s.type === 'line')!;
  const mA = { x: Math.max(3, e13.x! - 15), y: e13.y! + e13.h! - 8 };
  const mB = { x: e13.x! + 30, y: l13.y1! + 4 };
  await dragImg(page, f, mA, mB);
  const sel13 = await selectedIds(f);
  const typesSel = sel13.map((s) => sh.find((x) => x.id === s)?.type);
  ev.set('step13-marquee (J-047)', { from: mA, to: mB, selected: typesSel });
  ev.xshot('13-marquee', FULL);
  clicks['step13'] = '1 drag';

  // 14. Delete, then Ctrl+Z
  const n14 = sh.length;
  xkey('Delete');
  const after14 = await shapes(sw, id);
  xkey('ctrl+z');
  const back14 = await shapes(sw, id);
  ev.set('step14-delete-undo (J-048)', { before: n14, afterDelete: after14.length, afterUndo: back14.length, sameTypes: JSON.stringify(back14.map((s) => s.type).sort()) === JSON.stringify(sh.map((s) => s.type).sort()) });
  clicks['step14'] = '2 keys (Delete, Ctrl+Z)';

  // 15. undo three times, redo three times, with the buttons
  const seq: Record<string, unknown>[] = [];
  for (const b of ['undo', 'undo', 'undo', 'redo', 'redo', 'redo'] as const) {
    await xclickF(page, f, `[data-testid="${b}"]`);
    const s = await shapes(sw, id);
    seq.push({ click: b, shapes: s.length, state: s.map((x) => JSON.stringify(round(x))).join('|').length + ':' + hash(s.map((x) => JSON.stringify(round(x))).join('|')), ...(await undoRedo(f)) });
  }
  ev.set('step15-undo-redo (J-049)', seq);
  ev.xshot('15-after-redo', FULL);
  clicks['step15'] = '6 clicks';

  // 16. title and a second line
  await xclickEl(page, f.getByTestId('field'));
  await sleep(200);
  xtype('parity S2.1 annotated');
  xkey('Return');
  xtype('pre-roll check');
  await sleep(700);
  const d16 = await draftById(sw, id);
  ev.set('step16-text', { title: d16?.title, description: d16?.description });

  // 17. destination menu: paused (J-079, docs/scope.md), not run
  ev.set('step17', 'paused (J-079): not run; the destination stays on the share link');

  // 18. the workspace menu with a second workspace; pick "Parity"
  await xclickF(page, f, '[data-testid="workspace"]');
  await f.locator('[role="menu"][aria-label="Workspace"]').waitFor();
  const wsItems = await f.locator('[role="menu"][aria-label="Workspace"] [role="menuitemradio"]').evaluateAll((els) => els.map((e) => `${(e.textContent ?? '').trim()}${e.getAttribute('aria-checked') === 'true' ? ' (current)' : ''}`));
  ev.xshot('18-workspace-menu', FULL);
  await xclickEl(page, f.locator('[role="menu"][aria-label="Workspace"] [role="menuitemradio"]', { hasText: /^\s*Parity\s*$/ }).first());
  await sleep(800);
  ev.set('step18-workspace (J-080)', { items: wsItems, after: await f.getByTestId('workspace').getAttribute('aria-label') });
  clicks['step18'] = '2 clicks (menu, Parity)';

  // 19. folder button, "parity", the chip
  await xclickF(page, f, '[data-testid="folder"]');
  await f.locator('[role="menu"][aria-label="Folder"]').waitFor();
  const fItems = await f.locator('[role="menu"][aria-label="Folder"] [role="menuitemradio"]').allTextContents();
  await xclickEl(page, f.locator('[role="menu"][aria-label="Folder"] [role="menuitemradio"]', { hasText: /^\s*parity\s*$/ }).first());
  await sleep(500);
  const chip = await f.getByTestId('folder').evaluate((e) => ({ text: (e.textContent ?? '').trim(), set: e.classList.contains('nb-set') }));
  ev.set('step19-folder (J-081)', { items: fItems.map((s) => s.trim()), chip });
  const chipBox = (await f.getByTestId('folder').boundingBox())!;
  const chipS = await toScreen(page, { x: chipBox.x, y: chipBox.y });
  ev.xshot('19-folder-chip', { x: chipS.x - 120, y: chipS.y - 60, w: 520, h: 120 });
  clicks['step19'] = '2 clicks (folder, parity)';

  // 20. caret in the description, Ctrl+Enter. Clipboard permission grants of the rig are cleared
  // first, so a prompt would show (J-202).
  await context.clearPermissions();
  await xclickEl(page, f.getByTestId('field'));
  xkey('ctrl+End');
  await sleep(300);
  const caret20 = await f.evaluate(() => {
    const s = document.getSelection();
    const field = document.querySelector('[data-testid="field"]')!;
    const r = s && s.rangeCount ? s.getRangeAt(0) : null;
    if (!r) return null;
    const pre = document.createRange();
    pre.selectNodeContents(field);
    pre.setEnd(r.endContainer, r.endOffset);
    const before = pre.toString();
    return { offset: before.length, inDescription: before.includes('pre-roll'), fieldFocused: document.activeElement === field };
  });
  ev.set('step20-caret', caret20);
  setClipboard('before-S2.1');
  await sleep(200);
  const c20 = await calm(60_000);
  const tabsBefore = await tabsOf(sw);
  const newPage = context.waitForEvent('page', { timeout: 60_000 });
  const t20 = Date.now();
  xkey('ctrl+Return');
  let pageAt = 0;
  void newPage.then(() => (pageAt = Date.now()));
  const linkSeen = await until(async () => (/\/s\//.test(clipboard()) ? clipboard() : ''), 60_000, 40);
  const capPage = await newPage;
  // 21. the toast; Ctrl+Enter to the link and to the background tab; the tab sits right of the source
  const toast = await until(async () => ((await pageToasts(page)).join(' ') || null), 10_000, 50).catch(() => null);
  ev.xshot('21-toast', FULL);
  const toastGone = toast ? await until(async () => !(await pageToasts(page)).length, 20_000, 200).catch(() => null) : null;
  const tabsAfter = await tabsOf(sw);
  ev.set('step21-create (J-086, J-197)', {
    toLinkOnClipboard: { seconds: secs(linkSeen.at - t20), ms: linkSeen.at - t20 },
    toNewTab: pageAt ? { seconds: secs(pageAt - t20), ms: pageAt - t20 } : null,
    load: c20.load,
    reliable: c20.reliable,
    link: linkSeen.value,
    toast: toast?.value ?? null,
    toastSeenAfterMs: toast ? toast.at - t20 : null,
    toastShownMs: toast && toastGone ? toastGone.at - toast.at : null,
    tabsBefore,
    tabsAfter,
  });
  clicks['step20'] = '1 click (into the description), 1 chord (Ctrl+Enter)';
  // 22. clipboard prompt: the screen top after create (any Chrome permission bubble would show there)
  await sleep(800);
  ev.xshot('22-browser-top', { x: 0, y: 0, w: 1460, h: 260 });
  const bubble = (() => {
    try {
      return xdo('search', '--onlyvisible', '--name', 'clipboard');
    } catch {
      return '';
    }
  })();
  ev.set('step22-clipboard-prompt (J-202)', { xWindowNamedClipboard: bubble || 'none', note: 'see S2.1-22-browser-top shot' });

  // 23. the capture: marks burned into one image, nothing editable
  const rec = await captureOf(context, linkSeen.value);
  await waitReady(context, rec.id);
  const full = await api<Record<string, unknown>>(context, 'GET', `/api/v1/recordings/${rec.id}`);
  await capPage.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(1500);
  const capView = await capPage.evaluate(() => ({
    url: location.href,
    images: [...document.querySelectorAll('[data-testid="media"] img, main img')].map((i) => ({ w: (i as HTMLImageElement).naturalWidth, h: (i as HTMLImageElement).naturalHeight, src: (i as HTMLImageElement).src.replace(location.origin, '').slice(0, 80) })),
    svgShapes: document.querySelectorAll('[data-shape], [data-testid="annotator"], [data-testid="tool-pill"]').length,
    contentEditable: document.querySelectorAll('[data-testid="media"] [contenteditable]').length,
  }));
  ev.set('step23-capture (J-051)', { id: rec.id, kind: rec.kind, title: rec.title, workspaceId: full.body.workspaceId, folderId: full.body.folderId, folderIsParityInParity: full.body.folderId === r.ws.folderInParity, view: capView, detailKeys: Object.keys(full.body) });
  fs.writeFileSync(path.join(ev.dir, 'S2.1-23-recording.json'), JSON.stringify(full.body, null, 2));
  ev.set('step23-capture-pages', await shootCapturePage(ev, context, rec.id, '23-capture-page'));
  await capPage.close().catch(() => undefined);

  // 24. a fresh screenshot draft: the folder picker shows "parity" again; discard
  await focusWindow(page);
  await armScreenshot(context, page);
  const p24 = await toScreen(page, { x: 1200, y: 480 });
  xclick(p24.x, p24.y);
  const f24 = await editorFrame(page);
  await f24.getByTestId('field').waitFor();
  await sleep(1500);
  ev.set('step24-fresh-draft (J-081)', { folderChip: (await f24.getByTestId('folder').textContent().catch(() => ''))?.trim(), workspace: await f24.getByTestId('workspace').getAttribute('aria-label'), colourDot: await f24.locator('[data-testid="colour-dot"] [data-colour]').getAttribute('data-colour') });
  ev.xshot('24-fresh-draft', FULL);
  await xclickEl(page, f24.getByTestId('close'));
  await until(async () => !hasEditor(page), 10_000);
  ev.set('clicks', clicks);
  ev.set('load-end', load());
});

// ================================================================ S2.2

test('S2.2 area screenshot with the full viewport kept', async () => {
  test.setTimeout(600_000);
  const ev = new Evidence(GROUP, 'S2.2');
  const r = await getRig();
  const { context, sw } = r;
  ev.set('load-start', load());
  const page = await freshLab(context);
  const L = await labLayout(page);
  const area = { x: L.buttonRow.x - 10, y: L.buttonRow.y - 10, w: L.buttonRow.w + 20, h: L.buttonRow.h + 20 };
  ev.set('area', area);

  const one = async (keep: boolean, title: string, tag: string) => {
    // 1. arm, drag a box over the button row
    await armScreenshot(context, page);
    const a = await toScreen(page, { x: area.x, y: area.y });
    const b = await toScreen(page, { x: area.x + area.w, y: area.y + area.h });
    const c = await calm(60_000);
    await xdrag(a, b, { steps: 15 });
    const t = Date.now();
    const f = await editorFrame(page);
    const domMs = Date.now() - t;
    await f.getByTestId('field').waitFor();
    await sleep(1200);
    // 2. the thumbnail with a ticked box
    const thumb = await f.getByTestId('keep-full').evaluate((el) => {
      const i = el.querySelector('img') as HTMLImageElement;
      const r = el.getBoundingClientRect();
      return { box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, thumb: { w: i.naturalWidth, h: i.naturalHeight, shownW: Math.round(i.getBoundingClientRect().width), shownH: Math.round(i.getBoundingClientRect().height) }, label: (el.textContent ?? '').trim() };
    }).catch(() => null);
    const checked0 = await f.getByTestId('keep-full-check').isChecked().catch(() => null);
    ev.set(`${tag}-draft (J-004)`, { releaseToEditorDomMs: domMs, load: c.load, crop: await layer(f), thumbnail: thumb, ticked: checked0 });
    ev.xshot(`2-draft-${tag}`, FULL);
    // 3. untick and tick again (real clicks)
    await xclickF(page, f, '[data-testid="keep-full-check"]');
    const c1 = await f.getByTestId('keep-full-check').isChecked();
    if (keep) await xclickF(page, f, '[data-testid="keep-full-check"]');
    const c2 = await f.getByTestId('keep-full-check').isChecked();
    ev.set(`${tag}-toggle`, { afterFirstClick: c1, final: c2 });
    // 4. title, create with the button
    await xclickEl(page, f.getByTestId('field'));
    xtype(title);
    await sleep(500);
    setClipboard(`before-${tag}`);
    const pageEv = context.waitForEvent('page', { timeout: 60_000 }).catch(() => null);
    await xclickF(page, f, '[data-testid="create"]');
    const link = (await until(async () => (/\/s\//.test(clipboard()) ? clipboard() : ''), 60_000, 100)).value;
    const cp = await pageEv;
    await cp?.close().catch(() => undefined);
    const rec = await captureOf(context, link);
    await waitReady(context, rec.id);
    const full = await api<Record<string, unknown>>(context, 'GET', `/api/v1/recordings/${rec.id}`);
    fs.writeFileSync(path.join(ev.dir, `S2.2-${tag}-recording.json`), JSON.stringify(full.body, null, 2));
    const cap = await context.newPage();
    await cap.setViewportSize({ width: 1440, height: 900 });
    await cap.goto(`${SERVER}/c/${rec.id}`);
    await cap.waitForLoadState('networkidle').catch(() => undefined);
    await sleep(1500);
    const imgs = await cap.evaluate(() => [...document.querySelectorAll('main img, [data-testid="media"] img')].map((i) => ({ w: (i as HTMLImageElement).naturalWidth, h: (i as HTMLImageElement).naturalHeight, alt: (i as HTMLImageElement).alt })));
    const toggles = await cap.locator('button, [role="tab"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter((t) => /full|crop|area|view/i.test(t)));
    await cap.screenshot({ path: ev.file(`4-capture-${tag}`) });
    await cap.close();
    ev.set(`${tag}-capture`, { id: rec.id, link, images: imgs, viewToggles: toggles });
    await focusWindow(page);
    void sw;
    return rec.id;
  };
  ev.set('ids', { kept: await one(true, 'parity S2.2 area', 'kept'), unticked: await one(false, 'parity S2.2 area unticked', 'unticked') });
  ev.set('clicks', 'arm 2 + 1 drag; untick and tick 2; create 1 (plus a click into the title)');
  ev.set('load-end', load());
});

// ================================================================ S2.3

test('S2.3 discard a screenshot draft', async () => {
  test.setTimeout(600_000);
  const ev = new Evidence(GROUP, 'S2.3');
  const { context, sw } = await getRig();
  ev.set('load-start', load());
  const page = await freshLab(context);
  const n0 = (await drafts(sw)).length;

  // 1. arm, click the page, draw one rectangle
  await armScreenshot(context, page);
  const p = await toScreen(page, { x: 1200, y: 480 });
  xclick(p.x, p.y);
  let f = await editorFrame(page);
  await f.getByTestId('field').waitFor();
  await sleep(800);
  await xclickF(page, f, '[data-tool="rect"]');
  await dragImg(page, f, { x: 300, y: 300 }, { x: 600, y: 450 });
  const id1 = await draftIdOf(f);
  const sh = await shapes(sw, id1);
  // 2. close: gone at once, no confirmation
  const t2 = Date.now();
  await xclickEl(page, f.getByTestId('close'));
  const gone = await until(async () => !hasEditor(page), 5000, 30).catch(() => null);
  ev.set('step2-close', { shapesBefore: sh.length, closedMs: gone ? gone.at - t2 : null, confirmShown: !gone, draftLeft: !!(await draftById(sw, id1)), session: (await session(sw))?.state });

  // 3. another screenshot; Escape once: a toast asks for a second press; wait 2 s: the draft stays
  await armScreenshot(context, page);
  xclick(p.x, p.y);
  f = await editorFrame(page);
  await f.getByTestId('field').waitFor();
  await sleep(1200);
  // keys go to the editor, as after a click on the preview
  await clickImg(page, f, { x: 1300, y: 820 });
  await focusWindow(page);
  xkey('Escape');
  await sleep(250);
  const toast = await editorToasts(f);
  ev.xshot('3-escape-toast', FULL);
  await sleep(2000);
  ev.set('step3-escape-once (J-088)', { toast, editorStill: hasEditor(page), toastAfter2s: await editorToasts(f).catch(() => []) });

  // 4. Escape twice within 0.5 s: the draft goes
  const id2 = await draftIdOf(f);
  const t4 = Date.now();
  xdo('key', '--delay', '250', 'Escape', 'Escape');
  const gone4 = await until(async () => !hasEditor(page), 5000, 30).catch(() => null);
  ev.set('step4-escape-twice', { gapMs: 250, closedMs: gone4 ? gone4.at - t4 : null, draftLeft: !!(await draftById(sw, id2)) });

  // 5. the icon: no draft pill
  const popup = await clickIcon(context, page);
  const pill = await popup.locator('[data-drafts-pill]').count();
  ev.set('step5-popup', { draftPill: pill, pillCount: pill ? await popup.locator('[data-drafts-pill]').getAttribute('data-drafts-pill') : null, rows: await rowsOf(popup), draftsInDb: (await drafts(sw)).length, draftsBefore: n0 });
  await shootPopup(ev, '5-popup', popup);
  await popup.close().catch(() => undefined);
  ev.set('clicks', 'step 1: 3 + 1 tool click + 1 drag; step 2: 1 click; step 3: 1 key; step 4: 2 keys; step 5: 1 click');
  ev.set('load-end', load());
});

// ================================================================ S2.4

test('S2.4 video draft: preview, trim, save for later, create', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S2.4');
  const { context, sw } = await getRig();
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  const clicks: Record<string, string> = {};

  // Prelude (S1.2 on Jam makes N2): a tab recording with Submit order early on, stopped, then the
  // extension restarted from the popup menu so the draft waits in the drafts list.
  let page = await freshLab(context);
  let popup = await clickIcon(context, page);
  await xclickPopup(popup, '[data-row-main="record"]');
  const live = await until(async () => (await shadowOne(page, 'data-nb-bar'))?.attrs['data-state'] === 'recording', 30_000, 50);
  await sleep(3000);
  const tSubmit = Date.now();
  await xclickEl(page, page.getByTestId('hidden-500'));
  await sleep(6000);
  await xclickEl(page, page.getByTestId('works'));
  await sleep(500);
  await xclickEl(page, page.getByTestId('console'));
  await sleep(9000);
  const stopN = (await shadowQuery(page, 'data-nb-stop')).find((n) => n.visible)!;
  const sp = await toScreen(page, { x: stopN.box.x + stopN.box.w / 2, y: stopN.box.y + stopN.box.h / 2 });
  const tStop = Date.now();
  xclick(sp.x, sp.y);
  const f0 = await editorFrame(page, 60_000);
  await f0.getByTestId('length').waitFor();
  const draftId = await draftIdOf(f0);
  ev.set('prelude', { submitAtMs: tSubmit - live.at, wallMs: tStop - live.at, draftId, length: (await f0.getByTestId('length').textContent())?.trim() });
  popup = await clickIcon(context, page);
  await openMenu(popup);
  await xclickPopup(popup, '[data-menu-item="restart"]');
  const closed = await until(async () => !hasEditor(page), 8000, 100).catch(() => null);
  ev.set('prelude-restart', closed ? 'editor closed' : 'the editor frame stayed over the page (G1 bug 2); page reloaded before step 1');
  await sleep(2000);
  // the restart reopens the popup by itself (G1); close it
  const port = (context as BrowserContext & { __cdpPort?: number }).__cdpPort;
  const openNow = ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { url: string }[]).some((t) => t.url.includes('/popup.html'));
  if (openNow) {
    const { popup: pp } = await openPopup(context, page);
    await pp.close().catch(() => undefined);
  }
  // the old content script is orphaned by the restart; a reload gives the page a live one
  await focusWindow(page);
  xkey('ctrl+r');
  await page.waitForLoadState('networkidle');
  await sleep(1000);

  const reopen = async (step: string) => {
    const { popup: pp } = await openPopup(context, page);
    const pill = pp.locator('[data-drafts-pill]');
    const pillState = { count: await pill.getAttribute('data-drafts-pill').catch(() => null), disabled: await pill.isDisabled().catch(() => null) };
    await xclickPopup(pp, '[data-drafts-pill]');
    await pp.locator('[data-screen="drafts"]').waitFor();
    await shootPopup(ev, `${step}-drafts`, pp);
    await xclickPopup(pp, `[data-draft-view="${draftId}"]`);
    const found = await until(async () => {
      for (const pg of context.pages()) {
        const fr = pg.frames().find((x) => x.url().includes('/editor.html') && x.url().includes(encodeURIComponent(draftId)));
        if (fr) return { pg, fr };
      }
      return null;
    }, 30_000, 100);
    if (!found.value) throw new Error('the editor did not reopen from the drafts list');
    page = found.value.pg;
    await found.value.fr.getByTestId('length').waitFor();
    await sleep(1000);
    return { f: found.value.fr, pillState };
  };

  // 1. icon, pill, View: the editor reopens with the video
  let { f, pillState } = await reopen('1');
  ev.set('step1-reopen', { pill: pillState, kind: await f.getByTestId('editor').getAttribute('data-kind'), video: await f.getByTestId('draft-video').count(), closeLabel: (await f.getByTestId('close').textContent())?.trim() });
  clicks['step1'] = '3 (icon, pill, View)';

  // 2. no annotation tools, only play and trim
  ev.set('step2-tools (J-240)', { toolPill: await f.getByTestId('tool-pill').count(), play: await f.getByTestId('play').count(), trimTrack: await f.getByTestId('trim-track').count(), grips: await f.locator('[data-testid^="grip-"]').count() });
  ev.xshot('2-video-editor', FULL);

  // 3. play starts at the left handle; a click on the video pauses; a click halfway seeks; the length
  const vstate = () => f.evaluate(() => { const v = document.querySelector('video')!; return { t: Math.round(v.currentTime * 100) / 100, paused: v.paused, duration: v.duration }; });
  const track = async () => (await f.getByTestId('trim-track').boundingBox())!;
  const trimNow = async () => (await draftById(sw, draftId))?.trim ?? null;
  const s0 = await vstate();
  await xclickF(page, f, '[data-testid="play"]');
  await sleep(150);
  const sPlay = await vstate();
  await sleep(1500);
  const sPlaying = await vstate();
  await xclickF(page, f, '[data-testid="draft-video"]');
  const sPaused = await vstate();
  await sleep(600);
  const sPaused2 = await vstate();
  const tr = await track();
  const half = await toScreen(page, { x: tr.x + tr.width / 2, y: tr.y + tr.height / 2 });
  xclick(half.x, half.y);
  await sleep(600);
  const sSeek = await vstate();
  const durationMs = Number(await f.getByTestId('trim-track').getAttribute('aria-valuemax'));
  ev.set('step3-playback (J-084)', { start: s0, justAfterPlay: sPlay, after1500ms: sPlaying, afterVideoClick: sPaused, stillPausedAfter600: sPaused2, afterHalfwayClick: sSeek, durationMs, halfMs: durationMs / 2, length: (await f.getByTestId('length').textContent())?.trim(), trim: await trimNow() });
  ev.xshot('3-playback', FULL);
  clicks['step3'] = '3 (play, video, track)';

  // 4 and 5: AI ghost text, paused (J-083, J-230)
  ev.set('step4-5', 'paused (J-083, J-230): not run');

  // 6. close: on a reopened video draft it saves for later; toast with View; the popup
  await xclickF(page, f, '[data-testid="close"]');
  await until(async () => !hasEditor(page), 10_000, 50);
  const toast6 = await until(async () => ((await pageToasts(page)).join(' ') || null), 5000, 50).catch(() => null);
  ev.xshot('6-saved-toast', FULL);
  const viewBtn = (await shadowQuery(page, 'data-nb-editor-toasts')).length ? 'toast region present' : 'none';
  const d6 = await draftById(sw, draftId);
  popup = await clickIcon(context, page);
  ev.set('step6-save-for-later (J-219)', { toast: toast6?.value ?? null, region: viewBtn, draftStatus: d6?.status, pill: { count: await popup.locator('[data-drafts-pill]').getAttribute('data-drafts-pill').catch(() => null), disabled: await popup.locator('[data-drafts-pill]').isDisabled().catch(() => null) }, rows: await rowsOf(popup) });
  await shootPopup(ev, '6-popup', popup);
  clicks['step6'] = '1 (close); popup check 1 (icon)';

  // 7. while saved, the capture is not listed
  const listed = await api<{ items: { id: string }[] }>(context, 'GET', '/api/v1/recordings?limit=100');
  ev.set('step7-not-listed (J-189)', { recordingId: d6?.recordingId, listed: (listed.body.items ?? []).some((x) => x.id === d6?.recordingId), total: listed.body.items?.length });

  // 8. reopen; drag the left handle to just after the Submit order click; Ctrl+Z, Ctrl+Shift+Z
  await popup.close().catch(() => undefined);
  ({ f } = await reopen('8'));
  clicks['step8-reopen'] = '3 (icon, pill, View)';
  const len0 = (await f.getByTestId('length').textContent())?.trim();
  const tr8 = await track();
  const g = (await f.getByTestId('grip-start').boundingBox())!;
  const targetMs = tSubmit - live.at + 1200;
  const gx = tr8.x + (tr8.width * targetMs) / durationMs;
  const ga = await toScreen(page, { x: g.x + g.width / 2, y: g.y + g.height / 2 });
  const gb = await toScreen(page, { x: gx, y: g.y + g.height / 2 });
  await xdrag(ga, gb, { steps: 12, stepMs: 30 });
  await sleep(700);
  const cut = await f.getByTestId('cut-start').evaluate((e) => ({ widthPx: Math.round(e.getBoundingClientRect().width), bg: getComputedStyle(e).backgroundColor }));
  const t8a = { length: (await f.getByTestId('length').textContent())?.trim(), trim: await trimNow(), cut };
  ev.xshot('8-trimmed', FULL);
  const focus8 = await f.evaluate(() => { const a = document.activeElement as HTMLElement | null; return { testid: a?.getAttribute('data-testid') ?? a?.tagName ?? null, editable: !!a?.isContentEditable }; });
  const undoBtn8 = { undoEnabled: !(await f.getByTestId('trim-undo').isDisabled()), redoEnabled: !(await f.getByTestId('trim-redo').isDisabled()) };
  xkey('ctrl+z');
  await sleep(700);
  const t8b = { length: (await f.getByTestId('length').textContent())?.trim(), trim: await trimNow() };
  xkey('ctrl+shift+z');
  await sleep(700);
  const t8c = { length: (await f.getByTestId('length').textContent())?.trim(), trim: await trimNow() };
  // the undo and redo buttons under the bar, as a check that the trim history exists
  let viaButtons: Record<string, unknown> | null = null;
  if (JSON.stringify(t8b.trim) === JSON.stringify(t8a.trim)) {
    await xclickF(page, f, '[data-testid="trim-undo"]');
    await sleep(500);
    const u = { length: (await f.getByTestId('length').textContent())?.trim(), trim: await trimNow() };
    await xclickF(page, f, '[data-testid="trim-redo"]');
    await sleep(500);
    viaButtons = { afterUndoButton: u, afterRedoButton: { length: (await f.getByTestId('length').textContent())?.trim(), trim: await trimNow() } };
  }
  ev.set('step8-trim (J-085)', { targetMs, lengthBefore: len0, afterDrag: t8a, focusAtChord: focus8, buttonsAtChord: undoBtn8, afterCtrlZ: t8b, afterCtrlShiftZ: t8c, viaButtons });
  clicks['step8'] = '1 drag; 2 chords';

  // 9. title, Ctrl+Enter; to the link on the clipboard
  await xclickEl(page, f.getByTestId('field'));
  xtype('parity S1.2 bar');
  await sleep(500);
  setClipboard('before-S2.4');
  const labelLen = (await f.getByTestId('length').textContent())?.trim();
  const finalTrim = await trimNow();
  const c9 = await calm(60_000);
  const newPage = context.waitForEvent('page', { timeout: 60_000 });
  const t9 = Date.now();
  xkey('ctrl+Return');
  const link = await until(async () => (/\/s\//.test(clipboard()) ? clipboard() : ''), 60_000, 40);
  ev.set('step9-create (J-086, J-087, J-197)', { toLinkOnClipboard: { seconds: secs(link.at - t9), ms: link.at - t9 }, load: c9.load, reliable: c9.reliable, link: link.value, labelLen, trim: finalTrim });
  clicks['step9'] = '1 click into the field, 1 chord';

  // 10. the capture at once: the processing notice; time to playable
  const cap = await newPage;
  const t10 = Date.now();
  await cap.bringToFront();
  const notice = await until(async () => ((await cap.getByTestId('processing').count()) ? await cap.getByTestId('processing').textContent() : null), 15_000, 50).catch(() => null);
  if (notice) await cap.screenshot({ path: ev.file('10-processing') });
  const playable = await until(async () => cap.evaluate(() => { const v = document.querySelector('[data-testid="media"] video') as HTMLVideoElement | null; return v && v.readyState >= 2 ? Math.round(v.duration * 1000) : null; }), 180_000, 200);
  ev.set('step10-processing (J-087)', { notice: notice?.value?.trim() ?? 'not seen', noticeSeenAfterMs: notice ? notice.at - t10 : null, openToPlayable: { seconds: secs(playable.at - t10), ms: playable.at - t10 }, fromCtrlEnter: secs(playable.at - t9), load: load(), playerDurationMs: playable.value });
  await cap.screenshot({ path: ev.file('10-playable') });

  // 11. stored length against the label; the 500 is gone from console, network and markers
  const rec = await captureOf(context, link.value);
  await waitReady(context, rec.id);
  const full = await api<{ durationMs?: number | null; trim?: unknown }>(context, 'GET', `/api/v1/recordings/${rec.id}`);
  const net = await api<{ items: { url: string; status: number | null; offsetMs?: number }[] }>(context, 'GET', `/api/v1/recordings/${rec.id}/network?limit=500`);
  const con = await api<{ items: { level?: string; text?: string; offsetMs?: number }[] }>(context, 'GET', `/api/v1/recordings/${rec.id}/console?limit=500`);
  const evs = await api<{ items?: { offsetMs: number; event: { kind: string; status?: number; url?: string } }[] }>(context, 'GET', `/api/v1/recordings/${rec.id}/events?limit=500`);
  const rows = evs.body?.items ?? [];
  ev.set('step11-events-status', evs.status);
  const kinds = rows.reduce<Record<string, number>>((m, x) => ((m[x.event.kind] = (m[x.event.kind] ?? 0) + 1), m), {});
  const has500 = (net.body?.items ?? []).some((x) => x.status === 500) || rows.some((x) => x.event.status === 500 || /submit|order/i.test(String(x.event.url ?? '')));
  ev.set('step11-capture (J-227)', {
    id: rec.id,
    storedDurationMs: full.body.durationMs,
    labelLen,
    trimLengthMs: finalTrim ? finalTrim.endMs - finalTrim.startMs : null,
    network: (net.body?.items ?? []).map((x) => `${x.status}:${x.url.replace(/^https?:\/\/[^/]+/, '')}`),
    consoleRows: con.body?.items?.length,
    eventKinds: kinds,
    userEvents: rows.filter((x) => /click|input|key|nav|user/i.test(x.event.kind)).length,
    still500: has500,
  });
  await cap.close().catch(() => undefined);
  ev.set('step11-S1.2-video-checks', 'made on Nib in G1 S1.2 after-check (bar position, blur, pause)');
  ev.set('clicks', clicks);
  ev.set('load-end', load());
});

void expect;
void labPage;
void viewportOrigin;
