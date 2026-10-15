// Viewer models against the seed fixtures (apps/server/fixtures/events.ts): the panels, markers,
// clock and copy-as-cURL the capture page renders.
import { describe, expect, it } from 'vitest';
import { eventIndexSchema, networkEntrySchema, consoleRowSchema, actionRowSchema } from '@toolbar/shared/api';
import {
  buildTimeMap,
  computeEventIndex,
  deriveActions,
  deriveConsole,
  deriveMarkers,
  deriveNetwork,
  errorMessageOf,
  filterConsole,
  filterNetwork,
  fmtClock,
  fmtClockPrecise,
  fmtValue,
  figmaLink,
  indexAt,
  mentionsIn,
  presentConsoleChips,
  renderMarkdown,
  secondsParam,
  sortNetwork,
  toCurl,
  topFrame,
} from '../src/viewer/index.ts';
import { FIXTURE_T0, commentedEvents, screenshotEvents, sortEvents, tabVideoEvents } from '../../../apps/server/fixtures/events.ts';

const video = sortEvents(tabVideoEvents());
const vmap = buildTimeMap(video, FIXTURE_T0, true);

describe('time map', () => {
  it('puts the first video frame at player 0 and maps events after it', () => {
    expect(vmap.videoOffsetMs).toBe(20);
    expect(vmap.toPlayer(FIXTURE_T0 + 2910)).toBe(2890);
    expect(vmap.toEpoch(2890)).toBe(FIXTURE_T0 + 2910);
  });

  it('leaves paused time out of the player clock (J-029)', () => {
    const t0 = FIXTURE_T0 + 7_200_000;
    const ev = sortEvents(commentedEvents());
    const m = buildTimeMap(ev, t0, true);
    expect(m.pauses).toEqual([{ from: t0 + 5000, to: t0 + 5600 }]);
    expect(m.toPlayer(t0 + 4500)).toBe(4500);
    expect(m.toPlayer(t0 + 5300)).toBe(5000); // inside the pause: the pause point
    expect(m.toPlayer(t0 + 7900)).toBe(7300);
    expect(m.toEpoch(5000)).toBe(t0 + 5600);
  });

  it('binary-searches the row at a time', () => {
    const rows = [{ at: 0 }, { at: 100 }, { at: 200 }];
    expect(indexAt(rows, -5)).toBe(-1);
    expect(indexAt(rows, 150)).toBe(1);
    expect(indexAt(rows, 900)).toBe(2);
  });
});

describe('network', () => {
  const net = deriveNetwork(video, vmap);

  it('pairs requests, keeps the pending one, adds the socket row and matches the contract', () => {
    expect(net.map((n) => `${n.method} ${n.path} ${n.status ?? n.state}`)).toEqual([
      'GET /api/cart 200',
      'PUT /api/cart/save 200',
      'POST /api/orders 500',
      'GET /api/sync?since=0 pending',
      'GET /img/pen.jpg 200',
      'GET /live 101',
    ]);
    for (const n of net) {
      const { at: _a, frames: _f, startAt: _s, ...entry } = n;
      expect(networkEntrySchema.safeParse(entry).success).toBe(true);
    }
  });

  it('reads the error text from the 500 body and flags masked headers (J-095, J-185)', () => {
    const order = net.find((n) => n.path === '/api/orders')!;
    expect(order.errorMessage).toBe('Item ink-3 is out of stock');
    expect(order.redacted).toEqual(expect.arrayContaining(['authorization', 'cookie']));
    expect(order.type).toBe('fetch');
    expect(net.find((n) => n.host === 'localhost:5174')!.type).toBe('image');
    const ws = net.find((n) => n.type === 'websocket')!;
    expect(ws.wsFrames).toBe(3);
    expect(ws.frames.map((f) => f.op)).toEqual(['open', 'send', 'recv', 'recv']);
    expect(ws.frames.at(-1)).toMatchObject({ binary: true, length: 2048, data: null });
  });

  it('filters by chip, text and errors only, and sorts', () => {
    expect(filterNetwork(net, { chip: 'fetch', q: '', errorsOnly: false })).toHaveLength(4);
    expect(filterNetwork(net, { chip: 'all', q: '', errorsOnly: true }).map((n) => n.status)).toEqual([500]);
    expect(filterNetwork(net, { chip: 'all', q: 'pen.jpg', errorsOnly: false })).toHaveLength(1);
    expect(filterNetwork(net, { chip: 'ws', q: '', errorsOnly: false })).toHaveLength(1);
    expect(sortNetwork(net, 'status', -1)[0]!.status).toBe(500);
  });

  it('copies a multi-line cURL with placeholders for masked headers (J-107)', () => {
    const curl = toCurl(net.find((n) => n.path === '/api/orders')!);
    expect(curl).toContain("curl 'http://localhost:5173/api/orders'");
    expect(curl).toContain('-X POST');
    expect(curl).toContain("-H 'cookie: <cookie>'");
    expect(curl).toContain("-H 'authorization: <authorization>'");
    expect(curl).toContain("--data-raw '{\"cart\":42");
    expect(curl.split('\n').length).toBeGreaterThan(4);
    expect(toCurl({ method: 'GET', url: "http://x/it's" })).toBe(`curl 'http://x/it'\\''s'`);
  });
});

