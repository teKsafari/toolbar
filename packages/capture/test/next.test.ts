// @vitest-environment happy-dom
// The page side of the Next.js locator (D-185): the route tree read from the flight scripts a
// Next.js App Router page leaves in its DOM, and the packet's route files and framework.
import { describe, expect, it } from 'vitest';
import { locateInPage } from '../src/locator.ts';
import { isNextPage, readNextRoute } from '../src/next.ts';

const tree = '0:{"c":["","sw","anza","misingi-ya-nuru","karibu"],"f":[[["",{"children":["(main)",{"children":[["lang","sw","d"],{"children":["anza",{"children":[["moduleSlug","misingi-ya-nuru","d"],{"children":[["lessonSlug","karibu","d"],{"children":["__PAGE__",{}]}]}]}]}]}]},"$undefined","$undefined",true]]}\n';

function nextDocument(): Document {
  const doc = document.implementation.createHTMLDocument('Nuru');
  doc.head.innerHTML = '<link rel="preload" as="script" href="/_next/static/chunks/webpack-1.js">';
  doc.body.innerHTML = `<main><h1>Karibu Nuru!</h1></main><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,${JSON.stringify(tree)}])</script>`;
  return doc;
}

describe('Next.js route in the page', () => {
  it('finds a Next.js page and its App Router tree', () => {
    const doc = nextDocument();
    expect(isNextPage(doc)).toBe(true);
    expect(readNextRoute(doc)!.segs.map((s) => s.name)).toEqual(['(main)', 'lang', 'anza', 'moduleSlug', 'lessonSlug']);
    const plain = document.implementation.createHTMLDocument('x');
    expect(readNextRoute(plain)).toBeNull();
  });

  it('a locator packet on a Next.js page names the app/ page file, not a SvelteKit route', async () => {
    const doc = nextDocument();
    const win = { document: doc, location: new URL('https://116.nuru.sh/sw/anza/misingi-ya-nuru/andika'), innerWidth: 1280, innerHeight: 800, scrollX: 0, scrollY: 0, devicePixelRatio: 1, getSelection: () => null } as unknown as Window & typeof globalThis;
    const { packet } = await locateInPage({ selector: 'h1' }, { win });
    expect(packet.framework).toMatchObject({ name: 'nextjs', router: 'app', routeId: '/(main)/[lang]/anza/[moduleSlug]/[lessonSlug]' });
    expect(packet.routeFiles[0]).toMatchObject({ file: 'app/(main)/[lang]/anza/[moduleSlug]/[lessonSlug]/page.tsx', source: 'next-tree', params: { lang: 'sw', lessonSlug: 'andika' } });
    expect(packet.routeFiles.some((f) => f.file.includes('src/routes'))).toBe(false);
  });
});

describe('selectors on React pages', () => {
  it('skip ids React generates per render (useId), keep authored ids', async () => {
    const { generatedId, selectorOf } = await import('../src/target.ts');
    for (const id of [':r1:', ':R2d6:', '«r3»', '_r_1p_', 'radix-:r4:']) expect(generatedId(id), id).toBe(true);
    for (const id of ['main', 'run-button', 'profile', '__next']) expect(generatedId(id), id).toBe(false);
    document.body.innerHTML = '<div id="_r_1p_"><div><button>Majaribio</button></div></div><section id="lesson"><h1>Karibu</h1></section>';
    expect(selectorOf(document.querySelector('button')!)).not.toContain('_r_1p_');
    expect(selectorOf(document.querySelector('h1')!)).toBe('#lesson > h1');
  });
});
