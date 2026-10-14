// Realistic capture events for the seed captures (scripts/seed.ts) and for tests.
// Times are fixed so the fixtures are deterministic; every event passes captureEventSchema
// (test/fixtures.test.ts). The page is the lab app's checkout on http://localhost:5173.
import { createEmitter, type CaptureEvent, type EnvInfo, type EventDataMap, type EventKind, type TargetRef } from '@toolbar/shared';

/** 2026-10-13T14:00:00Z */
export const FIXTURE_T0 = Date.UTC(2026, 9, 13, 14, 0, 0);
export const LAB = 'http://localhost:5173';

export const fixtureEnv = (url: string, title: string): EnvInfo => ({
  ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  platform: 'Linux x86_64',
  browser: { name: 'Chrome', version: '141.0.7390.54' },
  os: { name: 'Linux' },
  viewport: { w: 1280, h: 720 },
  screen: { w: 1920, h: 1080 },
  dpr: 1,
  locale: 'en-GB',
  tz: 'Africa/Nairobi',
  extVersion: '0.0.1',
  maskingPreset: 'staging',
  url,
  title,
  connection: { effectiveType: '4g', downlink: 10, rtt: 50 },
  incognito: false,
});

const button = (testId: string, text: string, x: number): TargetRef => ({
  selector: `button[data-testid="${testId}"]`,
  xpath: `/html/body/main/section/button[${x}]`,
  tag: 'button',
  role: 'button',
  name: text,
  text,
  testId,
  classes: ['btn', 'btn-primary'],
  rect: { x: 64 + (x - 1) * 224, y: 170, w: 200, h: 48 },
  landmarks: ['main'],
  heading: 'Checkout',
});

/** Password fields have no textbox role. */
const input = (name: string, type: 'text' | 'email' | 'password', y: number): TargetRef => ({
  selector: `input[name="${name}"]`,
  tag: 'input',
  role: 'textbox',
  name,
  elId: name,
  classes: ['field'],
  rect: { x: 64, y, w: 420, h: 40 },
  landmarks: ['main', 'form'],
  heading: 'Your details',
  ...(type === 'password' ? { role: undefined } : {}),
});

/** Small clock: `at(ms)` moves time, `emit` stamps events per context. */
function timeline(t0: number) {
  let now = t0;
  const clock = () => now;
  const ctx = { top: createEmitter('top', clock), sw: createEmitter('sw', clock), off: createEmitter('off', clock) };
  const out: CaptureEvent[] = [];
  const emit = <K extends EventKind>(c: keyof typeof ctx, kind: K, data: EventDataMap[K]) => {
    out.push(ctx[c](kind, data) as CaptureEvent);
  };
  return { at: (ms: number) => void (now = t0 + ms), emit, out };
}

const json = (v: unknown) => JSON.stringify(v);
const stack = (fn: string, line: number) =>
  `TypeError: Cannot read properties of undefined (reading 'name')\n    at ${fn} (${LAB}/_app/immutable/nodes/2.Bx81k.js:${line}:17)\n    at HTMLButtonElement.onclick (${LAB}/_app/immutable/nodes/2.Bx81k.js:${line + 40}:9)`;

/**
 * Capture 1: 8 s tab video on /checkout. Console at several levels, a hidden 500 on
 * "Submit order", a request that never returns ("Sync"), a cross-origin image, a WebSocket, an
 * uncaught TypeError, a SPA navigation, masked typing, a pen marker.
 */
