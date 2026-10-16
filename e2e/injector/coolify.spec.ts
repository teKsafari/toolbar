// The injector behind a Traefik set up like Coolify's (D-200), in a headed Chromium without the
// extension. Run by apps/injector/test/coolify-like/run.sh, which starts the stack: traefik:v3.7
// with Coolify's command line and labels, the lab and a strict-CSP page as two apps, the injector
// in loopback mode behind deploy/injector/traefik-open-toolbar-injector.yml, and the worktree's
// dev server as the open-toolbar server.
//
// 1. A plain visitor never passes the injector: its request log stays empty while they browse.
// 2. Onboarding as the owner does it: add the app's origins to a project, then "Open with
//    toolbar" on the project page lands on the app with the toolbar.
// 3. A comment sends the last minute; a trace follows the reviewer across two pages.
// 4. WebSockets and server-sent events work through the loop; x-review-skip turns injection off.
// 5. The copied review link opens the strict nonce-CSP app with the toolbar.
// 6. The review link's error states: a site outside the projects, a site without the injector.
// 7. With the injector killed the app keeps working for everyone; reviewers only lose the toolbar.
// 8. The menu names the reviewer and "Stop reviewing on this site" ends it.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { signInOidc } from '../fixtures/oidc.ts';
import { compose, injectorCaptures, injectorRequests, latestCapture, toolbar } from './helpers.ts';

