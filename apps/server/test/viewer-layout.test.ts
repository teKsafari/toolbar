// The capture page adapts to what a capture holds (D-206): hidden empty tabs, the lean layout of a
// comment-only feedback, the info strip's facts, and a note's context window.
import { describe, expect, it } from 'vitest';
import { buildTimeMap, computeEventIndex, deriveActions, deriveConsole, deriveNetwork } from '@toolbar/shared/derive';
import type { CaptureEvent } from '@toolbar/shared';
import type { CaptureDetail } from '@toolbar/shared/api';
import { contextFromEvents } from '@toolbar/shared/areas/reviewer';
import { activeTab, countsFromIndex, inWindow, isLean, noteWindow, stripFacts, tabVisible, type TabCounts } from '../src/lib/components/viewer/layout.ts';
import { fixtureEnv, FIXTURE_T0, LAB, tabVideoEvents } from '../fixtures/events.ts';

const media = (over: Partial<CaptureDetail['media']> = {}) => ({ video: null, screenshot: null, fullScreenshot: null, thumbUrl: null, rrwebUrls: [], eventsUrl: null, ...over }) as unknown as CaptureDetail['media'];
const detailOf = (events: CaptureEvent[], kind: CaptureDetail['kind'], m = media()) => {
  const map = buildTimeMap(events, FIXTURE_T0, false);
  return { kind, media: m, index: computeEventIndex(events, map) } as Pick<CaptureDetail, 'kind' | 'media' | 'index'>;
};
const rowsCounts = (events: CaptureEvent[]): TabCounts => {
  const map = buildTimeMap(events, FIXTURE_T0, false);
  const net = deriveNetwork(events, map);
  return { console: deriveConsole(events, map, net).length, network: net.length, actions: deriveActions(events, map).length };
};

let seq = 0;
const ev = (kind: CaptureEvent['kind'], t: number, data: unknown): CaptureEvent => ({ v: 1, id: `e${++seq}`, kind, t, ctx: 'top', seq, data }) as unknown as CaptureEvent;

/** What a reviewer submit uploads for a note with one error and one failed request attached. */
function feedbackEvents(t0: number) {
  return [
    ev('error', t0 + 1000, { type: 'error', name: 'TypeError', message: 'x is undefined' }),
    ev('net.req', t0 + 2000, { rid: 'r1', method: 'POST', url: `${LAB}/api/fail`, initiator: 'fetch', source: 'page' }),
    ev('net.res', t0 + 2100, { rid: 'r1', status: 500, statusText: 'Internal Server Error', headers: {}, source: 'page', timing: { start: t0 + 2000, end: t0 + 2100 } }),
    ev('console', t0 + 3000, { level: 'log', args: ['fine'] }),
  ];
}

