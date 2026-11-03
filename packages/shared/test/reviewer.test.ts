// The 60 s context a reviewer comment carries (Part 2 "Comment without a trace").
import { describe, expect, it } from 'vitest';
import { autoFeedbackTitle, CONTEXT_WINDOW_MS, contextEventIds, contextFromEvents, feedbackItemInputSchema } from '../src/areas/reviewer.ts';

const now = 1_000_000;
let seq = 0;
const ev = (t: number, kind: string, data: unknown, ctx = 'top') => ({ id: `${ctx}:${seq++}`, t: now - t, kind, data });

describe('contextFromEvents', () => {
  const events = [
    ev(90_000, 'console', { level: 'error', args: ['too old'] }),
    ev(30_000, 'console', { level: 'log', args: ['fine'] }),
    ev(29_000, 'console', { level: 'error', args: ['Save failed:', { $t: 'error', name: 'TypeError', message: 'x is undefined' }] }),
    ev(28_000, 'error', { type: 'unhandledrejection', message: 'boom' }),
    ev(27_000, 'error', { type: 'csp', message: 'blocked' }),
    ev(20_000, 'net.req', { rid: 'a', method: 'POST', url: 'http://lab/api/fail', source: 'page' }),
    ev(19_900, 'net.res', { rid: 'a', status: 500 }),
    // webRequest saw the same request
    ev(20_000, 'net.req', { rid: 'w1', method: 'POST', url: 'http://lab/api/fail', source: 'webRequest' }, 'sw'),
    ev(19_800, 'net.res', { rid: 'w1', status: 500 }, 'sw'),
    ev(15_000, 'net.req', { rid: 'b', method: 'GET', url: 'http://lab/ok', source: 'page' }),
    ev(14_900, 'net.res', { rid: 'b', status: 200 }),
    ev(10_000, 'net.req', { rid: 'c', method: 'GET', url: 'http://api/x', source: 'page' }),
    ev(9_000, 'net.fail', { rid: 'c', error: 'net::ERR_CONNECTION_REFUSED' }),
    ev(8_000, 'net.req', { rid: 'd', method: 'GET', url: 'http://lab/old.js', source: 'webRequest' }, 'sw'),
    ev(7_900, 'net.fail', { rid: 'd', error: 'abort' }, 'sw'),
  ];

  it('keeps errors and failed requests of the last minute, once each', () => {
    const c = contextFromEvents(events, now);
    expect(c.windowMs).toBe(CONTEXT_WINDOW_MS);
    expect(c.errors.map((e) => e.text)).toEqual(['Save failed: TypeError: x is undefined', 'Unhandled rejection: boom']);
    expect(c.failedRequests.map((r) => [r.text, r.status, r.error])).toEqual([
      ['POST http://lab/api/fail', 500, undefined],
      ['GET http://api/x', 0, 'net::ERR_CONNECTION_REFUSED'],
    ]);
  });

  it('names the events a capture needs: the entries and the requests they answer', () => {
    const c = contextFromEvents(events, now);
    const ids = contextEventIds(events, c);
    const kinds = events.filter((e) => ids.has(e.id)).map((e) => e.kind);
    expect(kinds).toEqual(['console', 'error', 'net.req', 'net.res', 'net.req', 'net.fail']);
  });

  it('an empty window', () => {
    expect(contextFromEvents([], now)).toEqual({ windowMs: 60_000, errors: [], failedRequests: [] });
  });
});

describe('feedbackItemInputSchema', () => {
  it('fills the defaults and refuses unknown kinds', () => {
    const base = { clientId: crypto.randomUUID(), n: 1, kind: 'draw', page: { url: 'http://x/', viewport: { w: 1, h: 1 }, scroll: { x: 0, y: 0 }, dpr: 1 }, t: 1, shapes: [{ type: 'arrow', points: [[0, 0], [10, 10]], color: '#e5484d' }] };
    const p = feedbackItemInputSchema.parse(base);
    expect(p).toMatchObject({ comment: '', intent: 'fix', severity: 'important', shapes: [{ width: 3 }] });
    expect(feedbackItemInputSchema.safeParse({ ...base, kind: 'poem' }).success).toBe(false);
  });
});

describe('autoFeedbackTitle (D-206: the title row placeholder and the title of a skipped row)', () => {
  const page = { url: 'http://localhost:5173/checkout?step=2' };
  it('takes the first line of the first comment, at most 80 characters', () => {
    expect(autoFeedbackTitle([{ comment: '', page }, { comment: '  Save gives no feedback \nmore', page }])).toBe('Save gives no feedback');
    const long = autoFeedbackTitle([{ comment: 'x'.repeat(120), page }]);
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });
  it('falls back to the page path, then to "Feedback"', () => {
    expect(autoFeedbackTitle([{ comment: ' ', page }])).toBe('Feedback on /checkout');
    expect(autoFeedbackTitle([{ comment: '', page: { url: 'not a url' } }])).toBe('Feedback');
  });
  it('with traces (D-214): the first trace note comes first, then the comments, then "N traces on" the page', () => {
    const takes = [{ note: '' }, { note: 'Nav bar hides on scroll up\nand stays hidden' }];
    expect(autoFeedbackTitle([{ comment: 'Save gives no feedback', page }], takes)).toBe('Nav bar hides on scroll up');
    expect(autoFeedbackTitle([{ comment: 'Save gives no feedback', page }], [{ note: '' }])).toBe('Save gives no feedback');
    expect(autoFeedbackTitle([], [{ note: '' }, { note: ' ' }], 'http://localhost:5173/lessons/3')).toBe('2 traces on /lessons/3');
    expect(autoFeedbackTitle([], [{ note: '' }], 'http://localhost:5173/')).toBe('Trace on /');
  });
});
