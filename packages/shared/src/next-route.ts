// Next.js route files for the locator (D-185). The locator was built for SvelteKit (D-128): on a
// Next.js app it guessed `src/routes/<url>/+page.svelte`. A Next.js page tells us its own route:
//
// - App Router: the HTML streams the React Server Components payload in inline scripts,
//   `self.__next_f.push([1,"<text>"])`. The text holds the router tree of the loaded page, a nested
//   array `["",{"children":["(main)",{"children":[["lang","sw","d"],{"children":["__PAGE__",{}]}]}]}]`
//   whose segments are route groups, static names and `[param, value, type]` triples (type `d`
//   dynamic, `c` catch-all, `oc` optional catch-all; `di`, `ci`, `oci` when intercepted).
//   That is `app/(main)/[lang]/page.tsx`.
// - Pages Router: `<script id="__NEXT_DATA__">` holds `"page": "/[lang]/anza/[slug]"`.
//
// Both describe the page that was loaded first. After client-side navigation the current URL is
// matched against that route; when it does not match, the route's leading segments that still fit
// (a `[lang]` prefix, a route group) are kept and the rest of the URL is appended literally.
import type { RouteFile } from './locator.ts';

export type NextSegKind = 'static' | 'group' | 'dynamic' | 'catchall' | 'optional';
export interface NextSeg {
  kind: NextSegKind;
  /** the folder name without brackets: `anza`, `(main)`, `lang` */
  name: string;
}
export interface NextRoute {
  router: 'app' | 'pages';
  segs: NextSeg[];
}

/** The text pushed into `self.__next_f` by the page's inline scripts, joined in order. */
export function flightTextOf(scripts: string[]): string {
  let out = '';
  for (const s of scripts) {
    if (!s.includes('__next_f')) continue;
    for (const m of s.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
      try {
        out += JSON.parse(m[1]!) as string;
      } catch {
        /* not a JSON string literal */
      }
    }
  }
  return out;
}

