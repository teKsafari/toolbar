import { describe, expect, it } from 'vitest';
import { deriveTrace, LiveTrace, spansJsonl, timelineLines, type Span } from '../src/index.ts';
import { EXPORT, PROFILE, REDRAW, SAVE, Stream, SUBMIT, SYNC, button } from './fixtures.ts';

const only = (s: Stream, opts = {}) => {
  const { spans } = deriveTrace(s.events, opts);
  expect(spans).toHaveLength(1);
  return spans[0]!;
};

describe('outcomes of the lab buttons', () => {
  it('Save: request, then the status text changes -> changed, closed after 500 ms of quiet', () => {
    const s = new Stream()
      .click(1000, SAVE)
      .request(1004, 'GET', 'http://lab/api/ok?q=works', 1030)
      .dom(1100, { text: 3, texts: ['loading'] })
      .dom(1140, { text: 2, texts: ['saved at 12:00', 'saved 1 times'] });
    const span = only(s);
    expect(span.outcome).toBe('changed');
    expect(span.closeReason).toBe('quiet');
    expect(span.t1).toBe(1640);
    expect(span.action).toMatchObject({ type: 'click', label: 'Click "Save (works)"', interactive: true });
    expect(span.requests).toEqual([expect.objectContaining({ method: 'GET', status: 200, state: 'done', ms: 26 })]);
    expect(span.texts).toContain('loading');
  });

  it('Export: nothing follows -> dead at 2.5 s', () => {
    const span = only(new Stream().click(1000, EXPORT));
    expect(span.outcome).toBe('dead');
    expect(span.closeReason).toBe('no_effect');
    expect(span.durationMs).toBe(2500);
    expect(span.summary).toBe('Click "Export (does nothing)" -> dead: nothing happened');
  });

  it('Sync: the request never returns -> stuck at 10 s', () => {
    const span = only(new Stream().click(1000, SYNC).request(1003, 'GET', 'http://lab/api/hang', null).dom(1100, { texts: ['loading'] }));
    expect(span.outcome).toBe('stuck');
    expect(span.closeReason).toBe('max_open');
    expect(span.durationMs).toBe(10_000);
    expect(span.effects.pendingRequests).toBe(1);
  });

  it('the 10 s limit is a setting (code runs take longer)', () => {
    const s = new Stream().click(1000, SYNC).request(1003, 'POST', 'http://lab/run', 15_000).dom(15_050, { texts: ['exit 0'] });
    expect(only(s).outcome).toBe('stuck');
    const long = only(s, { config: { maxOpenMs: 30_000 } });
    expect(long.outcome).toBe('changed');
    expect(long.t1).toBe(15_550);
  });

  it('Submit order: 500 and the page says "saved" -> silent 5xx', () => {
    const s = new Stream()
      .click(1000, SUBMIT)
      .request(1002, 'POST', 'http://lab/api/fail', 1012, 500)
      .dom(1100, { text: 2, texts: ['saved'] });
    const span = only(s);
    expect(span.outcome).toBe('silent');
    expect(span.silent).toBe('5xx');
    expect(span.caveat).toMatch(/showed no error/);
    expect(span.summary).toContain('POST /api/fail 500');
  });

  it('a failure the page shows in words is changed, not silent', () => {
    const s = new Stream()
      .click(1000, SUBMIT)
      .request(1002, 'POST', 'http://lab/api/fail', 1012, 500)
      .dom(1100, { added: 1, texts: ['Could not place the order. Try again.'] });
    expect(only(s).outcome).toBe('changed');
  });

  it('a 403 with no page change at all is silent 4xx', () => {
    const s = new Stream().click(1000, SUBMIT).request(1002, 'POST', 'http://lab/form?/save', 1020, 403);
    const span = only(s);
    expect(span).toMatchObject({ outcome: 'silent', silent: '4xx' });
  });

  it('captures without changed text fall back to "any DOM change after the failure"', () => {
    const shown = new Stream().click(1000, SUBMIT).request(1002, 'POST', 'http://lab/api/fail', 1012, 500).dom(1100, { added: 1 });
    expect(only(shown).outcome).toBe('changed');
    const before = new Stream().click(1000, SUBMIT).dom(1005, { text: 1 }).request(1002, 'POST', 'http://lab/api/fail', 1200, 500);
    expect(only(before)).toMatchObject({ outcome: 'silent', silent: '5xx' });
  });

  it('a network failure is silent network', () => {
    const s = new Stream().click(1000, SUBMIT).add(1002, 'net.req', { rid: 'x', method: 'GET', url: 'http://down/', source: 'page' }).add(1050, 'net.fail', { rid: 'x', error: 'net::ERR_CONNECTION_REFUSED' });
    expect(only(s)).toMatchObject({ outcome: 'silent', silent: 'network' });
  });

  it('a request that worked and changed nothing is silent 2xx', () => {
    const s = new Stream().click(1000, SAVE).request(1004, 'POST', 'http://lab/api/track', 1030);
    expect(only(s)).toMatchObject({ outcome: 'silent', silent: '2xx', closeReason: 'quiet' });
  });

  it('Show profile: uncaught TypeError -> error', () => {
    const s = new Stream()
      .click(1000, PROFILE)
      .add(1001, 'console', { level: 'log', args: ['about to read profile name'] })
      .add(1002, 'error', { type: 'error', message: "Cannot read properties of undefined (reading 'profile')", name: 'TypeError' });
    const span = only(s);
    expect(span.outcome).toBe('error');
    expect(span.errors[0]!.message).toMatch(/profile/);
    expect(span.console[0]).toMatchObject({ level: 'log', text: 'about to read profile name' });
    expect(span.summary).toContain('uncaught: Cannot read properties');
  });

  it('a console.error or an unhandled rejection is an error too', () => {
    expect(only(new Stream().click(1000).add(1010, 'console', { level: 'error', args: ['boom'] })).outcome).toBe('error');
    expect(only(new Stream().click(1000).add(1010, 'error', { type: 'unhandledrejection', message: 'nope' })).outcome).toBe('error');
  });
});

