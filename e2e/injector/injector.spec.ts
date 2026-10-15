// The injector in front of the lab app, in a browser without the extension (D-157,
// PLAN "Zero integration", delivery 2). Run by apps/injector/test/run.sh.
//
// 1. Without the reviewer cookie the lab comes back byte for byte, toolbar-free.
// 2. A reviewer signs in on the server (mock OIDC), confirms the site and lands back on the lab
//    with the toolbar, loaded from /__toolbar/ on the lab's own origin.
// 3. A comment on an element uploads the last minute: the lab's failed request, its uncaught
//    error and its console lines reach the server, with a DOM replay.
// 4. A trace spans two pages of the lab and keeps a comment made on the way.
// 5. x-review-skip turns injection off; streamed HTML and the lab's WebSocket pass through.
// 6. Behind a strict nonce-only CSP the toolbar loads with the reused nonce and renders styled.
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { mockProviderLogin } from '../fixtures/oidc.ts';

const INJECTOR = process.env.INJECTOR_URL ?? 'http://localhost:3506';
const SERVER = process.env.SERVER_URL ?? 'http://localhost:3306';
const LAB = process.env.LAB_URL ?? 'http://localhost:5173';
const EMAIL = process.env.INJECTOR_E2E_EMAIL ?? `reviewer-${Date.now()}@injector.test`;

const toolbar = (page: Page) => page.locator('toolbar-root [role=toolbar]');

async function signInAsReviewer(page: Page) {
  await page.goto(`${INJECTOR}/__toolbar/login?next=/`);
  // the server's login page, then the mock provider
  await page.waitForURL((u) => u.origin === new URL(SERVER).origin && u.pathname === '/login');
  await page.locator('[data-provider]').click();
  await mockProviderLogin(page, EMAIL, 'Rita Reviewer');
  // a first sign-in may pass through onboarding; the confirm page is what matters
  await page.waitForURL((u) => u.origin === new URL(SERVER).origin && !u.pathname.startsWith('/api/auth'), { timeout: 30_000 });
  if (!page.url().includes('/review/start')) await page.goto(`${SERVER}/review/start?origin=${encodeURIComponent(INJECTOR)}&next=/`);
  await page.getByRole('button', { name: /with the toolbar/ }).click();
  await page.waitForURL((u) => u.origin === new URL(INJECTOR).origin && u.pathname === '/', { timeout: 30_000 });
}

