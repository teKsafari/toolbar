import { describe, expect, it } from 'vitest';
import { completeLocator, createRouteTables, errorOf } from '../src/locator-complete.ts';
import type { CaptureEvent } from '../src/events.ts';
import type { LocatorPacket } from '../src/locator.ts';
import { locatorPacketSchema } from '../src/schemas.ts';
import { createStackMapper } from '../src/sourcemap.ts';
import { TRACE_OPEN_MS, traceOpenMsOf } from '../src/projects.ts';

const PROD = `var i={"/":[2],"/items/[id]":[-6],"/list":[7]}`;
const ENTRY = 'https://app.test/_app/immutable/entry/app.abc.js';

function packet(over: Partial<LocatorPacket> = {}): LocatorPacket {
  return { v: 1, kind: 'element', at: 1, url: 'https://app.test/items/42', route: '/items/42', routeFiles: [], viewport: { w: 800, h: 600, scrollX: 0, scrollY: 0, dpr: 1 }, selector: 'button#save', ...over };
}

const ev = (t: number, kind: 'console' | 'error', data: unknown): CaptureEvent => ({ v: 1, id: `top:${t}`, ctx: 'top', seq: t, t, kind, data }) as CaptureEvent;

describe('completeLocator (D-164)', () => {
  it('adds route-table candidates and the errors of the window, and stays within the packet schema', async () => {
    let fetches = 0;
    const routes = createRouteTables(async (u) => (fetches++, u === ENTRY ? { text: PROD } : null));
    const mapper = createStackMapper({ fetchText: async () => null });
    const long = 'x'.repeat(9000);
    const events = [
      ev(10, 'console', { level: 'log', args: ['fine'] }),
      ev(20, 'console', { level: 'error', args: ['save failed', { $t: 'error', name: 'TypeError', message: 'boom', stack: 'TypeError: boom\n    at f (https://app.test/_app/x.js:1:2)' }] }),
      ev(30, 'error', { type: 'error', name: 'Error', message: long, stack: `Error\n${'    at g (https://app.test/_app/y.js:1:1)\n'.repeat(5)}` }),
      ev(40, 'error', { type: 'resource', message: 'img failed' }),
    ];
    const p = await completeLocator({ packet: packet(), kitEntries: [ENTRY] }, { routes, mapper, events });
    expect(p.framework).toMatchObject({ name: 'sveltekit', routeId: '/items/[id]' });
    expect(p.routeFiles[0]).toMatchObject({ file: 'src/routes/items/[id]/+page.svelte', source: 'manifest', params: { id: '42' } });
    expect(p.errors?.map((e) => e.kind)).toEqual(['console', 'error']);
    expect(p.errors?.[0]).toMatchObject({ message: 'save failed TypeError: boom', mapped: false });
    expect(p.errors?.[1]!.message.length).toBe(4000);
    expect(locatorPacketSchema.safeParse(p).success).toBe(true);
    // the route table is read once per entry module
    await completeLocator({ packet: packet(), kitEntries: [ENTRY] }, { routes, mapper });
    expect(fetches).toBe(1);
  });

  it('leaves a page without a SvelteKit entry with its own guesses', async () => {
    const routes = createRouteTables(async () => null);
    const mapper = createStackMapper({ fetchText: async () => null });
    const p = await completeLocator({ packet: packet({ routeFiles: [{ file: 'src/routes/items/[id]/+page.svelte', routeId: '/items/[id]', role: 'page', source: 'guess' }] }), kitEntries: [] }, { routes, mapper });
    expect(p.routeFiles).toHaveLength(1);
    expect(p.errors).toBeUndefined();
  });

  it('reads errors only from error events and console errors', () => {
    expect(errorOf({ kind: 'console', data: { level: 'warn', args: ['x'] } } as never)).toBeNull();
    expect(errorOf({ kind: 'error', data: { type: 'csp', message: 'blocked' } } as never)).toBeNull();
    expect(errorOf({ kind: 'error', data: { type: 'error', name: 'RangeError', message: 'bad' } } as never)).toMatchObject({ kind: 'error', message: 'RangeError: bad' });
  });

  it('a packet outside the schema is dropped by the annotation schema, not the annotation', async () => {
    const { annotationInputSchema } = await import('../src/schemas.ts');
    const r = annotationInputSchema.safeParse({ shapes: [], comment: 'hi', locator: { v: 1, kind: 'nope' } });
    expect(r.success).toBe(true);
    expect(r.data?.locator).toBeUndefined();
  });
});

describe('trace span window (D-166)', () => {
  it('defaults to 10 s and clamps to the allowed range', () => {
    expect(traceOpenMsOf(null)).toBe(10_000);
    expect(traceOpenMsOf({})).toBe(TRACE_OPEN_MS.default);
    expect(traceOpenMsOf({ traceOpenMs: 45_000 })).toBe(45_000);
    expect(traceOpenMsOf({ traceOpenMs: 100 })).toBe(TRACE_OPEN_MS.min);
    expect(traceOpenMsOf({ traceOpenMs: 10_000_000 })).toBe(TRACE_OPEN_MS.max);
  });
});
