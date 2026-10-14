// Form typing and masking, navigation causes, WebSocket and SSE, header and body redaction,
// GraphQL, CORS and timing, env info and device emulation, user-event switch-off.
import { LAB_ORIGIN_2, LAB_URL, byKind, expect, ring, setSettings, sleep, tabIdOf, test } from './helpers.ts';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsYWIifQ.c2lnbmF0dXJlLXZhbHVlLWhlcmU';
const CARD = '4242 4242 4242 4242';

test('form: one row per field, email and password masked, bodies redacted (J-068, J-186, J-187)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(`${LAB_URL}/form`);
  const tabId = await tabIdOf(sw, page);
  await page.getByLabel('Name').fill('Ada Lovelace');
  await page.getByLabel('Email').fill('ada@example.com');
  await page.getByLabel('Password').fill('hunter2-secret');
  await page.getByLabel('Notes').fill(`token ${JWT} card ${CARD}`);
  // The lab's form action answers 403 (cross-site check), as recorded in docs/jam/capture.md.
  const posted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/form'));
  await page.getByRole('button', { name: 'Create account' }).click();
  await posted;
  await sleep(300);
  const s = await ring(sw, tabId);
  const inputs = byKind(s, 'user').filter((e) => e.data.type === 'input');
  const byName = Object.fromEntries(inputs.map((e) => [(e.data.target as { attrs?: { name?: string } }).attrs?.name, e.data]));
  expect(Object.keys(byName).sort()).toEqual(['email', 'name', 'notes', 'password']);
  expect(inputs).toHaveLength(4); // one row per field
  expect(byName.name).toMatchObject({ value: 'Ada Lovelace' });
  expect(byName.email).toMatchObject({ value: '********', masked: true });
  expect(byName.password).toMatchObject({ value: '********', masked: true });
  expect(String(byName.notes!.value)).toBe('token [redacted] card [redacted]');
  const post = byKind(s, 'net.req').find((e) => e.data.source === 'page' && e.data.method === 'POST' && String(e.data.url).includes('/form'))!;
  expect(post).toBeTruthy();
  const body = decodeURIComponent(String(post.data.body).replace(/\+/g, ' '));
  expect(body).toContain('name=Ada Lovelace');
  expect(body).toContain('email=[redacted]');
  expect(body).toContain('password=[redacted]');
  const all = JSON.stringify(s);
  for (const secret of ['hunter2-secret', 'ada@example.com', JWT, CARD]) expect(all).not.toContain(secret);
  await page.close();
});

test('navigation rows name the cause; full loads follow a tab-hidden row (J-069, J-032 data)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL); // typed address
  const tabId = await tabIdOf(sw, page);
  await page.getByRole('link', { name: 'Form' }).click(); // SPA
  await expect(page).toHaveURL(/\/form$/);
  await page.reload();
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.href = '/slow-raw';
    a.textContent = 'raw';
    a.setAttribute('data-sveltekit-reload', '');
    document.body.append(a);
    a.click();
  });
  await page.waitForURL(/slow-raw/);
  await page.waitForLoadState('load');
  await page.goBack();
  await page.waitForURL(/\/form$/);
  await sleep(500);
  const s = await ring(sw, tabId);
  const navs = byKind(s, 'nav').filter((e) => e.ctx === 'top').map((e) => `${e.data.type}:${e.data.cause ?? ''}:${new URL(String(e.data.url)).pathname}`);
  expect(navs).toEqual(expect.arrayContaining(['load:typed:/', 'pushState::/form', 'load:reload:/form', 'load:link:/slow-raw', 'load:back_forward:/form']));
  // each full load after the first is preceded by a visibility false row from the old document
  const seq = s.events.filter((e) => (e.kind === 'nav' && e.data.type === 'load' && e.ctx === 'top') || (e.kind === 'user' && e.data.type === 'visibility'));
  const reloadIdx = seq.findIndex((e) => e.kind === 'nav' && e.data.cause === 'reload');
  expect(seq[reloadIdx - 1]).toMatchObject({ kind: 'user', data: { type: 'visibility', visible: false } });
  await page.close();
});

