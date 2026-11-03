import { describe, expect, it } from 'vitest';
import { deriveTrace } from '../src/index.ts';
import { SAVE, Stream } from './fixtures.ts';

describe('trace sessions (D-214)', () => {
  it('each trace gets its own engine: ids and offsets run on, spans carry their trace', () => {
    const s = new Stream()
      .click(1000, SAVE)
      .request(1004, 'GET', 'http://lab/api/ok', 1030)
      .dom(1100, { text: 1, texts: ['saved'] })
      .click(20_000, SAVE)
      .dom(20_100, { text: 1, texts: ['saved'] });
    const { spans, summary } = deriveTrace(s.events, {
      traces: [
        { n: 1, startedAt: 900, endedAt: 5000 },
        { n: 2, startedAt: 19_900, endedAt: 25_000 },
      ],
    });
    expect(spans.map((x) => [x.id, x.trace, x.startMs])).toEqual([
      ['s001', 1, 100],
      ['s002', 2, 19_100],
    ]);
    expect(summary.startedAt).toBe(900);
    expect(summary.endedAt).toBe(25_000);
    expect(summary.spans).toBe(2);
  });

  it('a request open at Stop is stuck in its own trace, not answered by the next one', () => {
    const s = new Stream()
      .click(1000, SAVE)
      .request(1004, 'POST', 'http://lab/api/slow', 30_000)
      .click(20_000, SAVE)
      .dom(20_100, { text: 1, texts: ['saved'] });
    const { spans } = deriveTrace(s.events, {
      traces: [
        { n: 1, startedAt: 900, endedAt: 3000 },
        { n: 2, startedAt: 19_900, endedAt: 25_000 },
      ],
    });
    expect(spans[0]!.trace).toBe(1);
    expect(spans[0]!.outcome).toBe('stuck');
    expect(spans[1]!.trace).toBe(2);
    expect(spans[1]!.causedBy).toEqual([]);
  });

  it('events outside every window (a removed trace) make no spans', () => {
    const s = new Stream().click(1000, SAVE).dom(1100, { text: 1 }).click(9000, SAVE).dom(9100, { text: 1 });
    const { spans } = deriveTrace(s.events, { traces: [{ n: 2, startedAt: 8900, endedAt: 12_000 }] });
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ id: 's001', trace: 2, startMs: 100 });
  });

  it('without traces a span has no trace field', () => {
    const s = new Stream().click(1000, SAVE).dom(1100, { text: 1 });
    expect(deriveTrace(s.events).spans[0]!.trace).toBeUndefined();
  });
});
