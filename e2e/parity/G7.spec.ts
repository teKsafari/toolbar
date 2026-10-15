// Parity group G7, Nib side: settings, team admin, integrations, privacy and deletion
// (docs/parity/scenarios.md, S7.1 to S7.4). Each test is one scenario, run as scripted, and
// records its evidence (states, counts, clicks, API statuses, timings with the load average,
// screenshots) in e2e/parity-shots/G7/<scenario>.json and .png files. The raw results are
// written up in docs/parity/G7-replica.md.
//
//   cd e2e && PARITY_EXT_BUILD=chrome-mv3-g7 npx playwright test -c playwright.parity.config.ts G7
//   cd e2e && npx playwright test -c playwright.parity.config.ts G7 -g S7.2   # one
//
// Owner scope (docs/scope.md): S7.3 (integrations, webhooks are kept but the scenario is paused as
// a whole) is not run. Every Mailpit, email, magic-link and social sign-in check is skipped.
//
// Browsers: the owner is `parity@example.com` in the G1 rig (release extension build, private
// Xvfb display, signed in through the popup). The other people (creator@, viewer@ and a
// throwaway account) and signed-out visitors use a second, plain Chromium on the same display
// with a fresh context each. Popup steps (S7.2) and typing on the lab page use real X input.
//
// Captures: N1 is the S3.1 tab recording (G3). N7 is made here in S7.2 and deleted in S7.4; its
// id passes through e2e/parity-shots/G7/S7.2.json (or PARITY_N7).
import { chromium, expect, test, type Browser, type BrowserContext, type Frame, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs';
import { createRequire } from 'node:module';
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
  captureOf,
  clickIcon,
  clipboard,
  editorFrame,
  focusWindow,
  labPage,
  launchNib,
  load,
  popupBox,
  secs,
  shadowOne,
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
} from './rig.ts';

const GROUP = 'G7';
const EMAIL = process.env.PARITY_EMAIL ?? 'parity@example.com';
const CREATOR = 'creator@example.com';
const VIEWER = 'viewer@example.com';
const SHOTS = path.join(ROOT, 'e2e/parity-shots');
const MAIN_WS = "parity's workspace";
const TEAM_WS = 'Parity';
const NEW_WS = 'Parity 2';

function idFrom(env: string, file: string, pick: (j: Record<string, unknown>) => unknown): string {
  if (process.env[env]) return process.env[env]!;
  const j = JSON.parse(fs.readFileSync(path.join(SHOTS, file), 'utf8')) as Record<string, unknown>;
  const id = pick(j);
  if (typeof id !== 'string') throw new Error(`no capture id in ${file}; set ${env}`);
  return id;
}
const N1 = () => idFrom('PARITY_N1', 'G3/S3.1.json', (j) => (j.capture as { id?: string } | undefined)?.id);
const N7 = () => idFrom('PARITY_N7', 'G7/S7.2.json', (j) => (j.n7 as { id?: string } | undefined)?.id);

// ---------------------------------------------------------------- server side reads (evidence only)

/** One SQL query against the compose database; rows as tab-separated lines. */
function sql(q: string): string[] {
  const out = execFileSync('docker', ['compose', '-f', path.join(ROOT, 'docker-compose.yml'), 'exec', '-T', 'postgres', 'psql', '-U', 'toolbar', 'toolbar', '-tA', '-F', '\t', '-c', q], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

/** Object keys in Garage under rec/<id>/ (the compose stack's default dev keys). */
async function garageKeys(recId: string): Promise<string[]> {
  const req = createRequire(path.join(ROOT, 'apps/server/package.json'));
  // the S3 client is the server's dependency, loaded from there (e2e has no types for it)
  type S3Mod = {
    S3Client: new (o: Record<string, unknown>) => { send(c: unknown): Promise<{ Contents?: { Key?: string }[] }>; destroy(): void };
    ListObjectsV2Command: new (o: Record<string, unknown>) => unknown;
  };
  const { S3Client, ListObjectsV2Command } = req('@aws-sdk/client-s3') as S3Mod;
  const s3 = new S3Client({
    endpoint: process.env.S3_TEST_ENDPOINT ?? 'http://localhost:3900',
    region: 'garage',
    forcePathStyle: true,
    credentials: { accessKeyId: 'GK000000000000000000000000', secretAccessKey: '0'.repeat(64) },
  });
  const r = await s3.send(new ListObjectsV2Command({ Bucket: 'toolbar', Prefix: `rec/${recId}/` }));
  s3.destroy();
  return (r.Contents ?? []).map((o) => o.Key!).filter(Boolean);
}

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

/** A plain Chromium (no extension, no profile) for other people and signed-out visitors. */
async function getPlain(): Promise<Browser> {
  if (plain) return plain;
  const free = availableMb();
  if (free < 1600) throw new Error(`only ${free} MB available; a second browser needs about 800 MB and 800 MB must stay free`);
  plain = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY }, args: ['--force-device-scale-factor=1', '--window-position=0,0', '--window-size=1448,991'] });
  return plain;
}

async function freshContext(o: { w?: number; h?: number; theme?: 'light' | 'dark' } = {}): Promise<BrowserContext> {
  const b = await getPlain();
  const c = await b.newContext({ viewport: { width: o.w ?? 1440, height: o.h ?? 900 }, colorScheme: o.theme ?? 'light' });
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
  await p.emulateMedia({ colorScheme: o.theme ?? 'light' });
  await ready(p);
  return p;
}

// clientWidth leaves out a classic (non-overlay) vertical scrollbar, which takes 15 px on this
// rig; comparing with innerWidth (as G4 to G6 do) misses an overflow of up to 15 px
const overflowX = (p: Page) => p.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));

async function shoot4(ev: Evidence, step: string, open: (w: number, h: number, theme: Theme) => Promise<{ page: Page; done: () => Promise<void> }>, setup: (p: Page, w: number) => Promise<void> = async () => undefined) {
  const out: Record<string, number | string> = {};
  for (const [w, h, theme] of VARIANTS) {
    let done: (() => Promise<void>) | null = null;
    try {
      const o = await open(w, h, theme);
      done = o.done;
      await setup(o.page, w);
      await sleep(500);
      await ev.shot(o.page, step, String(w), theme);
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
  const c = await freshContext({ w, h, theme });
  const page = await c.newPage();
  await page.goto(url.startsWith('http') ? url : SERVER + url);
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
    const msgs = (await p.locator('.nb-toast').allTextContents().catch(() => [] as string[])).map(txt);
    const hit = msgs.find((m) => re.test(m));
    if (hit) return { toast: hit, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) throw new Error(`no toast ${re}; toasts: ${JSON.stringify(msgs)}`);
    await sleep(16);
  }
}

/** Open the settings drawer at phone width so the nav shows in a 390 shot. */
async function settingsDrawer(p: Page, w: number) {
  if (w < 860 && (await p.getByTestId('settings-menu').isVisible().catch(() => false))) {
    await p.getByTestId('settings-menu').click();
    await sleep(400);
  }
}

/** Open the dashboard sidebar drawer at phone width. */
async function drawer(p: Page, w: number) {
  if (w < 860 && (await p.getByTestId('menu-button').isVisible().catch(() => false))) {
    await p.getByTestId('menu-button').click();
    await sleep(400);
  }
}

async function myWorkspaces(context: BrowserContext) {
  return (await api<{ items: { id: string; name: string; role: string; memberCount?: number }[]; activeId: string }>(context, 'GET', '/api/v1/workspaces')).body;
}

async function activate(context: BrowserContext, name: string) {
  const w = await myWorkspaces(context);
  const ws = w.items.find((x) => x.name === name);
  if (!ws) throw new Error(`no workspace ${name}`);
  if (w.activeId !== ws.id) await api(context, 'PUT', '/api/v1/me/active-workspace', { workspaceId: ws.id });
  return ws;
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

/** A ready screenshot capture made through the upload API with a signed-in context. */
async function apiScreenshot(c: BrowserContext, workspaceId: string, title: string): Promise<string> {
  const png = fs.readFileSync(path.join(ROOT, 'apps/server/fixtures/screenshot.png'));
  const h = { origin: SERVER };
  const created = await api<{ id: string }>(c, 'POST', '/api/v1/recordings', { clientId: randomUUID(), kind: 'screenshot', workspaceId, page: { url: `${LAB_URL}/`, title: 'Lab' }, startedAt: Date.now() });
  if (created.status >= 300) throw new Error(`create: ${created.status} ${JSON.stringify(created.body)}`);
  const a = await c.request.post(`${SERVER}/api/v1/assets`, { headers: h, multipart: { kind: 'screenshot', recordingId: created.body.id, file: { name: 'shot.png', mimeType: 'image/png', buffer: png } } });
  if (!a.ok()) throw new Error(`asset: ${a.status()} ${await a.text()}`);
  const asset = (await a.json()) as { id: string };
  const fin = await api(c, 'POST', `/api/v1/recordings/${created.body.id}/finalize`, { title, screenshotAssetId: asset.id, annotations: [] });
  if (fin.status >= 300) throw new Error(`finalize: ${fin.status} ${JSON.stringify(fin.body)}`);
  return created.body.id;
}

// ---------------------------------------------------------------- extension helpers (as in G1 and G3)

function xtype(text: string) {
  xdo('type', '--delay', '40', text);
}

function setClipboard(text: string) {
  execFileSync('xclip', ['-selection', 'clipboard', '-i'], { input: text, stdio: ['pipe', 'ignore', 'ignore'], env: { ...process.env, DISPLAY } });
}

async function openMenu(popup: Page) {
  for (let i = 0; i < 3; i++) {
    await xclickPopup(popup, '[data-menu-button]');
    if (await popup.locator('[data-menu]').waitFor({ timeout: 3000 }).then(() => true).catch(() => false)) return;
  }
  throw new Error('the popup menu did not open');
}

async function shootPopup(ev: Evidence, step: string, popup: Page) {
  await popup.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => undefined);
  await sleep(600);
  const b = await popupBox(popup);
  return ev.xshot(step, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 });
}

