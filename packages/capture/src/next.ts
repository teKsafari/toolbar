// The route a Next.js page carries (D-185), read from the DOM, which the isolated world shares
// with the page: the App Router's inline `self.__next_f.push(...)` scripts, or the Pages Router's
// `#__NEXT_DATA__`. Parsing lives in @toolbar/shared/locator (next-route.ts).
import { nextRouteOf, type NextRoute } from '@toolbar/shared/locator';

const cache = new WeakMap<Document, NextRoute | null>();

/** True on a page served by Next.js (its static chunks, its data script or its flight scripts). */
export function isNextPage(doc: Document): boolean {
  return !!doc.querySelector('script[src*="/_next/static/"], script#__NEXT_DATA__, link[href*="/_next/static/"]');
}

/**
 * The route of the page as Next.js first rendered it, or null on other apps. On a Next.js page
 * without a readable tree the route is empty, so route files are guessed from the URL in
 * Next.js's layout instead of SvelteKit's.
 */
export function readNextRoute(doc: Document): NextRoute | null {
  if (cache.has(doc)) return cache.get(doc)!;
  let route: NextRoute | null = null;
  if (isNextPage(doc)) {
    const inline: string[] = [];
    doc.querySelectorAll('script:not([src])').forEach((s) => {
      const t = s.textContent ?? '';
      if (t.includes('__next_f')) inline.push(t);
    });
    const data = doc.getElementById('__NEXT_DATA__')?.textContent ?? null;
    route = nextRouteOf({ inlineScripts: inline, nextData: data }) ?? { router: data ? 'pages' : 'app', segs: [] };
  }
  // the flight scripts never change after the first load; an app that is not Next.js may still
  // load later, so only a found route is cached
  if (route) cache.set(doc, route);
  return route;
}