const SERVER = process.env.SERVER_URL ?? 'http://localhost:3650';
const LAB = process.env.LAB_ORIGIN ?? 'https://lab.localhost:3651';
const CSP = process.env.CSP_ORIGIN ?? 'https://csp.localhost:3651';
const WHOAMI = LAB.replace('//lab.', '//whoami.');
const NO_INJECTOR = 'http://localhost:5173'; // the lab on the host, not behind the proxy
const EMAIL = `owner-${Date.now()}@coolify-like.test`;

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let dash: Page;
let app: Page;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  ctx.on('page', (p) => {
    p.on('pageerror', (e) => console.log(`[page error] ${p.url()} ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) console.log(`[console error] ${m.text()}`);
    });
  });
  dash = await ctx.newPage();
});

test.afterAll(async () => {
  // leave the stack as run.sh started it, whatever happened in between
  try {
    compose('start', 'open-toolbar-injector');
  } catch {
    /* already running */
  }
  await ctx?.close();
});

test('1. a plain visitor never passes the injector', async ({ browser }) => {
  const before = injectorRequests().length;
  const visitor = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await visitor.newPage();
  await page.goto(`${LAB}/`);
  await expect(page.getByTestId('works')).toBeVisible();
  await page.getByTestId('works').click();
  await page.goto(`${LAB}/form`);
  await page.goto(`${LAB}/live`);
  await page.waitForTimeout(1500);
  await page.goto(`${CSP}/`);
  await expect(page.locator('#title')).toHaveText('Strict CSP');
  await expect(page.locator('toolbar-root')).toHaveCount(0);
  // what Traefik answers is the app's own response: compressed by Coolify's gzip middleware
  const res = await page.request.get(`${LAB}/form`, { headers: { 'accept-encoding': 'gzip' } });
  expect(res.headers()['x-toolbar-injected']).toBeUndefined();
  await visitor.close();
  expect(injectorRequests().slice(before)).toEqual([]);
});

test('2. onboarding: add the origins to a project, open the site from the project page', async () => {
  await signInOidc(dash, SERVER, EMAIL, { name: 'Olive Owner' });
  await dash.goto(`${SERVER}/settings/projects`);
  await dash.waitForLoadState('networkidle');
  // the dev server hydrates late on a first visit: click until the dialog opens
  await expect(async () => {
    await dash.getByTestId('add-project').click();
    await expect(dash.getByTestId('project-name')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await dash.getByTestId('project-name').fill('Lab on Coolify');
  await dash.getByTestId('project-origins-input').fill([LAB, CSP, NO_INJECTOR].join('\n'));
  await dash.getByTestId('project-save').click();
  const row = dash.getByTestId('project-row').filter({ hasText: 'Lab on Coolify' });
  const labLink = row.locator(`[data-testid=project-review] li[data-origin="${LAB}"]`);
  await expect(labLink.getByTestId('review-copy')).toBeVisible();
  // several sites in one project: each link names its site
  expect(await labLink.getByTestId('review-copy').getAttribute('data-href')).toMatch(new RegExp(`^${SERVER}/go/[0-9a-f-]{36}\\?site=`));
  await dash.screenshot({ path: 'test-results-injector/coolify-project-page.png' });

  const before = injectorRequests().length;
  const [tab] = await Promise.all([ctx.waitForEvent('page'), labLink.getByTestId('review-open').click()]);
  app = tab;
  await app.waitForURL((u) => u.origin === LAB && u.pathname === '/', { timeout: 30_000 });
  await expect(toolbar(app)).toBeVisible();
  await expect(app.locator('head > script[data-open-toolbar]')).toHaveCount(1);
  // the cookie is HttpOnly and never reaches the app's pages
  expect(await app.evaluate(() => document.cookie)).not.toContain('tb_review');
  const cookie = (await ctx.cookies(LAB)).find((c) => c.name === '__Host-tb_review');
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  // the page came through the injector's loop back into Traefik, injected
  const seen = injectorRequests().slice(before);
  expect(seen.some((r) => r.kind === 'toolbar' && r.path === '/__toolbar/session' && r.status === '303')).toBe(true);
  expect(seen.some((r) => r.kind === 'loopback' && r.path === '/' && r.injected)).toBe(true);
  await app.screenshot({ path: 'test-results-injector/coolify-lab-with-toolbar.png' });
});

test('3. a comment sends the last minute, a trace spans two pages', async () => {
  const api = ctx.request;
  let before = await injectorCaptures(api, SERVER);
  await app.getByTestId('hidden-500').click();
  await app.getByTestId('throws').click();
  await app.evaluate(() => console.warn('coolify-like warning line'));
  await app.waitForTimeout(500);
  await toolbar(app).getByRole('button', { name: 'Comment' }).click();
  await app.getByTestId('status').click();
  const pop = app.locator('toolbar-root [role=dialog]');
  await pop.getByRole('textbox').fill('Order failed silently behind Coolify');
  await pop.getByTestId('tb-send').click();
  await expect(app.locator('toolbar-root [role=status]', { hasText: 'Comment sent.' })).toBeVisible();
  const cap = await latestCapture(api, SERVER, before);
  expect(cap.title).toBe('Order failed silently behind Coolify');
  const detail = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}`)).json()) as { source: string; kind: string };
  expect(detail).toMatchObject({ source: 'injector', kind: 'replay' });
  const net = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}/network`)).json()) as { items: { url: string; status: number | null }[] };
  expect(net.items.some((n) => n.url.endsWith('/api/fail') && n.status === 500)).toBe(true);
  const rows = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}/console`)).json()) as { items: { level: string; message: string }[] };
  expect(rows.items.some((r) => r.level === 'warn' && r.message.includes('coolify-like warning line'))).toBe(true);

  before = await injectorCaptures(api, SERVER);
  await toolbar(app).getByRole('button', { name: 'Start trace' }).click();
  await expect(toolbar(app).getByRole('button', { name: 'Stop trace' })).toBeVisible();
  await app.getByTestId('works').click();
  await app.waitForTimeout(2500);
  await app.goto(`${LAB}/form`);
  await expect(toolbar(app).getByRole('button', { name: 'Stop trace' })).toBeVisible();
  await app.evaluate(() => console.error('coolify-like second page'));
  await toolbar(app).getByRole('button', { name: 'Stop trace' }).click();
  await pop.getByRole('textbox').fill('Save, then the form');
  await pop.getByTestId('tb-send').click();
  await expect(app.locator('toolbar-root [role=status]', { hasText: 'Trace sent.' })).toBeVisible();
  const trace = await latestCapture(api, SERVER, before);
  const tnet = (await (await api.get(`${SERVER}/api/v1/recordings/${trace.id}/network`)).json()) as { items: { url: string }[] };
  expect(tnet.items.some((n) => n.url.includes('/api/ok?q=works'))).toBe(true);
  const trows = (await (await api.get(`${SERVER}/api/v1/recordings/${trace.id}/console`)).json()) as { items: { message: string }[] };
  expect(trows.items.some((r) => r.message.includes('coolify-like second page'))).toBe(true);
  expect(((await (await api.get(`${SERVER}/api/v1/recordings/${trace.id}`)).json()) as { kind: string }).kind).toBe('trace');
});