describe('canvas regions', () => {
  const rect = { x: 0, y: 100, w: 520, h: 110 };
  const before = (s: Stream, at: number, hash: string | null, blank?: boolean) => s.add(at, 'canvas.sample', { phase: 'before', key: 'canvas', rect, hash, at, ...(blank ? { blank } : {}) });
  const after = (s: Stream, t: number, at: number, hash: string | null, diff = 0, blank?: boolean) => s.add(t, 'canvas.sample', { phase: 'after', key: 'canvas', rect, hash, at, diff, ...(blank ? { blank } : {}) });

  it('a canvas redraw with no DOM change is changed, not dead', () => {
    const s = new Stream();
    before(s, 950, 'aaaa');
    s.click(1000, REDRAW);
    after(s, 1100, 950, 'bbbb', 0.004);
    after(s, 1550, 950, 'bbbb', 0.004);
    const span = only(s);
    expect(span.outcome).toBe('changed');
    expect(span.effects.canvas).toBe('changed');
    expect(span.effects.dom).toEqual({ added: 0, removed: 0, attrs: 0, text: 0 });
    expect(span.summary).toContain('canvas redrawn');
  });

  it('the same pixels after the click leave it dead', () => {
    const s = new Stream();
    before(s, 950, 'aaaa');
    s.click(1000, REDRAW);
    after(s, 1100, 950, 'aaaa');
    after(s, 3300, 950, 'aaaa');
    const span = only(s);
    expect(span.outcome).toBe('dead');
    expect(span.effects.canvas).toBe('unchanged');
  });

  it('a canvas that cannot be read leaves a caveat on dead', () => {
    const s = new Stream();
    before(s, 950, null);
    s.click(1000, REDRAW);
    after(s, 1100, 950, null);
    const span = only(s);
    expect(span.outcome).toBe('dead');
    expect(span.effects.canvas).toBe('unreadable');
    expect(span.caveat).toMatch(/canvas/);
  });

  it('a canvas change turns silent 2xx into changed', () => {
    const s = new Stream();
    before(s, 990, 'aaaa');
    s.click(1000, REDRAW).request(1002, 'POST', 'http://lab/run', 1100);
    after(s, 1200, 990, 'cccc', 0.1);
    expect(only(s).outcome).toBe('changed');
  });
});

