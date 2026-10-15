// Parity group G3, Nib side: recording contents per lab case (docs/parity/scenarios.md, S3.1 to
// S3.5). Each test is one scenario, run as scripted, and records its evidence (per-step counts,
// viewer checks, timings with the load average, screenshots) in e2e/parity-shots/G3/<scenario>.json
// and .png files. The raw results are written up in docs/parity/G3-replica.md.
//
//   cd e2e && PARITY_EXT_BUILD=chrome-mv3-g3 npx playwright test -c playwright.parity.config.ts G3
//   cd e2e && npx playwright test -c playwright.parity.config.ts G3 -g S3.2   # one
//
// Needs the compose stack on :3000, the lab on :5173 and :5174 (with L-1 to L-3), the release
// build, xdotool, xclip, ImageMagick, ffprobe and espeak-ng (S3.5 narration).
import { test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  Evidence,
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
  launchNib,
  load,
  openPopup,
  screencast,
  secs,
  shadowOne,
  shadowQuery,
  signIn,
  sleep,
  toScreen,
  until,
  waitReady,
  xclick,
  xclickEl,
  xclickPopup,
  xdo,
  xkey,
  xmove,
  type Launched,
  type ScreenFrame,
} from './rig.ts';

const GROUP = 'G3';
const EMAIL = process.env.PARITY_EMAIL ?? 'parity@example.com';
const LAB_HOSTS = ['localhost:5173', 'localhost:5174'];
/** Wait between scripted steps so each lab case owns its own stretch of the timeline (S3.1). */
const GAP = 3000;

// ---------------------------------------------------------------- one signed-in browser

let rig: Launched | null = null;
/** When the last capture of this run was created (S3.3 measures its reach back against it). */
let lastCaptureEnd: { at: number; id: string; scenario: string } | null = null;

async function getRig(): Promise<Launched> {
  if (rig) return rig;
  rig = await launchNib();
  const { lab, popup } = await signIn(rig.context, EMAIL);
  await popup.close().catch(() => undefined);
  void lab;
  for (const p of rig.context.pages()) if (p.url().startsWith(SERVER)) await p.close().catch(() => undefined);
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
async function freshLab(context: BrowserContext, p = '/'): Promise<Page> {
  const page = await context.newPage();
  for (const other of context.pages()) if (other !== page) await other.close().catch(() => undefined);
  await page.goto(LAB_URL + p);
  await page.waitForLoadState('networkidle');
  await focusWindow(page);
  return page;
}

function xtype(text: string) {
  xdo('type', '--delay', '40', text);
}

function setClipboard(text: string) {
  execFileSync('xclip', ['-selection', 'clipboard', '-i'], { input: text, stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, DISPLAY: process.env.PARITY_DISPLAY ?? ':130' } });
}

async function barOf(page: Page) {
  return shadowOne(page, 'data-nb-bar');
}

async function session(sw: () => Promise<import('@playwright/test').Worker>) {
  return (await (await sw()).evaluate(async () => (await chrome.storage.session.get('nib:session'))['nib:session'])) as { state: string; [k: string]: unknown } | undefined;
}

/** A real click on the centre of an in-page UI element (closed shadow root). */
async function xclickShadow(page: Page, attr: string) {
  const n = (await shadowQuery(page, attr)).find((x) => x.visible);
  if (!n) throw new Error(`no visible [${attr}] in the in-page UI`);
  const s = await toScreen(page, { x: n.box.x + n.box.w / 2, y: n.box.y + n.box.h / 2 });
  xclick(s.x, s.y);
}

/** Run one check; a failure is recorded as evidence and does not end the scenario. */
async function probe<T>(ev: Evidence, key: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    const v = await fn();
    ev.set(key, v);
    return v;
  } catch (e) {
    ev.set(key, { error: String(e).slice(0, 400) });
    return null;
  }
}

function saveFrame(ev: Evidence, name: string, jpeg: Buffer) {
  fs.writeFileSync(path.join(ev.dir, `${ev.scenario}-${name}-nib-1440-light.jpg`), jpeg);
}

// ---------------------------------------------------------------- capture helpers

/** Start or stop a tab recording with the chord; returns the chord time and when live (or the editor) showed. */
async function chordStart(ev: Evidence, key: string, page: Page) {
  const c = await calm(120_000);
  const cast = await screencast(page);
  await focusWindow(page);
  const t0 = Date.now();
  xkey('ctrl+shift+space');
  const live = await until(async () => (await barOf(page))?.attrs['data-state'] === 'recording', 30_000, 30);
  await sleep(1500);
  const frames = await cast.stop();
  const stop = await shadowOne(page, 'data-nb-stop');
  const ref = frames.filter((f) => f.t <= live.at + 1200).pop() ?? frames[frames.length - 1]!;
  const first = stop ? firstMatching(frames, t0, stop.box, { ref }) : null;
  if (first) saveFrame(ev, `${key}-first-live-frame`, frames[first.index]!.jpeg);
  ev.set(`${key}-chord-to-live (J-195)`, { seconds: first ? secs(first.t - t0) : null, frameMs: first ? Math.round(first.t - t0) : null, domMs: live.at - t0, load: c.load, reliable: c.reliable, frames: frames.length });
  return { t0, liveAt: live.at };
}

