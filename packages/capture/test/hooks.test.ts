// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaptureEvent } from '@toolbar/shared';
import { createEmitter } from '@toolbar/shared/events';
import type { Emit, Uninstall } from '../src/transport.ts';
import { installConsoleHook } from '../src/hooks/console.ts';
import { installNetworkHook, graphqlOf, graphqlErrorsOf, bodyToText } from '../src/hooks/network.ts';
import { installWebSocketHook, frameData } from '../src/hooks/websocket.ts';
import { installEventSourceHook } from '../src/hooks/eventsource.ts';
import { installHistoryHook } from '../src/hooks/history.ts';
import { installErrorsHook } from '../src/hooks/errors.ts';
import { installWorkerHook } from '../src/hooks/worker.ts';
import { evaluateMetadata } from '../src/metadata.ts';

const W = window as unknown as Window & typeof globalThis;
let undo: Uninstall[] = [];
afterEach(() => {
  for (const u of undo.reverse()) u();
  undo = [];
});

function collector() {
  const out: CaptureEvent[] = [];
  const make = createEmitter('top');
  const emit: Emit = (kind, data) => out.push(make(kind, data as never) as CaptureEvent);
  return { out, emit };
}
const of = <K extends CaptureEvent['kind']>(out: CaptureEvent[], k: K) => out.filter((e) => e.kind === k) as Extract<CaptureEvent, { kind: K }>[];

describe('console hook', () => {
  it('records every level with args and stack, and still calls the native method', () => {
    const native = vi.fn();
    const orig = console.log;
    console.log = native;
    const { out, emit } = collector();
    undo.push(installConsoleHook(emit, W));
    console.log('a', 1, { b: [2] });
    expect(native).toHaveBeenCalledWith('a', 1, { b: [2] });
    console.warn('w');
    console.error('e', new Error('boom'));
    console.count('c');
    console.count('c');
    console.assert(true, 'not recorded');
    console.assert(false, 'recorded');
    console.time('t');
    console.timeEnd('t');
    undo.pop()!();
    console.log = orig;
    const rows = of(out, 'console');
    expect(rows.map((r) => r.data.level)).toEqual(['log', 'warn', 'error', 'count', 'count', 'assert', 'time', 'timeEnd']);
    expect(rows[0]!.data.args).toEqual(['a', 1, { b: [2] }]);
    expect(rows[0]!.data.stack).toBeTruthy();
    expect(rows[2]!.data.args[1]).toMatchObject({ $t: 'error', name: 'Error', message: 'boom' });
    expect(rows[4]!.data).toMatchObject({ count: 2, args: ['c: 2'] });
    expect(rows[5]!.data.args).toEqual(['recorded']);
    expect(String(rows[7]!.data.args[0])).toMatch(/^t: [\d.]+ ms$/);
  });

  it('keeps native-looking functions', () => {
    const before = console.info.toString();
    const { emit } = collector();
    undo.push(installConsoleHook(emit, W));
    expect(console.info.name).toBe('info');
    expect(console.info.toString()).toBe(before);
  });
});

