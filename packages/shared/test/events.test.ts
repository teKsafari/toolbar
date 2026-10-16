import { describe, expect, it } from 'vitest';
import {
  EVENT_KINDS,
  compareEvents,
  createEmitter,
  fromNdjson,
  parseEvent,
  safeParseEvent,
  toNdjson,
  type CaptureEvent,
} from '../src/index.ts';

describe('createEmitter', () => {
  it('stamps v, ctx, monotonic seq and id', () => {
    let t = 1000;
    const make = createEmitter('top', () => t++);
    const a = make('console', { level: 'log', args: ['hi', 1] });
    const b = make('nav', { type: 'pushState', url: 'http://x/a' });
    expect(a).toEqual({ v: 1, id: 'top:0', ctx: 'top', seq: 0, t: 1000, kind: 'console', data: { level: 'log', args: ['hi', 1] } });
    expect(b.id).toBe('top:1');
    expect(b.seq).toBe(1);
  });
});

describe('schema round trip', () => {
  const make = createEmitter('top', () => 1);
  const samples: CaptureEvent[] = [
    make('env', { ua: 'UA', viewport: { w: 1280, h: 720 }, dpr: 1 }),
    make('nav', { type: 'load', url: 'http://localhost:5173/' }),
    make('console', { level: 'error', args: [{ $error: 'Error', message: 'x' }], stack: 'at y' }),
    make('error', { type: 'unhandledrejection', message: 'boom' }),
    make('net.req', { rid: 'top-0', method: 'POST', url: '/api/fail', source: 'page', initiator: 'fetch' }),
    make('net.res', { rid: 'top-0', status: 500, truncated: false, timing: { start: 1, end: 2 } }),
    make('net.fail', { rid: 'top-1', error: 'abort' }),
    make('ws', { sid: 'w1', op: 'recv', data: 'tick' }),
    make('sse', { sid: 's1', op: 'message', data: '1' }),
    make('worker', { wid: 'w-1', op: 'send' }),
    make('user', { type: 'click', target: { selector: '#save', tag: 'button', rect: { x: 1, y: 2, w: 3, h: 4 } } }),
    make('dom', { added: 1, removed: 0, attrs: 2, text: 0, rects: [] }),
    make('rrweb', { chunk: 0, first: 1, last: 2 }),
    make('media', { stream: 'video', op: 'start' }),
    make('shot', { assetId: 'a', reason: 'user' }),
    make('annotation', { annotationId: 'n', op: 'create' }),
    make('marker', { type: 'mark' }),
    make('canvas.sample', { phase: 'after', key: 'canvas', rect: { x: 0, y: 0, w: 10, h: 10 }, hash: '0a1b2c3d', diff: 0.25, at: 1 }),
    make('stackmap', { ref: 'top.k1:3', frames: [{ fn: 'f', url: 'http://h/a.js', line: 1, col: 2, file: 'src/a.ts', srcLine: 3, srcCol: 1 }] }),
  ];

  it('has a sample for every kind', () => {
    expect(new Set(samples.map((s) => s.kind))).toEqual(new Set(EVENT_KINDS));
  });

  it('parses every sample after an NDJSON round trip', () => {
    const back = fromNdjson(toNdjson(samples)).map(parseEvent);
    expect(back).toEqual(samples);
  });

  it('rejects a wrong data shape for a kind', () => {
    const bad = { ...samples[4], data: { method: 'GET' } };
    expect(safeParseEvent(bad).ok).toBe(false);
  });

  it('rejects an unknown kind and a wrong version', () => {
    expect(safeParseEvent({ ...samples[0], kind: 'nope' }).ok).toBe(false);
    expect(safeParseEvent({ ...samples[0], v: 2 }).ok).toBe(false);
  });
});

describe('compareEvents', () => {
  it('orders by t, then ctx, then seq', () => {
    const e = (ctx: string, seq: number, t: number) =>
      ({ v: 1, id: `${ctx}:${seq}`, ctx, seq, t, kind: 'marker', data: { type: 'mark' } }) as CaptureEvent;
    const sorted = [e('top', 1, 5), e('sw', 0, 5), e('top', 0, 5), e('top', 2, 1)].sort(compareEvents);
    expect(sorted.map((x) => x.id)).toEqual(['top:2', 'sw:0', 'top:0', 'top:1']);
  });
});
