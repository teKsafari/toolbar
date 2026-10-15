// Agent area: derived models over events (network merge, console rows, actions), paging, filters,
// and the markdown summary and prompts built from them.
import { describe, expect, it } from 'vitest';
import { createEmitter, type CaptureEvent } from '../src/events.ts';
import {
  agentPrompts,
  copyForAi,
  decodeCursor,
  encodeCursor,
  investigationGuide,
  pageItems,
  prepare,
  queryActions,
  queryConsole,
  queryEvents,
  queryNetwork,
  querySocketFrames,
  shareMarkdown,
  signalsOf,
  type CaptureBrief,
} from '../src/derive/index.ts';

const T0 = 1_800_000_000_000;

function events(): CaptureEvent[] {
  let now = T0;
  const top = createEmitter('top', () => now);
  const off = createEmitter('off', () => now);
  const at = (ms: number) => (now = T0 + ms);
  const out: CaptureEvent[] = [];
  at(0);
  out.push(top('nav', { type: 'load', url: 'http://lab.test/checkout' }));
  at(100);
  out.push(off('media', { stream: 'video', op: 'start' }));
  at(500);
  out.push(top('console', { level: 'log', args: ['cart', { items: 3 }] }));
  at(1000);
  out.push(top('user', { type: 'click', target: { selector: 'button[data-testid="submit"]', tag: 'button', text: 'Submit', testId: 'submit', rect: { x: 0, y: 0, w: 10, h: 10 } } }));
  out.push(top('net.req', { rid: 'r1', method: 'POST', url: 'http://lab.test/api/orders', headers: { authorization: '[redacted]' }, body: '{"a":1}', initiator: 'fetch', source: 'page' }));
  at(1300);
  out.push(top('net.res', { rid: 'r1', status: 500, statusText: 'Internal Server Error', headers: { 'content-type': 'application/json' }, body: '{"error":"boom","message":"Out of stock"}', contentType: 'application/json' }));
  at(1400);
  out.push(top('net.req', { rid: 'r2', method: 'GET', url: 'http://lab.test/api/cart', initiator: 'fetch', source: 'page' }));
  at(1450);
  out.push(top('net.res', { rid: 'r2', status: 200, body: '{"ok":true}', contentType: 'application/json' }));
  at(1500);
  out.push(top('net.req', { rid: 'r3', method: 'GET', url: 'http://lab.test/api/sync', initiator: 'fetch', source: 'page' }));
  at(2000);
  out.push(top('error', { type: 'error', name: 'TypeError', message: "Cannot read properties of undefined (reading 'x')", stack: "TypeError: x\n    at render (http://lab.test/app.js:10:5)" }));
  at(2100);
  out.push(top('user', { type: 'input', target: { selector: 'input[name="password"]', tag: 'input', name: 'password', rect: { x: 0, y: 0, w: 1, h: 1 } }, masked: true, value: '****' }));
  at(2200);
  out.push(top('ws', { sid: 'w1', op: 'open', url: 'ws://lab.test/live' }));
  at(2300);
  out.push(top('ws', { sid: 'w1', op: 'send', data: '{"hello":1}' }));
  at(2400);
  out.push(top('ws', { sid: 'w1', op: 'recv', data: '{"tick":1}' }));
  return out;
}

const brief = (over: Partial<CaptureBrief> = {}): CaptureBrief => ({
  id: 'c1',
  title: 'Submit does nothing',
  description: 'Clicked submit.',
  kind: 'video',
  status: 'ready',
  url: 'http://nib.test/s/tok',
  pageUrl: 'http://lab.test/checkout',
  pageTitle: 'Checkout',
  createdAt: '2026-10-13T14:00:00.000Z',
  durationMs: 3000,
  author: { name: 'Dana', email: 'dana@nib.test' },
  env: { ua: 'UA', browser: { name: 'Chrome', version: '141' }, os: { name: 'Linux' }, viewport: { w: 1280, h: 720 }, dpr: 1, tz: 'Africa/Nairobi' },
  folder: null,
  imageUrl: null,
  comments: [{ author: 'Sam', body: 'Seen it, @[Dana](user:019a0000-0000-7000-8000-000000000001)', tMs: 1200, createdAt: '2026-10-13T14:01:00.000Z', replies: [{ author: 'Dana', body: 'thanks', tMs: null, createdAt: '2026-10-13T14:02:00.000Z' }] }],
  transcript: null,
  ...over,
});

