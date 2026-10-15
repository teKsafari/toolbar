// Part 2 traces (PLAN "What a trace is"): Start trace, use the lab app's buttons, Stop trace,
// then read the spans the server derives. Each lab button has one expected outcome:
//   Save -> changed, Export -> dead, Submit order -> silent 5xx, Show profile -> error,
//   canvas redraw -> changed (not dead), Sync -> stuck.
// Runs against a real server (SERVER_URL) with the mock OIDC provider (e2e/fixtures/oidc.ts):
// the test signs in, makes a personal token and hands it to the extension.
import type { Page, Worker } from '@playwright/test';
import { LAB_URL, SERVER_URL, expect, test } from '../../fixtures/extension.ts';
import { signInOidc } from '../../fixtures/oidc.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

test.describe.configure({ timeout: 240_000 });

interface SpanLite {
  id: string;
  outcome: string;
  silent?: string;
  closeReason: string;
  summary: string;
  action: { type: string; label: string; target?: { testId?: string } };
  effects: { canvas: string | null; nav: string[] };
  keyframes: string[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function tabIdOf(sw: Worker, page: Page): Promise<number> {
  const url = page.url();
  return sw.evaluate(async (url) => {
    for (let i = 0; i < 40; i++) {
      const tabs = ((await chrome.tabs.query({})) as { id?: number; url?: string }[]).filter((t) => t.url === url);
      if (tabs.length) return Math.max(...tabs.map((t) => t.id ?? -1));
      await new Promise((r) => setTimeout(r, 100));
    }
    return -1;
  }, url);
}

/** A person signs in on the server, makes a personal token and gives it to the extension. */
async function signInExtension(page: Page, sw: Worker) {
  const email = `trace-${Date.now()}@toolbar.test`;
  // the browser is shared by the tests of this file: sign in once
  if ((await page.request.get(`${SERVER_URL}/api/v1/me`)).status() !== 200) await signInOidc(page, SERVER_URL, email, { name: 'Trace Reviewer' });
  const me = await (await page.request.get(`${SERVER_URL}/api/v1/me`)).json();
  expect(me.activeWorkspaceId, 'a first sign-in gets a workspace').toBeTruthy();
  const res = await page.request.post(`${SERVER_URL}/api/v1/tokens`, { data: { name: 'trace e2e', scopes: ['cli:read', 'cli:write'], expiresInDays: 7 } });
  expect(res.status()).toBe(201);
  const { secret } = await res.json();
  await sw.evaluate(
    async ({ serverUrl, token, ws, email }) => {
      await chrome.storage.local.set({
        'tb:auth': { serverUrl, token, tokenId: 'tok-trace', user: { id: 'u', name: 'Trace Reviewer', email, image: null }, activeWorkspaceId: ws, signedInAt: Date.now() },
        'tb:server-url': serverUrl,
      });
    },
    { serverUrl: SERVER_URL, token: secret as string, ws: me.activeWorkspaceId as string, email },
  );
  return secret as string;
}

test('a trace of the lab buttons: each button gets its outcome, spans.jsonl comes from the API', async ({ context, sw }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  const setup = await context.newPage();
  const token = await signInExtension(setup, sw);
  await setup.close();

  const page = await context.newPage();
  await page.goto(LAB_URL);
  await page.bringToFront();
  const tabId = await tabIdOf(sw, page);
  expect(tabId).toBeGreaterThan(0);

  const started = await sw.evaluate((tabId) => (globalThis as unknown as { __tb: { trace: { start(t: number): Promise<unknown> } } }).__tb.trace.start(tabId), tabId);
  expect(started).toMatchObject({ tabId, spans: 0 });
  await sleep(800);

  // one action at a time, each given time to close (500 ms quiet, 2.5 s without effect)
  await page.getByTestId('works').click();
  await expect(page.getByTestId('status')).toHaveText(/saved at/);
  await sleep(1500);
  await page.getByTestId('dead').click();
  await sleep(3200);
  await page.getByTestId('hidden-500').click();
  await sleep(1500);
  await page.getByTestId('throws').click();
  await sleep(1500);
  await page.getByRole('link', { name: 'Canvas' }).click();
  await expect(page.getByTestId('redraw')).toBeVisible();
  await sleep(1500);
  await page.getByTestId('redraw').click();
  await sleep(3200);
  await page.getByRole('link', { name: 'Buttons' }).click();
  await expect(page.getByTestId('hangs')).toBeVisible();
  await sleep(1500);
  await page.getByTestId('hangs').click();
  await sleep(10_800);

  const kf = await sw.evaluate(() => (globalThis as unknown as { __tb: { trace: { stats: unknown } } }).__tb.trace.stats);

  const result = (await sw.evaluate(() => (globalThis as unknown as { __tb: { trace: { stop(o: unknown): Promise<unknown> } } }).__tb.trace.stop({ open: false }))) as { recordingId: string; spans: number };
  expect(result.recordingId).toBeTruthy();
  // the worker's live engine saw the same actions
  const live = (await sw.evaluate(() => (globalThis as unknown as { __tb: { traceSpans(): unknown } }).__tb.traceSpans())) as SpanLite[];
  expect(live.length).toBeGreaterThanOrEqual(6);

  const auth = { authorization: `Bearer ${token}` };
  await expect
    .poll(async () => (await (await page.request.get(`${SERVER_URL}/api/v1/recordings/${result.recordingId}`, { headers: auth })).json()).status, { timeout: 90_000, intervals: [1000] })
    .toBe('ready');
  const detail = await (await page.request.get(`${SERVER_URL}/api/v1/recordings/${result.recordingId}`, { headers: auth })).json();
  expect(detail.kind).toBe('trace');

  const res = await page.request.get(`${SERVER_URL}/api/v1/recordings/${result.recordingId}/spans`, { headers: auth });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items: SpanLite[]; summary: { outcomes: Record<string, number>; attention: string[] }; timeline: string[] };
  const spans = body.items;
  const byTest = (id: string) => spans.filter((s) => s.action.target?.testId === id);
  const one = (id: string) => {
    const list = byTest(id);
    expect(list, `one span for ${id}: ${JSON.stringify(spans.map((s) => s.summary))}`).toHaveLength(1);
    return list[0]!;
  };

  expect(one('works').outcome).toBe('changed');
  expect(one('dead').outcome).toBe('dead');
  expect(one('hidden-500')).toMatchObject({ outcome: 'silent', silent: '5xx' });
  expect(one('throws').outcome).toBe('error');
  const redraw = one('redraw');
  expect(redraw.outcome).toBe('changed');
  expect(redraw.effects.canvas).toBe('changed');
  expect(one('hangs').outcome).toBe('stuck');
  const navClick = spans.find((s) => s.action.label === 'Click "Canvas"');
  expect(navClick?.effects.nav[0]).toMatch(/\/canvas$/);
  expect(body.summary.attention.length).toBeGreaterThanOrEqual(3);
  expect(body.timeline.some((l) => /silent 5xx/.test(l) && /POST \/api\/fail 500/.test(l))).toBe(true);

  // keyframes were taken and attached (route changes, changed spans)
  expect(spans.flatMap((s) => s.keyframes).length, JSON.stringify(kf)).toBeGreaterThanOrEqual(3);

  // spans.jsonl
  const jsonl = await page.request.get(`${SERVER_URL}/api/v1/recordings/${result.recordingId}/spans?format=jsonl`, { headers: auth });
  expect(jsonl.headers()['content-type']).toContain('application/x-ndjson');
  const lines = (await jsonl.text()).trim().split('\n');
  expect(lines).toHaveLength(spans.length);
  expect(JSON.parse(lines[0]!).id).toBe(spans[0]!.id);

  // live and server agree on the outcomes of the lab buttons
  for (const id of ['works', 'dead', 'hidden-500', 'throws', 'redraw', 'hangs']) {
    expect(live.find((s) => s.action.target?.testId === id)?.outcome, id).toBe(one(id).outcome);
  }

  // the capture page shows each action's outcome in the Actions tab
  const viewer = await context.newPage();
  await viewer.goto(`${SERVER_URL}/c/${result.recordingId}`);
  // the page hydrates before the tab answers clicks
  await expect(async () => {
    await viewer.getByTestId('tab-actions').click();
    await expect(viewer.getByTestId('tab-actions')).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
  }).toPass({ timeout: 30_000 });
  await expect(viewer.getByTestId('trace-outcomes')).toContainText('1 dead', { timeout: 30_000 });
  await expect(viewer.locator('[data-testid=span-outcome][data-outcome=stuck]')).toHaveCount(1);
  await expect(viewer.locator('[data-testid=span-outcome][data-outcome=silent]')).toHaveText('silent 5xx');
  await viewer.close();
  await page.close();
});

test('the popup starts and stops a trace', async ({ context, sw }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  const setup = await context.newPage();
  await signInExtension(setup, sw);
  await setup.close();
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html?tabId=${tabId}`);
  const row = popup.locator('[data-row="trace"] [data-row-main]');
  await expect(row).toHaveText(/Start trace/);
  await row.click();
  await expect
    .poll(() => sw.evaluate(() => (globalThis as unknown as { __tb: { trace: { state(): { tabId: number } | null } } }).__tb.trace.state()?.tabId ?? null))
    .toBe(tabId);
  await page.bringToFront();
  await page.getByTestId('works').click();
  await sleep(1500);
  const popup2 = await context.newPage();
  await popup2.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html?tabId=${tabId}`);
  await expect(popup2.locator('[data-row="trace-stop"] [data-row-main]')).toHaveText(/Stop trace/);
  await expect(popup2.locator('[data-trace-badge]')).toHaveText(/1 action/);
  await popup2.locator('[data-row="trace-stop"] [data-row-main]').click();
  await expect.poll(() => sw.evaluate(() => (globalThis as unknown as { __tb: { trace: { state(): unknown } } }).__tb.trace.state()), { timeout: 30_000 }).toBeNull();
  // stop opens the trace on the server
  await expect.poll(() => context.pages().some((p) => p.url().startsWith(SERVER_URL)), { timeout: 15_000 }).toBe(true);
});
