// The viewer area's routes exist where the route table says, with the methods it names
// (docs/parallel.md rule 5), and the VTT parser the captions use reads the seed transcript.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROUTE_LIST } from '@toolbar/shared/api';
import { parseVtt } from '../src/lib/server/viewer/detail.ts';

const routesDir = new URL('../src/routes/', import.meta.url).pathname;

/** /api/v1/recordings/:id/comments -> api/v1/recordings/[id]/comments/+server.ts */
const fileFor = (path: string) => `${routesDir}${path.replace(/^\//, '').replace(/:([A-Za-z_]+)/g, '[$1]')}/+server.ts`;

describe('viewer routes', () => {
  const mine = ROUTE_LIST.filter((r) => r.area === 'viewer' && r.response !== 'html');
  it('covers every viewer API route', () => {
    expect(mine.map((r) => r.name).sort()).toEqual(
      ['captures.get', 'captures.update', 'captures.view', 'comments.addReaction', 'comments.create', 'comments.delete', 'comments.list', 'comments.removeReaction', 'comments.resolve', 'comments.stream', 'comments.update'].sort(),
    );
  });
  for (const r of mine) {
    it(`${r.method} ${r.path} has a handler`, () => {
      const f = fileFor(r.path);
      expect(existsSync(f), f).toBe(true);
      expect(readFileSync(f, 'utf8')).toMatch(new RegExp(`export const ${r.method}\\b`));
    });
  }
  it('has the share page', () => {
    expect(existsSync(`${routesDir}s/[token]/+page.svelte`)).toBe(true);
    expect(existsSync(`${routesDir}(app)/c/[id]/+page.svelte`)).toBe(true);
  });
});

describe('parseVtt', () => {
  it('reads cues with and without hours', () => {
    const cues = parseVtt('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nI fill in the name and press send.\n\n00:03.200 --> 00:05.500 align:start\nNothing happens.\n');
    expect(cues).toEqual([
      { startMs: 1000, endMs: 3000, text: 'I fill in the name and press send.' },
      { startMs: 3200, endMs: 5500, text: 'Nothing happens.' },
    ]);
  });
});