describe('console', () => {
  const net = deriveNetwork(video, vmap);
  const rows = deriveConsole(video, vmap, net);

  it('merges console, errors, failed requests, navigations, user events and video rows (J-102)', () => {
    const kinds = new Set(rows.map((r) => r.kind));
    expect([...kinds].sort()).toEqual(['click', 'console', 'error', 'input', 'media', 'navigation', 'network']);
    expect(rows.find((r) => r.kind === 'network')!.message).toContain('POST http://localhost:5173/api/orders 500');
    expect(rows.find((r) => r.kind === 'error')!.message).toBe("Uncaught TypeError: Cannot read properties of undefined (reading 'name')");
    expect(rows.filter((r) => r.kind === 'media').map((r) => r.message)).toEqual(['Video started', 'Video stopped']);
    expect(rows.find((r) => r.kind === 'input' && r.message.includes('email'))!.message).toContain('masked');
    for (const r of rows) {
      const { at: _a, status: _s, rid: _r, target: _t, ...row } = r;
      expect(consoleRowSchema.safeParse(row).success).toBe(true);
    }
  });

  it('formats objects as one-line JSON and errors by name (J-055)', () => {
    expect(rows.find((r) => r.message.startsWith('cart loaded'))!.message).toBe('cart loaded {items: 3, total: 45.75}');
    expect(fmtValue({ $t: 'error', name: 'TypeError', message: 'x' })).toBe('TypeError: x');
    expect(fmtValue({ $t: 'undefined' })).toBe('undefined');
  });

  it('keeps a video paused row between started and stopped (J-233)', () => {
    const ev = sortEvents(commentedEvents());
    const m = buildTimeMap(ev, FIXTURE_T0 + 7_200_000, true);
    expect(deriveConsole(ev, m).filter((r) => r.kind === 'media').map((r) => r.message)).toEqual(['Video started', 'Video paused', 'Video resumed', 'Video stopped']);
  });

  it('filters by text, level and kind chips; chips only for kinds present', () => {
    expect(filterConsole(rows, { q: 'profile', levels: [], hidden: [] }).length).toBeGreaterThan(0);
    expect(filterConsole(rows, { q: '', levels: ['warn'], hidden: ['navigation', 'network', 'user'] }).every((r) => r.level === 'warn' || r.kind === 'media')).toBe(true);
    expect(filterConsole(rows, { q: '', levels: [], hidden: ['user'] }).some((r) => r.kind === 'click')).toBe(false);
    expect(presentConsoleChips(rows).map((c) => c.id)).toEqual(['navigation', 'network', 'user']);
    const shot = sortEvents(screenshotEvents());
    const sm = buildTimeMap(shot, FIXTURE_T0 + 3_600_000, false);
    expect(presentConsoleChips(deriveConsole(shot, sm, deriveNetwork(shot, sm))).map((c) => c.id)).toEqual(['navigation', 'network', 'user']);
  });

  it('parses the top stack frame for the call-site link', () => {
    expect(topFrame('Error: x\n    at refresh (http://localhost:5173/_app/chunks/auth.js:12:9)')).toEqual({ fn: 'refresh', url: 'http://localhost:5173/_app/chunks/auth.js', line: 12, col: 9 });
    expect(topFrame(null)).toBeNull();
  });
});

