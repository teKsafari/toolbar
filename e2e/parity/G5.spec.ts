// Parity group G5, Nib side: sharing, permissions, comments and notifications
// (docs/parity/scenarios.md, S5.1 to S5.3). Each test is one scenario, run as scripted, and
// records its evidence (states, counts, clicks, API statuses, timings with the load average,
// screenshots) in e2e/parity-shots/G5/<scenario>.json and .png files. The raw results are
// written up in docs/parity/G5-replica.md.
//
//   cd e2e && PARITY_EXT_BUILD=chrome-mv3-g5 npx playwright test -c playwright.parity.config.ts G5
//   cd e2e && npx playwright test -c playwright.parity.config.ts G5 -g S5.2   # one
//
// Owner scope (docs/scope.md): every Mailpit and email check is skipped, notification settings
// (J-136) are paused and not run, invites are by link. Where the script says "open the mail's
// link", the spec opens the same /invite/<id> page the mail would carry, with the id the inviter
// sees through the API.
//
// Browsers: the owner is `parity@example.com` in the G1 rig (release extension build, private
// Xvfb display, signed in through the popup). Signed-out people and the other members
// (mate@, creator@, viewer@example.com) use a second, plain Chromium on the same display with
// a fresh context each, so no session leaks between them. Captures: N1 is the S3.1 tab
// recording, N4 the S2.1 annotated screenshot (ids as in G4). S5.3 works in N4's workspace
// ("Parity") and its folder ("parity"), and puts the owner's active workspace back at the end.
import { chromium, expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DISPLAY,
  Evidence,
  LAB_URL,
  PASSWORD,
  ROOT,
  SERVER,
  api,
  availableMb,
  calm,
  clickIcon,
  clipboard,
  editorFrame,
  labPage,
  launchNib,
  load,
  screencast,
  firstMatching,
  secs,
  shadowOne,
  signIn,
  sleep,
  toScreen,
  until,
  xclick,
  xclickEl,
  xclickPopup,
  xdo,
  xkey,
  type Launched,
} from './rig.ts';

const GROUP = 'G5';
const EMAIL = process.env.PARITY_EMAIL ?? 'parity@example.com';
const MATE = 'mate@example.com';
const CREATOR = 'creator@example.com';
const VIEWER = 'viewer@example.com';
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

/** A plain Chromium (no extension, no profile) for signed-out people and the other members. */
async function getPlain(): Promise<Browser> {
  if (plain) return plain;
  const free = availableMb();
  if (free < 1600) throw new Error(`only ${free} MB available; a second browser needs about 800 MB and 800 MB must stay free`);
  plain = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY }, args: ['--force-device-scale-factor=1', '--window-position=0,0', '--window-size=1448,991'] });
  return plain;
}

async function freshContext(o: { w?: number; h?: number; theme?: 'light' | 'dark' } = {}): Promise<BrowserContext> {
  const b = await getPlain();
  const c = await b.newContext({ viewport: { width: o.w ?? 1440, height: o.h ?? 900 }, colorScheme: o.theme ?? 'light', acceptDownloads: true });
  await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });
  return c;
}

test.afterAll(async () => {
  await plain?.close().catch(() => undefined);
  plain = null;
  await rig?.close();
  rig = null;
});