export function tabVideoEvents(t0 = FIXTURE_T0): CaptureEvent[] {
  const { at, emit, out } = timeline(t0);
  const url = `${LAB}/checkout`;
  at(0);
  emit('top', 'env', fixtureEnv(url, 'Checkout - Lab shop'));
  emit('top', 'nav', { type: 'load', url, title: 'Checkout - Lab shop' });
  at(20);
  emit('off', 'media', { stream: 'video', op: 'start', mime: 'video/webm;codecs=vp9,opus', width: 1280, height: 720 });
  at(300);
  emit('top', 'console', { level: 'info', args: ['cart loaded', { items: 3, total: 45.75 }] });
  at(500);
  emit('top', 'net.req', { rid: 'top-0', method: 'GET', url: `${LAB}/api/cart`, headers: { accept: 'application/json' }, initiator: 'fetch', source: 'page' });
  at(640);
  emit('top', 'net.res', {
    rid: 'top-0',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: json({ items: [{ sku: 'nb-1', qty: 2 }, { sku: 'fp-2', qty: 1 }, { sku: 'ink-3', qty: 3 }] }),
    contentType: 'application/json',
    encodedSize: 182,
    timing: { start: t0 + 500, dns: 0, connect: 0, ttfb: 120, end: t0 + 640 },
    source: 'page',
  });
  at(1200);
  emit('top', 'user', { type: 'click', target: button('save', 'Save (works)', 1), x: 164, y: 194 });
  at(1250);
  emit('top', 'net.req', {
    rid: 'top-1',
    method: 'PUT',
    url: `${LAB}/api/cart/save`,
    headers: { 'content-type': 'application/json', authorization: '[redacted]' },
    body: json({ saved: true }),
    initiator: 'fetch',
    source: 'page',
  });
  at(1400);
  emit('top', 'net.res', {
    rid: 'top-1',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: json({ id: 42, savedAt: '2026-10-13T14:00:01Z' }),
    contentType: 'application/json',
    encodedSize: 44,
    timing: { start: t0 + 1250, ttfb: 140, end: t0 + 1400 },
    source: 'page',
  });
  at(1450);
  emit('top', 'dom', { added: 1, removed: 0, attrs: 2, text: 1, rects: [{ x: 64, y: 660, w: 300, h: 24 }] });
  emit('top', 'console', { level: 'log', args: ['saved', { id: 42 }] });
  at(2600);
  emit('top', 'user', { type: 'click', target: button('submit-order', 'Submit order', 2), x: 404, y: 194 });
  at(2650);
  emit('top', 'net.req', {
    rid: 'top-2',
    method: 'POST',
    url: `${LAB}/api/orders`,
    headers: { 'content-type': 'application/json', authorization: '[redacted]', cookie: '[redacted]' },
    body: json({ cart: 42, email: '[redacted]', card: '[redacted]' }),
    initiator: 'fetch',
    source: 'page',
  });
  at(2910);
  emit('top', 'net.res', {
    rid: 'top-2',
    status: 500,
    statusText: 'Internal Server Error',
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_7f3a' },
    body: json({ error: 'inventory_unavailable', message: 'Item ink-3 is out of stock' }),
    contentType: 'application/json',
    encodedSize: 71,
    timing: { start: t0 + 2650, dns: 0, connect: 0, ttfb: 250, end: t0 + 2910 },
    source: 'page',
  });
  at(2920);
  emit('top', 'console', { level: 'debug', args: ['order request finished', { status: 500 }] });
  at(3500);
  emit('top', 'user', { type: 'click', target: button('sync', 'Sync', 3), x: 624, y: 194 });
  at(3520);
  // never answered: no net.res and no net.fail (pending, J-061)
  emit('top', 'net.req', { rid: 'top-3', method: 'GET', url: `${LAB}/api/sync?since=0`, initiator: 'fetch', source: 'page' });
  at(4200);
  emit('sw', 'net.req', { rid: 'sw-0', method: 'GET', url: 'http://localhost:5174/img/pen.jpg', initiator: 'image', source: 'webRequest' });
  at(4290);
  emit('sw', 'net.res', {
    rid: 'sw-0',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'image/jpeg' },
    contentType: 'image/jpeg',
    encodedSize: 48211,
    timing: { start: t0 + 4200, end: t0 + 4290 },
    source: 'webRequest',
  });
  at(4600);
  emit('top', 'ws', { sid: 'ws-0', op: 'open', url: 'ws://localhost:5173/live' });
  at(4700);
  emit('top', 'ws', { sid: 'ws-0', op: 'send', data: json({ type: 'hello' }) });
  at(4800);
  emit('top', 'ws', { sid: 'ws-0', op: 'recv', data: json({ type: 'tick', n: 1 }) });
  at(5200);
  emit('top', 'user', {
    type: 'click',
    target: { ...button('show-profile', 'Show profile', 4), rect: { x: 728, y: 170, w: 200, h: 48 } },
    x: 828,
    y: 194,
  });
  at(5210);
  emit('top', 'error', {
    type: 'error',
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'name')",
    stack: stack('renderProfile', 88),
    src: `${LAB}/_app/immutable/nodes/2.Bx81k.js`,
    line: 88,
    col: 17,
  });
  at(5230);
  emit('top', 'console', {
    level: 'error',
    args: ['Profile failed to render', { $t: 'error', name: 'TypeError', message: "Cannot read properties of undefined (reading 'name')", stack: stack('renderProfile', 88) }],
    stack: `at renderProfile (${LAB}/_app/immutable/nodes/2.Bx81k.js:88:17)`,
  });
  at(6000);
  emit('top', 'nav', { type: 'pushState', url: `${LAB}/checkout/details`, from: url, title: 'Your details - Lab shop' });
  emit('top', 'dom', { added: 14, removed: 22, attrs: 3, text: 6, rects: [{ x: 0, y: 56, w: 1280, h: 664 }] });
  at(6400);
  emit('top', 'user', { type: 'input', target: input('name', 'text', 250), value: 'Ada Lovelace' });
  at(6800);
  emit('top', 'user', { type: 'input', target: input('email', 'email', 310), value: '*******', masked: true });
  at(7100);
  emit('top', 'user', { type: 'input', target: input('password', 'password', 370), value: '**********', masked: true });
  at(7200);
  emit('top', 'user', { type: 'key', key: 'Enter', target: input('password', 'password', 370) });
  emit('top', 'console', { level: 'warn', args: ['Slow render: 312 ms in <DetailsForm>'] });
  at(7400);
  emit('top', 'marker', { type: 'mark', label: 'pen' });
  at(7990);
  emit('off', 'media', { stream: 'video', op: 'stop' });
  return out;
}