describe('tabs with entries (D-206)', () => {
  it('a comment-only feedback has no data tab and is lean', () => {
    const d = detailOf([], 'feedback');
    const counts = countsFromIndex(d);
    expect(counts).toEqual({ console: 0, network: 0, actions: 0 });
    expect(['info', 'console', 'network', 'actions', 'agent'].filter((t) => tabVisible(t, counts))).toEqual(['info', 'agent']);
    expect(activeTab('console', counts)).toBe('info');
    expect(isLean(d, counts)).toBe(true);
  });

  it('a tab video keeps every tab, and the index agrees with the rows', () => {
    const events = tabVideoEvents();
    const d = detailOf(events, 'video', media({ video: { url: 'v' } as never }));
    const fromIndex = countsFromIndex(d);
    const fromRows = rowsCounts(events);
    for (const t of ['console', 'network', 'actions'] as const) expect(fromIndex[t] > 0, t).toBe(fromRows[t] > 0);
    expect(['info', 'console', 'network', 'actions', 'agent'].every((t) => tabVisible(t, fromRows))).toBe(true);
    expect(activeTab('network', fromRows)).toBe('network');
    expect(isLean(d, fromRows)).toBe(false);
  });

  it('a feedback with attached entries shows console and network, hides actions, and is not lean', () => {
    const events = feedbackEvents(FIXTURE_T0);
    const d = detailOf(events, 'feedback');
    const counts = rowsCounts(events);
    expect(counts.network).toBe(1);
    expect(counts.console).toBeGreaterThan(0);
    expect(counts.actions).toBe(0);
    expect(tabVisible('actions', counts)).toBe(false);
    expect(activeTab('actions', counts)).toBe('console');
    expect(isLean(d, countsFromIndex(d))).toBe(false);
  });

  it('a video, replay or trace is never lean, even without logs', () => {
    const none = { console: 0, network: 0, actions: 0 };
    expect(isLean(detailOf([], 'video', media({ video: { url: 'v' } as never })), none)).toBe(false);
    expect(isLean(detailOf([], 'replay', media({ rrwebUrls: ['r'] })), none)).toBe(false);
    expect(isLean(detailOf([], 'trace'), none)).toBe(false);
    expect(isLean(detailOf([], 'screenshot'), none)).toBe(true);
  });
});

describe('info strip (D-206)', () => {
  it('names URL, browser, OS and viewport, and links http pages', () => {
    const env = fixtureEnv(`${LAB}/checkout`, 'Checkout');
    const facts = stripFacts({ pageUrl: `${LAB}/checkout`, env } as Pick<CaptureDetail, 'pageUrl' | 'env'>);
    expect(facts.map((f) => f.label)).toEqual(['URL', 'Browser', 'OS', 'Viewport']);
    expect(facts[0]).toMatchObject({ value: `${LAB}/checkout`, href: `${LAB}/checkout` });
    expect(facts[3]!.value).toMatch(/^\d+ x \d+$/);
    expect(stripFacts({ pageUrl: null, env: null } as Pick<CaptureDetail, 'pageUrl' | 'env'>)).toEqual([]);
  });
});

describe('a note context window (D-206)', () => {
  it('spans the 60 s before the note and selects the entries it attached', () => {
    const t0 = FIXTURE_T0;
    const events = [ev('error', t0 - 120_000, { type: 'error', name: 'Error', message: 'long ago' }), ...feedbackEvents(t0)];
    const noteT = t0 + 5000;
    const context = contextFromEvents(events, noteT);
    expect(context.errors).toHaveLength(1);
    expect(context.failedRequests).toHaveLength(1);
    const w = noteWindow({ n: 2, t: noteT, context }, events, 'requests');
    expect(w).toMatchObject({ n: 2, from: noteT - 60_000, to: noteT + 1000, show: 'requests' });
    expect([...w.rids]).toEqual(['r1']);
    expect(w.ids.has(events[1]!.id)).toBe(true); // the error
    expect(w.ids.has(events[3]!.id)).toBe(true); // the 500 response
    expect(w.ids.has(events[4]!.id)).toBe(false); // the plain log is in the window, not attached
    expect(inWindow(w, events[0]!.t)).toBe(false);
    expect(inWindow(w, events[4]!.t)).toBe(true);
    expect(inWindow(null, 0)).toBe(true);
  });

  it('matches entries without a ref by kind and time', () => {
    const events = feedbackEvents(FIXTURE_T0);
    const context = contextFromEvents(events, FIXTURE_T0 + 5000);
    for (const e of [...context.errors, ...context.failedRequests]) delete e.ref;
    const w = noteWindow({ n: 1, t: FIXTURE_T0 + 5000, context }, events, 'errors');
    expect([...w.rids]).toEqual(['r1']);
    expect(w.ids.size).toBe(2);
  });

  it('a note without context selects nothing', () => {
    const w = noteWindow({ n: 1, t: FIXTURE_T0 }, [], 'errors');
    expect(w.ids.size + w.rids.size).toBe(0);
  });
});