test('WebSocket frames with binary placeholders, SSE messages (J-062, J-063, J-066)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(`${LAB_URL}/live`);
  const tabId = await tabIdOf(sw, page);
  await page.getByTestId('ws-connect').click();
  await expect(page.locator('pre').first()).toContainText('open');
  await page.getByTestId('ws-send').click();
  await page.getByTestId('sse-connect').click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const w = new WebSocket(`ws://${location.host}/ws`);
        w.binaryType = 'arraybuffer';
        w.onopen = () => {
          w.send(new Uint8Array([1, 2, 3, 4, 5]));
          setTimeout(() => {
            w.close();
            resolve();
          }, 300);
        };
      }),
  );
  await sleep(3500); // a server tick and a few SSE messages
  const s = await ring(sw, tabId);
  const ws = byKind(s, 'ws').map((e) => e.data);
  const sid = ws.find((f) => f.op === 'open' && String(f.url).endsWith('/ws'))!.sid;
  const mine = ws.filter((f) => f.sid === sid);
  expect(mine.find((f) => f.op === 'open' && f.code === 101)).toBeTruthy();
  expect(mine.find((f) => f.op === 'send')).toMatchObject({ data: JSON.stringify({ type: 'say', text: 'hello' }), length: 29 });
  expect(mine.filter((f) => f.op === 'recv').map((f) => JSON.parse(String(f.data)).type)).toEqual(expect.arrayContaining(['hello', 'echo']));
  expect(ws.find((f) => f.op === 'send' && f.binary)).toMatchObject({ binary: true, length: 5 });
  expect(ws.find((f) => f.op === 'send' && f.binary)!.data).toBeUndefined();
  const sse = byKind(s, 'sse').map((e) => e.data);
  expect(sse.find((e) => e.op === 'open')!.url).toMatch(/\/api\/sse$/);
  expect(sse.filter((e) => e.op === 'message' && e.event === 'tick').length).toBeGreaterThan(1);
  // webRequest sees the upgrade request too
  expect(byKind(s, 'net.req').some((e) => e.data.source === 'webRequest' && e.data.initiator === 'websocket')).toBe(true);
  await page.close();
});

test('secret headers are masked before they leave the page and the worker (J-059, J-185)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.evaluate(async () => {
    document.cookie = 'lab_session=cookie-secret-value; path=/';
    await fetch('/api/ok?q=auth&api_key=query-secret', { headers: { Authorization: 'Bearer header-secret-value', 'X-Api-Key': 'apikey-secret', 'X-Trace': 'visible' } });
  });
  await sleep(300);
  const s = await ring(sw, tabId);
  const page_ = byKind(s, 'net.req').find((e) => e.data.source === 'page' && String(e.data.url).includes('q=auth'))!;
  expect(page_.data.headers).toMatchObject({ authorization: '[redacted]', 'x-api-key': '[redacted]', 'x-trace': 'visible' });
  expect(String(page_.data.url)).toContain('api_key=%5Bredacted%5D');
  const wr = byKind(s, 'net.req').find((e) => e.data.source === 'webRequest' && String(e.data.url).includes('q=auth'))!;
  expect(wr.data.headers).toMatchObject({ cookie: '[redacted]', authorization: '[redacted]' });
  const all = JSON.stringify(s);
  for (const secret of ['cookie-secret-value', 'header-secret-value', 'apikey-secret', 'query-secret']) expect(all).not.toContain(secret);
  await page.close();
});