/**
 * Capture 2: an area screenshot of the checkout buttons. Includes logs from before the shot
 * (J-071): the hidden 500 and a console error from 20 s earlier.
 */
export function screenshotEvents(t0 = FIXTURE_T0 + 3_600_000): CaptureEvent[] {
  const { at, emit, out } = timeline(t0);
  const url = `${LAB}/checkout`;
  at(-20_000);
  emit('top', 'env', fixtureEnv(url, 'Checkout - Lab shop'));
  emit('top', 'nav', { type: 'load', url, title: 'Checkout - Lab shop' });
  at(-19_000);
  emit('top', 'user', { type: 'click', target: button('submit-order', 'Submit order', 2), x: 404, y: 194 });
  emit('top', 'net.req', { rid: 'top-0', method: 'POST', url: `${LAB}/api/orders`, body: json({ cart: 42 }), initiator: 'fetch', source: 'page' });
  at(-18_700);
  emit('top', 'net.res', {
    rid: 'top-0',
    status: 500,
    statusText: 'Internal Server Error',
    headers: { 'content-type': 'application/json' },
    body: json({ error: 'inventory_unavailable', message: 'Item ink-3 is out of stock' }),
    contentType: 'application/json',
    timing: { start: t0 - 19_000, end: t0 - 18_700 },
    source: 'page',
  });
  at(-18_650);
  emit('top', 'console', { level: 'error', args: ['POST /api/orders 500'] });
  at(0);
  emit('top', 'shot', { assetId: 'shot-0', rect: { x: 40, y: 120, w: 720, h: 300 }, reason: 'user', target: button('submit-order', 'Submit order', 2) });
  emit('top', 'annotation', { annotationId: 'a01', op: 'create' });
  return out;
}

/** Capture 3: 8 s tab video on /form with a WebSocket and SSE; it carries the comment thread. */
export function commentedEvents(t0 = FIXTURE_T0 + 7_200_000): CaptureEvent[] {
  const { at, emit, out } = timeline(t0);
  const url = `${LAB}/form`;
  at(0);
  emit('top', 'env', fixtureEnv(url, 'Form - Lab shop'));
  emit('top', 'nav', { type: 'load', url, title: 'Form - Lab shop' });
  emit('off', 'media', { stream: 'video', op: 'start', mime: 'video/webm;codecs=vp9,opus', width: 1280, height: 720 });
  at(800);
  emit('top', 'sse', { sid: 'sse-0', op: 'open', url: `${LAB}/events` });
  at(1300);
  emit('top', 'sse', { sid: 'sse-0', op: 'message', event: 'price', data: json({ sku: 'ink-3', price: 6.25 }) });
  at(2000);
  emit('top', 'user', { type: 'input', target: input('name', 'text', 250), value: 'Grace Hopper' });
  at(3000);
  emit('top', 'user', { type: 'click', target: button('submit', 'Send', 1), x: 164, y: 194 });
  emit('top', 'net.req', {
    rid: 'top-0',
    method: 'POST',
    url: `${LAB}/form?/save`,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'name=Grace+Hopper&email=%5Bredacted%5D',
    initiator: 'fetch',
    source: 'page',
  });
  at(3180);
  emit('top', 'net.res', {
    rid: 'top-0',
    status: 403,
    statusText: 'Forbidden',
    headers: { 'content-type': 'application/json' },
    body: json({ type: 'error', error: { message: 'CSRF check failed' } }),
    contentType: 'application/json',
    timing: { start: t0 + 3000, end: t0 + 3180 },
    source: 'page',
  });
  at(3200);
  emit('top', 'console', { level: 'warn', args: ['form action failed', { status: 403 }] });
  at(4500);
  emit('top', 'error', { type: 'unhandledrejection', name: 'Error', message: 'refresh token expired', stack: `Error: refresh token expired\n    at refresh (${LAB}/_app/immutable/chunks/auth.js:12:9)` });
  at(5000);
  emit('off', 'media', { stream: 'video', op: 'pause' });
  at(5600);
  emit('off', 'media', { stream: 'video', op: 'resume' });
  at(7900);
  emit('top', 'sse', { sid: 'sse-0', op: 'close' });
  emit('off', 'media', { stream: 'video', op: 'stop' });
  return out;
}

export const sortEvents = (events: CaptureEvent[]) =>
  events.slice().sort((a, b) => a.t - b.t || (a.ctx < b.ctx ? -1 : a.ctx > b.ctx ? 1 : 0) || a.seq - b.seq);