/** Newest capture of the injector source in the reviewer's workspace, once it is processed. */
async function latestCapture(request: APIRequestContext, after: string[] = []) {
  let found: { id: string; title: string } | null = null;
  await expect
    .poll(
      async () => {
        const r = await request.get(`${SERVER}/api/v1/recordings?sources=injector`);
        if (!r.ok()) return `http ${r.status()}`;
        const items = ((await r.json()) as { items: { id: string; title: string; status: string }[] }).items.filter((c) => !after.includes(c.id));
        const ready = items.find((c) => c.status === 'ready');
        found = ready ?? null;
        return ready ? 'ready' : (items[0]?.status ?? 'none');
      },
      { timeout: 60_000 },
    )
    .toBe('ready');
  return found! as { id: string; title: string };
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(({ page }) => {
  // page errors of the bundle show in the run log
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[console error] ${m.text()} ${m.location().url}`);
  });
});

test('the injector gives the lab a toolbar for signed-in reviewers only', async ({ page, request }) => {
  // 1. no cookie: byte for byte what the lab sends
  const direct = await request.get(`${LAB}/form`, { headers: { 'accept-encoding': 'identity' } });
  const proxied = await request.get(`${INJECTOR}/form`, { headers: { 'accept-encoding': 'identity' } });
  expect(proxied.headers()['x-toolbar-injected']).toBeUndefined();
  expect((await proxied.text()).includes('__toolbar')).toBe(false);
  expect(direct.status()).toBe(proxied.status());
  await page.goto(`${INJECTOR}/`);
  await expect(page.getByTestId('works')).toBeVisible();
  await expect(page.locator('toolbar-root')).toHaveCount(0);
  expect(await page.evaluate(() => fetch('/__toolbar/status').then((r) => r.json()))).toEqual({ reviewer: false });

  // 2. sign in through the server and come back with the toolbar
  await signInAsReviewer(page);
  await expect(toolbar(page)).toBeVisible();
  const script = page.locator('head > script[data-open-toolbar]');
  await expect(script).toHaveCount(1);
  expect(await script.getAttribute('src')).toMatch(/^\/__toolbar\/toolbar\.js\?v=[0-9a-f]+$/);
  expect(await page.evaluate(() => fetch('/__toolbar/status').then((r) => r.json()))).toEqual({ reviewer: true });
  // the lab never sees the reviewer cookie, and page scripts cannot read it
  expect(await page.evaluate(() => document.cookie)).not.toContain('tb_review');
});

test('a comment uploads the last minute of console, errors, network and DOM', async ({ page }) => {
  await signInAsReviewer(page);
  await expect(toolbar(page)).toBeVisible();
  const before = await page.context().request.get(`${SERVER}/api/v1/recordings?sources=injector`).then(async (r) => ((await r.json()) as { items: { id: string }[] }).items.map((c) => c.id));

  await page.getByTestId('hidden-500').click();
  await page.getByTestId('throws').click();
  await page.evaluate(() => console.warn('injector-e2e warning line'));
  await page.waitForTimeout(500);

  await toolbar(page).getByRole('button', { name: 'Comment' }).click();
  await page.getByTestId('status').click(); // picks the element; the lab never sees this click
  const pop = page.locator('toolbar-root [role=dialog]');
  await expect(pop).toBeVisible();
  await pop.getByRole('textbox').fill('Order failed and the page said nothing');
  await pop.getByTestId('tb-send').click();
  const toast = page.locator('toolbar-root [role=status]', { hasText: 'Comment sent.' });
  await expect(toast).toBeVisible();
  expect(await toast.getByRole('link', { name: 'Open' }).getAttribute('href')).toContain('/s/');

  const api = page.context().request;
  const cap = await latestCapture(api, before);
  expect(cap.title).toBe('Order failed and the page said nothing');
  const detail = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}`)).json()) as { source: string; kind: string; annotations?: unknown[] };
  expect(detail.source).toBe('injector');
  expect(detail.kind).toBe('replay');

  const net = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}/network`)).json()) as { items: { url: string; status: number | null }[] };
  expect(net.items.some((n) => n.url.endsWith('/api/fail') && n.status === 500)).toBe(true);
  // the bundle's own uploads stay out of the reviewer's network log
  expect(net.items.some((n) => n.url.includes('/__toolbar/'))).toBe(false);

  const rows = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}/console`)).json()) as { items: { kind: string; level: string; message: string }[] };
  expect(rows.items.some((r) => r.kind === 'error' && /TypeError|profile/i.test(r.message))).toBe(true);
  expect(rows.items.some((r) => r.level === 'warn' && r.message.includes('injector-e2e warning line'))).toBe(true);

  const streams = await api.get(`${SERVER}/api/v1/recordings/${cap.id}/streams/rrweb/chunks`);
  expect(((await streams.json()) as { chunks: unknown[] }).chunks.length).toBeGreaterThan(0);
});