/** Icon, menu, Settings: the popup's settings screen. Returns the popup. */
async function openExtSettings(context: BrowserContext, page: Page) {
  const popup = await clickIcon(context, page);
  await openMenu(popup);
  await xclickPopup(popup, '[data-menu-item="settings"]');
  await popup.locator('[data-screen="settings"]').waitFor();
  await sleep(300);
  return popup;
}

async function createDraft(context: BrowserContext, page: Page, f: Frame, title: string) {
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
  await focusWindow(page).catch(() => undefined);
  return { id: rec.id, link, createdAt: t0, readyAfterMs: Date.now() - t0 };
}

async function tab(cap: Page, id: 'info' | 'console' | 'network' | 'actions') {
  if (!(await cap.getByTestId('devtools').isVisible().catch(() => false)) && (await cap.getByTestId('narrow-devtools').isVisible().catch(() => false))) await cap.getByTestId('narrow-devtools').click();
  await cap.getByTestId(`tab-${id}`).click();
  await sleep(500);
}

async function rowsOf(cap: Page, list: string) {
  return cap.locator(`[data-testid="${list}"] [data-row-index]`).evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)));
}

// ================================================================ S7.1

test('S7.1 settings pages, members, workspaces and sign-in', async () => {
  test.setTimeout(2_400_000);
  const ev = new Evidence(GROUP, 'S7.1');
  const { context } = await getRig();
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  const start = await myWorkspaces(context);
  const team = await activate(context, TEAM_WS);
  const ws = team.id;
  ev.set('setup-workspaces', { activeBefore: start.items.find((w) => w.id === start.activeId)?.name, team: { id: ws, name: TEAM_WS } });

  // repeatable start: viewer@ back to the Viewer seat; creator@ a member of "Parity"; no "Parity 2" from an earlier run
  await probe(ev, 'setup-reset', async () => {
    const out: Record<string, unknown> = {};
    const members = (await api<{ items: { userId: string; role: string; person: { email: string } }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/members`)).body.items;
    const v = members.find((m) => m.person.email === VIEWER);
    if (v && v.role !== 'viewer') out.viewerToViewer = (await api(context, 'PATCH', `/api/v1/workspaces/${ws}/members/${v.userId}`, { role: 'viewer' })).status;
    out.viewerSeat = v ? 'member' : 'absent';
    if (!members.some((m) => m.person.email === CREATOR)) {
      const link = (await api<{ url: string }>(context, 'GET', `/api/v1/workspaces/${ws}/invite-link`)).body?.url;
      out.creatorRejoinLink = link ? 'found' : 'none';
      if (link) {
        const c = await freshContext();
        const p = await c.newPage();
        await p.goto(link);
        if (await p.getByRole('link', { name: 'Sign in to join' }).count()) {
          await p.getByRole('link', { name: 'Sign in to join' }).click();
          await webSignIn(p, CREATOR);
          if (!/\/invite\//.test(p.url())) await p.goto(link);
        }
        await p.getByRole('button', { name: /^Join / }).click({ timeout: 10_000 }).catch(() => undefined);
        await sleep(1500);
        await c.close();
      }
    }
    const old = sql(`select o.id from organization o join member m on m.organization_id=o.id join "user" u on u.id=m.user_id where o.name='${NEW_WS}' and u.email='${EMAIL}'`);
    for (const id of old) {
      // a workspace from an earlier run of step 5; nothing in the product closes a workspace (J-249)
      sql(`update "user" set active_workspace_id=null where active_workspace_id='${id}'`);
      sql(`delete from organization where id='${id}'`);
    }
    out.removedEarlierParity2 = old.length;
    // rig hygiene: the sso-* accounts that earlier step 7 runs signed in, with their solo workspaces
    const ssoLike = `(u.email like 'sso-%@example.com' or u.email like 'sso-%@elsewhere.test')`;
    out.removedSsoWorkspaces = Number(
      sql(
        `with d as (delete from organization o where exists (select 1 from member m join "user" u on u.id=m.user_id where m.organization_id=o.id and ${ssoLike}) and not exists (select 1 from member m join "user" u on u.id=m.user_id where m.organization_id=o.id and not ${ssoLike}) returning 1) select count(*) from d`,
      )[0],
    );
    out.removedSsoAccounts = Number(sql(`with d as (delete from "user" u where ${ssoLike} returning 1) select count(*) from d`)[0]);
    out.members = (await api<{ items: { role: string; person: { email: string } }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/members`)).body.items.map((m) => `${m.person.email} ${m.role}`);
    return out;
  });

  const page = await openUrl(context, '/');
  const clicksTo: Record<string, number> = {};

  // 1. dashboard, workspace menu, Settings (2 clicks); the layout
  await probe(ev, 'step1-layout (J-171)', async () => {
    await page.getByTestId('workspace-menu').click();
    const menu = page.locator(`#${await page.getByTestId('workspace-menu').getAttribute('aria-controls')}`);
    await menu.waitFor();
    await menu.getByRole('menuitem', { name: 'Settings' }).click();
    await page.waitForURL(/\/settings\/workspace/);
    await ready(page);
    clicksTo.general = 2;
    await page.screenshot({ path: ev.file('1-layout') });
    const nav = page.locator('nav[aria-label="Settings"]');
    const order = await nav.evaluate((n) => {
      const out: { group: string; items: string[] }[] = [];
      for (const el of n.children) {
        if (el.classList.contains('glabel')) out.push({ group: (el.textContent ?? '').trim(), items: [] });
        else if (el.tagName === 'A' && !el.classList.contains('back') && out.length) out[out.length - 1]!.items.push((el.textContent ?? '').trim());
      }
      return out;
    });
    return {
      url: page.url().replace(SERVER, ''),
      back: { text: txt(await page.getByTestId('settings-back').textContent()), href: await page.getByTestId('settings-back').getAttribute('href'), box: await boxOf(page.getByTestId('settings-back')) },
      workspaceLine: txt(await nav.locator('.ws').textContent()),
      groups: order,
      navBox: await boxOf(nav),
      contentBox: await boxOf(page.locator('main .col').first()),
      active: txt(await nav.locator('a.active').textContent()),
      clicks: 2,
    };
  });
  ev.set('step1-shots', await shoot4(ev, '1-layout', ownerOpen(context, '/settings/workspace'), settingsDrawer));

  const sectionsOf = async (p: Page) =>
    p.locator('main .col section').evaluateAll((els) =>
      els.map((s) => ({
        title: (s.querySelector('h2, h3')?.textContent ?? '').trim(),
        description: (s.querySelector('p')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
        fields: [...s.querySelectorAll('label, .label, [class*="field"] > span:first-child')].map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean).slice(0, 12),
        controls: [...s.querySelectorAll('input, select, button, [role="switch"]')].map((c) => {
          const e = c as HTMLInputElement;
          const label = e.getAttribute('aria-label') ?? e.getAttribute('data-testid') ?? (e.textContent ?? '').trim();
          const state = e.getAttribute('role') === 'switch' ? `switch ${e.getAttribute('aria-checked')}` : e.tagName === 'SELECT' ? `select=${e.value}` : e.tagName === 'INPUT' ? `input=${e.value}` : 'button';
          return `${label}: ${state}${e.disabled ? ' (disabled)' : ''}`;
        }),
      })),
    );

  // 2. general
  await probe(ev, 'step2-general (J-172)', async () => {
    const h1 = txt(await page.locator('main h1').first().textContent().catch(() => ''));
    const sections = await sectionsOf(page);
    await page.screenshot({ path: ev.file('2-general'), fullPage: true });
    return {
      h1,
      sections,
      logo: { button: await page.getByTestId('ws-logo').count(), enabled: await page.getByTestId('ws-logo').isEnabled().catch(() => null) },
      name: await page.getByTestId('ws-name').inputValue().catch(() => null),
      selectOptions: {
        defaultAccess: await page.locator('[data-testid="ws-default-access"] option').allTextContents().catch(() => []),
        autoDelete: await page.locator('[data-testid="ws-auto-delete"] option').allTextContents().catch(() => []),
      },
      closeWorkspaceControl: await page.getByText(/delete (this )?workspace|close (this )?workspace/i).count(),
      clicks: 0,
    };
  });
  ev.set('step2-shots', await shoot4(ev, '2-general', ownerOpen(context, '/settings/workspace')));

  // 3. members
  await probe(ev, 'step3-members (J-173, J-249)', async () => {
    await page.getByTestId('settings-nav-members').click();
    await page.waitForURL(/\/settings\/members/);
    await ready(page);
    clicksTo.members = 3;
    const sw = (id: string) => page.getByTestId(id).getAttribute('aria-checked').catch(() => null);
    const linkSection = page.getByTestId('invite-link-section');
    const parts = {
      inviteLinkSwitch: await sw('invite-link-switch'),
      link: (await page.getByTestId('invite-link-url').inputValue().catch(() => '')).replace(SERVER, ''),
      expiryLine: txt(await linkSection.locator('text=/Expires|Off:/').first().textContent().catch(() => '')),
      copy: await page.getByTestId('invite-link-copy').count(),
      reset: await page.getByTestId('invite-link-reset').count(),
      restrictInvites: await sw('restrict-invites'),
      autoApprove: await sw('auto-approve'),
      addMembers: txt(await page.getByTestId('add-members').textContent().catch(() => '')),
      sectionTitles: (await page.locator('main .col section h2, main .col section h3').allTextContents()).map(txt),
      tableHead: (await page.locator('[data-testid="member-table"] thead th').allTextContents()).map(txt),
      rows: await page.locator('[data-testid="member-table"] tbody tr').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim())),
    };
    await page.screenshot({ path: ev.file('3-members'), fullPage: true });
    // copy the invite link
    await page.getByTestId('invite-link-copy').click();
    const copied = await waitToast(page, /copied/i).catch((e) => ({ toast: String(e), ms: -1 }));
    const clip = (await readClipboard(page)).replace(SERVER, '');
    // your own row's menu
    const me = page.locator('[data-testid="member-table"] tbody tr', { hasText: EMAIL });
    const ownRoleIsButton = await me.getByTestId('role-button').count();
    await me.getByTestId('member-menu').click();
    await sleep(400);
    const ownMenu = (await page.locator('.roles[role="menu"] [role="menuitem"]').allTextContents()).map(txt);
    await page.screenshot({ path: ev.file('3-own-row-menu') });
    await page.keyboard.press('Escape');
    await sleep(300);
    // another member's row menu (admin view)
    const other = page.locator('[data-testid="member-table"] tbody tr', { hasText: CREATOR });
    let otherMenu: string[] = [];
    if (await other.count()) {
      await other.getByTestId('member-menu').click();
      await sleep(400);
      otherMenu = (await page.locator('.roles[role="menu"] [role="menuitem"]').allTextContents()).map(txt);
      await page.keyboard.press('Escape');
      await sleep(300);
    }
    // nothing anywhere in settings closes the workspace
    const closeControls: Record<string, number> = {};
    for (const slug of ['workspace', 'members', 'privacy']) {
      const p = await openUrl(context, `/settings/${slug}`);
      closeControls[slug] = await p.getByRole('button', { name: /delete (this )?workspace|close (this )?workspace|delete .*workspace/i }).count();
      await p.close();
    }
    return { parts, copyLink: { toast: copied.toast, clipboard: clip }, ownRow: { roleIsButton: ownRoleIsButton, menu: ownMenu }, otherRowMenu: otherMenu, closeWorkspaceButtons: closeControls, clicks: 3 };
  });
  ev.set('step3-shots', await shoot4(ev, '3-members', ownerOpen(context, '/settings/members')));

  // 4. seat change: the viewer to creator and back
  await probe(ev, 'step4-seat (J-222)', async () => {
    await page.goto(`${SERVER}/settings/members`);
    await ready(page);
    const row = () => page.locator('[data-testid="member-table"] tbody tr', { hasText: VIEWER });
    const before = txt(await row().getByTestId('role-button').textContent());
    const runs: Record<string, unknown>[] = [];
    for (const to of ['creator', 'viewer'] as const) {
      await row().getByTestId('role-button').click();
      await page.locator('.roles[role="menu"]').first().waitFor();
      await sleep(300);
      if (to === 'creator') await page.screenshot({ path: ev.file('4-role-menu') });
      const options = to === 'creator' ? await page.locator('.roles[role="menu"] [role="menuitemradio"]').evaluateAll((els) => els.map((e) => `${(e.textContent ?? '').replace(/\s+/g, ' ').trim()}${e.getAttribute('aria-checked') === 'true' ? ' (current)' : ''}`)) : undefined;
      const c = await calm();
      const t0 = Date.now();
      await page.locator(`.roles[role="menu"] [data-role="${to}"]`).click();
      const t = await waitToast(page, new RegExp(`now ${to}`, 'i'), t0);
      await sleep(400);
      const apiRole = (await api<{ items: { role: string; person: { email: string } }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/members`)).body.items.find((m) => m.person.email === VIEWER)?.role;
      runs.push({ to, options, toast: t.toast, toastSeconds: secs(t.ms), toastMs: t.ms, load: c.load, cell: txt(await row().getByTestId('role-button').textContent()), apiRole, clicks: 2 });
      if (to === 'creator') await page.screenshot({ path: ev.file('4-creator') });
    }
    return { before, runs };
  });

  // 5. workspace menu, switch list, create "Parity 2"
  await probe(ev, 'step5-create (J-221)', async () => {
    await page.goto(`${SERVER}/`);
    await ready(page);
    await page.getByTestId('workspace-menu').click();
    const menu = page.locator(`#${await page.getByTestId('workspace-menu').getAttribute('aria-controls')}`);
    await menu.waitFor();
    await sleep(300);
    const switchList = await menu.locator('button[data-ws]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
    await page.screenshot({ path: ev.file('5-menu') });
    await menu.getByRole('menuitem', { name: /Create or join/ }).click();
    await page.waitForURL(/\/workspaces\/new/);
    await ready(page);
    const avatarText = async () => txt(await page.locator('.namerow > :first-child, .avatar').first().textContent().catch(() => ''));
    const next = page.getByRole('button', { name: 'Next' });
    const empty = { avatar: await avatarText(), nextDisabled: await next.isDisabled(), domainJoin: await page.locator('input[name="domainJoin"]').isChecked(), domainJoinLabel: txt(await page.locator('label.check').textContent()), heading: txt(await page.locator('h1').textContent()), invites: await page.locator('section.invites li').count() };
    await page.screenshot({ path: ev.file('5-form-empty') });
    await page.locator('#ws-name').click();
    await page.keyboard.type(NEW_WS, { delay: 60 });
    await sleep(300);
    const typed = { avatar: await avatarText(), nextDisabled: await next.isDisabled() };
    await page.screenshot({ path: ev.file('5-form-typed') });
    const c = await calm();
    const t0 = Date.now();
    await next.click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });
    const tUrl = Date.now() - t0;
    await ready(page);
    await page.screenshot({ path: ev.file('5-created') });
    const after = await myWorkspaces(context);
    const active = after.items.find((w) => w.id === after.activeId);
    return {
      switchList,
      empty,
      typed,
      created: { url: page.url().replace(SERVER, ''), seconds: secs(tUrl), load: c.load, activeName: active?.name, activeRole: active?.role, sidebarName: txt(await page.getByTestId('workspace-menu').textContent()) },
      clicks: { toForm: 2, submit: 1 },
    };
  });
  ev.set('step5-shots', await shoot4(ev, '5-form', ownerOpen(context, '/workspaces/new'), async (p) => {
    await p.locator('#ws-name').fill(NEW_WS);
  }));

  // 6a. the S5.3 creator leaves "Parity"; their capture stays
  await probe(ev, 'step6-leave (J-249)', async () => {
    const c = await freshContext();
    const p = await c.newPage();
    await webSignIn(p, CREATOR);
    await api(c, 'PUT', '/api/v1/me/active-workspace', { workspaceId: ws });
    const capId = await apiScreenshot(c, ws, 'parity S7.1 creator capture');
    await p.goto(`${SERVER}/settings/members`);
    await ready(p);
    const me = p.locator('[data-testid="member-table"] tbody tr', { hasText: CREATOR });
    await me.getByTestId('member-menu').click();
    await sleep(300);
    const menu = (await p.locator('.roles[role="menu"] [role="menuitem"]').allTextContents()).map(txt);
    await p.getByTestId('member-remove').click();
    const dlg = p.getByRole('alertdialog').or(p.getByRole('dialog')).first();
    await dlg.waitFor();
    await sleep(300);
    const confirm = txt(await dlg.textContent());
    await p.screenshot({ path: ev.file('6-leave-confirm') });
    await dlg.getByRole('button', { name: 'Leave' }).click();
    const toast = await waitToast(p, /left/i).catch((e) => ({ toast: String(e), ms: -1 }));
    await p.waitForURL((u) => u.pathname === '/', { timeout: 15_000 }).catch(() => undefined);
    await p.screenshot({ path: ev.file('6-left') });
    const creatorWs = (await myWorkspaces(c)).items.map((w) => w.name);
    const creatorReads = (await api(c, 'GET', `/api/v1/recordings/${capId}`)).status;
    await c.close();
    const ownerView = await api<{ workspaceId: string; author: { name: string; email?: string } | null; title: string }>(context, 'GET', `/api/v1/recordings/${capId}`);
    const members = (await api<{ items: { person: { email: string } }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/members`)).body.items.map((m) => m.person.email);
    return {
      creatorMenu: menu,
      confirm,
      toast: toast.toast,
      creatorWorkspacesAfter: creatorWs,
      creatorReadsOwnCaptureAfter: creatorReads,
      capture: { id: capId, ownerStatus: ownerView.status, inParity: ownerView.body?.workspaceId === ws, author: ownerView.body?.author?.name ?? null },
      membersAfter: members,
      clicks: 3,
    };
  });

  // 6b. a throwaway account, sole member of its workspace, deletes itself: workspace and media go
  await probe(ev, 'step6-delete-account (J-249)', async () => {
    const email = `g7-throwaway-${Date.now()}@example.com`;
    const c = await freshContext();
    const p = await c.newPage();
    await webSignIn(p, email);
    const wss = await myWorkspaces(c);
    const own = wss.items.find((w) => w.id === wss.activeId) ?? wss.items[0];
    if (!own) throw new Error('the throwaway account has no workspace');
    const memberCount = sql(`select count(*) from member where organization_id='${own.id}'`)[0];
    const capId = await apiScreenshot(c, own.id, 'parity S7.1 throwaway capture');
    const keysBefore = await garageKeys(capId);
    const detail = await api<{ media: { screenshot: { url: string } | null } }>(c, 'GET', `/api/v1/recordings/${capId}`);
    const mediaUrl = detail.body?.media?.screenshot?.url ?? null;
    await p.goto(`${SERVER}/settings/profile`);
    await ready(p);
    await p.getByTestId('delete-account').click();
    const dlg = p.getByTestId('delete-dialog');
    await dlg.waitFor().catch(() => undefined);
    await sleep(400);
    const dialog = {
      text: txt(await dlg.textContent().catch(() => '')).slice(0, 500),
      workspaces: (await p.locator('[data-testid="delete-workspaces"] li').allTextContents()).map(txt),
      confirmDisabledBeforeTyping: await p.getByTestId('delete-confirm').isDisabled(),
    };
    await p.screenshot({ path: ev.file('6-delete-account') });
    await p.getByTestId('delete-confirm-input').fill('DELETE');
    const c0 = await calm();
    const t0 = Date.now();
    await p.getByTestId('delete-confirm').click();
    await p.waitForURL((u) => !u.pathname.startsWith('/settings'), { timeout: 30_000 }).catch(() => undefined);
    const tDone = Date.now() - t0;
    await ready(p);
    await p.screenshot({ path: ev.file('6-account-deleted') });
    const landed = p.url().replace(SERVER, '');
    await sleep(1000);
    const after = {
      workspaceRows: sql(`select count(*) from organization where id='${own.id}'`)[0],
      userRows: sql(`select count(*) from "user" where email='${email}'`)[0],
      recordingRows: sql(`select count(*) from recording where id='${capId}'`)[0],
      garageKeys: (await garageKeys(capId)).length,
      mediaUrlStatus: mediaUrl ? (await (await getPlain()).newContext().then(async (x) => { const r = await x.request.get(mediaUrl.startsWith('http') ? mediaUrl : SERVER + mediaUrl, { failOnStatusCode: false }); await x.close(); return r.status(); })) : null,
      sessionApiStatus: (await api(c, 'GET', '/api/v1/me')).status,
    };
    await c.close();
    return { email, workspace: { id: own.id, name: own.name, members: memberCount }, capture: capId, garageKeysBefore: keysBefore.length, dialog, landed, seconds: secs(tDone), load: c0.load, after };
  });

  // 7. signed out: the sign-in page; providers and the work-email path (mail paused)
  await probe(ev, 'step7-sign-in (J-217)', async () => {
    const c = await freshContext();
    const p = await c.newPage();
    await p.goto(`${SERVER}/login`);
    await ready(p);
    await p.screenshot({ path: ev.file('7-login') });
    const out = {
      url: p.url().replace(SERVER, ''),
      heading: txt(await p.locator('h1').first().textContent().catch(() => '')),
      providers: (await p.locator('.providers button, .providers a').allTextContents()).map(txt),
      inputs: await p.locator('main input:not([type="hidden"])').evaluateAll((els) => els.map((e) => `${(e as HTMLInputElement).type}:${e.getAttribute('aria-label') ?? (e as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? e.getAttribute('name')}`)),
      buttons: (await p.locator('main button').allTextContents()).map(txt),
      links: (await p.locator('main a').allTextContents()).map(txt),
      text: txt(await p.locator('main').textContent()).slice(0, 400),
    };
    // the password path a test account uses
    let passwordPath: unknown = null;
    if (await p.getByRole('button', { name: 'Use a password instead' }).count()) {
      await p.getByRole('button', { name: 'Use a password instead' }).click();
      await sleep(300);
      passwordPath = { inputs: await p.locator('main input:not([type="hidden"])').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).type)), toggle: (await p.locator('main button').allTextContents()).map(txt) };
      await p.screenshot({ path: ev.file('7-login-password') });
    }
    const signup = await (async () => {
      await p.goto(`${SERVER}/login?mode=signup`);
      await ready(p);
      return { heading: txt(await p.locator('h1').first().textContent().catch(() => '')), text: txt(await p.locator('main').textContent()).slice(0, 300) };
    })();
    await c.close();
    // the scope's sign-in (docs/scope.md): one OIDC button against the dev profile's mock provider,
    // limited by the email-domain allowlist (the server runs with AUTH_ALLOWED_DOMAINS=example.com)
    const oidc = async (email: string) => {
      const c2 = await freshContext();
      const p2 = await c2.newPage();
      await p2.goto(`${SERVER}/login`);
      await ready(p2);
      const btn = p2.locator('[data-provider]').first();
      if (!(await btn.count())) {
        await c2.close();
        return { provider: null };
      }
      const provider = txt(await btn.textContent());
      const t0 = Date.now();
      await btn.click();
      await p2.waitForURL(/\/authorize/, { timeout: 15_000 });
      await p2.screenshot({ path: ev.file(`7-oidc-provider-${email.split('@')[1]}`) });
      await p2.locator('input[name=username]').fill(email);
      await p2.locator('textarea[name=claims]').fill(JSON.stringify({ email, email_verified: true, name: 'Sso Person' }));
      const tSubmit = Date.now();
      await p2.locator('input[type=submit], button[type=submit]').first().click();
      await p2.waitForURL((u) => u.origin === SERVER && !/\/api\/auth\//.test(u.pathname), { timeout: 20_000, waitUntil: 'commit' }).catch(() => undefined);
      const landedMs = Date.now() - tSubmit;
      await sleep(500);
      const landed = p2.url().replace(SERVER, '');
      const me = await p2.evaluate(async () => (await fetch('/api/v1/me')).status);
      const error = (await p2.locator('.err').count()) ? txt(await p2.locator('.err').first().textContent()) : '';
      await p2.screenshot({ path: ev.file(`7-oidc-landed-${email.split('@')[1]}`) });
      await c2.close();
      return { provider, clicksOnOurSide: 1, landed, signedIn: me === 200, error: error || null, submitToLandedMs: landedMs, providerClickToLandedMs: landedMs + (tSubmit - t0) };
    };
    const ssoAllowed = await oidc(`sso-${Date.now()}@example.com`);
    const ssoRefused = await oidc(`sso-${Date.now()}@elsewhere.test`);
    return { ...out, passwordPath, signup, sso: { allowedDomain: ssoAllowed, refusedDomain: ssoRefused, load: load() }, magicLinkMailpit: 'skipped (scope: FEATURE_EMAIL)' };
  });
  ev.set('step7-shots', await shoot4(ev, '7-login', anonOpen('/login')));

  // 7b. the default deployment (J-217): the rig server above runs with AUTH_DEV_PASSWORD=1 for
  // its test accounts. PARITY_DEFAULT_SERVERS lists servers started from the same image with
  // compose defaults (no AUTH_DEV_PASSWORD), with and without the scope's OIDC values.
  for (const base of (process.env.PARITY_DEFAULT_SERVERS ?? '').split(',').filter(Boolean)) {
    await probe(ev, `step7-default-deployment ${base} (J-217)`, async () => {
      const c = await freshContext();
      const p = await c.newPage();
      await p.goto(`${base}/login`);
      await p.waitForLoadState('networkidle');
      const tag = new URL(base).port;
      await p.screenshot({ path: ev.file(`7-default-${tag}-login`) });
      const out: Record<string, unknown> = {
        providers: (await p.locator('[data-provider]').allTextContents()).map(txt),
        inputs: await p.locator('main input:not([type="hidden"])').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).type)),
        passwordToggle: await p.getByRole('button', { name: 'Use a password instead' }).count(),
        text: txt(await p.locator('main').textContent()).slice(0, 300),
        passwordApi: (await p.request.post(`${base}/api/auth/sign-in/email`, { data: { email: 'nobody@example.com', password: 'not a real password' }, headers: { origin: base }, failOnStatusCode: false })).status(),
      };
      const btn = p.locator('[data-provider]').first();
      if (await btn.count()) {
        const email = `sso-${Date.now()}@example.com`;
        const t0 = Date.now();
        await btn.click();
        await p.waitForURL(/\/authorize/, { timeout: 15_000 });
        await p.locator('input[name=username]').fill(email);
        await p.locator('textarea[name=claims]').fill(JSON.stringify({ email, email_verified: true, name: 'Sso Person' }));
        await p.locator('input[type=submit], button[type=submit]').first().click();
        await p.waitForURL((u) => u.origin === base && !/\/api\/auth\//.test(u.pathname), { timeout: 20_000, waitUntil: 'commit' }).catch(() => undefined);
        const ms = Date.now() - t0;
        await sleep(500);
        out.sso = { email, landed: p.url().replace(base, ''), signedIn: (await p.evaluate(async () => (await fetch('/api/v1/me')).status)) === 200, providerClickToLandedMs: ms, load: load() };
        await p.screenshot({ path: ev.file(`7-default-${tag}-landed`) });
      }
      await c.close();
      return out;
    });
  }

  ev.set('clicks-to-pages', clicksTo);
  await page.close().catch(() => undefined);
  // the later groups expect the owner in "parity's workspace"
  const back = await activate(context, MAIN_WS).then((w) => w.name).catch((e) => String(e));
  ev.set('restore-active-workspace', back);
  ev.set('load-end', load());
});

// ================================================================ S7.2

test('S7.2 extension settings and user-event capture off (N7)', async () => {
  test.setTimeout(1_200_000);
  const ev = new Evidence(GROUP, 'S7.2');
  const { context, sw } = await getRig();
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  await activate(context, MAIN_WS);
  const storage = async () => ((await (await sw()).evaluate(async () => (await chrome.storage.local.get('nib:settings'))['nib:settings'])) ?? {}) as Record<string, unknown>;

  // 1. popup menu, settings; every setting; scroll
  let page = await labPage(context, '/');
  await focusWindow(page);
  let popup = await openExtSettings(context, page);
  await probe(ev, 'step1-settings (J-176)', async () => {
    await shootPopup(ev, '1-settings', popup);
    const items = await popup.locator('[data-screen="settings"] .item').evaluateAll((els) =>
      els.map((e) => {
        const sw = e.querySelector('[role="switch"]');
        const sel = e.querySelector('select') as HTMLSelectElement | null;
        const btn = e.querySelector('button.link, button.reset');
        return {
          name: (e.querySelector('strong')?.textContent ?? '').trim(),
          hint: (e.querySelector('small')?.textContent ?? '').trim(),
          control: sw ? `switch ${sw.getAttribute('aria-checked')}` : sel ? `select ${sel.value}` : btn ? `button "${(btn.textContent ?? '').trim()}"` : e.tagName === 'BUTTON' ? 'opens a screen' : 'none',
        };
      }),
    );
    const scroller = await popup.evaluate(() => {
      const el = document.querySelector('[data-screen="settings"]') as HTMLElement;
      const r = { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, popupH: window.innerHeight, popupW: window.innerWidth };
      el.scrollTop = el.scrollHeight;
      return r;
    });
    await shootPopup(ev, '1-settings-scrolled', popup);
    await popup.evaluate(() => ((document.querySelector('[data-screen="settings"]') as HTMLElement).scrollTop = 0));
    const header = await popup.locator('[data-screen="settings"] header, [data-screen="settings"] h1, [data-screen="settings"] h2').first().textContent().catch(() => '');
    return { clicks: '2 after the icon (menu, Settings); 3 with the icon', header: txt(header), items, scroller, scrolls: scroller.scrollHeight > scroller.clientHeight };
  });

  // 2. user-event capture off; close the popup
  await probe(ev, 'step2-off (J-190)', async () => {
    const s = popup.getByRole('switch', { name: 'Capture clicks and typing' });
    const before = await s.getAttribute('aria-checked');
    if (before === 'true') await xclickPopup(popup, s);
    await expect(s).toHaveAttribute('aria-checked', 'false');
    await shootPopup(ev, '2-off', popup);
    const stored = (await storage()).captureUserEvents;
    xkey('Escape');
    await sleep(500);
    return { before, after: await s.getAttribute('aria-checked').catch(() => 'popup closed'), stored, clicks: 1 };
  });
  await popup.close().catch(() => undefined);

  // 3. /form: Name, "no events", Email, "x@example.com" (real X input)
  await probe(ev, 'step3-typing', async () => {
    await page.goto(`${LAB_URL}/form`);
    await page.waitForLoadState('networkidle');
    await focusWindow(page);
    await sleep(800);
    await xclickEl(page, page.getByLabel('Name'));
    await sleep(200);
    xtype('no events');
    await sleep(400);
    await xclickEl(page, page.getByLabel('Email'));
    await sleep(200);
    xtype('x@example.com');
    await sleep(800);
    return { name: await page.getByLabel('Name').inputValue(), email: await page.getByLabel('Email').inputValue() };
  });

  // 4. visible screenshot, title, create
  const made = await probe(ev, 'n7', async () => {
    const pop = await clickIcon(context, page);
    await xclickPopup(pop, '[data-row-main="screenshot"]');
    await until(async () => (await shadowOne(page, 'data-nb-ui'))?.attrs['data-session'] === 'arming-screenshot', 10_000);
    const pt = await toScreen(page, { x: 1200, y: 600 });
    xmove(pt.x - 20, pt.y - 10);
    await sleep(200);
    xclick(pt.x, pt.y);
    const f = await editorFrame(page);
    await f.getByTestId('field').waitFor();
    await sleep(800);
    const r = await createDraft(context, page, f, 'parity S7.2 no events');
    const d = (await api<{ title: string; kind: string; folder: { name: string } | null }>(context, 'GET', `/api/v1/recordings/${r.id}`)).body;
    return { ...r, title: d.title, kind: d.kind, folder: d.folder?.name ?? null };
  });

  // 5. the capture: no click or typing rows; console and network still fill
  if (made?.id) {
    await probe(ev, 'step5-contents (J-190)', async () => {
      const all = async (p: string) => (await api<{ items: unknown[] }>(context, 'GET', `/api/v1/recordings/${made.id}/${p}?limit=500`)).body?.items ?? [];
      const actionsApi = (await all('actions')) as { type: string }[];
      const consoleApi = await all('console');
      const networkApi = (await all('network')) as { method: string; url: string; status: number | null }[];
      const cap = await openUrl(context, `/c/${made.id}`);
      await tab(cap, 'actions');
      const actionRows = await rowsOf(cap, 'actions-list');
      const empty = txt(await cap.getByTestId('actions-empty').textContent().catch(() => ''));
      await cap.screenshot({ path: ev.file('5-actions') });
      await tab(cap, 'console');
      const consoleRows = await cap.locator('[role="listitem"][data-row-index]').count();
      await cap.screenshot({ path: ev.file('5-console') });
      await tab(cap, 'network');
      const netRows = await rowsOf(cap, 'network-list');
      await cap.screenshot({ path: ev.file('5-network') });
      await cap.close();
      return {
        api: { actions: actionsApi.length, actionTypes: [...new Set(actionsApi.map((a) => a.type))], console: consoleApi.length, network: networkApi.length },
        viewer: { actionRows: actionRows.length, actionRowTexts: actionRows, emptyState: empty, consoleRows, networkRows: netRows.length, networkSample: netRows.slice(0, 6) },
        clickOrTypingRows: actionsApi.filter((a) => ['click', 'input', 'key'].includes(a.type)).length,
      };
    });
  }

  // 6. user-event capture back on
  await probe(ev, 'step6-on', async () => {
    page = await labPage(context, '/');
    await focusWindow(page);
    popup = await openExtSettings(context, page);
    const s = popup.getByRole('switch', { name: 'Capture clicks and typing' });
    if ((await s.getAttribute('aria-checked')) !== 'true') await xclickPopup(popup, s);
    await expect(s).toHaveAttribute('aria-checked', 'true');
    const stored = (await storage()).captureUserEvents;
    xkey('Escape');
    await popup.close().catch(() => undefined);
    return { on: true, stored, clicks: '4 (icon, menu, Settings, switch)' };
  });
  ev.set('load-end', load());
});

// ================================================================ S7.3

test('S7.3 integrations (paused by owner scope)', async () => {
  const ev = new Evidence(GROUP, 'S7.3');
  ev.set('status', 'paused (docs/scope.md: FEATURE_TRACKERS, FEATURE_SLACK); not run on either product');
  test.skip(true, 'S7.3 is paused by owner scope (docs/scope.md)');
});

// ================================================================ S7.3 step 7: webhooks (kept by scope)

// Webhooks are one of the three agent channels (docs/scope.md), so J-142 is not paused even
// though the rest of S7.3 is. Nib only: Jam's webhooks need a connected account.
test('S7.3 step 7 webhooks (J-142, kept by owner scope)', async () => {
  test.setTimeout(900_000);
  const ev = new Evidence(GROUP, 'S7.3-7');
  const { context } = await getRig();
  const team = await activate(context, TEAM_WS);
  const ws = team.id;
  ev.set('load-start', load());
  // a listener on this machine the server container can reach
  const seen: { headers: Record<string, string | string[] | undefined>; body: string; at: number }[] = [];
  let status = 200;
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      seen.push({ headers: req.headers, body: b, at: Date.now() });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  await new Promise<void>((r) => srv.listen(0, '0.0.0.0', () => r()));
  const port = (srv.address() as { port: number }).port;
  const hookUrl = `http://host.docker.internal:${port}/parity`;
  try {
    // repeatable: drop hooks an earlier run left
    for (const h of (await api<{ items: { id: string; url: string }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/webhooks`)).body.items ?? [])
      if (/\/parity$/.test(h.url)) await api(context, 'DELETE', `/api/v1/webhooks/${h.id}`);
    const page = await openUrl(context, '/settings/webhooks');
    await ready(page);
    await page.screenshot({ path: ev.file('7-webhooks-empty') });
    let clicks = 0;
    await page.getByTestId('add-webhook').click();
    clicks++;
    await page.getByTestId('webhook-url').fill(hookUrl);
    await page.getByTestId('webhook-save').click();
    clicks++;
    await expect(page.getByTestId('webhook-secret')).toHaveText(/^whsec_/);
    const secret = txt(await page.getByTestId('webhook-secret').textContent());
    await page.screenshot({ path: ev.file('7-webhook-secret') });
    await page.locator('[data-testid=webhook-secret-dialog][open]').getByRole('button', { name: 'Done' }).click();
    clicks++;
    await page.screenshot({ path: ev.file('7-webhooks') });
    // a capture made now sends capture.created
    const c = await calm();
    const t0 = Date.now();
    const capId = await apiScreenshot(context, ws, 'parity S7.3 webhook capture');
    const created = await (async () => {
      for (let i = 0; i < 200; i++) {
        const hit = seen.find((x) => x.body.includes(capId));
        if (hit) return hit;
        await sleep(100);
      }
      return null;
    })();
    const verify = (hit: { headers: Record<string, string | string[] | undefined>; body: string }) => {
      const sig = String(hit.headers['x-nib-signature'] ?? '');
      const [t, v1] = sig.split(',').map((p) => p.split('=')[1]);
      return { header: sig.replace(/v1=[0-9a-f]+/, 'v1=<hex>'), valid: !!t && !!v1 && createHmac('sha256', secret).update(`${t}.${hit.body}`).digest('hex') === v1 };
    };
    const payload = created ? (JSON.parse(created.body) as Record<string, unknown>) : null;
    const delivery = created ? { event: payload?.event, keys: Object.keys(payload ?? {}), signature: verify(created), finalizeToDeliveryMs: created.at - t0, load: c.load } : 'no delivery in 20 s';
    // the listener fails: the delivery is retried with a backoff and the log lists the attempts
    status = 500;
    const failCap = await apiScreenshot(context, ws, 'parity S7.3 webhook retry');
    const hooks = (await api<{ items: { id: string; url: string }[] }>(context, 'GET', `/api/v1/workspaces/${ws}/webhooks`)).body.items;
    const hookId = hooks.find((h) => h.url === hookUrl)!.id;
    const attempts = async () => (await api<{ items: { status: string; attempts: number; event?: string; recordingId?: string }[] }>(context, 'GET', `/api/v1/webhooks/${hookId}/deliveries`)).body.items;
    // wait for the first attempt to fail (HTTP 500 from the listener)
    let firstFail: unknown = null;
    for (let i = 0; i < 150 && !firstFail; i++) {
      const d = (await attempts()).find((x) => x.status !== 'ok' && x.attempts >= 1);
      if (d) firstFail = d;
      else await sleep(200);
    }
    status = 200; // back up: the retry after the first backoff (10 s) succeeds
    let retried: unknown = null;
    for (let i = 0; i < 60 && !retried; i++) {
      const d = (await attempts()).find((x) => x.attempts >= 2);
      if (d) retried = d;
      else await sleep(1000);
    }
    await page.reload();
    await ready(page);
    const row = page.getByTestId('webhook-row').filter({ hasText: `${port}` }).first();
    await row.getByTestId('webhook-log-toggle').click();
    clicks++;
    await sleep(500);
    const log = await page.getByTestId('webhook-log').locator('tr').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-status') ?? ''} ${(e.textContent ?? '').replace(/\s+/g, ' ').trim()}`.trim()));
    await page.screenshot({ path: ev.file('7-webhook-log') });
    ev.set('step7-webhooks (J-142)', { listener: hookUrl.replace(/:\d+/, ':<port>'), delivery, failingDelivery: firstFail, retry: retried, retryCapture: failCap, log: log.slice(0, 8), requestsSeen: seen.length, clicks: { add: 3, openLog: 1, total: clicks } });
    ev.set('step7-shots', await shoot4(ev, '7-webhooks', ownerOpen(context, '/settings/webhooks')));
    // tidy: the hook goes, the two captures stay as data of this run
    await api(context, 'DELETE', `/api/v1/webhooks/${hookId}`);
    await page.close();
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
  ev.set('load-end', load());
});

// ================================================================ S7.4

test('S7.4 privacy and deletion (N1, N7)', async () => {
  test.setTimeout(1_800_000);
  const ev = new Evidence(GROUP, 'S7.4');
  const { context } = await getRig();
  ev.set('load-start', load());
  ev.set('mem-available-mb', availableMb());
  await activate(context, MAIN_WS);
  const n1 = N1();
  ev.set('n1', n1);
  const cap = await openUrl(context, `/c/${n1}`);

  const openRow = async (needle: string) => {
    await tab(cap, 'network');
    if (await cap.getByTestId('close-detail').isVisible().catch(() => false)) await cap.getByTestId('close-detail').click();
    await cap.getByTestId('network-filter').fill(needle);
    await sleep(300);
    await cap.locator('[data-testid="network-list"] [data-row-index]').first().click();
    await cap.getByTestId('request-detail').waitFor();
    await sleep(300);
  };

  // 1. the auth request: masked headers; copy as cURL
  await probe(ev, 'step1-auth-headers (J-185)', async () => {
    await openRow('q=auth');
    await cap.getByTestId('sub-headers').click();
    await sleep(200);
    const masked = await cap.locator('[data-testid^="masked-"]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-testid')}: ${(e.textContent ?? '').trim()}`));
    const body = txt(await cap.getByTestId('detail-body').textContent());
    const leaks = ['cookie-secret-value', 'header-secret-value', 'apikey-secret'].filter((s) => body.includes(s));
    await cap.screenshot({ path: ev.file('1-auth-headers') });
    await cap.evaluate(() => navigator.clipboard.writeText('before-curl'));
    await cap.getByTestId('copy-curl').click();
    await sleep(500);
    const curl = await readClipboard(cap);
    const curlLeaks = ['cookie-secret-value', 'header-secret-value', 'apikey-secret'].filter((s) => curl.includes(s));
    const placeholders = curl.split('\n').filter((l) => /authorization|x-api-key|cookie/i.test(l)).map((l) => l.trim());
    return { masked, viewerLeaks: leaks, curlFirstLine: curl.split('\n')[0], curlSecretLines: placeholders, curlLeaks };
  });

  // 2. POST /form: email and password replaced; the key-like string and the card number
  await probe(ev, 'step2-form-body (J-186)', async () => {
    await openRow('/form');
    const rows = await rowsOf(cap, 'network-list');
    // the POST row
    const idx = rows.findIndex((r) => /POST/.test(r));
    if (idx > 0) await cap.locator('[data-testid="network-list"] [data-row-index]').nth(idx).click();
    await sleep(300);
    await cap.getByTestId('sub-payload').click();
    await sleep(300);
    const payload = txt(await cap.getByTestId('detail-body').textContent());
    await cap.screenshot({ path: ev.file('2-form-body') });
    return {
      rows,
      payload: payload.slice(0, 600),
      emailInClear: payload.includes('ada@example.com'),
      passwordInClear: payload.includes('hunter2hunter2'),
      keyLikeInClear: payload.includes('sk_live_51Hparity0000'),
      cardInClear: /4242[ +]?4242[ +]?4242[ +]?4242/.test(payload),
      nameInClear: /Ada(\+|%20| )Lovelace/.test(payload),
    };
  });

  // 3. actions: typing rows masked, click rows, Name and Notes
  await probe(ev, 'step3-actions (J-187)', async () => {
    if (await cap.getByTestId('close-detail').isVisible().catch(() => false)) await cap.getByTestId('close-detail').click();
    await tab(cap, 'actions');
    const rows = await rowsOf(cap, 'actions-list');
    const formRows = rows.filter((r) => /Name|Email|Password|Notes|Create account|input|Typed|masked|form/i.test(r));
    await cap.getByTestId('actions-list').locator('[data-row-index]', { hasText: /Typed|Clicked .*Email/ }).first().scrollIntoViewIfNeeded().catch(() => undefined);
    // the attribute lists of the form's click rows (Name, Email): is the value attribute masked?
    const expanded: Record<string, string>[] = [];
    const clickRows = cap.getByTestId('actions-list').locator('[data-row-index]', { hasText: /Click on <input/ });
    for (let i = 0; i < (await clickRows.count()); i++) {
      const r = clickRows.nth(i);
      if (await r.getByTestId('attr-chip').count()) {
        await r.getByTestId('attr-chip').click();
        await sleep(200);
        expanded.push(
          await r.getByTestId('attr-list').evaluate((dl) => {
            const o: Record<string, string> = {};
            for (const dt of dl.querySelectorAll('dt')) o[(dt.textContent ?? '').trim()] = (dt.nextElementSibling?.textContent ?? '').trim();
            return o;
          }),
        );
      }
    }
    await cap.screenshot({ path: ev.file('3-actions') });
    const api_ = (await api<{ items: { type: string; value: string | null; masked: boolean; target: { selector?: string; tag?: string; attrs?: Record<string, string> } | null }[] }>(context, 'GET', `/api/v1/recordings/${n1}/actions?limit=500`)).body.items;
    const formApi = api_.filter((a) => ['input', 'click', 'key'].includes(a.type) && JSON.stringify(a.target ?? {}).match(/name|email|password|notes|create|input|textarea/i));
    return {
      rows: rows.length,
      formRows,
      expandedClickRows: expanded,
      apiFormRows: formApi.filter((a) => a.target?.tag === 'input' || a.target?.tag === 'textarea').map((a) => ({ type: a.type, value: a.value, masked: a.masked, attrs: (a.target as { attrs?: unknown } | null)?.attrs ?? null, name: (a.target as { name?: string } | null)?.name ?? null })),
    };
  });

  // 4. the video at the form step: is the typed email readable?
  await probe(ev, 'step4-video-frame (J-188)', async () => {
    const marks = (JSON.parse(fs.readFileSync(path.join(SHOTS, 'G3/S3.1.json'), 'utf8')) as { marks: { step: string; atMs: number }[] }).marks;
    const form = marks.find((m) => m.step.startsWith('16'))!;
    const list = marks.find((m) => m.step.startsWith('17'))!;
    await cap.locator('[data-testid="video"]').waitFor();
    await cap.waitForFunction(() => {
      const v = document.querySelector('[data-testid="video"]') as HTMLVideoElement | null;
      return !!v && v.readyState >= 1 && Number.isFinite(v.duration);
    });
    // play from the form step, then pause on frames across it
    const frames: { at: number; file: string }[] = [];
    for (const s of [form.atMs / 1000 + 5, form.atMs / 1000 + 9, list.atMs / 1000 - 2]) {
      await cap.evaluate(async (t) => {
        const v = document.querySelector('[data-testid="video"]') as HTMLVideoElement;
        v.pause();
        v.currentTime = t;
        await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
      }, s);
      await sleep(600);
      const file = ev.file(`4-frame-${Math.round(s)}s`);
      await cap.getByTestId('video-card').screenshot({ path: file });
      frames.push({ at: Math.round(s * 10) / 10, file: path.basename(file) });
    }
    return { formStepAtS: form.atMs / 1000, listStepAtS: list.atMs / 1000, frames, readability: 'judged from the frames by eye (see G7-replica.md)' };
  });

  // 5. J-189 comes from S1.4 step 5 (G1) and S2.4 step 7 (G2)
  ev.set('step5-J-189', {
    S1_4_step5: (() => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(SHOTS, 'G1/S1.4.json'), 'utf8')) as Record<string, unknown>;
        return Object.fromEntries(Object.entries(j).filter(([k]) => /J-189|count|step5/i.test(k)));
      } catch (e) {
        return String(e);
      }
    })(),
    S2_4_step7: (() => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(SHOTS, 'G2/S2.4.json'), 'utf8')) as Record<string, unknown>;
        return Object.fromEntries(Object.entries(j).filter(([k]) => /J-189|listed|step7/i.test(k)));
      } catch (e) {
        return String(e);
      }
    })(),
  });
  await cap.close();

  // 6. N7: three-dot, Delete, the warning, confirm (3 clicks); time to toast and to the dashboard
  let n7: string | null = null;
  try {
    n7 = N7();
  } catch (e) {
    ev.set('n7', { error: String(e) });
  }
  if (!n7) return;
  ev.set('n7', n7);
  const before = (await api<{ title: string; folder: { id: string; name: string } | null; media: { screenshot: { url: string } | null; thumbUrl: string | null } }>(context, 'GET', `/api/v1/recordings/${n7}`)).body;
  const mediaUrl = before?.media?.screenshot?.url ? (before.media.screenshot.url.startsWith('http') ? before.media.screenshot.url : SERVER + before.media.screenshot.url) : null;
  const thumbUrl = before?.media?.thumbUrl ? (before.media.thumbUrl.startsWith('http') ? before.media.thumbUrl : SERVER + before.media.thumbUrl) : null;
  ev.set('n7-before', { title: before?.title, folder: before?.folder?.name ?? null, mediaStatus: mediaUrl ? (await context.request.get(mediaUrl, { failOnStatusCode: false })).status() : null });
  const shareUrl = (await api<{ link: { url: string } }>(context, 'GET', `/api/v1/recordings/${n7}/share`)).body?.link?.url ?? null;
  const p = await openUrl(context, `/c/${n7}`);
  await probe(ev, 'step6-delete (J-114)', async () => {
    await p.getByTestId('more').click();
    await sleep(300);
    const items = (await p.locator('[role="menu"] [role="menuitem"]').allTextContents()).map(txt);
    await p.locator('[role="menu"] [role="menuitem"]', { hasText: 'Delete' }).click();
    const dlg = p.getByRole('alertdialog');
    await dlg.waitFor();
    await sleep(400);
    const warning = txt(await dlg.textContent());
    const box = await boxOf(dlg);
    await p.screenshot({ path: ev.file('6-warning') });
    const c = await calm();
    const t0 = Date.now();
    await dlg.getByRole('button', { name: 'Delete', exact: true }).click();
    const toast = await waitToast(p, /deleted/i, t0);
    await p.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });
    const tDash = Date.now() - t0;
    await ready(p);
    const tSettled = Date.now() - t0;
    await p.screenshot({ path: ev.file('6-dashboard') });
    return { menu: items, warning, box, toast: toast.toast, toToastS: secs(toast.ms), toastMs: toast.ms, toDashboardUrlS: secs(tDash), toDashboardSettledS: secs(tSettled), load: c.load, reliable: c.reliable, clicks: 3 };
  });

  // 7. gone everywhere; API and media 404; the not-found page
  await probe(ev, 'step7-gone (J-191, J-205)', async () => {
    const t0 = Date.now();
    const apiStatus = (await api(context, 'GET', `/api/v1/recordings/${n7}`)).status;
    const mediaStatus = mediaUrl ? (await context.request.get(mediaUrl, { failOnStatusCode: false })).status() : null;
    const thumbStatus = thumbUrl ? (await context.request.get(thumbUrl, { failOnStatusCode: false })).status() : null;
    const afterMs = Date.now() - t0;
    const onGrid = await p.locator(`[data-testid="capture-card"][data-id="${n7}"]`).count();
    const listed = ((await api<{ items: { id: string }[] }>(context, 'GET', '/api/v1/recordings?limit=100')).body?.items ?? []).some((x) => x.id === n7);
    let inFolder: number | null = null;
    if (before?.folder?.id) {
      const f = await openUrl(context, `/f/${before.folder.id}`);
      inFolder = await f.locator(`[data-testid="capture-card"][data-id="${n7}"]`).count();
      await f.close();
    }
    // Ctrl+K search for its title
    await p.locator('body').click({ position: { x: 600, y: 5 } }).catch(() => undefined);
    await p.keyboard.press('Control+k');
    await p.getByTestId('palette').waitFor();
    await p.getByTestId('palette-input').fill('S7.2 no events');
    await sleep(1500);
    const palRows = await p.locator('.pal [data-row-type]').evaluateAll((els) => els.map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()));
    const palText = txt(await p.getByTestId('palette').textContent());
    await p.screenshot({ path: ev.file('7-palette') });
    await p.keyboard.press('Escape');
    const nf = await openUrl(context, `/c/${n7}`);
    const notFound = { title: await nf.evaluate(() => document.title), text: txt(await nf.evaluate(() => document.body.innerText)).slice(0, 200) };
    await nf.close();
    let share: unknown = null;
    if (shareUrl) {
      const c = await freshContext();
      const sp = await c.newPage();
      const r = await sp.goto(shareUrl);
      share = { status: r?.status() ?? null, text: txt(await sp.evaluate(() => document.body.innerText)).slice(0, 160) };
      await c.close();
    }
    return { apiStatus, mediaStatus, thumbStatus, checkedWithinMs: afterMs, onGrid, listed, inFolder, palette: { rows: palRows, text: palText.slice(0, 200) }, notFound, shareLink: share };
  });
  await p.close().catch(() => undefined);
  ev.set('step7-notfound-shots', await shoot4(ev, '7-not-found', ownerOpen(context, `/c/${n7}`)));
  ev.set('load-end', load());
});