describe('actions', () => {
  it('Enter on a button fires a click too: one span', () => {
    const s = new Stream().add(1000, 'user', { type: 'key', key: 'Enter', target: SAVE }).click(1010, SAVE).request(1012, 'GET', 'http://lab/api/ok', 1030).dom(1100);
    const span = only(s);
    expect(span.action).toMatchObject({ type: 'key', key: 'Enter', label: 'Press Enter in "Save (works)"' });
    expect(span.outcome).toBe('changed');
  });

  it('Ctrl+Enter is an action, typing and Ctrl+C are not', () => {
    const s = new Stream()
      .add(1000, 'user', { type: 'key', key: 'Backspace' })
      .add(1100, 'user', { type: 'key', key: 'C', mods: ['ctrl'] })
      .add(1200, 'user', { type: 'key', key: 'Enter', mods: ['ctrl'], target: button({ tag: 'textarea', role: 'textbox', name: 'Code' }) })
      .request(1210, 'POST', 'http://app/run', 1800)
      .dom(1850, { texts: ['Hello'] });
    const span = only(s);
    expect(span.action.key).toBe('Ctrl+Enter');
    expect(span.outcome).toBe('changed');
  });

  it('a committed input is an action whose value is a change', () => {
    const s = new Stream().add(1000, 'user', { type: 'input', value: 'ada@example.test', target: button({ tag: 'input', role: 'textbox', name: 'Email' }) });
    const span = only(s);
    expect(span).toMatchObject({ outcome: 'changed', action: { type: 'input', label: 'Type in "Email"', value: 'ada@example.test' } });
  });

  it('a checkbox click and its committed value are one span', () => {
    const box = button({ selector: '#agree', tag: 'input', role: 'checkbox', name: 'Agree' });
    const s = new Stream().click(1000, box).add(1004, 'user', { type: 'input', value: 'checked', target: box });
    const span = only(s);
    expect(span.action.type).toBe('click');
    expect(span.effects.value).toBe(true);
    expect(span.outcome).toBe('changed');
  });

  it('a click into a text field moves focus: changed, not dead', () => {
    const span = only(new Stream().click(1000, button({ tag: 'input', role: 'textbox', name: 'Search' })));
    expect(span.outcome).toBe('changed');
    expect(span.effects.focus).toBe(true);
  });

  it('a dead click on a non-interactive element says so', () => {
    const span = only(new Stream().click(1000, { tag: 'p', role: undefined, name: undefined, text: 'Some text', selector: 'main > p' }));
    expect(span).toMatchObject({ outcome: 'dead', action: { interactive: false, label: 'Click "Some text"' } });
  });

  it('a route change the click caused is an effect; a back navigation is its own span', () => {
    const s = new Stream()
      .add(500, 'env', { ua: 'x', viewport: { w: 1280, h: 800 }, dpr: 1, url: 'http://lab/' })
      .click(1000, button({ tag: 'a', role: 'link', name: 'Form', selector: 'nav a:nth-child(2)' }))
      .request(1005, 'GET', 'http://lab/form/__data.json?x-sveltekit-invalidated=01', 1050)
      .add(1060, 'nav', { type: 'pushState', url: 'http://lab/form', from: 'http://lab/' })
      .dom(1100, { added: 30, removed: 25 })
      .add(5000, 'nav', { type: 'popstate', url: 'http://lab/', from: 'http://lab/form' })
      .dom(5050, { added: 25, removed: 30 });
    const { spans } = deriveTrace(s.events);
    expect(spans.map((x) => [x.action.type, x.outcome])).toEqual([
      ['click', 'changed'],
      ['nav', 'changed'],
    ]);
    expect(spans[0]!.url).toBe('http://lab/');
    expect(spans[0]!.effects.nav).toEqual(['http://lab/form']);
    expect(spans[0]!.requests[0]!.name).toMatchObject({ framework: 'sveltekit', type: 'load', route: '/form' });
    expect(spans[0]!.summary).toContain('SvelteKit load /form (invalidated) 200');
    expect(spans[1]!.action.label).toBe('Back or forward to /');
    expect(spans[1]!.url).toBe('http://lab/');
  });

  it('a SvelteKit form action is named in the timeline', () => {
    const s = new Stream()
      .add(1000, 'user', { type: 'key', key: 'Enter', target: button({ tag: 'input', role: 'textbox', name: 'Name' }) })
      .request(1003, 'POST', 'http://lab/form?/save', 1040, 403, { headers: { 'x-sveltekit-action': 'true' } })
      .dom(1080, { added: 1, texts: ['Forbidden: you cannot save'] });
    const span = only(s);
    expect(span.requests[0]!.name).toMatchObject({ framework: 'sveltekit', type: 'action', name: 'save' });
    expect(span.summary).toContain('SvelteKit form action ?/save on /form 403');
    expect(span.outcome).toBe('changed');
  });

  it('annotations, voice segments and marks are notes, and take no page effects', () => {
    const s = new Stream()
      .click(1000, EXPORT)
      .add(1200, 'annotation', { annotationId: 'a1', op: 'create' })
      .add(1300, 'marker', { type: 'voice.start' })
      .add(4000, 'marker', { type: 'voice.end' })
      .add(4100, 'marker', { type: 'mark', label: 'here' });
    const { spans, summary } = deriveTrace(s.events);
    expect(spans.map((x) => [x.action.type, x.outcome, x.durationMs])).toEqual([
      ['click', 'dead', 2500],
      ['annotation', 'note', 0],
      ['voice', 'note', 2700],
      ['mark', 'note', 0],
    ]);
    expect(summary.outcomes).toMatchObject({ dead: 1, note: 3 });
    expect(summary.attention).toEqual(['s001']);
  });
});