async function editorBox(f: Frame) {
  const b = (await f.getByTestId('editor').boundingBox())!;
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

/** Stop with the chord (or the bar's stop button) and time it to the first editor frame (J-196). */
async function stopToEditor(ev: Evidence, key: string, page: Page, how: 'chord' | 'bar' = 'chord') {
  const c = await calm(120_000);
  const cast = await screencast(page);
  await focusWindow(page);
  const t0 = Date.now();
  if (how === 'chord') xkey('ctrl+shift+space');
  else await xclickShadow(page, 'data-nb-stop');
  const f = await editorFrame(page, 90_000);
  const domAt = Date.now();
  await sleep(1500);
  const frames: ScreenFrame[] = await cast.stop();
  const region = await editorBox(f);
  const ref = frames.filter((x) => x.t <= domAt + 1200).pop() ?? frames[frames.length - 1]!;
  const first = firstMatching(frames, t0, region, { ref });
  if (first) saveFrame(ev, `${key}-first-editor-frame`, frames[first.index]!.jpeg);
  ev.set(`${key}-stop-to-editor (J-196)`, { how, seconds: first ? secs(first.t - t0) : null, frameMs: first ? Math.round(first.t - t0) : null, domMs: domAt - t0, load: c.load, reliable: c.reliable });
  return { f, t0 };
}

/** Title the draft and click Create; returns the capture once it is ready. */
async function createDraft(context: BrowserContext, page: Page, f: Frame, title: string, scenario: string) {
  await xclickEl(page, f.getByTestId('field'));
  await sleep(200);
  xtype(title);
  await sleep(500);
  setClipboard(`before-${title}`);
  const opened = context.waitForEvent('page', { timeout: 60_000 }).catch(() => null);
  await xclickEl(page, f.locator('[data-testid="create"]').first());
  const t0 = Date.now();
  const link = (await until(async () => (/\/s\//.test(clipboard()) ? clipboard() : ''), 90_000, 100)).value;
  const cap = await opened;
  await cap?.close().catch(() => undefined);
  const rec = await captureOf(context, link);
  await waitReady(context, rec.id, 400_000);
  lastCaptureEnd = { at: t0, id: rec.id, scenario };
  await focusWindow(page).catch(() => undefined);
  return { id: rec.id, link, createdAt: t0, readyAfterMs: Date.now() - t0 };
}

/** Screenshot of the visible page: icon, screenshot row, a click on the page; title; Create. */
async function screenshotCapture(context: BrowserContext, page: Page, title: string, scenario: string) {
  const popup = await clickIcon(context, page);
  await xclickPopup(popup, '[data-row-main="screenshot"]');
  await until(async () => (await shadowOne(page, 'data-nb-ui'))?.attrs['data-session'] === 'arming-screenshot', 10_000);
  const pt = await toScreen(page, { x: 1200, y: 480 });
  xmove(pt.x - 20, pt.y - 10);
  await sleep(200);
  const tShot = Date.now();
  xclick(pt.x, pt.y);
  const f = await editorFrame(page);
  await f.getByTestId('field').waitFor();
  await sleep(800);
  const made = await createDraft(context, page, f, title, scenario);
  return { ...made, tShot };
}

// ---------------------------------------------------------------- API reads

async function all<T>(context: BrowserContext, p: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const sep = p.includes('?') ? '&' : '?';
    const r: { status: number; body: { items: T[]; nextCursor: string | null; hasMore: boolean } } = await api<{ items: T[]; nextCursor: string | null; hasMore: boolean }>(context, 'GET', `${p}${sep}limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (r.status !== 200) throw new Error(`${p}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    out.push(...r.body.items);
    if (!r.body.hasMore || !r.body.nextCursor) break;
    cursor = r.body.nextCursor;
  }
  return out;
}

interface ConsoleRow { id: string; t: number; offsetMs: number; kind: string; level: string; message: string; stack: string | null; source: { url: string; line: number } | null; count: number }
interface NetRow { rid: string; t: number; offsetMs: number; method: string; url: string; host: string; path: string; status: number | null; state: string; type: string; frame: string; durationMs: number | null; size: number | null; source: string; graphql: { operationName: string | null; hasErrors: boolean } | null; requestHeaders?: Record<string, string>; responseHeaders?: Record<string, string>; requestBody?: string | null; responseBody?: string | null; redacted: string[]; wsFrames: number | null; error: string | null; errorMessage: string | null }
interface ActionRow { id: string; t: number; offsetMs: number; type: string; target: { selector?: string; tag?: string; testid?: string | null; [k: string]: unknown } | null; value: string | null; masked: boolean; key: string | null; url: string | null; cause: string | null }
interface EventRow { offsetMs: number; event: { kind: string; t: number; ctx?: string; data: Record<string, unknown> } }

async function contents(context: BrowserContext, id: string) {
  const [consoleRows, network, actions, events] = await Promise.all([
    all<ConsoleRow>(context, `/api/v1/recordings/${id}/console`),
    all<NetRow>(context, `/api/v1/recordings/${id}/network?bodies=all&headers=true`),
    all<ActionRow>(context, `/api/v1/recordings/${id}/actions`),
    all<EventRow>(context, `/api/v1/recordings/${id}/events`),
  ]);
  const detail = (await api<Record<string, unknown>>(context, 'GET', `/api/v1/recordings/${id}`)).body;
  return { consoleRows, network, actions, events, detail };
}

type Contents = Awaited<ReturnType<typeof contents>>;

/** Rows per scripted step: a row belongs to the last step mark at or before it. */
function bucket<T extends { t: number }>(rows: T[], marks: { step: string; t: number }[]) {
  const out: Record<string, T[]> = { pre: [] };
  for (const m of marks) out[m.step] = [];
  for (const r of rows) {
    let owner = 'pre';
    for (const m of marks) if (r.t >= m.t - 100) owner = m.step;
    out[owner]!.push(r);
  }
  return out;
}

const shortUrl = (u: string) => u.replace(/^https?:\/\/localhost:5173/, '').replace(/^https?:\/\//, '');
const isLab = (r: NetRow) => LAB_HOSTS.includes(r.host);

function describeConsole(r: ConsoleRow) {
  return `${r.kind}/${r.level}: ${r.message.slice(0, 90)}${r.count > 1 ? ` (x${r.count})` : ''}`;
}
function describeNet(r: NetRow) {
  return `${r.method} ${shortUrl(r.url)} ${r.status ?? r.state} ${r.type} frame=${r.frame}${r.graphql ? ` gql=${r.graphql.operationName}:${r.graphql.hasErrors ? 'errors' : 'ok'}` : ''}`;
}
function describeAction(r: ActionRow) {
  const tgt = r.target ? ` ${(r.target.testid as string) ?? r.target.selector ?? r.target.tag ?? ''}` : '';
  return `${r.type}${tgt}${r.value != null ? ` "${r.value.slice(0, 60)}"${r.masked ? ' (masked)' : ''}` : ''}${r.key ? ` key=${r.key}` : ''}${r.cause ? ` cause=${r.cause}` : ''}${r.url && r.type !== 'click' ? ` ${shortUrl(r.url)}` : ''}`;
}

/** The per-step count table: console (console and error kinds) / network / user events. */
function countTable(c: Contents, marks: { step: string; t: number }[]) {
  const con = bucket(c.consoleRows.filter((r) => r.kind === 'console' || r.kind === 'error'), marks);
  const net = bucket(c.network, marks);
  const act = bucket(c.actions, marks);
  const table: Record<string, unknown> = {};
  for (const step of ['pre', ...marks.map((m) => m.step)]) {
    table[step] = {
      c: con[step]!.length,
      n: net[step]!.length,
      u: act[step]!.length,
      console: con[step]!.map(describeConsole),
      network: net[step]!.map(describeNet),
      actions: act[step]!.map(describeAction),
    };
  }
  return table;
}

// ---------------------------------------------------------------- the capture page

async function openCapture(context: BrowserContext, id: string, size: [number, number] = [1440, 900], theme: 'light' | 'dark' = 'light') {
  const cap = await context.newPage();
  await cap.setViewportSize({ width: size[0], height: size[1] });
  await cap.emulateMedia({ colorScheme: theme });
  await cap.goto(`${SERVER}/c/${id}`);
  await cap.waitForLoadState('networkidle').catch(() => undefined);
  await cap.locator('[data-testid="devtools"]:visible, [data-testid="narrow-devtools"]:visible').first().waitFor({ timeout: 30_000 });
  await sleep(800);
  return cap;
}

async function tab(cap: Page, id: 'info' | 'console' | 'network' | 'actions') {
  if (!(await cap.getByTestId('devtools').isVisible().catch(() => false)) && (await cap.getByTestId('narrow-devtools').isVisible().catch(() => false))) await cap.getByTestId('narrow-devtools').click();
  await cap.getByTestId(`tab-${id}`).click();
  await sleep(500);
}

/** Each dev tools tab at 1440 and 390, light and dark; sideways overflow per shot. */
async function shootTabs(ev: Evidence, context: BrowserContext, id: string, step: string, tabs: ('info' | 'console' | 'network' | 'actions')[] = ['info', 'console', 'network', 'actions']) {
  const overflow: Record<string, boolean> = {};
  for (const [w, h] of [[1440, 900], [390, 844]] as const)
    for (const theme of ['light', 'dark'] as const) {
      const cap = await openCapture(context, id, [w, h], theme);
      for (const t of tabs) {
        await tab(cap, t);
        await ev.shot(cap, `${step}-${t}`, String(w), theme);
        overflow[`${t}-${w}-${theme}`] = await cap.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      }
      await cap.close();
    }
  return overflow;
}

const rowText = (s: string) => s.replace(/\s+/g, ' ').trim();

// ================================================================ S3.1

test('S3.1 every lab case in one tab recording', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S3.1');
  const { context, sw } = await getRig();
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  const marks: { step: string; t: number }[] = [];
  const mark = (step: string) => marks.push({ step, t: Date.now() });

  // 1, 2. fresh /, 5 s, idle
  const page = await freshLab(context);
  await sleep(5000);
  ev.set('step2-idle', rowText((await page.locator('p', { has: page.getByTestId('status') }).textContent()) ?? ''));

  // 3. chord to the first live frame
  const start = await chordStart(ev, 'step3', page);
  await sleep(GAP);

  const click = async (step: string, testid: string) => {
    await page.getByTestId(testid).scrollIntoViewIfNeeded();
    await sleep(300);
    mark(step);
    await xclickEl(page, page.getByTestId(testid));
    await sleep(GAP);
  };
  // 4 to 10
  await click('4 Save', 'works');
  await click('5 Export', 'dead');
  await click('6 Sync', 'hangs');
  await click('7 Submit order', 'hidden-500');
  await click('8 Show profile', 'throws');
  await click('9 Refresh', 'rejects');
  await click('10 Log at every level', 'console');
  // 11. open modal, Delete in the modal
  await page.getByTestId('open-modal').scrollIntoViewIfNeeded();
  await sleep(300);
  mark('11 Modal');
  await xclickEl(page, page.getByTestId('open-modal'));
  await sleep(800);
  await xclickEl(page, page.locator('.modal').getByRole('button', { name: 'Delete' }));
  await sleep(GAP);
  // 12. the button inside the iframe
  const iframeBtn = page.frameLocator('iframe[title="Embedded lab page"]').getByRole('button');
  await iframeBtn.scrollIntoViewIfNeeded();
  await sleep(300);
  mark('12 Iframe button');
  await xclickEl(page, iframeBtn);
  await sleep(GAP);
  // 13, 14 (L-1, L-2)
  await page.evaluate(() => window.scrollTo(0, 0));
  await click('13 GraphQL', 'graphql');
  await click('14 Auth', 'auth');
  // 15. Ctrl+R
  await page.evaluate(() => window.scrollTo(0, 0));
  await focusWindow(page);
  mark('15 Reload');
  xkey('ctrl+r');
  await page.waitForLoadState('load');
  await until(async () => (await barOf(page))?.attrs['data-state'] === 'recording', 20_000, 100).catch(() => null);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(GAP);
  // 16. Form link, four fields, Create account
  mark('16 Form');
  await xclickEl(page, page.getByRole('link', { name: 'Form', exact: true }));
  await page.waitForURL(/\/form$/);
  await sleep(1200);
  for (const [label, text] of [
    ['Name', 'Ada Lovelace'],
    ['Email', 'ada@example.com'],
    ['Password', 'hunter2hunter2'],
    ['Notes', 'token sk_live_51Hparity0000 card 4242 4242 4242 4242'],
  ] as const) {
    await xclickEl(page, page.getByLabel(label));
    await sleep(200);
    xtype(text);
    await sleep(400);
  }
  await xclickEl(page, page.getByRole('button', { name: 'Create account' }));
  await sleep(GAP);
  ev.set('step16-form-result', { url: page.url(), main: rowText((await page.locator('main').textContent({ timeout: 3000 }).catch(() => '')) ?? '').slice(-160) });
  // 17. Long list, row 3, wheel to the bottom
  mark('17 List');
  await page.evaluate(() => window.scrollTo(0, 0));
  await xclickEl(page, page.getByRole('link', { name: 'Long list', exact: true }));
  await page.waitForURL(/\/list$/);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(1200);
  const row3 = page.locator('li .rowbtn').nth(2);
  await xclickEl(page, row3);
  await sleep(600);
  const mid = await toScreen(page, { x: 720, y: 450 });
  xmove(mid.x, mid.y);
  let wheels = 0;
  for (let i = 0; i < 80; i++) {
    xdo('click', '--repeat', '10', '--delay', '25', '5');
    wheels += 10;
    await sleep(120);
    if (await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2)) break;
  }
  ev.set('step17-wheel-clicks', { wheels, atBottom: await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2), scrollY: await page.evaluate(() => window.scrollY) });
  await sleep(GAP);
  // 18. typed navigation to /canvas, Redraw once
  mark('18 Canvas');
  await focusWindow(page);
  xkey('ctrl+l');
  await sleep(400);
  xtype('localhost:5173/canvas');
  await sleep(200);
  xkey('Return');
  await page.waitForURL(/\/canvas$/);
  await page.waitForLoadState('load');
  await until(async () => (await barOf(page))?.attrs['data-state'] === 'recording', 20_000, 100).catch(() => null);
  await sleep(1200);
  await xclickEl(page, page.getByTestId('redraw'));
  await sleep(GAP);
  mark('19 Stop');

  // 19. chord to the editor; title; create
  const stop = await stopToEditor(ev, 'step19', page);
  ev.set('recording-wall-ms', stop.t0 - start.liveAt);
  const made = await createDraft(context, page, stop.f, 'parity S3.1 lab', 'S3.1');
  ev.set('capture', made);
  ev.set('marks', marks.map((m) => ({ step: m.step, atMs: m.t - start.liveAt })));
  void sw;

  // the count table from the API
  const c = await contents(context, made.id);
  fs.writeFileSync(path.join(ev.dir, 'S3.1-contents.json'), JSON.stringify(c, null, 2));
  ev.set('totals-api', { console: c.consoleRows.length, consoleKinds: tally(c.consoleRows.map((r) => r.kind)), network: c.network.length, actions: c.actions.length, actionTypes: tally(c.actions.map((r) => r.type)), events: c.events.length, eventKinds: tally(c.events.map((r) => r.event.kind)) });
  ev.set('count-table', countTable(c, marks));
  // J-248: the extension's own requests
  ev.set('extension-requests (J-248)', c.network.filter((r) => !isLab(r)).map(describeNet));

  // the viewer, filters cleared
  await viewerChecks(ev, context, made.id, c);
  ev.set('shots-overflow', await shootTabs(ev, context, made.id, 'tabs'));
  ev.set('load-end', load());
});

function tally(xs: string[]) {
  return xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {});
}

async function viewerChecks(ev: Evidence, context: BrowserContext, id: string, c: Contents) {
  const cap = await openCapture(context, id);

  // console (J-055, J-056, J-057)
  await probe(ev, 'viewer-console (J-055, J-056)', async () => {
    await tab(cap, 'console');
    const rows = await cap.locator('[data-testid="console-list"] [data-row-index]').evaluateAll((els) =>
      els.map((e) => {
        const ic = e.querySelector('.ic') as HTMLElement | null;
        const cls = [...e.classList];
        return {
          kind: cls.find((x) => x.startsWith('kind-'))?.slice(5),
          level: cls.find((x) => x.startsWith('lvl-'))?.slice(4),
          msg: (e.querySelector('.msg')?.textContent ?? '').trim().slice(0, 100),
          iconColour: ic ? getComputedStyle(ic).color : null,
          rowBg: getComputedStyle(e).backgroundColor,
          icon: ic?.querySelector('svg')?.getAttribute('data-icon') ?? ic?.innerHTML.slice(0, 60) ?? null,
        };
      }),
    );
    const chips = await cap.locator('[data-testid^="chip-"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    const perLevel: Record<string, { rows: number; iconColour: string | null; rowBg: string }> = {};
    for (const r of rows.filter((x) => x.kind === 'console' || x.kind === 'error')) {
      const k = `${r.kind}/${r.level}`;
      perLevel[k] ??= { rows: 0, iconColour: r.iconColour, rowBg: r.rowBg };
      perLevel[k].rows++;
    }
    // expand every console and error row: does it carry the call-site stack with a link?
    const n = await cap.locator('[data-testid="console-list"] [data-row-index]').count();
    let consoleish = 0;
    let withStack = 0;
    let withLink = 0;
    for (let i = 0; i < n; i++) {
      const row = cap.locator(`[data-testid="console-list"] [data-row-index="${i}"]`);
      const cls = (await row.getAttribute('class')) ?? '';
      if (!/kind-(console|error)/.test(cls)) continue;
      consoleish++;
      await row.locator('button.main').click();
      await sleep(60);
      if (await row.locator('.stack').count()) withStack++;
      if (await row.locator('.src a').count()) withLink++;
    }
    await cap.screenshot({ path: ev.file('console-expanded') });
    const objectRow = rows.find((r) => r.msg.startsWith('info: object'))?.msg ?? null;
    return { uiRows: rows.length, apiRows: c.consoleRows.length, chips, perLevel, objectRowText: objectRow, consoleRowsExpanded: consoleish, withStack, withCallSiteLink: withLink, rows: rows.map((r) => `${r.kind}/${r.level}: ${r.msg}`) };
  });
  await probe(ev, 'viewer-typeerror (J-057)', async () => {
    const row = cap.locator('[data-testid="console-list"] [data-row-index]', { hasText: 'TypeError' }).first();
    const text = rowText((await row.textContent()) ?? '');
    const markers = await cap.locator('[data-testid^="marker-"]').evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute('data-testid'), label: e.getAttribute('aria-label'), text: (e.textContent ?? '').trim() })));
    await row.scrollIntoViewIfNeeded();
    await cap.screenshot({ path: ev.file('console-typeerror') });
    return { text: text.slice(0, 600), markers };
  });

  // network (J-058, J-061, J-064, J-248)
  await probe(ev, 'viewer-network (J-058)', async () => {
    await tab(cap, 'network');
    const cols = await cap.locator('[data-testid="network-list"] .hrow [role="columnheader"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    const rows = await cap.locator('[data-testid="network-list"] [data-row-index]').evaluateAll((els) =>
      els.map((e) => ({ cells: [...e.querySelectorAll('[role="cell"]')].map((x) => (x.textContent ?? '').trim()), failed: e.classList.contains('failed'), pending: e.classList.contains('pending') })),
    );
    const find = (s: string) => rows.find((r) => r.cells.some((x) => x.includes(s)));
    const typeChips = await cap.locator('[data-testid^="type-"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    return {
      columns: cols,
      typeChips,
      uiRows: rows.length,
      apiRows: c.network.length,
      sync: find('/api/hang') ?? null,
      graphql: find('/api/graphql') ?? null,
      graphqlApi: c.network.find((r) => r.url.includes('/api/graphql'))?.graphql ?? null,
      graphqlFailedInApi: c.network.find((r) => r.url.includes('/api/graphql')) ? c.network.find((r) => r.url.includes('/api/graphql'))!.errorMessage : null,
      nonLabRows: rows.filter((r) => !r.cells.some((x) => LAB_HOSTS.some((h) => x.includes(h)))).map((r) => r.cells.join(' | ')),
      rows: rows.map((r) => `${r.failed ? '[failed] ' : ''}${r.pending ? '[pending] ' : ''}${r.cells.join(' | ')}`),
    };
  });
  await cap.screenshot({ path: ev.file('network') });

  const openRow = async (needle: string) => {
    await tab(cap, 'network');
    if (await cap.getByTestId('close-detail').isVisible().catch(() => false)) await cap.getByTestId('close-detail').click();
    await cap.getByTestId('network-filter').fill(needle);
    await sleep(300);
    await cap.locator('[data-testid="network-list"] [data-row-index]').first().click();
    await cap.getByTestId('request-detail').waitFor();
    await sleep(300);
  };
  const headerGroups = async () =>
    cap.getByTestId('detail-body').evaluate((b) => {
      const out: Record<string, string[]> = {};
      let cur = '';
      for (const el of b.children) {
        // collapsible groups (details/summary): the summary names the group, the list follows
        if (el.tagName === 'DETAILS') {
          const title = (el.querySelector('summary')?.textContent ?? '').trim();
          const rows = [...el.querySelectorAll('dt')].map((dt) => `${dt.textContent?.trim()}: ${(dt.nextElementSibling?.textContent ?? '').trim().slice(0, 80)}`);
          out[`${title}${(el as HTMLDetailsElement).open ? '' : ' (closed)'} [collapsible]`] = rows;
          continue;
        }
        if (el.tagName === 'H4') {
          cur = (el.textContent ?? '').trim();
          out[cur] = [];
        } else if (el.tagName === 'DL') for (const dt of el.querySelectorAll('dt')) out[cur]!.push(`${dt.textContent?.trim()}: ${(dt.nextElementSibling?.textContent ?? '').trim().slice(0, 80)}`);
        else if (cur) out[cur]!.push((el.textContent ?? '').trim());
      }
      return out;
    });
  // J-059: headers of Save and of the auth call
  for (const [key, needle] of [['save', 'q=works'], ['auth', 'q=auth']] as const)
    await probe(ev, `viewer-headers-${key} (J-059)`, async () => {
      await openRow(needle);
      await cap.getByTestId('sub-headers').click();
      await sleep(200);
      const groups = await headerGroups();
      const masked = await cap.locator('[data-testid^="masked-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
      await cap.screenshot({ path: ev.file(`network-headers-${key}`) });
      return { groups, masked };
    });
  // J-060: Submit order bodies; the document and image rows
  await probe(ev, 'viewer-bodies-submit (J-060)', async () => {
    await openRow('/api/fail');
    await cap.getByTestId('sub-payload').click();
    await sleep(200);
    const payload = await cap.getByTestId('detail-body').evaluate((b) => {
      const pre = b.querySelector('pre');
      return { text: (pre?.textContent ?? b.textContent ?? '').trim().slice(0, 300), json: !!pre?.classList.contains('json'), lineNumbers: !!b.querySelector('[class*="line"], [class*="gutter"], ol li'), foldControls: b.querySelectorAll('[class*="fold"], details, [aria-expanded]').length, copyButton: !!b.querySelector('[aria-label*="opy" i], [title*="opy" i], [data-testid*="copy"]'), formatToggle: !!b.querySelector('[aria-label*="ormat" i], [aria-label*="retty" i], [title*="retty" i]') };
    });
    await cap.screenshot({ path: ev.file('network-payload-submit') });
    await cap.getByTestId('sub-response').click();
    await sleep(200);
    const response = await cap.getByTestId('detail-body').evaluate((b) => {
      const pre = b.querySelector('pre');
      return { text: (pre?.textContent ?? b.textContent ?? '').trim().slice(0, 300), json: !!pre?.classList.contains('json'), lineNumbers: !!b.querySelector('[class*="line"], [class*="gutter"], ol li'), foldControls: b.querySelectorAll('[class*="fold"], details, [aria-expanded]').length, copyButton: !!b.querySelector('[aria-label*="opy" i], [title*="opy" i], [data-testid*="copy"]') };
    });
    await cap.screenshot({ path: ev.file('network-response-submit') });
    const status = (await cap.getByTestId('detail-status').textContent())?.trim();
    return { status, payload, response };
  });
  for (const [key, needle] of [['document', '/canvas'], ['image', 'badge.svg']] as const)
    await probe(ev, `viewer-body-${key} (J-060)`, async () => {
      await openRow(needle);
      const name = rowText((await cap.locator('[data-testid="request-detail"] header').textContent()) ?? '');
      await cap.getByTestId('sub-response').click();
      await sleep(200);
      return { row: name, response: rowText((await cap.getByTestId('detail-body').textContent()) ?? '').slice(0, 200) };
    });
  await probe(ev, 'viewer-sync-detail (J-061)', async () => {
    await openRow('/api/hang');
    const status = (await cap.getByTestId('detail-status').textContent())?.trim();
    await cap.getByTestId('sub-timing').click();
    await sleep(200);
    const timing = rowText((await cap.getByTestId('detail-body').textContent()) ?? '');
    await cap.getByTestId('sub-response').click();
    await sleep(200);
    const response = rowText((await cap.getByTestId('detail-body').textContent()) ?? '');
    await cap.screenshot({ path: ev.file('network-sync') });
    return { status, timing, response };
  });
  await probe(ev, 'viewer-graphql-detail (J-064)', async () => {
    await openRow('/api/graphql');
    const head = rowText((await cap.locator('[data-testid="request-detail"] header').textContent()) ?? '');
    const dot = await cap.locator('[data-testid="request-detail"] header .dot').getAttribute('class');
    await cap.getByTestId('sub-response').click();
    await sleep(200);
    const response = rowText((await cap.getByTestId('detail-body').textContent()) ?? '');
    await cap.screenshot({ path: ev.file('network-graphql') });
    return { head, dot, response: response.slice(0, 200) };
  });
  if (await cap.getByTestId('close-detail').isVisible().catch(() => false)) await cap.getByTestId('close-detail').click();
  await cap.getByTestId('network-filter').fill('').catch(() => undefined);

  // actions (J-067, J-068, J-069)
  await probe(ev, 'viewer-actions (J-067, J-068, J-069)', async () => {
    await tab(cap, 'actions');
    const rows = await cap.locator('[data-testid="actions-list"] [data-row-index]').evaluateAll((els) => els.map((e) => (e.querySelector('.main')?.textContent ?? '').replace(/\s+/g, ' ').trim()));
    const filterBar = await cap.locator('[data-testid="actions-list"]').evaluate((l) => !!l.parentElement?.querySelector('input[type="text"], .vp-bar'));
    // the Save click: its tag and the attribute chip
    const save = cap.locator('[data-testid="actions-list"] [data-row-index]', { hasText: /works|Save/ }).first();
    const saveText = rowText((await save.textContent()) ?? '');
    let attrs: string | null = null;
    if (await save.getByTestId('attr-chip').count()) {
      await save.getByTestId('attr-chip').click();
      await sleep(200);
      attrs = rowText((await save.getByTestId('attr-list').textContent()) ?? '');
      await cap.screenshot({ path: ev.file('actions-save-attrs') });
    }
    return { uiRows: rows.length, apiRows: c.actions.length, filterBar, saveRow: saveText, saveAttrs: attrs, rows };
  });
  await cap.screenshot({ path: ev.file('actions') });

  // info (J-070)
  await probe(ev, 'viewer-info (J-070)', async () => {
    await tab(cap, 'info');
    return cap.getByTestId('info-tab').evaluate((el) => {
      const out: Record<string, string> = {};
      for (const dt of el.querySelectorAll('dt')) out[(dt.textContent ?? '').trim()] = (dt.nextElementSibling?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
      return out;
    });
  });
  await cap.screenshot({ path: ev.file('info') });

  // player: quality menu and download (J-054)
  await probe(ev, 'viewer-player (J-054)', async () => {
    const card = cap.getByTestId('video-card');
    await card.hover();
    await sleep(300);
    await cap.getByTestId('quality').click();
    await sleep(300);
    const menu = await cap.locator('[role="menu"]').filter({ hasText: 'Quality' }).locator('[role="menuitem"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    await cap.screenshot({ path: ev.file('player-quality') });
    await cap.keyboard.press('Escape');
    await sleep(200);
    await card.hover();
    const dl = cap.waitForEvent('download', { timeout: 60_000 });
    await cap.getByTestId('download').click();
    const d = await dl;
    const failure = await d.failure();
    const file = path.join(ROOT, 'e2e/.cache', 'S3.1-download.webm');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let via = 'download';
    if (failure || !(await d.saveAs(file).then(() => true).catch(() => false))) {
      // the browser's download failed (or could not be saved): fetch the same URL the button uses
      via = `fetch (browser download: ${failure ?? 'not saved'})`;
      const r = await context.request.get(d.url(), { headers: { origin: SERVER } });
      fs.writeFileSync(file, await r.body());
    }
    let probeOut = '';
    try {
      probeOut = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=format_name,duration', '-of', 'compact', file], { encoding: 'utf8' }).trim();
    } catch (e) {
      probeOut = String(e).slice(0, 200);
    }
    const size = fs.statSync(file).size;
    fs.rmSync(file, { force: true });
    return { qualityMenu: menu, downloadName: d.suggestedFilename(), url: d.url().replace(SERVER, ''), via, bytes: size, ffprobe: probeOut };
  });
  await cap.close();
}

// ================================================================ S3.2

test('S3.2 sockets, streams and slow pages', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S3.2');
  const { context } = await getRig();
  ev.set('load-start', load());

  // rec2 shape: /canvas (three redraws), /live: connect the socket after the start, send, the SSE
  // stream to its end; started and stopped with the chord. About 54 s.
  let page = await freshLab(context, '/canvas');
  await sleep(2000);
  const s2 = await chordStart(ev, 'rec2', page);
  const m2: { step: string; t: number }[] = [];
  const mark2 = (step: string) => m2.push({ step, t: Date.now() });
  await sleep(2000);
  for (let i = 1; i <= 3; i++) {
    mark2(`redraw ${i}`);
    await xclickEl(page, page.getByTestId('redraw'));
    await sleep(2000);
  }
  mark2('to /live');
  await xclickEl(page, page.getByRole('link', { name: 'WebSocket and SSE', exact: true }));
  await page.waitForURL(/\/live$/);
  await sleep(2000);
  mark2('ws connect');
  await xclickEl(page, page.getByTestId('ws-connect'));
  await sleep(2000);
  mark2('ws send');
  await xclickEl(page, page.getByTestId('ws-send'));
  await sleep(4000);
  mark2('sse start');
  await xclickEl(page, page.getByTestId('sse-connect'));
  await sleep(23_000);
  ev.set('rec2-page-logs', { ws: await page.locator('pre').nth(0).textContent(), sse: await page.locator('pre').nth(1).textContent() });
  const stop2 = await stopToEditor(ev, 'rec2', page);
  ev.set('rec2-wall-ms', stop2.t0 - s2.liveAt);
  const rec2 = await createDraft(context, page, stop2.f, 'parity S3.2 sockets', 'S3.2');
  ev.set('rec2-capture', rec2);
  ev.set('rec2-marks', m2.map((m) => ({ step: m.step, atMs: m.t - s2.liveAt })));

  // rec3 shape: /slow and /slow-raw, socket connected after the start; /slow reloaded, /slow-raw
  // typed into the address bar, the Back link; stopped with the bar's stop button. About 55 s.
  page = await freshLab(context, '/live');
  await sleep(2000);
  const s3 = await chordStart(ev, 'rec3', page);
  await sleep(2000);
  await xclickEl(page, page.getByTestId('ws-connect'));
  await sleep(2000);
  await xclickEl(page, page.getByTestId('ws-send'));
  await sleep(3000);
  await xclickEl(page, page.getByRole('link', { name: 'Slow page', exact: true }));
  await page.waitForURL(/\/slow$/);
  await page.getByText('late row 5').waitFor({ timeout: 20_000 });
  await sleep(3000);
  await focusWindow(page);
  xkey('ctrl+r');
  await page.waitForLoadState('load');
  await page.getByText('late row 5').waitFor({ timeout: 20_000 });
  await sleep(3000);
  xkey('ctrl+l');
  await sleep(400);
  xtype('localhost:5173/slow-raw');
  xkey('Return');
  await page.waitForURL(/\/slow-raw$/);
  await page.locator('#done').waitFor({ timeout: 20_000 });
  await sleep(3000);
  await xclickEl(page, page.getByRole('link', { name: 'Back' }));
  await page.waitForURL(LAB_URL + '/');
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await sleep(Math.max(2000, 55_000 - (Date.now() - s3.liveAt)));
  const stop3 = await stopToEditor(ev, 'rec3', page, 'bar');
  ev.set('rec3-wall-ms', stop3.t0 - s3.liveAt);
  const rec3 = await createDraft(context, page, stop3.f, 'parity S3.2 slow pages', 'S3.2');
  ev.set('rec3-capture', rec3);

  // 3. the socket rows: frames from the API and the viewer sub-tab (J-062)
  for (const [key, rec] of [['rec2', rec2], ['rec3', rec3]] as const) {
    const c = await contents(context, rec.id);
    fs.writeFileSync(path.join(ev.dir, `S3.2-${key}-contents.json`), JSON.stringify(c, null, 2));
    ev.set(`${key}-network`, c.network.map((r) => `${describeNet(r)} ${r.durationMs ?? ''}ms size=${r.size ?? ''}${r.wsFrames != null ? ` frames=${r.wsFrames}` : ''}`));
    ev.set(`${key}-actions`, c.actions.map(describeAction));
    for (const r of c.network.filter((x) => x.type === 'websocket' || x.type === 'eventsource')) {
      const frames = await all<{ op: string; data: string | null; length: number; offsetMs: number }>(context, `/api/v1/recordings/${rec.id}/network/${encodeURIComponent(r.rid)}/frames`).catch((e) => [{ op: 'error', data: String(e), length: 0, offsetMs: 0 }]);
      ev.set(`${key}-frames-${r.type}`, { url: shortUrl(r.url), status: r.status, durationMs: r.durationMs, frames: frames.length, ops: tally(frames.map((f) => f.op)), list: frames.map((f) => `${secs(f.offsetMs)}s ${f.op} ${f.length} ${String(f.data ?? '').slice(0, 50)}`) });
    }
    const slow = c.network.filter((x) => /\/slow/.test(x.url));
    ev.set(`${key}-slow-rows`, slow.map((r) => ({ row: describeNet(r), durationMs: r.durationMs, body: r.responseBody ? `${r.responseBody.length} chars` : null })));
  }
  // the socket sub-tab in the viewer, shot at 1440 and 390, light and dark
  const overflow: Record<string, unknown> = {};
  for (const [w, h] of [[1440, 900], [390, 844]] as const)
    for (const theme of ['light', 'dark'] as const) {
      const cap = await openCapture(context, rec2.id, [w, h], theme);
      await tab(cap, 'network');
      await cap.getByTestId('network-filter').fill('/ws');
      await sleep(300);
      await cap.locator('[data-testid="network-list"] [data-row-index]').first().click();
      await cap.getByTestId('request-detail').waitFor();
      await cap.getByTestId('sub-response').click();
      await sleep(300);
      if (w === 1440 && theme === 'light') {
        const sub = {
          count: (await cap.getByTestId('frame-count').textContent())?.trim(),
          rows: await cap.getByTestId('frame').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())),
          headers: await cap.locator('[data-testid="frames"] .fhead').textContent().then((t) => (t ?? '').replace(/\s+/g, ' ').trim()),
          directionFilter: await cap.locator('[data-testid^="frame-dir-"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim())),
          subTabs: await cap.locator('[data-testid^="sub-"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim())),
          status: (await cap.getByTestId('detail-status').textContent())?.trim(),
        };
        await cap.getByTestId('frame-filter').fill('tick');
        await sleep(200);
        const regexTick = (await cap.getByTestId('frame-count').textContent())?.trim();
        await cap.getByTestId('frame-filter').fill('');
        await cap.getByTestId('frame-dir-send').click();
        await sleep(200);
        const sentOnly = (await cap.getByTestId('frame-count').textContent())?.trim();
        await cap.getByTestId('frame-dir-all').click();
        await cap.getByTestId('frame').nth(1).locator('button').click();
        await sleep(200);
        const pane = (await cap.getByTestId('frame-detail').textContent().catch(() => ''))?.replace(/\s+/g, ' ').trim();
        const pretty = await cap.locator('[data-testid="frame-detail"] pre').evaluate((p) => ({ json: p.classList.contains('json'), lines: (p.textContent ?? '').split('\n').length })).catch(() => null);
        ev.set('viewer-ws-subtab (J-062)', { ...sub, regexTickCount: regexTick, sentOnlyCount: sentOnly, selectedPane: pane?.slice(0, 200), pretty });
        // and the SSE row
        await cap.getByTestId('close-detail').click();
        await cap.getByTestId('network-filter').fill('/api/sse');
        await sleep(300);
        await cap.locator('[data-testid="network-list"] [data-row-index]').first().click();
        await cap.getByTestId('request-detail').waitFor();
        await cap.getByTestId('sub-response').click();
        await sleep(300);
        ev.set('viewer-sse-row', { status: (await cap.getByTestId('detail-status').textContent())?.trim(), body: rowText((await cap.getByTestId('detail-body').textContent()) ?? '').slice(0, 300) });
        await cap.screenshot({ path: ev.file('3-sse', '1440', 'light') });
        await cap.getByTestId('close-detail').click();
        await cap.getByTestId('network-filter').fill('/ws');
        await sleep(300);
        await cap.locator('[data-testid="network-list"] [data-row-index]').first().click();
        await cap.getByTestId('sub-response').click();
        await sleep(300);
      }
      await ev.shot(cap, '3-ws-subtab', String(w), theme);
      overflow[`${w}-${theme}`] = await cap.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      await cap.close();
    }
  ev.set('ws-shots-overflow', overflow);
  ev.set('load-end', load());
});

// ================================================================ S3.3

test('S3.3 logs from before a screenshot', async () => {
  test.setTimeout(600_000);
  const ev = new Evidence(GROUP, 'S3.3');
  const { context } = await getRig();
  ev.set('load-start', load());

  const analyse = async (id: string, key: string) => {
    const c = await contents(context, id);
    const startedAt = Date.parse(String(c.detail.startedAt ?? c.detail.createdAt));
    const firstT = Math.min(...[...c.consoleRows, ...c.network, ...c.actions].map((r) => r.t));
    const lastConsole = c.consoleRows[c.consoleRows.length - 1];
    ev.set(`${key}-contents (J-071, J-057)`, {
      id,
      startedAt: c.detail.startedAt,
      console: c.consoleRows.map(describeConsole),
      network: c.network.map(describeNet),
      actions: c.actions.map(describeAction),
      has500: c.network.some((r) => r.status === 500),
      typeError: c.consoleRows.some((r) => /TypeError/.test(r.message)),
      lastConsoleRow: lastConsole ? describeConsole(lastConsole) : null,
      screenshotRow: c.consoleRows.some((r) => r.kind === 'media' && /screenshot/i.test(r.message)),
      firstRowBeforeShotS: secs(startedAt - firstT),
      firstRowAt: new Date(firstT).toISOString(),
    });
    return { c, firstT };
  };

  // N4 from G2 (S2.1) when its evidence is on this machine: the pre-roll capture already made
  const n4File = path.join(ROOT, 'e2e/parity-shots/G2/S2.1-23-recording.json');
  if (fs.existsSync(n4File)) {
    const n4 = JSON.parse(fs.readFileSync(n4File, 'utf8')) as { id: string };
    await probe(ev, 'n4-g2', async () => (await analyse(n4.id, 'n4-g2')).c.consoleRows.length);
  }

  // A fresh N4 pre-roll (S2.1 steps 1 and 2): Submit order, Log at every level, 20 s, a visible
  // screenshot. Nib has no budget, so the run makes its own and is repeatable.
  const prev = lastConsoleEnd();
  const page = await freshLab(context);
  const tLoad = Date.now();
  await xclickEl(page, page.getByTestId('hidden-500'));
  await sleep(400);
  await xclickEl(page, page.getByTestId('console'));
  await sleep(20_000);
  const made = await screenshotCapture(context, page, 'parity S3.3 pre-roll', 'S3.3');
  ev.set('capture', { ...made, previousCaptureEnd: prev, pageLoadedAt: new Date(tLoad).toISOString() });
  const { firstT } = await analyse(made.id, 'fresh');
  ev.set('reach-back', {
    firstRowToShotS: secs(made.tShot - firstT),
    firstRowAfterPageLoadS: secs(firstT - tLoad),
    previousCaptureEndToFirstRowS: prev ? secs(firstT - prev.at) : null,
  });
  // the screenshot capture's console and network tabs
  const cap = await openCapture(context, made.id);
  await tab(cap, 'console');
  ev.set('viewer-console-rows', await cap.locator('[data-testid="console-list"] [data-row-index]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100))));
  await cap.screenshot({ path: ev.file('2-console') });
  await tab(cap, 'network');
  ev.set('viewer-network-rows', await cap.locator('[data-testid="network-list"] [data-row-index]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120))));
  await cap.screenshot({ path: ev.file('2-network') });
  ev.set('markers', await cap.locator('[data-testid^="marker-"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))));
  await cap.close();
  ev.set('load-end', load());
});

function lastConsoleEnd() {
  return lastCaptureEnd ? { at: lastCaptureEnd.at, iso: new Date(lastCaptureEnd.at).toISOString(), id: lastCaptureEnd.id, scenario: lastCaptureEnd.scenario } : null;
}

// ================================================================ S3.4

test('S3.4 custom metadata', async () => {
  test.setTimeout(600_000);
  const ev = new Evidence(GROUP, 'S3.4');
  const { context } = await getRig();
  ev.set('load-start', load());

  // 2. Set metadata (L-3), then a screenshot capture
  let page = await freshLab(context);
  const logs: string[] = [];
  page.on('console', (m) => logs.push(m.text()));
  await xclickEl(page, page.getByTestId('metadata'));
  await sleep(500);
  ev.set('step2-page-log', logs.filter((l) => /metadata/.test(l)));
  const made = await screenshotCapture(context, page, 'parity S3.4 metadata', 'S3.4');
  const d = (await api<{ metadata: unknown }>(context, 'GET', `/api/v1/recordings/${made.id}`)).body;
  let cap = await openCapture(context, made.id);
  await tab(cap, 'info');
  const row = await cap.getByTestId('info-tab').evaluate((el) => {
    const dt = [...el.querySelectorAll('dt')].find((x) => (x.textContent ?? '').trim() === 'Custom logs');
    return (dt?.nextElementSibling?.textContent ?? '').replace(/\s+/g, '');
  });
  await cap.screenshot({ path: ev.file('2-info-custom-logs') });
  await cap.close();
  ev.set('step2-capture (J-073)', { id: made.id, apiMetadata: d.metadata, infoRow: row, matches: row === JSON.stringify({ plan: 'parity', seats: 3 }) });

  // 2b. an object over 10 KB: refused
  page = await freshLab(context);
  const big = await page.evaluate(() => {
    const sdk = (window as unknown as { toolbar?: { setMetadata?: (fn: () => unknown) => void } }).toolbar;
    try {
      sdk?.setMetadata?.(() => ({ blob: 'x'.repeat(11 * 1024) }));
      return 'accepted by the call (checked when the capture is made)';
    } catch (e) {
      return `threw: ${String(e)}`;
    }
  });
  const madeBig = await screenshotCapture(context, page, 'parity S3.4 metadata too large', 'S3.4');
  const dBig = (await api<{ metadata: unknown }>(context, 'GET', `/api/v1/recordings/${madeBig.id}`)).body;
  const conBig = await all<ConsoleRow>(context, `/api/v1/recordings/${madeBig.id}/console`);
  ev.set('step2-over-10kb', { call: big, id: madeBig.id, apiMetadata: dBig.metadata, refused: dBig.metadata == null, consoleNotes: conBig.filter((r) => /metadata|10 ?KB|too large/i.test(r.message)).map(describeConsole) });

  // 3. the setup path from the info tab of a capture without metadata
  cap = await openCapture(context, madeBig.id);
  await tab(cap, 'info');
  let clicks = 1; // the info tab
  await cap.getByTestId('custom-logs-setup').click();
  clicks++;
  await sleep(300);
  const setup = rowText((await cap.locator('.setup').textContent().catch(() => '')) ?? '');
  await cap.screenshot({ path: ev.file('3-setup') });
  await cap.close();
  ev.set('step3-setup', { clicksFromCapturePage: clicks, clicksFromInfoTab: clicks - 1, steps: 1, text: setup });
  ev.set('load-end', load());
});

// ================================================================ S3.5

test('S3.5 voice transcript', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S3.5');
  ev.set('load-start', load());
  await closeRig(); // one browser at a time (memory)

  // a 30 s narration WAV for the fake microphone
  const wav = path.join(ROOT, 'e2e/.cache/S3.5-narration.wav');
  fs.mkdirSync(path.dirname(wav), { recursive: true });
  const script =
    'This is the parity check for voice notes. I open the lab app and click Save. The status line says saved. ' +
    'Next I click Submit order. The page claims success, but the request failed with a server error. ' +
    'Then I click Show profile, and nothing happens on screen, although an error was thrown. ' +
    'Please look at the console and the network tab to find both problems. That is the end of this narration.';
  execFileSync('espeak-ng', ['-s', '140', '-w', wav, script]);
  const wavLen = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }).trim();
  ev.set('narration-wav-seconds', Number(wavLen));

  // Tab capture fails with the fake-device flags (e2e/flows/fixture.ts, G1 S1.6), so both
  // recordings are desktop recordings, which the fake UI flag answers without a picker.
  const b = await launchNib({ cdpPort: 9365, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] });
  try {
    const { lab: page, popup: p0 } = await signIn(b.context, EMAIL);
    await p0.close().catch(() => undefined);
    for (const p of b.context.pages()) if (p !== page) await p.close().catch(() => undefined);
    await page.goto(LAB_URL + '/');
    await focusWindow(page);

    const record = async (mic: boolean, title: string, seconds: number) => {
      let popup = (await openPopup(b.context, page)).popup;
      let pill = await popup.locator('[data-mic-pill]').getAttribute('data-mic-pill');
      if (mic && pill !== 'on') {
        const opened = b.context.waitForEvent('page', { predicate: (p) => p.url().includes('/permissions.html'), timeout: 8000 }).catch(() => null);
        await xclickPopup(popup, '[data-mic-pill]');
        const perm = await opened;
        if (perm) await perm.waitForEvent('close', { timeout: 15_000 }).catch(() => undefined);
        await sleep(800);
        popup = (await openPopup(b.context, page)).popup;
        pill = await popup.locator('[data-mic-pill]').getAttribute('data-mic-pill');
        if (pill !== 'on') {
          await xclickPopup(popup, '[data-mic-pill]');
          await sleep(800);
          pill = await popup.locator('[data-mic-pill]').getAttribute('data-mic-pill');
        }
      } else if (!mic && pill === 'on') {
        await xclickPopup(popup, '[data-mic-pill]');
        await sleep(800);
        pill = await popup.locator('[data-mic-pill]').getAttribute('data-mic-pill');
      }
      await xclickPopup(popup, '[data-row-chevron="record"]');
      await xclickPopup(popup, '[data-row-options="record"] [data-value="desktop"]');
      await xclickPopup(popup, '[data-row-main="record"]');
      const live = await until(async () => (await barOf(page))?.attrs['data-state'] === 'recording', 30_000, 50);
      const micState = (await shadowOne(page, 'data-nb-mic'))?.attrs['data-nb-mic'];
      await sleep(3000);
      await xclickEl(page, page.getByTestId('works'));
      await sleep(5000);
      await xclickEl(page, page.getByTestId('hidden-500'));
      await sleep(5000);
      await xclickEl(page, page.getByTestId('throws'));
      await sleep(Math.max(1000, seconds * 1000 - (Date.now() - live.at)));
      await xclickShadow(page, 'data-nb-stop');
      const f = await editorFrame(page, 90_000);
      await sleep(1000);
      const made = await createDraft(b.context, page, f, title, 'S3.5');
      const sess = await session(b.sw);
      return { ...made, pill, micState, wallMs: made.createdAt - live.at, sessionAfter: sess?.state };
    };

    // 1, 2. narration on: time from create to a transcript
    const c1 = await calm(120_000);
    const on = await record(true, 'parity S3.5 narration', 30);
    const t0 = on.createdAt;
    const tr = await until(
      async () => {
        const r = await api<{ status: string; cues: { startMs: number; endMs: number; text: string }[]; language: string | null; reason: string | null }>(b.context, 'GET', `/api/v1/recordings/${on.id}/transcript`);
        return r.body && (r.body.status === 'done' || r.body.status === 'failed') ? r.body : null;
      },
      300_000,
      1000,
    ).catch(() => null);
    const detail = (await api<{ streams?: unknown; transcript?: unknown }>(b.context, 'GET', `/api/v1/recordings/${on.id}`)).body;
    ev.set('step2-transcript (J-074)', {
      capture: on,
      createToTranscriptS: tr ? secs(tr.at - t0) : null,
      withinTwoMinutes: tr ? tr.at - t0 <= 120_000 : false,
      loadAtStart: c1.load,
      loadAtEnd: load(),
      status: tr?.value?.status ?? 'timeout',
      language: tr?.value?.language,
      cues: tr?.value?.cues.map((c) => `${secs(c.startMs)}-${secs(c.endMs)}s ${c.text}`),
      reason: tr?.value?.reason,
      streams: detail.streams,
    });
    const cap = await b.context.newPage();
    await cap.setViewportSize({ width: 1440, height: 900 });
    await cap.goto(`${SERVER}/c/${on.id}`);
    await cap.waitForLoadState('networkidle').catch(() => undefined);
    await sleep(1500);
    const transcriptUi = await cap.locator('[data-testid="transcript"], [data-testid="cc"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    if (await cap.getByTestId('cc').count()) {
      await cap.getByTestId('video-card').hover();
      await cap.getByTestId('cc').click().catch(() => undefined);
      await cap.getByTestId('video').evaluate((v: HTMLVideoElement) => (v.currentTime = 6));
      await sleep(800);
    }
    const caption = (await cap.getByTestId('caption').textContent().catch(() => null))?.trim() ?? null;
    await cap.screenshot({ path: ev.file('2-transcript') });
    ev.set('step2-viewer', { controls: transcriptUi, captionAt6s: caption });
    await cap.close();

    // 3. microphone off: no transcribe job
    const off = await record(false, 'parity S3.5 mic off', 15);
    await sleep(15_000);
    const tOff = await api<{ status: string; reason: string | null; cues: unknown[] }>(b.context, 'GET', `/api/v1/recordings/${off.id}/transcript`);
    const dOff = (await api<{ streams?: unknown; transcript?: unknown }>(b.context, 'GET', `/api/v1/recordings/${off.id}`)).body;
    ev.set('step3-mic-off', { capture: off, transcript: tOff.body, detailTranscript: dOff.transcript, streams: dOff.streams });
  } finally {
    await b.close();
  }
  ev.set('load-end', load());
});

// ================================================================ S3.6

/**
 * The first video frame of a chord recording (J-006, J-027, J-181): the video must open on the
 * page, never on the countdown veil or its card. Each run starts a tab recording with the chord,
 * stops it after 1.5 s, reads the draft video from the editor, and compares the brightness of the
 * first frame with a frame 0.6 s in (the veil darkens the page by about half). The second half
 * of the runs adds two busy loops, to load the 4 CPUs. The draft is discarded; nothing uploads.
 */
test('S3.6 first video frame of chord recordings (J-006)', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S3.6');
  const { context } = await getRig();
  ev.set('load-start', load());
  const page = await freshLab(context);
  await sleep(2000);
  const n = Number(process.env.PARITY_FIRST_FRAME_RUNS ?? 12);
  const runs: Record<string, unknown>[] = [];
  const dir = path.join(ev.dir, 'S3.6-videos');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    const busy: ChildProcess[] = i >= n / 2 ? [0, 1].map(() => spawn('sh', ['-c', 'while :; do :; done'], { stdio: 'ignore' })) : [];
    try {
      if (busy.length) await sleep(3000);
      const loadAtStart = load();
      await focusWindow(page);
      xkey('ctrl+shift+space');
      await until(async () => (await barOf(page))?.attrs['data-state'] === 'recording', 30_000, 30);
      await sleep(1500);
      await focusWindow(page);
      xkey('ctrl+shift+space');
      const f = await editorFrame(page, 90_000);
      const b64 = (
        await until(
          async () =>
            f.evaluate(async () => {
              const v = document.querySelector('video');
              if (!v?.src) return null;
              const buf = new Uint8Array(await (await fetch(v.src)).arrayBuffer());
              let bin = '';
              for (let k = 0; k < buf.length; k += 0x8000) bin += String.fromCharCode(...buf.subarray(k, k + 0x8000));
              return btoa(bin);
            }),
          30_000,
          200,
        )
      ).value;
      const file = path.join(dir, `run-${i + 1}.webm`);
      fs.writeFileSync(file, Buffer.from(b64!, 'base64'));
      const firstPts = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-read_intervals', '%+#1', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split('\n')[0]);
      const mean = (args: string[], png: string) => {
        execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-i', file, '-frames:v', '1', png]);
        return Number(execFileSync('magick', [png, '-colorspace', 'gray', '-format', '%[fx:mean]', 'info:'], { encoding: 'utf8' }).trim());
      };
      const first = mean([], path.join(dir, `run-${i + 1}-first.png`));
      const later = mean(['-ss', '0.6'], path.join(dir, `run-${i + 1}-0.6s.png`));
      runs.push({ run: i + 1, busyLoops: busy.length, load: loadAtStart, firstPts, firstMean: Math.round(first * 1000) / 1000, laterMean: Math.round(later * 1000) / 1000, veil: first < later * 0.8 });
      await xclickEl(page, f.getByTestId('close'));
      await until(async () => !hasEditor(page), 15_000);
      await sleep(1500);
    } finally {
      for (const b of busy) b.kill();
    }
  }
  ev.set('runs', runs);
  ev.set('veilFrames', runs.filter((r) => r.veil).length);
  ev.set('load-end', load());
});
