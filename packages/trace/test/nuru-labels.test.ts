// Experiment 2 (docs/experiments/span-labels.md): 30 real actions on Nuru, labelled by hand,
// against the spans the engine derives from the stored events of that trace (slimmed fixture).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { CaptureEvent } from '@toolbar/shared';
import { deriveTrace, type Span } from '../src/index.ts';

interface Action {
  n: number;
  do: 'click' | 'editor' | 'type' | 'key';
  t: number;
  hand: string;
  strict: string;
  note: string;
}
const fixture = JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/nuru-span-labels.json.gz', import.meta.url))).toString('utf8')) as {
  startedAt: number;
  endedAt: number;
  actions: Action[];
  events: CaptureEvent[];
};

/** The span of each action: the typed text's committed input, else the action nearest in time. */
function matched(spans: Span[], actions: Action[]) {
  const page = spans.filter((s) => s.outcome !== 'note');
  return actions.map((a, i) => {
    const next = actions[i + 1];
    if (a.do === 'editor' || a.do === 'type') return page.find((s) => s.action.type === 'input' && s.t0 >= a.t && s.t0 <= (next ? next.t + 1500 : Infinity)) ?? null;
    const types = a.do === 'key' ? ['key', 'nav'] : ['click', 'dblclick', 'contextmenu', 'nav'];
    return page.filter((s) => types.includes(s.action.type) && s.t0 >= a.t - 150 && s.t0 <= a.t + 1500).sort((x, y) => Math.abs(x.t0 - a.t) - Math.abs(y.t0 - a.t))[0] ?? null;
  });
}

function agreement(events: CaptureEvent[]) {
  const { spans } = deriveTrace(events, { startedAt: fixture.startedAt, endedAt: fixture.endedAt });
  const got = matched(spans, fixture.actions).map((s) => s?.outcome ?? 'none');
  const byN = Object.fromEntries(fixture.actions.map((a, i) => [a.n, got[i]!]));
  return { byN, hand: fixture.actions.filter((a, i) => a.hand === got[i]).length, strict: fixture.actions.filter((a, i) => a.strict === got[i]).length };
}

describe('Nuru hand labels (D-188)', () => {
  it('has 30 labelled actions', () => {
    expect(fixture.actions).toHaveLength(30);
  });

  it('26 of 30 outcomes agree with the hand labels, 28 of 30 under the PLAN definitions', () => {
    const r = agreement(fixture.events);
    expect(r.hand).toBe(26);
    expect(r.strict).toBe(28);
    // Enter in the answer field and the submit click it fires are one action (was dead)
    expect(r.byN[29]).toBe('changed');
    // dead clicks and the offline navigation
    expect([r.byN[4], r.byN[11], r.byN[20]]).toEqual(['dead', 'dead', 'dead']);
    expect(r.byN[22]).toBe('error');
    // known limits: errors Nuru prints in its terminal are page changes, and an identical re-render is a change
    expect([r.byN[6], r.byN[17], r.byN[10]]).toEqual(['changed', 'changed', 'changed']);
  });

  it('with the link a new capture records on the click target, the click on a prefetching link reads stuck', () => {
    const a21 = fixture.actions.find((a) => a.n === 21)!;
    expect(agreement(fixture.events).byN[21]).toBe('dead');
    const events = fixture.events.map((e) =>
      e.kind === 'user' && e.data.type === 'click' && Math.abs(e.t - a21.t) < 300 ? ({ ...e, data: { ...e.data, target: { ...e.data.target!, link: 'https://116.nuru.sh/sw/anza/misingi-ya-nuru/maoni' } } } as CaptureEvent) : e,
    );
    expect(agreement(events).byN[21]).toBe('stuck');
  });

  it('the windows do not move the agreement: 500 ms to 4 s quiet, 1.5 to 4 s without effect', () => {
    for (const quietMs of [500, 1000, 2000, 4000])
      for (const noEffectMs of [1500, 2500, 4000]) {
        const { spans } = deriveTrace(fixture.events, { startedAt: fixture.startedAt, endedAt: fixture.endedAt, config: { quietMs, noEffectMs } });
        const got = matched(spans, fixture.actions).map((s) => s?.outcome ?? 'none');
        expect(fixture.actions.filter((a, i) => a.hand === got[i]).length).toBe(26);
      }
  });
});