test('4. WebSockets and server-sent events through the loop; x-review-skip', async ({ browser }) => {
  await app.goto(`${LAB}/`);
  await expect(toolbar(app)).toBeVisible();
  const hello = await app.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace('https', 'wss')}/ws`);
        ws.onopen = () => ws.send('ping');
        const got: string[] = [];
        ws.onmessage = (m) => {
          got.push(JSON.parse(String(m.data)).type);
          if (got.includes('echo')) {
            ws.close();
            resolve(got.join(','));
          }
        };
        ws.onerror = () => reject(new Error('ws error'));
        setTimeout(() => reject(new Error(`ws timeout: ${got}`)), 10_000);
      }),
  );
  expect(hello).toContain('hello');
  const ticks = await app.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        // the lab sends a "tick" event each second: two arrive while the stream stays open
        const es = new EventSource('/api/sse');
        let n = 0;
        es.addEventListener('tick', () => {
          if (++n === 2) {
            es.close();
            resolve(n);
          }
        });
        es.onerror = () => reject(new Error('sse error'));
        setTimeout(() => reject(new Error(`sse timeout after ${n}`)), 10_000);
      }),
  );
  expect(ticks).toBe(2);
  // the injector logs a WebSocket when it closes
  await expect.poll(() => injectorRequests().some((r) => r.kind === 'loopback' && r.path === '/ws' && r.status === '101')).toBe(true);
  expect(injectorRequests().some((r) => r.kind === 'loopback' && r.path === '/api/sse' && r.status === '200')).toBe(true);

  const skipped = await browser.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: { 'x-review-skip': '1' } });
  await skipped.addCookies(await ctx.cookies(LAB));
  const sp = await skipped.newPage();
  await sp.goto(`${LAB}/`);
  await expect(sp.getByTestId('works')).toBeVisible();
  await expect(sp.locator('toolbar-root')).toHaveCount(0);
  await skipped.close();
});

test('5. the copied review link opens the strict-CSP app with the toolbar', async () => {
  const row = dash.getByTestId('project-row').filter({ hasText: 'Lab on Coolify' });
  const href = await row.locator(`[data-testid=project-review] li[data-origin="${CSP}"]`).getByTestId('review-copy').getAttribute('data-href');
  expect(href).toBeTruthy();
  const page = await ctx.newPage();
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto(href!);
  await expect(page.getByTestId('go-page')).toHaveAttribute('data-probe', 'ok');
  await page.screenshot({ path: 'test-results-injector/coolify-review-link.png' });
  await page.getByTestId('go-open').click();
  await page.waitForURL((u) => u.origin === CSP, { timeout: 30_000 });
  await expect(toolbar(page)).toBeVisible();
  // the tag carries the app's nonce (Chrome hides nonce attributes from the DOM, so read the HTML)
  const html = await (await ctx.request.get(`${CSP}/`, { headers: { 'sec-fetch-dest': 'document' } })).text();
  expect(html).toMatch(/<script src="\/__toolbar\/toolbar\.js\?v=[0-9a-f]+" nonce="c3BlY2lhbA=="/);
  expect(await page.evaluate(() => [(window as { appRan?: boolean }).appRan, (window as { inlineRan?: boolean }).inlineRan])).toEqual([true, undefined]);
  expect(await toolbar(page).evaluate((el) => getComputedStyle(el).borderRadius)).toBe('999px');
  expect(violations.filter((v) => !/inline script/i.test(v))).toEqual([]);
  await page.close();
});

test('6. review link errors: a site outside the projects, a site without the injector', async () => {
  const page = await ctx.newPage();
  await page.goto(`${SERVER}/go?site=${encodeURIComponent(WHOAMI)}`);
  await expect(page.getByTestId('go-page')).toHaveAttribute('data-state', 'not_allowed');
  await expect(page.getByTestId('go-not-allowed')).toContainText('not in a project');
  await page.goto(`${SERVER}/go?site=${encodeURIComponent(NO_INJECTOR)}`);
  await expect(page.getByTestId('go-page')).toHaveAttribute('data-probe', 'unreachable');
  await expect(page.getByTestId('go-unreachable')).toBeVisible();
  await page.screenshot({ path: 'test-results-injector/coolify-unreachable.png' });
  await page.goto(`${SERVER}/go/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByTestId('go-page')).toHaveAttribute('data-state', 'not_found');
  await page.close();
});