describe('derive: network, console, actions', () => {
  const p = prepare(events(), T0, true);

  it('merges requests with responses and keeps the pending one', () => {
    const page = queryNetwork(p, { limit: 50 });
    expect(page.total).toBe(4);
    const failed = page.items.find((r) => r.rid === 'r1')!;
    expect(failed.status).toBe(500);
    expect(failed.errorMessage).toBe('Out of stock');
    expect(failed.responseBody).toContain('boom');
    expect(failed.requestHeaders).toBeUndefined();
    expect(failed.videoMs).toBe(900);
    expect(page.items.find((r) => r.rid === 'r3')!.state).toBe('pending');
    expect(page.items.find((r) => r.type === 'websocket')!.wsFrames).toBe(2);
  });

  it('merges a webRequest sighting that trails the page hook under load, nearest first', () => {
    let now = T0;
    const top = createEmitter('top', () => now);
    const sw = createEmitter('sw', () => now);
    const at = (ms: number) => (now = T0 + ms);
    const evs: CaptureEvent[] = [];
    at(1000);
    evs.push(top('net.req', { rid: 'p1', method: 'POST', url: 'http://lab.test/api/fail', initiator: 'fetch', source: 'page' }));
    at(1100);
    evs.push(top('net.res', { rid: 'p1', status: 500, body: '{"error":"x"}', contentType: 'application/json' }));
    at(1400); // the browser saw it 400 ms later (a busy machine)
    evs.push(sw('net.req', { rid: 'w1', method: 'POST', url: 'http://lab.test/api/fail', source: 'webRequest' }));
    at(2000);
    evs.push(top('net.req', { rid: 'p2', method: 'POST', url: 'http://lab.test/api/fail', initiator: 'fetch', source: 'page' }));
    at(2010);
    evs.push(sw('net.req', { rid: 'w2', method: 'POST', url: 'http://lab.test/api/fail', source: 'webRequest' }));
    const rows = queryNetwork(prepare(evs, T0, true), {}).items as { rid: string; source: string }[];
    expect(rows.map((r) => [r.rid, r.source])).toEqual([
      ['p1', 'both'],
      ['p2', 'both'],
    ]);
  });

  it('takes the tab from the envelope the worker stamps on desktop recordings (J-224)', () => {
    const evs = events().map((e) => (e.kind === 'net.req' && (e.data as { rid: string }).rid === 'r2' ? { ...e, tab: 7 } : e));
    const rows = queryNetwork(prepare(evs, T0, true), {}).items as { rid: string; tabId: number | null }[];
    expect(rows.find((r) => r.rid === 'r2')?.tabId).toBe(7);
    expect(rows.find((r) => r.rid === 'r1')?.tabId).toBeNull();
  });

  it('filters network by status class, method and bodies, with headers on request', () => {
    expect(queryNetwork(p, { status: ['5xx'] }).items.map((r) => r.rid)).toEqual(['r1']);
    expect(queryNetwork(p, { status: ['pending'] }).items.map((r) => r.rid)).toEqual(['r3']);
    expect(queryNetwork(p, { status: ['failed'] }).items.map((r) => r.rid)).toEqual(['r1']);
    expect(queryNetwork(p, { methods: ['post'] }).items).toHaveLength(1);
    const ok = queryNetwork(p, { status: ['2xx'], bodies: 'all', headers: true }).items[0]!;
    expect(ok.responseBody).toBe('{"ok":true}');
    expect(queryNetwork(p, { status: ['2xx'] }).items[0]!.responseBody).toBeUndefined();
    expect(queryNetwork(p, { status: ['5xx'], headers: true }).items[0]!.requestHeaders).toEqual({ authorization: '[redacted]' });
  });

  it('lists socket messages by direction', () => {
    const rid = p.network.find((r) => r.type === 'websocket')!.rid;
    expect(querySocketFrames(p, rid, {})!.total).toBe(3);
    expect(querySocketFrames(p, rid, { direction: 'recv' })!.items.map((f) => f.data)).toEqual(['{"tick":1}']);
    expect(querySocketFrames(p, 'nope', {})).toBeNull();
  });

  it('keeps frame length and marks binary frames, which carry no data (J-062, J-066)', () => {
    const evs = events();
    const last = evs[evs.length - 1]!;
    evs.push({ ...last, t: last.t + 50, kind: 'ws', data: { sid: 'w1', op: 'recv', binary: true, length: 2048 } } as CaptureEvent);
    const q = prepare(evs, T0, true);
    const rid = q.network.find((r) => r.type === 'websocket')!.rid;
    const frames = q.network.find((r) => r.rid === rid)!.frames;
    expect(frames.map((f) => [f.op, f.length, f.binary])).toEqual([
      ['open', null, false],
      ['send', 11, false],
      ['recv', 10, false],
      ['recv', 2048, true],
    ]);
    const bin = querySocketFrames(q, rid, { direction: 'recv' })!.items.at(-1)!;
    expect(bin).toMatchObject({ binary: true, length: 2048, data: null });
  });

  it('merges console with errors and failed requests, filtered by level and window', () => {
    const errs = queryConsole(p, { levels: ['error'] }).items;
    expect(errs.map((r) => r.kind)).toEqual(['network', 'error']);
    expect(errs[1]!.source).toEqual({ fn: 'render', url: 'http://lab.test/app.js', line: 10, col: 5 });
    expect(queryConsole(p, { kinds: ['console'] }).items[0]!.message).toBe('cart {items: 3}');
    expect(queryConsole(p, { fromMs: 1900, toMs: 2050 }).items.map((r) => r.kind)).toEqual(['error']);
  });

  it('lists actions with masked input', () => {
    const a = queryActions(p, {}).items;
    expect(a.map((r) => r.type)).toEqual(['navigation', 'click', 'input']);
    expect(a[2]!.masked).toBe(true);
    expect(queryActions(p, { q: 'submit' }).items).toHaveLength(1);
  });

  it('filters raw events by kind', () => {
    expect(queryEvents(p, { kinds: ['ws'] }).total).toBe(3);
  });
});

