// Page hooks on the lab app, one test per lab case (docs/jam/capture.md). Each test reads the
// worker's per-tab ring, which is what every capture slices from.
import { LAB_ORIGIN_2, LAB_URL, byKind, expect, ring, sleep, tabIdOf, test } from './helpers.ts';

test('Save (works): fetch with headers, JSON body, timing; click row with test id (J-058, J-059, J-060, J-067)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.getByTestId('works').click();
  await expect(page.getByTestId('status')).toContainText('saved at');
  await sleep(300);
  const s = await ring(sw, tabId);
  const req = byKind(s, 'net.req').find((e) => e.data.source === 'page' && String(e.data.url).includes('/api/ok?q=works'))!;
  expect(req.data).toMatchObject({ method: 'GET', initiator: 'fetch' });
  const res = byKind(s, 'net.res').find((e) => e.data.rid === req.data.rid)!;
  expect(res.data).toMatchObject({ status: 200, source: 'page' });
  expect(String(res.data.contentType)).toContain('json');
  expect(JSON.parse(String(res.data.body))).toHaveProperty('at');
  expect((res.data.timing as { end: number; start: number }).end).toBeGreaterThanOrEqual((res.data.timing as { start: number }).start);
  // webRequest sees the same request with full request headers (J-059)
  const wr = byKind(s, 'net.req').find((e) => e.data.source === 'webRequest' && String(e.data.url).includes('/api/ok?q=works'))!;
  expect(wr).toBeTruthy();
  expect(Object.keys(wr.data.headers as object)).toEqual(expect.arrayContaining(['user-agent', 'accept']));
  const wres = byKind(s, 'net.res').find((e) => e.data.rid === wr.data.rid)!;
  expect(wres.data).toMatchObject({ status: 200, source: 'webRequest' });
  expect(Object.keys(wres.data.headers as object)).toContain('content-type');
  const click = byKind(s, 'user').find((e) => e.data.type === 'click' && (e.data.target as { testId?: string })?.testId === 'works')!;
  expect(click.data.target).toMatchObject({ tag: 'button', role: 'button', attrs: { type: 'submit', 'data-testid': 'works' } });
  await page.close();
});

test('Export (no handler): a click row and nothing after it', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await sleep(500);
  const t0 = Date.now();
  await page.getByTestId('dead').click();
  await sleep(800);
  const s = await ring(sw, tabId);
  const after = s.events.filter((e) => e.t >= t0 - 5 && e.kind !== 'dom');
  expect(after.map((e) => `${e.kind}:${e.data.type ?? ''}`)).toEqual(['user:click']);
  await page.close();
});

test('Sync (never returns): a pending request with no response (J-061)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.getByTestId('hangs').click();
  await sleep(1000);
  const s = await ring(sw, tabId);
  const req = byKind(s, 'net.req').find((e) => e.data.source === 'page' && String(e.data.url).endsWith('/api/hang'))!;
  expect(req).toBeTruthy();
  expect(s.events.filter((e) => (e.kind === 'net.res' || e.kind === 'net.fail') && e.data.rid === req.data.rid)).toEqual([]);
  await page.close();
});

test('Submit order (hidden 500): request and response JSON bodies (J-060)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.getByTestId('hidden-500').click();
  await expect(page.getByTestId('status')).toHaveText('saved');
  await sleep(300);
  const s = await ring(sw, tabId);
  const req = byKind(s, 'net.req').find((e) => e.data.source === 'page' && String(e.data.url).endsWith('/api/fail'))!;
  expect(req.data).toMatchObject({ method: 'POST', body: JSON.stringify({ item: 'lab-42', qty: 3 }) });
  expect(req.data.headers).toMatchObject({ 'content-type': 'application/json' });
  const res = byKind(s, 'net.res').find((e) => e.data.rid === req.data.rid)!;
  expect(res.data.status).toBe(500);
  expect(JSON.parse(String(res.data.body))).toMatchObject({ error: 'database_unavailable' });
  await page.close();
});

