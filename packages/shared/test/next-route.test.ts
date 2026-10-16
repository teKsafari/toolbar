// Next.js route files for the locator (D-185), on the shape of a real App Router page (the Nuru
// course, docs/real-world/nuru.md) and on a Pages Router page.
import { describe, expect, it } from 'vitest';
import { appTreeOf, candidateRouteFiles, flightTextOf, guessFromRoute, matchNextRoute, nextRouteFiles, nextRouteOf, pagesRouteOf } from '../src/locator.ts';

// the row of the flight payload that holds the router tree, as Next.js 15 streams it
const row =
  '0:{"P":null,"b":"mv70znbz9a3ae5","p":"","c":["","sw","anza","misingi-ya-nuru","karibu"],"i":false,"f":[[["",{"children":["(main)",{"children":[["lang","sw","d"],{"children":["anza",{"children":[["moduleSlug","misingi-ya-nuru","d"],{"children":[["lessonSlug","karibu","d"],{"children":["__PAGE__",{}]}]}]}]}]}]},"$undefined","$undefined",true],["",["$","$1","c",{"children":[["$","link","0",{"rel":"stylesheet","href":"/_next/static/css/a.css"}]]}]]]]}\n';
const push = (t: string) => `self.__next_f.push([1,${JSON.stringify(t)}])`;
const scripts = ['(self.__next_f=self.__next_f||[]).push([0])', push('1:"$Sreact.fragment"\n'), push(row.slice(0, 120)), push(row.slice(120))];

describe('Next.js App Router tree', () => {
  it('joins the pushed chunks and reads the tree with groups and dynamic segments', () => {
    const flight = flightTextOf(scripts);
    expect(flight).toContain('"c":["","sw","anza"');
    const segs = appTreeOf(flight)!;
    expect(segs.map((s) => `${s.kind}:${s.name}`)).toEqual(['group:(main)', 'dynamic:lang', 'static:anza', 'dynamic:moduleSlug', 'dynamic:lessonSlug']);
  });

  it('names the page file of the loaded route and of another lesson of the same route', () => {
    const next = nextRouteOf({ inlineScripts: scripts })!;
    expect(next.router).toBe('app');
    const here = nextRouteFiles(next, '/sw/anza/misingi-ya-nuru/karibu');
    expect(here.routeId).toBe('/(main)/[lang]/anza/[moduleSlug]/[lessonSlug]');
    expect(here.files).toEqual([{ file: 'app/(main)/[lang]/anza/[moduleSlug]/[lessonSlug]/page.tsx', routeId: here.routeId, role: 'page', source: 'next-tree', params: { lang: 'sw', moduleSlug: 'misingi-ya-nuru', lessonSlug: 'karibu' } }]);
    // after client-side navigation to the next lesson in English
    expect(nextRouteFiles(next, '/en/anza/misingi-ya-nuru/andika').files[0]).toMatchObject({ source: 'next-tree', params: { lang: 'en', lessonSlug: 'andika' } });
  });

  it('guesses for a page reached by client navigation that the loaded route does not fit, keeping the group and the [lang] prefix', () => {
    const next = nextRouteOf({ inlineScripts: scripts })!;
    const other = nextRouteFiles(next, '/sw/masomo');
    expect(other.files[0]).toMatchObject({ file: 'app/(main)/[lang]/masomo/page.tsx', source: 'guess', params: { lang: 'sw' } });
    expect(guessFromRoute(next.segs, '/').segs.map((s) => s.name)).toEqual(['(main)']);
  });

  it('candidateRouteFiles prefers the Next.js route over SvelteKit guesses', () => {
    const next = nextRouteOf({ inlineScripts: scripts });
    const cand = candidateRouteFiles({ pathname: '/sw/anza/misingi-ya-nuru/karibu', next });
    expect(cand.files.map((f) => f.file)).toEqual(['app/(main)/[lang]/anza/[moduleSlug]/[lessonSlug]/page.tsx']);
    expect(cand.files.some((f) => f.file.includes('+page.svelte'))).toBe(false);
    // a Next.js page whose tree could not be read still gets Next.js's layout
    const empty = candidateRouteFiles({ pathname: '/sw/anza', next: { router: 'app', segs: [] } });
    expect(empty.files[0]).toMatchObject({ file: 'app/sw/anza/page.tsx', source: 'guess' });
  });

  it('is null on pages without a flight tree', () => {
    expect(nextRouteOf({ inlineScripts: ['console.log(1)'] })).toBeNull();
    expect(appTreeOf('{"children":[]}')).toBeNull();
  });
});

describe('Next.js Pages Router', () => {
  it('reads __NEXT_DATA__ and matches catch-all and optional catch-all segments', () => {
    const next = nextRouteOf({ inlineScripts: [], nextData: JSON.stringify({ props: {}, page: '/[lang]/docs/[...slug]', query: {} }) })!;
    expect(next.router).toBe('pages');
    expect(nextRouteFiles(next, '/sw/docs/a/b').files[0]).toMatchObject({ file: 'pages/[lang]/docs/[...slug].tsx', source: 'next-tree', params: { lang: 'sw', slug: 'a/b' } });
    expect(matchNextRoute(pagesRouteOf('/[lang]/docs/[...slug]'), '/sw/docs')).toBeNull();
    expect(matchNextRoute(pagesRouteOf('/shop/[[...rest]]'), '/shop')).toEqual({});
    expect(nextRouteFiles({ router: 'pages', segs: [] }, '/').files[0]!.file).toBe('pages/index.tsx');
  });
});