test('7. with the injector killed the app keeps working; reviewers only lose the toolbar', async ({ browser }) => {
  compose('kill', 'open-toolbar-injector');
  try {
    // Traefik's health check moves reviewers to the fallback within a few seconds
    await expect
      .poll(
        async () => {
          const r = await ctx.request.get(`${LAB}/`, { failOnStatusCode: false });
          return r.status();
        },
        { timeout: 20_000, intervals: [500] },
      )
      .toBe(200);
    await app.goto(`${LAB}/`);
    await expect(app.getByTestId('works')).toBeVisible();
    await expect(app.locator('toolbar-root')).toHaveCount(0);
    await app.getByTestId('works').click();
    const visitor = await browser.newContext({ ignoreHTTPSErrors: true });
    const vp = await visitor.newPage();
    await vp.goto(`${LAB}/form`);
    await expect(vp.locator('form').first()).toBeVisible();
    await visitor.close();
  } finally {
    compose('start', 'open-toolbar-injector');
  }
  await expect
    .poll(
      async () => {
        await app.goto(`${LAB}/`);
        return app.locator('toolbar-root').count();
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe(1);
});

test('8. the menu names the reviewer; Stop reviewing ends it', async () => {
  await expect(toolbar(app)).toBeVisible();
  await toolbar(app).getByRole('button', { name: 'More' }).click();
  await expect(app.locator('toolbar-root [role=menu]')).toContainText(`Signed in as ${EMAIL}`);
  await app.screenshot({ path: 'test-results-injector/coolify-menu.png' });
  await app.getByRole('menuitem', { name: 'Stop reviewing on this site' }).click();
  await app.waitForURL(`${LAB}/`);
  await expect(app.getByTestId('works')).toBeVisible();
  await expect(app.locator('toolbar-root')).toHaveCount(0);
  expect((await ctx.cookies(LAB)).some((c) => c.name.endsWith('tb_review'))).toBe(false);
  // the Traefik file and the injector agree (pass value, health checks): no warning in the whole run
  expect(compose('logs', '--no-log-prefix', 'open-toolbar-injector').match(/level=(WARN|ERROR).*/g)).toBeNull();
  // the device token behind the cookie is revoked too
  const tokens = (await (await ctx.request.get(`${SERVER}/api/v1/tokens`)).json()) as { items: { name: string; revokedAt?: string | null }[] };
  expect(tokens.items.filter((t) => t.name.startsWith('Review on lab.localhost') && !t.revokedAt)).toEqual([]);
});