test('Show profile (throws) and Refresh (unhandled rejection) are error rows with stacks (J-057)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.getByTestId('throws').click();
  await page.getByTestId('rejects').click();
  await sleep(300);
  const s = await ring(sw, tabId);
  const errs = byKind(s, 'error');
  const te = errs.find((e) => e.data.type === 'error')!;
  expect(te.data).toMatchObject({ name: 'TypeError' });
  expect(String(te.data.message)).toContain('profile');
  expect(String(te.data.stack)).toContain('TypeError');
  const rej = errs.find((e) => e.data.type === 'unhandledrejection')!;
  expect(rej.data).toMatchObject({ name: 'Error', message: 'unhandled rejection from the lab app' });
  // the log line before the throw
  expect(byKind(s, 'console').some((e) => (e.data.args as unknown[])[0] === 'about to read profile name')).toBe(true);
  await page.close();
});

test('Console at every level with serialized objects and call-site stacks (J-055, J-056)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.getByTestId('console').click();
  await sleep(300);
  const s = await ring(sw, tabId);
  const rows = byKind(s, 'console').filter((e) => e.ctx === 'top');
  const levels = rows.map((r) => r.data.level);
  expect(levels).toEqual(expect.arrayContaining(['log', 'info', 'warn', 'error', 'debug', 'table', 'group', 'groupEnd', 'trace', 'assert', 'count', 'time', 'timeEnd']));
  const info = rows.find((r) => r.data.level === 'info')!;
  expect((info.data.args as unknown[])[1]).toMatchObject({ user: { id: 7, roles: ['admin', 'editor'] }, at: { $t: 'date' } });
  const err = rows.find((r) => r.data.level === 'error')!;
  expect((err.data.args as unknown[])[1]).toMatchObject({ $t: 'error', name: 'Error', message: 'lab error object' });
  expect(String((err.data.args as { stack?: string }[])[1]!.stack)).toContain('Error: lab error object');
  for (const r of rows.filter((r) => ['log', 'info', 'warn', 'error', 'debug'].includes(String(r.data.level)))) {
    expect(String(r.data.stack)).toMatch(/localhost:5173.*:\d+:\d+/); // function, file, line and column
    expect(String(r.data.stack)).not.toContain('chrome-extension://');
  }
  expect(rows.filter((r) => r.data.level === 'count').map((r) => r.data.count)).toEqual([1, 2]);
  expect((rows.find((r) => r.data.level === 'assert')!.data.args as unknown[])[0]).toBe('assert: failed assertion');
  await page.close();
});

test('Modal, cross-origin image (webRequest) and iframe clicks, fetches and console (J-058, J-067 Better)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); // memory-cache hits never reach webRequest
  await page.reload(); // the image loads while the ring runs
  await page.getByTestId('open-modal').click();
  await page.getByRole('button', { name: 'Delete' }).click();
  const frame = page.frameLocator('iframe');
  await frame.getByRole('button', { name: /Iframe button/ }).click();
  await sleep(500);
  const s = await ring(sw, tabId);
  const img = byKind(s, 'net.req').find((e) => String(e.data.url).startsWith(`${LAB_ORIGIN_2}/badge.svg`))!;
  expect(img.data).toMatchObject({ source: 'webRequest', initiator: 'image' });
  expect(byKind(s, 'net.res').some((e) => e.data.rid === img.data.rid && e.data.status === 200)).toBe(true);
  expect(byKind(s, 'console').some((e) => (e.data.args as unknown[])[0] === 'delete clicked in modal')).toBe(true);
  const fclick = byKind(s, 'user').find((e) => e.data.type === 'click' && String((e.data.target as { text?: string })?.text).startsWith('Iframe button'))!;
  expect(fclick).toBeTruthy();
  expect((fclick.data.target as { frame?: string }).frame).toMatch(/^f/);
  expect(byKind(s, 'console').some((e) => e.ctx !== 'top' && (e.data.args as unknown[])[0] === 'iframe button clicked')).toBe(true);
  expect(byKind(s, 'net.req').some((e) => e.data.source === 'page' && e.ctx !== 'top' && String(e.data.url).includes('q=iframe'))).toBe(true);
  // the extension's own requests never appear (J-248)
  expect(s.events.filter((e) => String(e.data.url ?? '').startsWith('chrome-extension://'))).toEqual([]);
  await page.close();
});
