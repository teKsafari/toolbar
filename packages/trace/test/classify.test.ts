import { describe, expect, it } from 'vitest';
import { classifyRequest, requestLabel } from '../src/classify.ts';
import { dHash, dedupeKeyframes, hamming, isNearDuplicate, KeyframePlanner, nearDuplicateBits } from '../src/keyframes.ts';

describe('classifyRequest', () => {
  it('SvelteKit data loads', () => {
    expect(classifyRequest({ method: 'GET', url: 'https://nuru.test/lessons/1/__data.json?x-sveltekit-trailing-slash=1' })).toMatchObject({ framework: 'sveltekit', type: 'load', route: '/lessons/1', label: 'SvelteKit load /lessons/1' });
    expect(classifyRequest({ method: 'GET', url: 'https://nuru.test/__data.json' })).toMatchObject({ route: '/' });
    // the flags name which server loads rerun; a client navigation that keeps the layout sends 01
    expect(classifyRequest({ method: 'GET', url: '/x/__data.json?x-sveltekit-invalidated=001' })!.label).toBe('SvelteKit load /x (1 of 3 server loads)');
    expect(classifyRequest({ method: 'GET', url: '/search/__data.json?q=laptop&x-sveltekit-invalidated=01' })!.label).toBe('SvelteKit load /search (1 of 2 server loads)');
    expect(classifyRequest({ method: 'GET', url: '/x/__data.json?x-sveltekit-invalidated=11' })!.label).toBe('SvelteKit load /x');
    expect(classifyRequest({ method: 'GET', url: '/x/__data.json?x-sveltekit-invalidated=1' })!.label).toBe('SvelteKit load /x');
    expect(classifyRequest({ method: 'GET', url: '/x/__data.json?x-sveltekit-invalidated=zz' })!.label).toBe('SvelteKit load /x');
  });

  it('SvelteKit form actions and remote functions', () => {
    expect(classifyRequest({ method: 'POST', url: '/login?/signin' })).toMatchObject({ type: 'action', name: 'signin', route: '/login' });
    expect(classifyRequest({ method: 'POST', url: '/login', headers: { 'X-SvelteKit-Action': 'true' } })).toMatchObject({ type: 'action', name: 'default' });
    expect(classifyRequest({ method: 'GET', url: '/login?/signin' })).toBeNull();
    expect(classifyRequest({ method: 'GET', url: '/_app/remote/abc123/getPosts?payload=x' })).toMatchObject({ type: 'remote', name: 'abc123' });
  });

  it('Next.js RSC, prefetch and server actions', () => {
    expect(classifyRequest({ method: 'GET', url: '/dashboard?_rsc=1x2y' })).toMatchObject({ framework: 'next', type: 'rsc', label: 'Next.js RSC /dashboard' });
    expect(classifyRequest({ method: 'GET', url: '/a', headers: { RSC: '1', 'Next-Router-Prefetch': '1' } })).toMatchObject({ type: 'prefetch' });
    expect(classifyRequest({ method: 'POST', url: '/cart', headers: { 'next-action': '7f3a' } })).toMatchObject({ type: 'server-action', name: '7f3a' });
  });

  it('plain requests stay plain', () => {
    expect(classifyRequest({ method: 'GET', url: 'http://lab/api/ok?q=1' })).toBeNull();
    expect(requestLabel({ method: 'post', url: 'http://lab/api/fail' })).toBe('POST /api/fail');
  });
});

describe('keyframe planner', () => {
  it('keeps one request per gap and the strongest reason', () => {
    const p = new KeyframePlanner(1500);
    p.want({ t: 1000, reason: 'changed' });
    expect(p.due(1000)).toEqual([{ t: 1000, reason: 'changed' }]);
    p.want({ t: 1200, reason: 'dom-burst' });
    p.want({ t: 1300, reason: 'annotation' });
    expect(p.due(2400)).toEqual([]);
    expect(p.due(2500)).toEqual([{ t: 2500, reason: 'annotation' }]);
    p.want({ t: 9000, reason: 'nav' });
    expect(p.flush()).toEqual([{ t: 9000, reason: 'nav' }]);
  });
});

describe('dHash', () => {
  it('hashes any size: 33x32 gives 1024 bits, near-duplicates within 3 of them', () => {
    const w = 33;
    const h = 32;
    const a: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.push(x * 7, x * 7, x * 7, 255);
    const base = dHash(a, w, h);
    expect(base).toHaveLength(256);
    expect(nearDuplicateBits(base)).toBe(3);
    const b = a.slice();
    for (const x of [3, 9, 15, 21]) b[(5 * w + x) * 4] = b[(5 * w + x) * 4 + 1] = b[(5 * w + x) * 4 + 2] = 250;
    const changed = dHash(b, w, h);
    expect(hamming(base, changed)).toBeGreaterThan(3);
    expect(isNearDuplicate(base, changed)).toBe(false);
  });

  const img = (f: (x: number, y: number) => number) => {
    const a: number[] = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) {
      const v = f(x, y);
      a.push(v, v, v, 255);
    }
    return a;
  };

  it('is stable, and near for small changes, far for different pictures', () => {
    const grad = dHash(img((x) => 255 - x * 20));
    expect(grad).toBe('ffffffffffffffff');
    const noisy = dHash(img((x, y) => 255 - x * 20 + (x === 3 && y === 2 ? 30 : 0)));
    expect(hamming(grad, noisy)).toBe(1);
    expect(isNearDuplicate(grad, noisy)).toBe(true);
    const other = dHash(img((x) => x * 20));
    expect(other).toBe('0000000000000000');
    expect(isNearDuplicate(grad, other)).toBe(false);
    expect(dedupeKeyframes([{ hash: grad }, { hash: noisy }, { hash: other }, { hash: other }])).toEqual([{ hash: grad }, { hash: other }]);
  });
});