test('GraphQL errors at HTTP 200 carry the operation and an error count (J-064)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.route('**/graphql', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: null, errors: [{ message: 'Cart not found' }] }) }));
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.evaluate(() => fetch('/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'query GetCart($id: ID!) { cart(id: $id) { id } }', variables: { id: 1 } }) }).then((r) => r.json()));
  await sleep(300);
  const s = await ring(sw, tabId);
  const req = byKind(s, 'net.req').find((e) => e.data.source === 'page' && String(e.data.url).endsWith('/graphql'))!;
  expect(req.data.graphql).toEqual({ operationName: 'GetCart' });
  const res = byKind(s, 'net.res').find((e) => e.data.rid === req.data.rid)!;
  expect(res.data).toMatchObject({ status: 200, graphqlErrors: 1 });
  await page.close();
});

test('CORS failures are called out; rows carry a timing breakdown (J-065)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  const err = await page.evaluate((u) => fetch(u).then(() => 'ok', (e: Error) => e.message), `${LAB_ORIGIN_2}/api/data`);
  expect(err).toContain('Failed to fetch');
  await page.getByTestId('works').click();
  await sleep(500);
  const s = await ring(sw, tabId);
  const cors = byKind(s, 'net.fail').find((e) => e.data.cors === true)!;
  expect(cors.data).toMatchObject({ error: 'cors', source: 'webRequest' });
  const wrReq = byKind(s, 'net.req').find((e) => e.data.rid === cors.data.rid)!;
  expect(String(wrReq.data.url)).toBe(`${LAB_ORIGIN_2}/api/data`);
  expect(byKind(s, 'net.fail').some((e) => e.data.source === 'page' && String(e.data.error).includes('Failed to fetch'))).toBe(true);
  const ok = byKind(s, 'net.res').find((e) => e.data.source === 'page' && e.data.status === 200 && (e.data.timing as { dns?: number })?.dns !== undefined)!;
  expect(ok.data.timing).toMatchObject({ dns: expect.any(Number), connect: expect.any(Number), ttfb: expect.any(Number) });
  await page.close();
});

test('env info: browser, OS, viewport, DPR, locale, zone, connection; emulated mobile viewport (J-070, J-022)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await sleep(300);
  let s = await ring(sw, tabId);
  const env = byKind(s, 'env').at(-1)!.data;
  expect(env).toMatchObject({ browser: { name: 'Chrome' }, os: { name: 'Linux' }, dpr: 1, url: `${LAB_URL}/`, source: 'page' });
  expect((env.viewport as { w: number }).w).toBeGreaterThan(600);
  expect(env.locale).toBeTruthy();
  expect(env.tz).toBeTruthy();
  expect(env.connection).toMatchObject({ effectiveType: expect.any(String) });
  expect(String((env.browser as { version: string }).version)).toMatch(/^\d+\.\d+/);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp.send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' });
  await page.reload();
  await sleep(500);
  s = await ring(sw, tabId, 5000);
  const m = byKind(s, 'env').at(-1)!.data;
  // The page has no viewport meta tag, so the layout viewport is 980 px wide; the screen is the device.
  expect(m).toMatchObject({ screen: { w: 390, h: 844 }, dpr: 3, os: { name: 'iOS', version: '17.4' } });
  expect(String(m.ua)).toContain('iPhone');
  await page.close();
});

test('turning off user-event capture drops click and typing rows (J-190)', async ({ context, sw, mock: _ }) => {
  await setSettings(sw, { captureUserEvents: false });
  try {
    const page = await context.newPage();
    await page.goto(`${LAB_URL}/form`);
    const tabId = await tabIdOf(sw, page);
    const t0 = Date.now();
    await page.getByLabel('Name').fill('Grace');
    await page.getByLabel('Email').click();
    await page.getByRole('button', { name: 'Create account' }).click();
    await sleep(500);
    const s = await ring(sw, tabId);
    expect(byKind(s, 'user').filter((e) => e.t >= t0 && e.data.type !== 'visibility')).toEqual([]);
    expect(byKind(s, 'net.req').some((e) => e.data.method === 'POST')).toBe(true); // the rest is still captured
    await page.close();
  } finally {
    await setSettings(sw, { captureUserEvents: true });
  }
});