describe('overlap and attribution', () => {
  it('a response lands on the span that sent the request; the overlapping click gets caused_by', () => {
    const s = new Stream()
      .click(1000, SAVE)
      .request(1004, 'GET', 'http://lab/api/ok?q=works', 1600)
      .click(1200, EXPORT)
      .dom(1650, { texts: ['saved at 12:00'] });
    const { spans } = deriveTrace(s.events);
    const [save, exp] = spans as [Span, Span];
    expect(save.outcome).toBe('changed');
    expect(exp.outcome).toBe('dead');
    expect(exp.causedBy).toEqual([{ span: 's001', confidence: 0.5, reason: 'requests_in_flight' }]);
  });

  it('a click again on the same element while the first is open is a repeat', () => {
    const s = new Stream().click(1000, SYNC).request(1002, 'GET', 'http://lab/api/hang', null).click(2000, SYNC).request(2002, 'GET', 'http://lab/api/hang', null);
    const { spans } = deriveTrace(s.events);
    expect(spans.map((x) => x.outcome)).toEqual(['stuck', 'stuck']);
    expect(spans[1]!.causedBy).toEqual([{ span: 's001', confidence: 0.6, reason: 'repeat' }]);
  });

  it('a request seen by the page hook and by webRequest counts once', () => {
    const s = new Stream()
      .click(1000, SAVE)
      .request(1004, 'GET', 'http://lab/api/ok', 1030)
      .add(1010, 'net.req', { rid: 'w1', method: 'GET', url: 'http://lab/api/ok', source: 'webRequest', initiator: 'xhr' }, 'sw')
      .add(1031, 'net.res', { rid: 'w1', status: 200, source: 'webRequest' }, 'sw')
      .dom(1050);
    const span = only(s);
    expect(span.requests).toHaveLength(1);
    expect(span.effects.requests).toBe(1);
  });

  it('a stream that stays open (SSE) never holds a span', () => {
    const s = new Stream().click(1000, SAVE).request(1002, 'GET', 'http://lab/api/sse', null, 200, { initiator: 'eventsource' }).dom(1050);
    expect(only(s)).toMatchObject({ outcome: 'changed', closeReason: 'quiet' });
  });

  it('effects with no open span count as unattributed', () => {
    const { spans, summary } = deriveTrace(new Stream().dom(100).request(200, 'GET', 'http://lab/poll', 230).events);
    expect(spans).toHaveLength(0);
    expect(summary.unattributed).toBe(2);
  });
});