/** Run one check; a failure is recorded as evidence and does not end the scenario. */
async function probe<T>(ev: Evidence, key: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now();
  try {
    const v = await fn();
    ev.set(key, v);
    console.log(`${ev.scenario} ${key} took ${secs(Date.now() - t0)} s`);
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
  // only the capture and share pages mark hydration; dashboard and settings pages settle on networkidle
  if (/\/(c|s)\//.test(new URL(p.url()).pathname)) await p.locator('.page[data-hydrated]').waitFor({ timeout: 30_000 }).catch(() => undefined);
  await p.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await sleep(500);
}

async function openCap(context: BrowserContext, id: string, o: { w?: number; h?: number; theme?: Theme; page?: Page } = {}) {
  const cap = o.page ?? (await context.newPage());
  await cap.setViewportSize({ width: o.w ?? 1440, height: o.h ?? 900 });
  await cap.emulateMedia({ colorScheme: o.theme ?? 'light' });
  await cap.bringToFront();
  await cap.goto(`${SERVER}/c/${id}`);
  await ready(cap);
  return cap;
}

async function openUrl(context: BrowserContext, url: string, o: { w?: number; h?: number; theme?: Theme } = {}) {
  const p = await context.newPage();
  await p.setViewportSize({ width: o.w ?? 1440, height: o.h ?? 900 });
  await p.emulateMedia({ colorScheme: o.theme ?? 'light' });
  await p.bringToFront();
  await p.goto(url);
  await ready(p);
  return p;
}

const overflowX = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

/** One page state at 1440 and 390, light and dark, through `open`; returns sideways overflow per variant. */
async function shoot4(ev: Evidence, step: string, open: (w: number, h: number, theme: Theme) => Promise<{ page: Page; done: () => Promise<void> }>, setup: (p: Page) => Promise<void> = async () => undefined) {
  const out: Record<string, boolean | string> = {};
  for (const [w, h, theme] of VARIANTS) {
    let done: (() => Promise<void>) | null = null;
    try {
      const o = await open(w, h, theme);
      done = o.done;
      await setup(o.page);
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

/** Owner pages in the rig browser. */
const ownerOpen = (context: BrowserContext, url: string) => async (w: number, h: number, theme: Theme) => {
  const page = await openUrl(context, url, { w, h, theme });
  return { page, done: () => page.close() };
};

/** Signed-out pages, each in a fresh context of the plain browser. */
const anonOpen = (url: string) => async (w: number, h: number, theme: Theme) => {
  const c = await freshContext({ w, h, theme });
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

async function toastText(p: Page) {
  return txt(await p.locator('.nb-toaster').textContent().catch(() => ''));
}

async function videoState(cap: Page) {
  return cap.evaluate(() => {
    const v = document.querySelector('[data-testid="video"]') as HTMLVideoElement | null;
    return { paused: v?.paused ?? null, t: v ? Math.round(v.currentTime * 10) / 10 : null, duration: v ? Math.round(v.duration * 10) / 10 : null };
  });
}

/** Seek the paused video to `s` seconds with one click on the seek bar. */
async function seekTo(cap: Page, s: number) {
  await cap.waitForFunction(() => {
    const v = document.querySelector('[data-testid="video"]') as HTMLVideoElement | null;
    return !!v && v.readyState >= 1 && Number.isFinite(v.duration);
  });
  const st = await videoState(cap);
  if (st.paused === false) await cap.getByTestId('play').click();
  const card = (await boxOf(cap.getByTestId('video-card')))!;
  await cap.mouse.move(card.x + card.w / 2, card.y + card.h / 2);
  await sleep(300);
  const bar = (await boxOf(cap.getByTestId('seekbar')))!;
  await cap.mouse.click(bar.x + (bar.w * s) / st.duration!, bar.y + bar.h / 2);
  await sleep(600);
  // the click lands within a pixel of the target; nudge to the exact second the script names
  const now = await videoState(cap);
  if (Math.abs((now.t ?? 0) - s) > 0.05)
    await cap.evaluate((t) => {
      const v = document.querySelector('[data-testid="video"]') as HTMLVideoElement;
      v.currentTime = t;
    }, s);
  await sleep(400);
  return videoState(cap);
}

/** Sign a fresh context in through the login page (account made on first sign-in). */
async function webSignIn(p: Page, email: string) {
  if (!/\/login/.test(p.url())) await p.goto(`${SERVER}/login`);
  await p.waitForLoadState('networkidle').catch(() => undefined);
  for (let attempt = 0; attempt < 6; attempt++) {
    await expect(async () => {
      if (!(await p.getByLabel('Password').isVisible())) await p.getByRole('button', { name: 'Use a password instead' }).click({ timeout: 2000 });
      await expect(p.getByLabel('Password')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await p.getByLabel('Work email').fill(email);
    await p.getByLabel('Password').fill(PASSWORD);
    await p.getByRole('button', { name: 'Continue', exact: true }).click();
    const left = await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }).then(() => true).catch(() => false);
    if (left) {
      await p.waitForLoadState('networkidle').catch(() => undefined);
      return;
    }
    await sleep(11_000); // sign-in rate limit: 3 tries per 10 s per address
  }
  throw new Error(`could not sign in as ${email}`);
}

async function myWorkspaces(context: BrowserContext) {
  return (await api<{ items: { id: string; name: string; role: string }[]; activeId: string }>(context, 'GET', '/api/v1/workspaces')).body;
}

/** Join a workspace through an /invite/<id> page in `p` (signed out: signs in as `email` first). */
async function joinVia(p: Page, inviteUrl: string, email: string) {
  await p.goto(inviteUrl);
  await p.waitForLoadState('networkidle').catch(() => undefined);
  const heading = txt(await p.locator('main h1').textContent().catch(() => ''));
  const intro = txt(await p.locator('main p.muted').first().textContent().catch(() => ''));
  if (await p.getByRole('link', { name: 'Sign in to join' }).count()) {
    await p.getByRole('link', { name: 'Sign in to join' }).click();
    await p.waitForURL(/\/login/);
    await webSignIn(p, email);
    if (!/\/invite\//.test(p.url())) await p.goto(inviteUrl);
    await p.waitForLoadState('networkidle').catch(() => undefined);
  }
  const already = await p.getByText('You are already a member.').count();
  if (!already) {
    await p.getByRole('button', { name: /^Join / }).click();
    await p.waitForURL(/joined=1/, { timeout: 30_000 });
    await p.waitForLoadState('networkidle').catch(() => undefined);
  }
  return { heading, intro, already: !!already };
}

// ================================================================ S5.1

test('S5.1 share links and the logged-out viewer (N1)', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S5.1');
  const { context } = await getRig();
  const id = N1();
  ev.set('capture', id);
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  const share = (await api<{ access: string; link: { url: string }; contentOnlyLink: { url: string } }>(context, 'GET', `/api/v1/recordings/${id}/share`)).body;
  ev.set('share-settings', { access: share.access, full: share.link.url, contentOnly: share.contentOnlyLink.url });
  const cap = await openCap(context, id);

  // 1. copy link: tick for about 2 s, a toast, the link on the clipboard
  await probe(ev, 'step1-copy-link (J-117)', async () => {
    await cap.evaluate(() => navigator.clipboard.writeText('before-S5.1'));
    const btn = cap.getByTestId('copy-link');
    const before = txt(await btn.textContent());
    const t0 = Date.now();
    await btn.click();
    const changed = await until(async () => (txt(await btn.textContent()) !== before ? txt(await btn.textContent()) : null), 3000, 20);
    const hasTick = await btn.evaluate((e) => !!e.querySelector('svg, [data-icon]') && /Copied/.test(e.textContent ?? ''));
    await sleep(150);
    const toast = await toastText(cap);
    await cap.screenshot({ path: ev.file('1-copied'), clip: { x: 700, y: 0, width: 740, height: 140 } });
    const reverted = await until(async () => (txt(await btn.textContent()) === before ? true : null), 5000, 20);
    const link = await readClipboard(cap);
    return { before, during: changed.value, tick: hasTick, labelChangedAfterMs: changed.at - t0, labelShownMs: reverted.at - changed.at, toast, clipboard: link, isShareLink: link === share.link.url, clicks: 1 };
  });

  // 2. the caret: popover; the content-only card; that link opened
  await probe(ev, 'step2-popover (J-118)', async () => {
    await cap.getByTestId('share-caret').click();
    const pop = cap.getByTestId('share-popover');
    await pop.waitFor();
    await sleep(300);
    const box = (await boxOf(pop))!;
    await cap.screenshot({ path: ev.file('2-popover'), clip: { x: Math.max(0, box.x - 20), y: 0, width: Math.min(1440 - Math.max(0, box.x - 20), box.w + 40), height: box.y + box.h + 20 } });
    const cards = await pop.locator('button').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
    const access = txt(await pop.getByTestId('share-access').textContent().catch(() => ''));
    await pop.getByTestId('share-content').click();
    await sleep(500);
    const toast = await toastText(cap);
    const link = await readClipboard(cap);
    const inspect = async (p: Page) => ({
      url: p.url().replace(SERVER, ''),
      media: (await p.locator('[data-testid="video"], [data-testid="media"]').count()) > 0,
      title: txt(await p.getByTestId('title').textContent().catch(() => '')),
      description: await p.getByTestId('description').count(),
      comments: await p.getByTestId('comments').count(),
      devtoolsTabs: await p.locator('[data-testid^="tab-"]').count(),
      devtoolsToggle: await p.locator('[data-testid="show-devtools"], [data-testid="narrow-devtools"]').count(),
    });
    const asOwner = await openUrl(context, link);
    const owner = await inspect(asOwner);
    await asOwner.screenshot({ path: ev.file('2-content-only-owner') });
    await asOwner.close();
    const c = await freshContext();
    const anonP = await c.newPage();
    await anonP.goto(link);
    await ready(anonP);
    const anon = await inspect(anonP);
    await anonP.screenshot({ path: ev.file('2-content-only-signed-out') });
    await c.close();
    await cap.bringToFront();
    return { popoverBox: box, cards, access, toast, link, isContentOnly: link === share.contentOnlyLink.url, openedAsOwner: owner, openedSignedOut: anon, clicks: 2 };
  });
  ev.set(
    'step2-popover-shots-overflow',
    await shoot4(ev, '2-popover', ownerOpen(context, `${SERVER}/c/${id}`), async (p) => {
      await p.getByTestId('share-caret').click();
      await p.getByTestId('share-popover').waitFor();
    }),
  );

  // 3. general access: the control and its choices; members-only, then back to anyone
  await probe(ev, 'step3-general-access (J-119)', async () => {
    await cap.reload();
    await ready(cap);
    await cap.getByTestId('share-caret').click();
    const pop = cap.getByTestId('share-popover');
    await pop.waitFor();
    const controls = await pop.locator('select, [role="radio"], [role="combobox"], [role="menuitemradio"], input, [aria-haspopup]').count();
    const accessLine = txt(await pop.getByTestId('share-access').textContent().catch(() => ''));
    const accessClickable = await pop.getByTestId('share-access').evaluate((e) => e.tagName === 'BUTTON' || !!e.querySelector('button, select')).catch(() => false);
    await cap.screenshot({ path: ev.file('3-access-line') });
    await cap.keyboard.press('Escape');
    // no control in the UI: the same change through the API the page would call (sharing.update)
    const set = await api<{ access: string }>(context, 'PATCH', `/api/v1/recordings/${id}/share`, { access: 'workspace' });
    const c = await freshContext();
    const p = await c.newPage();
    const r = await p.goto(share.link.url);
    await p.waitForLoadState('networkidle').catch(() => undefined);
    const signedOut = { finalUrl: p.url().replace(SERVER, ''), status: r?.status() ?? null, heading: txt(await p.locator('h1').first().textContent().catch(() => '')) };
    await p.screenshot({ path: ev.file('3-members-only-signed-out') });
    // the popover's line while members-only
    await cap.reload();
    await ready(cap);
    await cap.getByTestId('share-caret').click();
    await cap.getByTestId('share-popover').waitFor();
    const lineWhileMembers = txt(await cap.getByTestId('share-access').textContent().catch(() => ''));
    await cap.screenshot({ path: ev.file('3-access-line-members') });
    await cap.keyboard.press('Escape');
    const back = await api<{ access: string }>(context, 'PATCH', `/api/v1/recordings/${id}/share`, { access: 'anyone' });
    const r2 = await p.goto(share.link.url);
    await p.waitForLoadState('networkidle').catch(() => undefined);
    const afterBack = { finalUrl: p.url().replace(SERVER, ''), status: r2?.status() ?? null };
    await c.close();
    return { uiControls: controls, accessLine, accessLineIsControl: accessClickable, lineWhileMembers, setMembersOnly: { status: set.status, access: set.body?.access }, signedOutWhileMembersOnly: signedOut, setBack: { status: back.status, access: back.body?.access }, signedOutAfterBack: afterBack };
  });

  // 4. the full link signed out: first contentful paint and load, three times
  await probe(ev, 'step4-signed-out-load (J-198)', async () => {
    const runs: unknown[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await freshContext();
      const p = await c.newPage();
      const m = await calm(300_000);
      await p.goto(share.link.url, { waitUntil: 'load' });
      await sleep(300);
      const t = await p.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return { fcpMs: fcp ? Math.round(fcp.startTime) : null, loadMs: Math.round(nav.loadEventEnd), domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd), url: location.pathname };
      });
      await ready(p);
      const hydratedAt = await p.evaluate(() => Math.round(performance.now()));
      if (i === 0) await p.screenshot({ path: ev.file('4-signed-out') });
      runs.push({ ...t, fcpS: t.fcpMs === null ? null : secs(t.fcpMs), loadS: secs(t.loadMs), load: m.load, reliable: m.reliable, settledAtMs: hydratedAt });
      await c.close();
      await sleep(1500);
    }
    const med = (k: 'fcpMs' | 'loadMs') => {
      const v = (runs as Record<string, number>[]).map((r) => r[k] ?? 0).sort((a, b) => a - b);
      return v[1] ?? 0;
    };
    return { runs, medianFcpS: secs(med('fcpMs')), medianLoadS: secs(med('loadMs')) };
  });
  ev.set('step4-signed-out-shots-overflow', await shoot4(ev, '4-signed-out', anonOpen(share.link.url)));

  // 5. signed out: every tab, copy as cURL, share at time, download, header, title
  await probe(ev, 'step5-signed-out-checks (J-121)', async () => {
    const c = await freshContext();
    const p = await c.newPage();
    await p.goto(share.link.url);
    await ready(p);
    const out: Record<string, unknown> = { url: p.url().replace(SERVER, '') };
    const tabs = await p.locator('[data-testid^="tab-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
    const opened: Record<string, unknown> = {};
    for (const t of tabs) {
      await p.getByTestId(t).click();
      await sleep(500);
      opened[t] = {
        selected: await p.getByTestId(t).getAttribute('aria-selected'),
        rows: await p.locator('[data-testid="right-panel"] [data-row-index], [data-testid="right-panel"] tr, [data-testid="right-panel"] dt').count(),
        text: txt(await p.getByTestId('right-panel').textContent().catch(() => '')).slice(0, 120),
      };
    }
    out.tabs = opened;
    // copy as cURL on the failed POST
    await p.getByTestId('tab-network').click();
    await sleep(400);
    await p.locator('[data-testid="network-list"] [data-row-index]', { hasText: '/api/fail' }).first().click();
    await p.getByTestId('copy-curl').click();
    await sleep(500);
    const curl = await readClipboard(p);
    out.curl = { toast: await toastText(p), firstLine: curl.split('\n')[0], hasPost: /-X POST/.test(curl), bytes: curl.length };
    await p.getByTestId('close-detail').click().catch(() => undefined);
    // share at time
    const st = await seekTo(p, 12);
    await p.getByTestId('share-at-time').click();
    await sleep(600);
    const atLink = await readClipboard(p);
    out.shareAtTime = { seekedTo: st.t, link: atLink.replace(SERVER, ''), hasT: /[?&]t=12/.test(atLink), toast: await toastText(p) };
    // download
    const card = (await boxOf(p.getByTestId('video-card')))!;
    await p.mouse.move(card.x + card.w / 2, card.y + card.h / 2);
    const dl = p.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
    await p.getByTestId('download').click();
    const d = await dl;
    let bytes: number | null = null;
    if (d) {
      const f = await d.path().catch(() => null);
      if (f && fs.existsSync(f)) bytes = fs.statSync(f).size;
    }
    out.download = { fired: !!d, filename: d?.suggestedFilename() ?? null, bytes };
    // header and title
    const hdr = p.getByTestId('viewer-header');
    out.header = await hdr.locator('a, button').evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim()));
    await p.getByTestId('title').click();
    await sleep(400);
    out.title = { inputAfterClick: await p.getByTestId('title-input').count(), editableClass: await p.getByTestId('title').evaluate((e) => e.classList.contains('editable')), descriptionEditable: await p.getByTestId('description').evaluate((e) => e.classList.contains('editable')).catch(() => null) };
    out.composer = { present: await p.getByTestId('comment-input').count(), placeholder: await p.getByTestId('comment-input').getAttribute('placeholder').catch(() => null) };
    await p.screenshot({ path: ev.file('5-signed-out-checked') });
    await c.close();
    return out;
  });
  await cap.close();
  ev.set('load-end', load());
});

// ================================================================ S5.2

test('S5.2 comments (N1, N4); mentions; notification settings paused', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S5.2');
  const { context } = await getRig();
  const id = N1();
  const n4 = N4();
  ev.set('captures', { N1: id, N4: n4 });
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  // a repeatable start: comments left on N1 by an interrupted run of this scenario go first
  const left = (await api<{ items: { id: string; body: string }[] }>(context, 'GET', `/api/v1/recordings/${id}/comments`)).body.items.filter((c) => /parity S5\.2 line|mention check/.test(c.body));
  ev.set('setup-leftovers-deleted', await Promise.all(left.map(async (c) => (await api(context, 'DELETE', `/api/v1/comments/${c.id}`)).status)));
  const cap = await openCap(context, id);
  let mine: string | null = null;

  // 1. seek to 0:05, the composer's send pill, two lines, Ctrl+Enter, time to clear
  await probe(ev, 'step1-timed-comment (J-127)', async () => {
    const st = await seekTo(cap, 5);
    const input = cap.getByTestId('comment-input');
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await sleep(300);
    const sendBefore = { label: await cap.getByTestId('send').getAttribute('aria-label'), text: txt(await cap.getByTestId('send').textContent()) };
    await cap.keyboard.type('parity S5.2 line one', { delay: 30 });
    await cap.keyboard.press('Enter');
    await cap.keyboard.type('parity S5.2 line two', { delay: 30 });
    await sleep(300);
    const sendTyped = { label: await cap.getByTestId('send').getAttribute('aria-label'), text: txt(await cap.getByTestId('send').textContent()), value: await input.inputValue() };
    await cap.screenshot({ path: ev.file('1-composer-typed') });
    const region = (await boxOf(input))!;
    const m = await calm(300_000);
    const sc = await screencast(cap);
    await sleep(400);
    const t0 = Date.now();
    await cap.keyboard.press('Control+Enter');
    const cleared = await until(async () => ((await input.inputValue()) === '' ? true : null), 5000, 5);
    const listed = await until(async () => (await cap.locator('[data-testid="comment"]', { hasText: 'parity S5.2 line two' }).count()) || null, 10_000, 10);
    const saved = await until(async () => {
      const el = cap.locator('[data-testid="comment"]', { hasText: 'parity S5.2 line two' }).first();
      const cid = await el.getAttribute('data-comment-id');
      return cid && !cid.startsWith('tmp-') ? cid : null;
    }, 10_000, 20);
    await sleep(500);
    const frames = await sc.stop();
    const fm = firstMatching(frames, t0, { x: region.x, y: region.y, w: region.w, h: region.h }, { share: 0.8 });
    mine = saved.value;
    await cap.screenshot({ path: ev.file('1-sent') });
    return {
      seekedTo: st.t,
      sendBefore,
      sendTyped,
      clear: { domMs: cleared.at - t0, frameMs: fm ? Math.round(fm.t - t0) : null, seconds: fm ? secs(fm.t - t0) : secs(cleared.at - t0), load: m.load, reliable: m.reliable, frames: frames.length },
      listedAfterMs: listed.at - t0,
      savedAfterMs: saved.at - t0,
      commentId: saved.value,
      clicks: '1 (seek bar) + 1 (composer); chord Ctrl+Enter',
    };
  });

  // 2. the bubble at 0:05, its hover card; the time chip seeks, scrolls up and highlights
  await probe(ev, 'step2-markers (J-128)', async () => {
    const bubble = cap.getByTestId('marker-comment').first();
    await bubble.waitFor({ timeout: 10_000 });
    const all = await cap.getByTestId('marker-comment').count();
    const bar = (await boxOf(cap.getByTestId('seekbar')))!;
    const bb = (await boxOf(bubble))!;
    const dur = (await videoState(cap)).duration!;
    const atSec = Math.round((((bb.x + bb.w / 2 - bar.x) / bar.w) * dur) * 10) / 10;
    const card = (await boxOf(cap.getByTestId('video-card')))!;
    await cap.mouse.move(card.x + card.w / 2, card.y + card.h / 2);
    await sleep(200);
    await bubble.hover();
    await sleep(500);
    const tip = txt(await cap.getByTestId('marker-tip').textContent().catch(() => ''));
    await cap.screenshot({ path: ev.file('2-bubble-hover'), clip: { x: card.x, y: Math.max(0, bb.y - 160), width: card.w, height: 220 } });
    // play on a little, scroll down to the comment, click its time chip
    await cap.evaluate(() => {
      const v = document.querySelector('[data-testid="video"]') as HTMLVideoElement;
      v.currentTime = 40;
    });
    await sleep(500);
    const item = mine ? cap.locator(`[data-comment-id="${mine}"]`) : cap.locator('[data-testid="comment"]', { hasText: 'parity S5.2 line two' }).first();
    await item.scrollIntoViewIfNeeded();
    await cap.mouse.wheel(0, 400);
    await sleep(500);
    const before = { scrollY: await cap.evaluate(() => Math.round(window.scrollY)), mediaTop: (await boxOf(cap.getByTestId('video-card')))?.y, t: (await videoState(cap)).t };
    await item.getByTestId('comment-time').click();
    await sleep(1200);
    const after = {
      scrollY: await cap.evaluate(() => Math.round(window.scrollY)),
      mediaTop: (await boxOf(cap.getByTestId('video-card')))?.y,
      t: (await videoState(cap)).t,
      highlighted: await item.evaluate((e) => e.classList.contains('hl')),
      chip: txt(await item.getByTestId('comment-time').textContent()),
    };
    await cap.screenshot({ path: ev.file('2-after-chip') });
    // the scrolling container may be an inner column rather than the window
    const scrollers = await cap.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== 'visible').map((e) => ({ tag: e.tagName.toLowerCase(), cls: (e as HTMLElement).className.toString().slice(0, 40), top: Math.round(e.scrollTop) })).slice(0, 6));
    // at 1440 the comment and the player share the first screen; at 390 the list sits below the player
    const narrow = await openCap(context, id, { w: 390, h: 844 });
    const nItem = narrow.locator(`[data-comment-id="${mine}"]`);
    await nItem.scrollIntoViewIfNeeded();
    await sleep(500);
    const scrollState = () =>
      nItem.evaluate((el) => {
        let p: HTMLElement | null = el.parentElement;
        while (p && !(p.scrollHeight > p.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
        const media = document.querySelector('[data-testid="video-card"]')!.getBoundingClientRect();
        return { container: p ? `${p.tagName.toLowerCase()}.${p.className.toString().split(' ')[0]}` : 'window', scrollTop: Math.round(p ? p.scrollTop : window.scrollY), mediaTop: Math.round(media.top), mediaVisible: media.bottom > 0 && media.top < innerHeight, commentTop: Math.round(el.getBoundingClientRect().top) };
      });
    const nBefore = await scrollState();
    await nItem.getByTestId('comment-time').click();
    await sleep(1500);
    const nAfter = { ...(await scrollState()), t: (await videoState(narrow)).t, highlighted: await nItem.evaluate((e) => e.classList.contains('hl')) };
    await narrow.screenshot({ path: ev.file('2-after-chip', '390') });
    await narrow.close();
    await cap.bringToFront();
    return { bubbles: all, bubbleAtSec: atSec, tip, before, after, scrollers, at390: { before: nBefore, after: nAfter }, clicks: 1 };
  });

  // 3. edit (edited label), then delete with its warning
  await probe(ev, 'step3-edit-delete (J-131)', async () => {
    const item = cap.locator(`[data-comment-id="${mine}"]`);
    await item.scrollIntoViewIfNeeded();
    await item.hover();
    await sleep(300);
    const menuBtn = item.getByTestId('comment-more');
    const visibleOnHover = await menuBtn.isVisible();
    await menuBtn.click();
    await sleep(300);
    const items = await cap.locator('[role="menu"] [role="menuitem"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    await cap.screenshot({ path: ev.file('3-menu') });
    await cap.getByRole('menuitem', { name: 'Edit' }).click();
    const edit = item.getByTestId('edit-input');
    await edit.waitFor();
    await edit.press('Control+End');
    await cap.keyboard.type(' edited', { delay: 30 });
    await item.getByTestId('save-edit').click();
    await item.getByTestId('edited').waitFor({ timeout: 10_000 });
    const edited = { label: txt(await item.getByTestId('edited').textContent()), body: txt(await item.getByTestId('comment-body').textContent()) };
    await cap.screenshot({ path: ev.file('3-edited') });
    await item.hover();
    await item.getByTestId('comment-more').click();
    await cap.getByRole('menuitem', { name: 'Delete' }).click();
    const modal = cap.locator('[role="alertdialog"]').filter({ hasText: 'Delete this comment?' }).first();
    await modal.waitFor();
    const warning = txt(await modal.textContent());
    await cap.screenshot({ path: ev.file('3-delete-warning') });
    await modal.locator('[data-confirm]').click();
    await until(async () => ((await cap.locator(`[data-comment-id="${mine}"]`).count()) === 0 ? true : null), 10_000, 50);
    const toast = await toastText(cap);
    const apiAfter = await api<{ items: { id: string }[] }>(context, 'GET', `/api/v1/recordings/${id}/comments`);
    return { menuVisibleOnHover: visibleOnHover, menu: items, edited, warning, toast, goneFromApi: !(apiAfter.body?.items ?? []).some((c) => c.id === mine), clicks: { edit: '2 (menu, Edit) + 1 (Save)', delete: '2 (menu, Delete) + 1 (confirm)' } };
  });

  // 4. N4 signed out: an anonymous comment; the owner cannot delete it
  await probe(ev, 'step4-anonymous (J-134)', async () => {
    const s4 = (await api<{ link: { url: string } }>(context, 'GET', `/api/v1/recordings/${n4}/share`)).body.link.url;
    const c = await freshContext();
    const p = await c.newPage();
    await p.goto(s4);
    await ready(p);
    const input = p.getByTestId('comment-input');
    const placeholder = await input.getAttribute('placeholder');
    await input.click();
    await p.keyboard.type('anonymous parity note', { delay: 30 });
    await p.keyboard.press('Control+Enter');
    const saved = await until(async () => {
      const el = p.locator('[data-testid="comment"]', { hasText: 'anonymous parity note' }).last();
      const cid = await el.getAttribute('data-comment-id').catch(() => null);
      return cid && !cid.startsWith('tmp-') ? cid : null;
    }, 15_000, 50);
    const el = p.locator(`[data-comment-id="${saved.value}"]`);
    const shown = { name: txt(await el.locator('.name').textContent()), tag: txt(await el.locator('.tag').textContent().catch(() => '')), avatarLetter: txt(await el.locator('.av').first().textContent().catch(() => '')), avatarIsImage: (await el.locator('img.av').count()) > 0 };
    await el.scrollIntoViewIfNeeded();
    await p.screenshot({ path: ev.file('4-anonymous-signed-out') });
    await c.close();
    const owner = await openCap(context, n4);
    const mineEl = owner.locator(`[data-comment-id="${saved.value}"]`);
    await mineEl.scrollIntoViewIfNeeded();
    await mineEl.hover();
    await sleep(300);
    const ownerView = { listed: await mineEl.count(), menu: await mineEl.getByTestId('comment-more').count(), name: txt(await mineEl.locator('.name').textContent()) };
    await owner.screenshot({ path: ev.file('4-anonymous-owner') });
    const del = await api(context, 'DELETE', `/api/v1/comments/${saved.value}`);
    await owner.close();
    const count = (await api<{ items: { body: string; anonymous: boolean }[] }>(context, 'GET', `/api/v1/recordings/${n4}/comments`)).body.items.filter((x) => x.anonymous && /anonymous parity note/.test(x.body)).length;
    return { placeholder, commentId: saved.value, shown, ownerView, ownerApiDeleteStatus: del.status, anonymousNotesOnN4: count };
  });

  // 5. @ in a comment, in the viewer description and in a fresh draft's description
  await probe(ev, 'step5-setup-second-member', async () => {
    const ws = (await api<{ workspaceId: string }>(context, 'GET', `/api/v1/recordings/${id}`)).body.workspaceId;
    const members = (await api<{ items: { person: { email: string; name: string } }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/members`)).body.items;
    if (members.some((m) => m.person.email === MATE)) return { workspace: ws, mate: 'already a member', members: members.length };
    const link = (await api<{ enabled: boolean; url: string | null }>(context, 'GET', `/api/v1/workspaces/${ws}/invite-link`)).body;
    if (!link.enabled || !link.url) throw new Error('the invite link is off in this workspace');
    const c = await freshContext();
    const p = await c.newPage();
    const j = await joinVia(p, link.url, MATE);
    const after = await myWorkspaces(c);
    await c.close();
    return { workspace: ws, joinedWith: 'workspace invite link', join: j, mateRole: after.items.find((w) => w.id === ws)?.role ?? null };
  });
  await probe(ev, 'step5-mentions (J-135)', async () => {
    const out: Record<string, unknown> = {};
    await cap.reload();
    await ready(cap);
    // a comment
    const input = cap.getByTestId('comment-input');
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await cap.keyboard.type('mention check @', { delay: 40 });
    await sleep(400);
    const picker = cap.getByTestId('mention-picker');
    const openAll = await picker.isVisible().catch(() => false);
    const allOptions = openAll ? await picker.locator('[role="option"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())) : [];
    await cap.keyboard.type('mat', { delay: 40 });
    await sleep(300);
    const filtered = (await picker.isVisible().catch(() => false)) ? await picker.locator('[role="option"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())) : [];
    await cap.screenshot({ path: ev.file('5-comment-picker') });
    await cap.keyboard.press('Enter');
    await sleep(300);
    const value = await input.inputValue();
    await cap.keyboard.press('Control+Enter');
    const saved = await until(async () => {
      const el = cap.locator('[data-testid="comment"]', { hasText: 'mention check' }).last();
      const cid = await el.getAttribute('data-comment-id').catch(() => null);
      return cid && !cid.startsWith('tmp-') ? cid : null;
    }, 10_000, 50);
    const stored = (await api<{ items: { id: string; body: string; mentions: string[] }[] }>(context, 'GET', `/api/v1/recordings/${id}/comments`)).body.items.find((x) => x.id === saved.value);
    const rendered = txt(await cap.locator(`[data-comment-id="${saved.value}"] .nb-mention`).first().textContent().catch(() => ''));
    await cap.screenshot({ path: ev.file('5-comment-mention-sent') });
    const del = await api(context, 'DELETE', `/api/v1/comments/${saved.value}`);
    out.comment = { pickerOpensOnAt: openAll, options: allOptions, filteredByMat: filtered, textAfterPick: value, stored: stored ? { body: stored.body, mentions: stored.mentions?.length ?? 0 } : null, rendered, cleanupDelete: del.status };
    // the viewer description (Escape leaves without saving)
    await cap.reload();
    await ready(cap);
    const descBefore = (await api<{ description: string }>(context, 'GET', `/api/v1/recordings/${id}`)).body.description;
    await cap.getByTestId('description').click();
    const ta = cap.getByTestId('description-input');
    await ta.waitFor();
    await ta.press('Control+End');
    await cap.keyboard.type(' @', { delay: 40 });
    await sleep(400);
    const dOpen = await cap.getByTestId('mention-picker').isVisible().catch(() => false);
    const dOptions = dOpen ? await cap.getByTestId('mention-picker').locator('[role="option"]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())) : [];
    await cap.screenshot({ path: ev.file('5-description-picker') });
    await cap.keyboard.press('Escape');
    await sleep(200);
    if (await ta.isVisible().catch(() => false)) await cap.keyboard.press('Escape');
    await sleep(800);
    const descAfter = (await api<{ description: string }>(context, 'GET', `/api/v1/recordings/${id}`)).body.description;
    out.description = { pickerOpensOnAt: dOpen, options: dOptions, unchanged: descAfter === descBefore };
    // a fresh draft's description, in the extension's editor
    const lab = await labPage(context, '/');
    await lab.bringToFront();
    const popup = await clickIcon(context, lab);
    await xclickPopup(popup, '[data-row-main="screenshot"]');
    await until(async () => (await shadowOne(lab, 'data-nb-ui'))?.attrs['data-session'] === 'arming-screenshot', 10_000);
    const pt = await toScreen(lab, { x: 1200, y: 820 });
    xclick(pt.x, pt.y);
    const f = await editorFrame(lab);
    await sleep(800);
    await xclickEl(lab, f.getByTestId('field'));
    xkey('ctrl+End');
    xdo('type', '--delay', '60', ' @');
    await sleep(600);
    const fieldText = txt(await f.getByTestId('field').textContent().catch(() => ''));
    const draftPicker = await f.locator('[role="listbox"], [data-testid*="mention"], [aria-label*="ention"]').count();
    ev.xshot('5-draft-at', { x: 0, y: 0, w: 1460, h: 1000 });
    out.draft = { pickerOpensOnAt: draftPicker > 0, fieldEndsWith: fieldText.slice(-24) };
    await xclickEl(lab, f.getByTestId('close'));
    await sleep(800);
    await lab.close();
    return out;
  });

  // 6. notification settings: paused (docs/scope.md, FEATURE_EMAIL); not run
  ev.set('step6-notifications (J-136)', 'paused (docs/scope.md); not run');
  await cap.close();
  ev.set('load-end', load());
});

// ================================================================ S5.3

test('S5.3 folder sharing, invites and roles', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S5.3');
  const { context } = await getRig();
  const n4 = N4();
  const detail = (await api<{ workspaceId: string; folder: { id: string; name: string } | null }>(context, 'GET', `/api/v1/recordings/${n4}`)).body;
  const ws = detail.workspaceId;
  const folderId = detail.folder?.id;
  if (!folderId) throw new Error('N4 is in no folder; S6.2 puts it into "parity"');
  const startWs = await myWorkspaces(context);
  ev.set('setup', { workspace: { id: ws, name: startWs.items.find((w) => w.id === ws)?.name }, folder: detail.folder, activeBefore: startWs.activeId });
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  await api(context, 'PUT', '/api/v1/me/active-workspace', { workspaceId: ws });

  // a repeatable start: creator@ and viewer@ are not members, no pending invites, auto-approve off
  await probe(ev, 'setup-reset', async () => {
    const members = (await api<{ items: { userId: string; person: { email: string } }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/members`)).body.items;
    const removed: Record<string, number> = {};
    for (const m of members) if ([CREATOR, VIEWER].includes(m.person.email)) removed[m.person.email] = (await api(context, 'DELETE', `/api/v1/workspaces/${ws}/members/${m.userId}`)).status;
    const pend = (await api<{ items: { id: string; email: string }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/invites`)).body.items;
    const canceled: Record<string, number> = {};
    for (const i of pend) if ([CREATOR, VIEWER].includes(i.email)) canceled[i.email] = (await api(context, 'DELETE', `/api/v1/invites/${i.id}`)).status;
    const set = await api<{ settings: { autoApproveCreators: boolean } }>(context, 'PATCH', `/api/v1/workspaces/${ws}`, { autoApproveCreators: false });
    return { removed, canceled, autoApprove: set.body?.settings?.autoApproveCreators ?? set.status };
  });

  const page = await openUrl(context, `${SERVER}/f/${folderId}`);

  // 1. the folder's share popover; invite viewer@
  await probe(ev, 'step1-folder-share (J-122)', async () => {
    await page.getByTestId('folder-share').click();
    const pop = page.getByTestId('folder-share-popover');
    await pop.waitFor();
    await pop.getByTestId('folder-people').waitFor({ timeout: 10_000 });
    await sleep(300);
    const box = (await boxOf(pop))!;
    await page.screenshot({ path: ev.file('1-popover-crop'), clip: { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 70), width: Math.min(1440 - Math.max(0, box.x - 20), box.w + 40), height: box.h + 90 } });
    const parts = {
      copyLink: await pop.getByTestId('folder-copy-link').count(),
      inviteField: await pop.getByTestId('folder-invite-email').count(),
      roleOptions: await pop.locator('select[aria-label="Role"] option').allTextContents(),
      people: await pop.locator('[data-testid="folder-people"] li').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())),
      generalAccess: await pop.locator('[data-testid="folder-access"] option').allTextContents(),
      generalAccessValue: await pop.getByTestId('folder-access').inputValue(),
    };
    await pop.getByTestId('folder-copy-link').click();
    await sleep(400);
    const copied = { toast: await toastText(page), link: (await readClipboard(page)).replace(SERVER, '') };
    await pop.getByTestId('folder-invite-email').fill(VIEWER);
    await pop.locator('select[aria-label="Role"]').selectOption('viewer');
    await pop.getByTestId('folder-invite').click();
    await sleep(800);
    const invited = { toast: await toastText(page), people: await pop.locator('[data-testid="folder-people"] li').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())) };
    await page.screenshot({ path: ev.file('1-invited') });
    await page.keyboard.press('Escape');
    return { box, parts, copied, invited, clicks: { open: 1, invite: '1 (role) + 1 (Invite), typing' } };
  });
  ev.set(
    'step1-popover-shots-overflow',
    await shoot4(ev, '1-popover', ownerOpen(context, `${SERVER}/f/${folderId}`), async (p) => {
      await p.getByTestId('folder-share').click();
      await p.getByTestId('folder-people').waitFor({ timeout: 10_000 });
    }),
  );

  // 2. the header's invite modal: invalid, valid, each role; send; join through the invite page
  await probe(ev, 'step2-invite (J-123)', async () => {
    await page.goto(`${SERVER}/`);
    await ready(page);
    await page.getByTestId('invite-button').click();
    const dlg = page.getByTestId('invite-dialog');
    await dlg.waitFor();
    await sleep(500);
    await page.screenshot({ path: ev.file('2-modal') });
    const email = dlg.getByLabel('Email address');
    const inviteBtn = dlg.getByRole('button', { name: 'Invite', exact: true });
    await email.fill('not-an-email');
    await sleep(200);
    const invalidDisabled = await inviteBtn.isDisabled();
    await email.fill(CREATOR);
    await sleep(200);
    const validEnabled = await inviteBtn.isEnabled();
    const seat = dlg.getByLabel('Seat');
    const options = await seat.locator('option').allTextContents();
    const notes: Record<string, string> = {};
    for (const v of ['viewer', 'creator']) {
      await seat.selectOption(v);
      await sleep(200);
      notes[v] = txt(await dlg.locator('form p.note').textContent());
      await page.screenshot({ path: ev.file(`2-role-${v}`) });
    }
    // the native menu as a person sees it, from the X screen
    await xclickEl(page, seat);
    await sleep(600);
    ev.xshot('2-role-menu', { x: 0, y: 0, w: 1460, h: 1000 });
    xkey('Escape');
    await sleep(300);
    const linkRow = txt(await dlg.locator('section').first().textContent());
    await seat.selectOption('creator');
    await inviteBtn.click();
    await dlg.getByText(CREATOR).waitFor({ timeout: 10_000 });
    const toast = await toastText(page);
    await page.screenshot({ path: ev.file('2-sent') });
    await dlg.getByRole('button', { name: 'Close' }).click();
    const pend = (await api<{ items: { id: string; email: string; role: string }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/invites`)).body.items.find((i) => i.email === CREATOR);
    if (!pend) throw new Error('no pending invite for creator@');
    const c = await freshContext();
    const p = await c.newPage();
    const j = await joinVia(p, `${SERVER}/invite/${pend.id}`, CREATOR);
    await p.screenshot({ path: ev.file('2-joined') });
    const after = await myWorkspaces(c);
    await c.close();
    return { invalidDisabled, validEnabled, seatOptions: options, notes, linkRow, toast, pending: { role: pend.role }, join: j, creatorSeat: after.items.find((w) => w.id === ws)?.role ?? null, activeIsParity: after.activeId === ws, clicks: '1 (header Invite) + 1 (Invite), typing' };
  });
  ev.set('step2-header-invite-at-390', await (async () => {
    const p = await openUrl(context, `${SERVER}/`, { w: 390, h: 844 });
    const r = { headerInviteVisible: await p.getByTestId('invite-button').isVisible(), fallback: 'members page, Add members' };
    await p.close();
    return r;
  })());
  ev.set(
    'step2-modal-shots-overflow',
    await shoot4(ev, '2-modal', ownerOpen(context, `${SERVER}/`), async (p) => {
      // under 520 px the header hides Invite; the members page's "Add members" opens the same modal
      if (await p.getByTestId('invite-button').isVisible()) await p.getByTestId('invite-button').click();
      else {
        await p.goto(`${SERVER}/settings/members`);
        await ready(p);
        await p.getByTestId('add-members').click();
      }
      await p.getByTestId('invite-dialog').waitFor();
      await sleep(500);
    }),
  );

  // 3. roles: the members page; the viewer from step 1 views, comments, cannot create; auto-upgrade
  await probe(ev, 'step3-roles (J-124)', async () => {
    const out: Record<string, unknown> = {};
    // the viewer signs in as a folder guest first
    const c = await freshContext();
    const p = await c.newPage();
    await p.goto(`${SERVER}/login`);
    await webSignIn(p, VIEWER);
    const asGuest = {
      workspaces: (await myWorkspaces(c)).items.map((w) => w.name),
      folderPage: (await p.goto(`${SERVER}/f/${folderId}`))?.status() ?? null,
      folderUrl: p.url().replace(SERVER, ''),
      capturePage: (await p.goto(`${SERVER}/c/${n4}`))?.status() ?? null,
      captureUrl: p.url().replace(SERVER, ''),
      apiCapture: (await api(c, 'GET', `/api/v1/recordings/${n4}`)).status,
    };
    await p.screenshot({ path: ev.file('3-guest-capture') });
    out.asFolderGuest = asGuest;
    const share = (await api<{ people: { person: { email: string | null }; role: string; pending: boolean }[] }>(context, 'GET', `/api/v1/folders/${folderId}/share`)).body;
    out.folderPeopleAfterViewerSignup = share.people.map((x) => `${x.person.email} ${x.role}${x.pending ? ' pending' : ''}`);
    // a workspace seat as viewer: the owner's invite modal with the Viewer seat, then the invite page
    await page.goto(`${SERVER}/`);
    await ready(page);
    await page.getByTestId('invite-button').click();
    const dlg = page.getByTestId('invite-dialog');
    await dlg.waitFor();
    await dlg.getByLabel('Email address').fill(VIEWER);
    await dlg.getByLabel('Seat').selectOption('viewer');
    await dlg.getByRole('button', { name: 'Invite', exact: true }).click();
    await dlg.getByText(VIEWER).waitFor({ timeout: 10_000 });
    await dlg.getByRole('button', { name: 'Close' }).click();
    const pend = (await api<{ items: { id: string; email: string }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/invites`)).body.items.find((i) => i.email === VIEWER);
    out.viewerJoin = await joinVia(p, `${SERVER}/invite/${pend!.id}`, VIEWER);
    out.viewerSeat = (await myWorkspaces(c)).items.find((w) => w.id === ws)?.role ?? null;
    await api(c, 'PUT', '/api/v1/me/active-workspace', { workspaceId: ws });
    // members page with role labels and the role menu
    await page.goto(`${SERVER}/settings/members`);
    await ready(page);
    out.memberRows = await page.locator('[data-testid="member-table"] tbody tr').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
    await page.screenshot({ path: ev.file('3-members'), fullPage: true });
    const vRow = page.locator('[data-testid="member-table"] tbody tr', { hasText: VIEWER });
    await vRow.getByTestId('role-button').click();
    await sleep(400);
    out.roleMenu = await page.locator('.roles[role="menu"] button').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
    await page.screenshot({ path: ev.file('3-role-menu') });
    await page.keyboard.press('Escape');
    // the viewer: view, comment, create
    const v = await p.goto(`${SERVER}/c/${n4}`);
    await ready(p);
    const view = { status: v?.status() ?? null, url: p.url().replace(SERVER, ''), title: txt(await p.getByTestId('title').textContent().catch(() => '')), header: await p.getByTestId('viewer-header').locator('a, button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim())) };
    await p.getByTestId('comment-input').click();
    await p.keyboard.type('viewer parity comment', { delay: 30 });
    await p.keyboard.press('Control+Enter');
    const vc = await until(async () => {
      const el = p.locator('[data-testid="comment"]', { hasText: 'viewer parity comment' }).last();
      const cid = await el.getAttribute('data-comment-id').catch(() => null);
      return cid && !cid.startsWith('tmp-') ? cid : null;
    }, 10_000, 50);
    await p.screenshot({ path: ev.file('3-viewer-comment') });
    const comment = { id: vc.value, cleanupDelete: (await api(c, 'DELETE', `/api/v1/comments/${vc.value}`)).status };
    const body = () => ({ clientId: randomUUID(), kind: 'screenshot', workspaceId: ws, page: { url: `${LAB_URL}/`, title: 'parity S5.3 viewer create' }, startedAt: Date.now() });
    const create1 = await api<{ code?: string; message?: string; error?: { code: string; message: string } }>(c, 'POST', '/api/v1/recordings', body());
    // auto-upgrade on, through the members page switch
    const sw = page.getByTestId('auto-approve');
    const swBefore = await sw.getAttribute('aria-checked');
    await sw.click();
    await sleep(1000);
    const autoNow = (await api<{ settings: { autoApproveCreators: boolean } }>(context, 'GET', `/api/v1/workspaces/${ws}`)).body?.settings?.autoApproveCreators;
    const create2 = await api<{ id?: string }>(c, 'POST', '/api/v1/recordings', body());
    const seatAfter = (await myWorkspaces(c)).items.find((w) => w.id === ws)?.role ?? null;
    out.view = view;
    out.comment = comment;
    out.createAsViewer = { status: create1.status, body: create1.body };
    out.autoApprove = { before: swBefore, after: autoNow };
    out.createWithAutoApprove = { status: create2.status, id: create2.body?.id ?? null, seatAfter };
    if (create2.body?.id) out.createdDraftCleanup = (await api(c, 'DELETE', `/api/v1/recordings/${create2.body.id}`)).status;
    await c.close();
    // put the workspace setting back
    await page.reload();
    await ready(page);
    await page.getByTestId('auto-approve').click();
    await sleep(800);
    out.autoApproveRestored = (await api<{ settings: { autoApproveCreators: boolean } }>(context, 'GET', `/api/v1/workspaces/${ws}`)).body?.settings?.autoApproveCreators;
    return out;
  });
  ev.set(
    'step3-members-shots-overflow',
    await shoot4(ev, '3-members', ownerOpen(context, `${SERVER}/settings/members`)),
  );

  await page.close();
  const back = await api(context, 'PUT', '/api/v1/me/active-workspace', { workspaceId: startWs.activeId });
  ev.set('restore-active-workspace', { status: back.status, to: startWs.activeId });
  ev.set('load-end', load());
});