describe('network hook: fetch', () => {
  it('records request and response with headers, bodies and graphql info', async () => {
    const orig = W.fetch;
    W.fetch = vi.fn(async () => new Response(JSON.stringify({ errors: [{ message: 'x' }], data: null }), { status: 200, headers: { 'content-type': 'application/json', 'x-r': '1' } })) as typeof fetch;
    const { out, emit } = collector();
    undo.push(() => (W.fetch = orig));
    undo.push(installNetworkHook(emit, W));
    const res = await W.fetch('/graphql', { method: 'post', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify({ query: 'query GetUser { user { id } }' }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: null }); // page still reads the body
    await vi.waitFor(() => expect(of(out, 'net.res')).toHaveLength(1));
    const [req] = of(out, 'net.req');
    expect(req!.data).toMatchObject({ method: 'POST', initiator: 'fetch', source: 'page', graphql: { operationName: 'GetUser' }, headers: { authorization: 'Bearer t' } });
    expect(req!.data.url).toMatch(/\/graphql$/);
    const [r] = of(out, 'net.res');
    expect(r!.data).toMatchObject({ rid: req!.data.rid, status: 200, contentType: 'application/json', graphqlErrors: 1, headers: { 'x-r': '1' } });
    expect(r!.data.body).toContain('errors');
    expect(r!.data.timing!.end).toBeGreaterThanOrEqual(r!.data.timing!.start);
  });

  it('records failures and keeps the rejection for the page', async () => {
    const orig = W.fetch;
    W.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const { out, emit } = collector();
    undo.push(() => (W.fetch = orig));
    undo.push(installNetworkHook(emit, W));
    await expect(W.fetch('http://x.test/a')).rejects.toThrow('Failed to fetch');
    await vi.waitFor(() => expect(of(out, 'net.fail')).toHaveLength(1));
    expect(of(out, 'net.fail')[0]!.data.error).toBe('TypeError: Failed to fetch');
  });

  it('a request that never answers has only net.req (pending)', async () => {
    const orig = W.fetch;
    W.fetch = vi.fn(() => new Promise<Response>(() => {})) as typeof fetch;
    const { out, emit } = collector();
    undo.push(() => (W.fetch = orig));
    undo.push(installNetworkHook(emit, W));
    void W.fetch('/api/hang');
    await new Promise((r) => setTimeout(r, 20));
    expect(out.map((e) => e.kind)).toEqual(['net.req']);
  });

  it('helpers', () => {
    expect(graphqlOf(JSON.stringify({ query: '{ a }', operationName: 'Op' }), 'http://x')).toEqual({ operationName: 'Op' });
    expect(graphqlOf('{"a":1}', 'http://x')).toBeUndefined();
    expect(graphqlErrorsOf('{"data":1}')).toBeUndefined();
    expect(bodyToText(new Uint8Array(3))).toEqual({ body: '[binary 3 B]' });
    expect(bodyToText(new URLSearchParams({ a: '1' }))).toEqual({ body: 'a=1' });
  });
});

class FakeSocket extends EventTarget {
  static OPEN = 1;
  readyState = 0;
  protocol = '';
  sent: unknown[] = [];
  constructor(public url: string) {
    super();
  }
  send(d: unknown) {
    this.sent.push(d);
  }
  close() {}
}

describe('websocket hook', () => {
  it('records open, frames both ways with binary placeholders, and close', () => {
    const orig = W.WebSocket;
    W.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const { out, emit } = collector();
    undo.push(() => (W.WebSocket = orig));
    undo.push(installWebSocketHook(emit, W));
    const ws = new W.WebSocket('ws://localhost:5173/ws') as unknown as FakeSocket;
    expect(ws).toBeInstanceOf(FakeSocket);
    expect((W.WebSocket as unknown as { OPEN: number }).OPEN).toBe(1);
    ws.dispatchEvent(new Event('open'));
    ws.send('hello');
    ws.dispatchEvent(new MessageEvent('message', { data: 'héllo' }));
    ws.dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(16) }));
    ws.dispatchEvent(new CloseEvent('close', { code: 1000 }));
    expect(ws.sent).toEqual(['hello']);
    const frames = of(out, 'ws').map((e) => e.data);
    expect(frames.map((f) => f.op)).toEqual(['open', 'open', 'send', 'recv', 'recv', 'close']);
    expect(frames[1]).toMatchObject({ code: 101 });
    expect(frames[2]).toMatchObject({ data: 'hello', length: 5 });
    expect(frames[3]).toMatchObject({ data: 'héllo', length: 6 });
    expect(frames[4]).toEqual({ sid: frames[0]!.sid, op: 'recv', binary: true, length: 16 });
    expect(frames[5]).toMatchObject({ code: 1000 });
  });

  it('frameData sizes', () => {
    expect(frameData(new Uint8Array(5))).toEqual({ binary: true, length: 5 });
  });
});

class FakeES extends EventTarget {
  readyState = 1;
  constructor(public url: string) {
    super();
  }
  close() {
    this.readyState = 2;
  }
}