/** The JSON value (array or object) that starts at `from`, by bracket depth outside strings; null when unbalanced. */
function balancedAt(text: string, from: number, max = 200_000): string | null {
  let depth = 0;
  let inStr = false;
  for (let i = from; i < text.length && i - from < max; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

const DYN: Record<string, NextSegKind> = { d: 'dynamic', di: 'dynamic', c: 'catchall', ci: 'catchall', oc: 'optional', oci: 'optional' };

/** Segments of the App Router tree in a flight payload, root to page; null when there is none. */
export function appTreeOf(flight: string): NextSeg[] | null {
  const at = flight.indexOf('["",{"children":');
  if (at < 0) return null;
  const json = balancedAt(flight, at);
  if (!json) return null;
  let node: unknown;
  try {
    node = JSON.parse(json);
  } catch {
    return null;
  }
  const segs: NextSeg[] = [];
  for (let guard = 0; guard < 64; guard++) {
    const kids = Array.isArray(node) ? (node[1] as { children?: unknown } | undefined)?.children : undefined;
    if (!Array.isArray(kids)) break;
    const seg = kids[0];
    if (typeof seg === 'string') {
      if (seg.startsWith('__PAGE__')) return segs;
      if (seg === '__DEFAULT__') return segs;
      segs.push(/^\(.+\)$/.test(seg) ? { kind: 'group', name: seg } : { kind: 'static', name: seg });
    } else if (Array.isArray(seg) && typeof seg[0] === 'string') {
      segs.push({ kind: DYN[String(seg[2])] ?? 'dynamic', name: seg[0] });
    } else break;
    node = kids;
  }
  return segs.length ? segs : null;
}

/** Segments of a Pages Router page pattern (`/[lang]/posts/[...slug]`). */
export function pagesRouteOf(page: string): NextSeg[] {
  return page
    .split('/')
    .filter(Boolean)
    .map((s): NextSeg => {
      let m = /^\[\[\.\.\.(.+)\]\]$/.exec(s);
      if (m) return { kind: 'optional', name: m[1]! };
      m = /^\[\.\.\.(.+)\]$/.exec(s);
      if (m) return { kind: 'catchall', name: m[1]! };
      m = /^\[(.+)\]$/.exec(s);
      if (m) return { kind: 'dynamic', name: m[1]! };
      return { kind: 'static', name: s };
    });
}

/** The folder name of a segment as it is on disk. */
export function segDir(s: NextSeg): string {
  return s.kind === 'dynamic' ? `[${s.name}]` : s.kind === 'catchall' ? `[...${s.name}]` : s.kind === 'optional' ? `[[...${s.name}]]` : s.name;
}

/** Route id as Next.js writes it: `/(main)/[lang]/anza/[moduleSlug]`. */
export function nextRouteId(segs: NextSeg[]): string {
  return '/' + segs.map(segDir).join('/');
}

/** Params when `pathname` fits the route, else null. Route groups take no URL segment. */
export function matchNextRoute(segs: NextSeg[], pathname: string): Record<string, string> | null {
  const parts = pathname.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const route = segs.filter((s) => s.kind !== 'group');
  const params: Record<string, string> = {};
  let i = 0;
  for (const [k, s] of route.entries()) {
    if (s.kind === 'static') {
      if (parts[i] !== s.name) return null;
      i++;
    } else if (s.kind === 'dynamic') {
      if (parts[i] === undefined) return null;
      params[s.name] = parts[i++]!;
    } else {
      // catch-alls are last in a route
      if (k !== route.length - 1) return null;
      const rest = parts.slice(i);
      if (s.kind === 'catchall' && !rest.length) return null;
      if (rest.length) params[s.name] = rest.join('/');
      i = parts.length;
    }
  }
  return i === parts.length ? params : null;
}

/**
 * The longest leading part of the route that fits the start of `pathname`, plus the rest of the
 * URL as static folders: a guess for a page reached by client-side navigation.
 */
export function guessFromRoute(segs: NextSeg[], pathname: string): { segs: NextSeg[]; params: Record<string, string> } {
  const parts = pathname.split('/').filter(Boolean);
  const out: NextSeg[] = [];
  const params: Record<string, string> = {};
  let i = 0;
  for (const s of segs) {
    if (s.kind === 'group') {
      out.push(s);
      continue;
    }
    if (i >= parts.length) break;
    if (s.kind === 'static' && parts[i] === s.name) {
      out.push(s);
      i++;
    } else if (s.kind === 'dynamic' && i === 0 && segs.filter((x) => x.kind !== 'group')[0] === s) {
      // a leading dynamic segment (`[lang]`, `[locale]`, `[team]`) is shared by most pages
      out.push(s);
      params[s.name] = parts[i++]!;
    } else break;
  }
  for (; i < parts.length; i++) out.push({ kind: 'static', name: parts[i]! });
  // drop route groups left dangling after the last segment that came from the route
  return { segs: out, params };
}

/** The page file of a route: `app/(main)/[lang]/page.tsx`, or `pages/[lang]/index.tsx`. */
export function nextPageFile(route: NextRoute['router'], segs: NextSeg[]): string {
  const dir = segs.map(segDir).join('/');
  if (route === 'app') return `app/${dir ? dir + '/' : ''}page.tsx`;
  return `pages/${dir || 'index'}.tsx`;
}

/** Route files for the current pathname, best first. */
export function nextRouteFiles(next: NextRoute, pathname: string): { files: RouteFile[]; routeId: string } {
  const params = matchNextRoute(next.segs, pathname);
  if (params) {
    const routeId = nextRouteId(next.segs);
    const p = Object.keys(params).length ? { params } : {};
    return { routeId, files: [{ file: nextPageFile(next.router, next.segs), routeId, role: 'page', source: 'next-tree', ...p }] };
  }
  const g = guessFromRoute(next.segs, pathname);
  const routeId = nextRouteId(g.segs);
  const p = Object.keys(g.params).length ? { params: g.params } : {};
  return { routeId, files: [{ file: nextPageFile(next.router, g.segs), routeId, role: 'page', source: 'guess', ...p }] };
}

/** The route of a Next.js page from its inline scripts and `__NEXT_DATA__`; null on other apps. */
export function nextRouteOf(input: { inlineScripts: string[]; nextData?: string | null }): NextRoute | null {
  const tree = appTreeOf(flightTextOf(input.inlineScripts));
  if (tree) return { router: 'app', segs: tree };
  if (input.nextData) {
    try {
      const page = (JSON.parse(input.nextData) as { page?: unknown }).page;
      if (typeof page === 'string' && page.startsWith('/')) return { router: 'pages', segs: pagesRouteOf(page) };
    } catch {
      /* not JSON */
    }
  }
  return null;
}