describe('derive: paging', () => {
  it('round-trips cursors and pages to the end', () => {
    expect(decodeCursor(encodeCursor(37))).toBe(37);
    expect(decodeCursor('garbage!!')).toBe(0);
    const items = Array.from({ length: 7 }, (_, i) => i);
    const a = pageItems(items, { limit: 3 });
    expect(a).toMatchObject({ items: [0, 1, 2], total: 7, returned: 3, hasMore: true });
    const b = pageItems(items, { limit: 3, cursor: a.nextCursor });
    const c = pageItems(items, { limit: 3, cursor: b.nextCursor });
    expect(c).toMatchObject({ items: [6], hasMore: false, nextCursor: null });
  });
});

describe('derive: summaries', () => {
  const p = prepare(events(), T0, true);
  const s = signalsOf(p);

  it('counts signals', () => {
    expect(s).toMatchObject({ consoleErrors: 0, uncaughtErrors: 1, failedRequests: 1, serverErrors: 1, pendingRequests: 1, interactions: 2, navigations: 1 });
  });

  it('writes the share markdown with front matter, signals, comments and pointers (J-153)', () => {
    const md = shareMarkdown(brief(), s, { mcpUrl: 'http://nib.test/mcp', apiUrl: 'http://nib.test/api/v1', cli: 'nib' });
    expect(md.startsWith('---\ntitle: "Submit does nothing"\n')).toBe(true);
    expect(md).toContain('browser: "Chrome 141"');
    expect(md).toContain('Signals: 1 console error, 1 failed request, 1 with a 5xx status, 1 request never answered, 2 interactions.');
    expect(md).toContain('## Comments (2)');
    expect(md).toContain('@Dana');
    expect(md).toContain('  - **Dana**');
    expect(md).toContain('http://nib.test/mcp');
    expect(md).toContain('`nib get http://nib.test/s/tok`');
    expect(md).toContain(`- HTTP API: \`GET http://nib.test/api/v1/recordings/${brief().id}/console\``);
  });

  it('leaves the paused CLI out of the share markdown when no CLI is named (J-153, docs/scope.md)', () => {
    const md = shareMarkdown(brief(), s, { mcpUrl: 'http://nib.test/mcp', apiUrl: 'http://nib.test/api/v1', cli: null });
    expect(md).toContain('- MCP server: http://nib.test/mcp');
    expect(md).toContain('- HTTP API:');
    expect(md).not.toMatch(/\bnib (get|console|network|frames)\b/);
    expect(md).not.toContain('CLI');
  });

  it('ranks the next calls in the guide (J-149)', () => {
    const g = investigationGuide(brief(), p, s);
    const lines = g.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(lines[0]).toContain('get_network_requests');
    expect(lines[0]).toContain('POST /api/orders');
    expect(g).toContain('get_frames with at [900]');
    expect(lines.at(-1)).toContain('create_comment');
    expect(investigationGuide(brief({ status: 'processing' }), null, null)).toContain('not ready');
  });

  it('builds prompts and the copy-for-AI bundle (J-152)', () => {
    const pr = agentPrompts('http://nib.test/c/1', 'http://nib.test/mcp');
    for (const k of ['setup', 'fix', 'summarize', 'e2e'] as const) expect(pr[k]).toContain(k === 'setup' ? 'http://nib.test/mcp' : 'http://nib.test/c/1');
    const all = copyForAi(brief(), p, { mcpUrl: 'http://nib.test/mcp', cli: 'nib' });
    expect(all).toContain('## Failed requests');
    expect(all).toContain('Out of stock');
    expect(all).toContain('## Requests that never answered');
    expect(all).toContain('type (masked) into input[name="password"]');
  });
});