describe('eventsource hook', () => {
  it('keeps unnamed and named events the page listens for', () => {
    const orig = W.EventSource;
    W.EventSource = FakeES as unknown as typeof EventSource;
    const { out, emit } = collector();
    undo.push(() => (W.EventSource = orig));
    undo.push(installEventSourceHook(emit, W));
    const es = new W.EventSource('/api/sse') as unknown as FakeES;
    const seen: string[] = [];
    es.addEventListener('tick', (e) => seen.push((e as MessageEvent).data));
    es.dispatchEvent(new Event('open'));
    es.dispatchEvent(new MessageEvent('tick', { data: '1' }));
    es.dispatchEvent(new MessageEvent('message', { data: 'plain' }));
    es.close();
    expect(seen).toEqual(['1']);
    const ev = of(out, 'sse').map((e) => e.data);
    expect(ev.map((e) => e.op)).toEqual(['open', 'open', 'message', 'message', 'close']);
    expect(ev[2]).toMatchObject({ event: 'tick', data: '1' });
    expect(ev[3]).toMatchObject({ data: 'plain' });
  });
});

describe('history hook', () => {
  it('records pushState, replaceState with a new URL, popstate and hashchange', () => {
    const { out, emit } = collector();
    undo.push(installHistoryHook(emit, W));
    history.pushState({}, '', '/a');
    history.replaceState({}, '', '/a'); // same URL: ignored
    history.replaceState({}, '', '/b');
    window.dispatchEvent(new PopStateEvent('popstate'));
    const navs = of(out, 'nav').map((e) => e.data);
    expect(navs.map((n) => n.type)).toEqual(['pushState', 'replaceState', 'popstate']);
    expect(navs[0]!.url).toMatch(/\/a$/);
    expect(navs[1]!.from).toMatch(/\/a$/);
  });
});

describe('errors hook', () => {
  it('records uncaught errors and unhandled rejections', () => {
    const { out, emit } = collector();
    undo.push(installErrorsHook(emit, W));
    const err = new TypeError("Cannot read properties of undefined (reading 'name')");
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message, filename: 'http://x/app.js', lineno: 3, colno: 9 }));
    const rej = new Event('unhandledrejection') as Event & { reason: unknown };
    Object.defineProperty(rej, 'reason', { value: new Error('nope') });
    window.dispatchEvent(rej);
    const errs = of(out, 'error').map((e) => e.data);
    expect(errs[0]).toMatchObject({ type: 'error', name: 'TypeError', src: 'http://x/app.js', line: 3, col: 9 });
    expect(errs[0]!.stack).toContain('TypeError');
    expect(errs[1]).toMatchObject({ type: 'unhandledrejection', name: 'Error', message: 'nope' });
  });
});

describe('metadata', () => {
  it('accepts objects up to 10 KB and rejects larger ones', () => {
    expect(evaluateMetadata(() => ({ plan: 'x' }))).toEqual({ value: { plan: 'x' } });
    expect(evaluateMetadata({ a: 1 })).toEqual({ value: { a: 1 } });
    expect(evaluateMetadata(() => ({ big: 'x'.repeat(11_000) }))).toEqual({ error: 'too_large' });
    expect(evaluateMetadata(() => [1])).toEqual({ error: 'not_object' });
    expect(evaluateMetadata(null)).toEqual({ value: null });
  });
});

describe('worker hook (D-189)', () => {
  it('marks a post and the first answer after it, without payloads, and still posts', () => {
    const posted: unknown[] = [];
    class FakeWorker extends EventTarget {
      postMessage(m: unknown) {
        posted.push(m);
      }
      reply() {
        this.dispatchEvent(new MessageEvent('message', { data: { type: 'stdout', text: 'secret output' } }));
      }
    }
    const orig = W.Worker;
    W.Worker = FakeWorker as unknown as typeof Worker;
    undo.push(() => (W.Worker = orig));
    const { out, emit } = collector();
    undo.push(installWorkerHook(emit, W));
    const w = new (W.Worker as unknown as typeof FakeWorker)();
    w.postMessage({ type: 'run', code: 'andika(1)' });
    w.postMessage({ type: 'input', text: 'x' }); // still owed an answer: no second send
    w.reply();
    w.reply();
    w.postMessage({ type: 'run', code: 'andika(2)' });
    expect(posted).toHaveLength(3);
    const ev = of(out, 'worker');
    expect(ev.map((e) => e.data.op)).toEqual(['send', 'recv', 'send']);
    expect(new Set(ev.map((e) => e.data.wid)).size).toBe(1);
    expect(JSON.stringify(ev)).not.toContain('andika');
    expect(JSON.stringify(ev)).not.toContain('secret');
  });
});