describe('keyframes', () => {
  it('route changes, annotations, changed spans and DOM bursts, at most one per gap', () => {
    const s = new Stream().add(0, 'env', { ua: 'x', viewport: { w: 1000, h: 800 }, dpr: 1, url: 'http://lab/' });
    for (let i = 0; i < 6; i++) s.click(1000 + i * 700, SAVE).dom(1050 + i * 700, { texts: [`saved ${i}`] });
    s.add(9000, 'nav', { type: 'popstate', url: 'http://lab/x' });
    s.dom(9100, { rects: [{ x: 0, y: 0, w: 1000, h: 600 }] });
    s.add(9200, 'annotation', { annotationId: 'a', op: 'create' });
    const { keyframes } = deriveTrace(s.events);
    const times = keyframes.map((k) => k.t);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(1500);
    expect(keyframes.length).toBeGreaterThanOrEqual(3);
    expect(keyframes.length).toBeLessThan(8);
    expect(keyframes[keyframes.length - 1]!.reason).toBe('annotation');
    expect(keyframes.map((k) => k.reason)).toContain('changed');
  });

  it('keyframe shots attach to the newest span', () => {
    const s = new Stream().click(1000, SAVE).dom(1050).add(1700, 'shot', { assetId: 'k1', reason: 'keyframe' }).add(1710, 'shot', { assetId: 'u1', reason: 'user' });
    const span = only(s);
    expect(span.keyframes).toEqual(['k1']);
    expect(span.shots).toEqual(['u1']);
  });
});

describe('live and batch agree', () => {
  it('the same spans from shuffled live batches', () => {
    const s = new Stream()
      .click(1000, SAVE)
      .request(1004, 'GET', 'http://lab/api/ok?q=works', 1030)
      .dom(1100, { texts: ['saved'] })
      .click(3000, EXPORT)
      .click(7000, SUBMIT)
      .request(7002, 'POST', 'http://lab/api/fail', 7012, 500)
      .dom(7100, { texts: ['saved'] })
      .click(9000, PROFILE)
      .add(9002, 'error', { type: 'error', message: 'boom' })
      .click(12_000, SYNC)
      .request(12_003, 'GET', 'http://lab/api/hang', null);
    const batch = deriveTrace(s.events).spans;
    const keyframes: number[] = [];
    const live = new LiveTrace({ onKeyframe: (k) => keyframes.push(k.t) });
    const ev = [...s.events];
    // arrive in reversed pairs, a little late
    for (let i = 0; i < ev.length; i += 2) {
      live.add(ev.slice(i, i + 2).reverse());
      live.tick(ev[i]!.t + 300);
    }
    live.tick(20_000);
    const spans = live.stop(25_000);
    expect(spans.map((x) => [x.action.label, x.outcome, x.silent ?? null])).toEqual(batch.map((x) => [x.action.label, x.outcome, x.silent ?? null]));
    expect(spans.map((x) => x.outcome)).toEqual(['changed', 'dead', 'silent', 'error', 'stuck']);
    expect(keyframes.length).toBeGreaterThan(0);
  });
});

describe('output', () => {
  it('spans.jsonl has one JSON span per line and the timeline one line per span', () => {
    const { spans } = deriveTrace(new Stream().click(1000, EXPORT).click(5000, SAVE).dom(5100).events);
    const lines = spansJsonl(spans).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ id: 's001', outcome: 'dead', startMs: 0 });
    expect(JSON.parse(lines[1]!)).toMatchObject({ id: 's002', outcome: 'changed', startMs: 4000 });
    expect(timelineLines(spans)[0]).toMatch(/^ +0\.0s {2}s001 {2}dead/);
    expect(spansJsonl([])).toBe('');
  });
});