describe('actions, markers, index', () => {
  it('lists clicks, typing, keys and navigations (J-108)', () => {
    const rows = deriveActions(video, vmap);
    expect(rows.map((r) => r.type)).toEqual(['navigation', 'click', 'click', 'click', 'click', 'navigation', 'input', 'input', 'input', 'key']);
    for (const r of rows) {
      const { at: _a, ...row } = r;
      expect(actionRowSchema.safeParse(row).success).toBe(true);
    }
  });

  it('groups errors and failed requests into markers with a status badge (J-072)', () => {
    const net = deriveNetwork(video, vmap);
    const rows = deriveConsole(video, vmap, net);
    const markers = deriveMarkers(rows, net, video, vmap);
    const fail = markers.find((m) => m.kind === 'net-fail')!;
    expect(fail.status).toBe(500);
    expect(fail.label).toContain('Item ink-3 is out of stock');
    expect(fail.at).toBe(2630);
    const err = markers.find((m) => m.kind === 'error')!;
    expect(err.count).toBe(2); // uncaught TypeError and the console.error 20 ms later
    expect(markers.some((m) => m.kind === 'pen')).toBe(true);
  });

  it('computes an event index that passes the contract', () => {
    const idx = computeEventIndex(video, vmap);
    expect(eventIndexSchema.safeParse(idx).success).toBe(true);
    expect(idx.network).toMatchObject({ total: 6, failed: 1, pending: 1 });
    expect(idx.user).toEqual({ clicks: 4, inputs: 3, keys: 1, navigations: 2 });
    expect(idx.errors).toBe(2);
  });

  it('reads error text from bodies', () => {
    expect(errorMessageOf('{"type":"error","error":{"message":"CSRF check failed"}}')).toBe('CSRF check failed');
    expect(errorMessageOf('not json')).toBe('not json');
  });
});

describe('format and markdown', () => {
  it('formats clocks', () => {
    expect(fmtClock(65_400)).toBe('1:05');
    expect(fmtClock(-20_000)).toBe('-0:20');
    expect(fmtClockPrecise(12_340)).toBe('0:12.34');
    expect(secondsParam(12_345)).toBe('12.35');
  });

  it('renders lists, bold, links, mentions and time links, escaping the rest', () => {
    const html = renderMarkdown('Steps:\n- one **bold**\n- two\n\n1. [0:05](t:5000) click\n2. see https://example.com/a\n\n<script>x</script> @[Sam Developer](user:019a0000-0000-7000-8000-000000000002)');
    expect(html).toContain('<ul><li>one <strong>bold</strong></li><li>two</li></ul>');
    expect(html).toContain('<ol><li><button type="button" class="nb-timelink" data-seek="5000">0:05</button> click</li>');
    expect(html).toContain('<a href="https://example.com/a"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('class="nb-mention"');
    expect(mentionsIn('hi @[A](user:019a0000-0000-7000-8000-000000000002)')).toEqual(['019a0000-0000-7000-8000-000000000002']);
  });

  it('finds public Figma links (J-116)', () => {
    expect(figmaLink('see https://www.figma.com/design/AbC123/Checkout?node-id=1-2 ok')).toBe('https://www.figma.com/design/AbC123/Checkout?node-id=1-2');
    expect(figmaLink('https://example.com')).toBeNull();
  });
});
