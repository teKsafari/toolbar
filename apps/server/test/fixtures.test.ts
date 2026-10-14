// Seed fixtures stay valid against the shared event schema, and the seal helper round-trips.
import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { safeParseEvent } from '@toolbar/shared';
import { commentedEvents, screenshotEvents, sortEvents, tabVideoEvents } from '../fixtures/events.ts';
import { seal, unseal } from '../src/lib/server/crypto.ts';

const sets = { tabVideo: tabVideoEvents(), screenshot: screenshotEvents(), commented: commentedEvents() };

describe('seed fixtures', () => {
  for (const [name, events] of Object.entries(sets)) {
    it(`${name}: every event parses and seq is monotonic per context`, () => {
      for (const e of events) expect(safeParseEvent(JSON.parse(JSON.stringify(e))), e.id).toMatchObject({ ok: true });
      const last: Record<string, number> = {};
      for (const e of events) {
        expect(e.seq).toBe((last[e.ctx] ?? -1) + 1);
        last[e.ctx] = e.seq;
      }
      const sorted = sortEvents(events);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.t).toBeGreaterThanOrEqual(sorted[i - 1]!.t);
    });
  }

  it('the tab video holds a 500, a pending request, an uncaught error and masked input', () => {
    const ev = sets.tabVideo;
    const res = ev.filter((e) => e.kind === 'net.res');
    expect(res.some((e) => e.kind === 'net.res' && e.data.status === 500)).toBe(true);
    const answered = new Set(res.map((e) => (e.kind === 'net.res' ? e.data.rid : '')));
    const pending = ev.filter((e) => e.kind === 'net.req' && !answered.has(e.data.rid));
    expect(pending).toHaveLength(1);
    expect(ev.some((e) => e.kind === 'error')).toBe(true);
    expect(ev.some((e) => e.kind === 'user' && e.data.masked)).toBe(true);
    expect(ev[0]!.kind).toBe('env');
  });

  it('ships the fixture media', () => {
    for (const f of ['tab-video.webm', 'tab-video.thumb.webp', 'screenshot.png', 'screenshot-full.png', 'screenshot.thumb.webp']) {
      const p = new URL(`../fixtures/${f}`, import.meta.url);
      expect(existsSync(p), f).toBe(true);
      expect(statSync(p).size, f).toBeLessThan(300_000);
    }
  });
});

describe('seal', () => {
  it('round-trips and binds the purpose', () => {
    const box = seal('tok_123', 'share-token', 'secret-a');
    expect(unseal(box, 'share-token', 'secret-a')).toBe('tok_123');
    expect(() => unseal(box, 'webhook-secret', 'secret-a')).toThrow();
    expect(() => unseal(box, 'share-token', 'secret-b')).toThrow();
  });
});