test('a trace spans two pages and keeps the comment made on the way', async ({ page }) => {
  await signInAsReviewer(page);
  await expect(toolbar(page)).toBeVisible();
  const api = page.context().request;
  const before = await api.get(`${SERVER}/api/v1/recordings?sources=injector`).then(async (r) => ((await r.json()) as { items: { id: string }[] }).items.map((c) => c.id));

  await toolbar(page).getByRole('button', { name: 'Start trace' }).click();
  await expect(toolbar(page).getByRole('button', { name: 'Stop trace' })).toBeVisible();
  await page.getByTestId('works').click();
  await page.waitForTimeout(2500); // one flush on this page
  await page.goto(`${INJECTOR}/form`);
  await expect(toolbar(page).getByRole('button', { name: 'Stop trace' })).toBeVisible();
  await page.evaluate(() => console.error('injector-e2e on the second page'));

  await toolbar(page).getByRole('button', { name: 'Comment' }).click();
  await page.locator('h1').first().click();
  const pop = page.locator('toolbar-root [role=dialog]');
  await pop.getByRole('textbox').fill('Heading is cut off');
  await pop.getByTestId('tb-send').click();
  await expect(page.locator('toolbar-root [role=status]', { hasText: 'Added to the trace.' })).toBeVisible();

  await toolbar(page).getByRole('button', { name: 'Stop trace' }).click();
  await pop.getByRole('textbox').fill('Checking save and the form');
  await pop.getByTestId('tb-send').click();
  await expect(page.locator('toolbar-root [role=status]', { hasText: 'Trace sent.' })).toBeVisible();

  const cap = await latestCapture(api, before);
  expect(cap.title).toBe('Checking save and the form');
  const net = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}/network`)).json()) as { items: { url: string }[] };
  expect(net.items.some((n) => n.url.includes('/api/ok?q=works'))).toBe(true);
  const rows = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}/console`)).json()) as { items: { kind: string; message: string; url: string | null }[] };
  expect(rows.items.some((r) => r.message.includes('injector-e2e on the second page'))).toBe(true);
  const detail = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}`)).json()) as { kind: string; source: string };
  expect(detail).toMatchObject({ kind: 'trace', source: 'injector' });
  // the server derives interaction spans from the page bundle's events as for the extension's traces
  const spans = (await (await api.get(`${SERVER}/api/v1/recordings/${cap.id}/spans`)).json()) as { items: { outcome: string }[] };
  expect(spans.items.some((sp) => sp.outcome === 'changed')).toBe(true);
  // the trace began mid-page on /, so the load of /form is its navigation row
  expect(rows.items.some((r) => r.kind === 'navigation' && `${r.message} ${r.url ?? ''}`.includes('/form'))).toBe(true);
});

test('x-review-skip, streamed HTML and WebSockets', async ({ page, browser }) => {
  await signInAsReviewer(page);
  const cookies = await page.context().cookies(INJECTOR);
  // automated tests send x-review-skip: no toolbar even with the cookie
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'x-review-skip': '1' } });
  await ctx.addCookies(cookies);
  const skipped = await ctx.newPage();
  await skipped.goto(`${INJECTOR}/`);
  await expect(skipped.getByTestId('works')).toBeVisible();
  await expect(skipped.locator('toolbar-root')).toHaveCount(0);
  await ctx.close();

  // the lab's streamed page: the head (with the toolbar) arrives before the last chunk
  const t0 = Date.now();
  await page.goto(`${INJECTOR}/slow-raw`, { waitUntil: 'commit' });
  await expect(page.locator('head > script[data-open-toolbar]')).toHaveCount(1);
  expect(Date.now() - t0).toBeLessThan(3500);
  await page.waitForLoadState('load');
  await expect(toolbar(page)).toBeVisible();

  // WebSocket upgrade through the proxy
  await page.goto(`${INJECTOR}/`);
  const hello = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
        ws.onmessage = (m) => {
          resolve(String(m.data));
          ws.close();
        };
        ws.onerror = () => reject(new Error('ws error'));
      }),
  );
  expect(JSON.parse(hello).type).toBe('hello');

  // turning review off removes the toolbar on the next load
  await toolbar(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Turn off review on this site' }).click();
  await page.waitForURL(`${INJECTOR}/`);
  await expect(page.getByTestId('works')).toBeVisible();
  await expect(page.locator('toolbar-root')).toHaveCount(0);
});

test('a strict nonce CSP: the toolbar runs with the reused nonce and renders without inline styles', async ({ browser }) => {
  // The CSP app sits behind the same injector on another host (apps/injector/test/docker-compose.yml).
  // The server only signs cookies for INJECTOR_ORIGINS, so this test signs one itself with the
  // shared secret; it checks injection and rendering, not uploads.
  const secret = process.env.INJECTOR_SECRET;
  test.skip(!secret, 'needs INJECTOR_SECRET (apps/injector/test/run.sh passes it)');
  const origin = `http://csp.localhost:${new URL(INJECTOR).port}`;
  const { createHmac } = await import('node:crypto');
  const part = Buffer.from(JSON.stringify({ v: 1, o: origin, u: 'csp-test', x: Math.floor(Date.now() / 1000) + 600, k: 'tb_dev_not_used' })).toString('base64url');
  const value = `tbr1.${part}.${createHmac('sha256', secret!).update(`tbr1.${part}`).digest('base64url')}`;
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: 'tb_review', value, url: origin }]);
  const page = await ctx.newPage();
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto(`${origin}/`);
  expect(res!.headers()['x-toolbar-injected']).toBe('1');
  const html = await res!.text();
  expect(html).toContain('data-open-toolbar=""></script>');
  expect(html).toMatch(/<script src="\/__toolbar\/toolbar\.js\?v=[0-9a-f]+" nonce="c3BlY2lhbA=="/);
  await expect(toolbar(page)).toBeVisible();
  // the app's own nonce script still runs, its un-nonced inline script is still blocked
  expect(await page.evaluate(() => [(window as { appRan?: boolean }).appRan, (window as { inlineRan?: boolean }).inlineRan])).toEqual([true, undefined]);
  // the bar is styled (constructed stylesheet), not an unstyled stack of buttons
  const radius = await toolbar(page).evaluate((el) => getComputedStyle(el).borderRadius);
  expect(radius).toBe('999px');
  // the only CSP report is the app's own blocked inline script
  expect(violations.filter((v) => !/inline script/i.test(v))).toEqual([]);
  await ctx.close();
});
