// Locator packets (PLAN "Source location without app integration", D-128). One packet per
// annotation or element comment, written to the hand-off folder as annotations/aNN.locator.json.
// It tells an agent where in the app's source the reviewer pointed, without any change to the
// app: route and title, candidate SvelteKit route files, the element's text, role, name, test id,
// id, classes, landmarks and nearest heading, the 1x crop, and on dev servers the file and line
// from Svelte's __svelte_meta. Pure helpers only: route matching, the SvelteKit route dictionary
// parser, stack parsing. The page side lives in @toolbar/capture (locator.ts), the source map
// side in ./sourcemap.ts, the zod schema in ./schemas.ts (this file stays free of zod for the
// content scripts).
import type { MaskingPreset, Rect } from './events.ts';
import { nextRouteFiles, type NextRoute } from './next-route.ts';

export * from './next-route.ts';

export const LOCATOR_VERSION = 1 as const;

export type LocatorKind = 'element' | 'text' | 'area' | 'page';

/**
 * A file the annotated UI probably comes from. `source` says how we know: `svelte-meta` (the
 * dev server told us, exact), `manifest` (the route matched the app's own route table),
 * `next-tree` (the route tree a Next.js page carries, D-185), `guess` (built from the URL alone;
 * dynamic-looking segments became `[param]`).
 */
export interface RouteFile {
  file: string;
  routeId: string;
  role: 'page' | 'page-server' | 'component';
  source: 'svelte-meta' | 'manifest' | 'next-tree' | 'guess';
  params?: Record<string, string>;
}

export interface SourceLoc {
  file: string;
  line: number;
  column: number;
}

/** One entry of Svelte's dev stack: the component, each, if or snippet block around the element. */
export interface ComponentFrame {
  type: string;
  file?: string;
  line?: number;
  column?: number;
  /** the component's tag where it is used (`<Card>` -> "Card") */
  tag?: string;
}

/** A stack frame, with its original position when the app serves source maps. */
export interface MappedFrame {
  fn?: string;
  url: string;
  line: number;
  col: number;
  /** source path as the map names it */
  source?: string;
  /** the same path made project relative where possible (`src/routes/+page.svelte`) */
  file?: string;
  srcLine?: number;
  srcCol?: number;
  name?: string;
  /** the original source line, trimmed to 200 characters, when the map embeds sources */
  snippet?: string;
}

export interface LocatorError {
  t: number;
  kind: 'error' | 'console';
  type?: string;
  message: string;
  stack?: string;
  frames?: MappedFrame[];
  /** true when at least one frame was mapped through a source map */
  mapped: boolean;
  /** why nothing was mapped (no_map, fetch_failed, no_stack), when nothing was */
  reason?: string;
}

export interface LocatorPacket {
  v: typeof LOCATOR_VERSION;
  kind: LocatorKind;
  /** epoch ms when the packet was taken */
  at: number;
  url: string;
  /** pathname of `url` without the app's base path */
  route: string;
  title?: string;
  masking?: MaskingPreset;
  framework?: { name: 'sveltekit' | 'svelte' | 'nextjs'; dev: boolean; base?: string; routeId?: string; router?: 'app' | 'pages' };
  /** best first; empty when nothing matched */
  routeFiles: RouteFile[];
  /** dev servers only: where the element is written, from __svelte_meta */
  source?: SourceLoc & { via: 'svelte-meta'; /** ancestors walked up to find the meta, 0 = the element itself */ depth: number };
  /** dev servers only: the Svelte blocks and components around the element, innermost first */
  components?: ComponentFrame[];
  // element fields (TargetRef, flattened so the file greps well)
  selector?: string;
  tag?: string;
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  elId?: string;
  classes?: string[];
  landmarks?: string[];
  heading?: string;
  attrs?: Record<string, string>;
  /** the element (or area) in page coordinates, CSS px */
  rect?: Rect;
  /** the selected text, for `text` packets */
  selection?: string;
  viewport: { w: number; h: number; scrollX: number; scrollY: number; dpr: number };
  /** the crop at 1x CSS pixels: `file` in a folder, `assetId` on the server */
  crop?: { w: number; h: number; scale: 1; file?: string; assetId?: string };
  /** console errors and uncaught errors of the last 60 s, stacks mapped where maps are served */
  errors?: LocatorError[];
}

/** `a01.locator.json` for the first annotation (1-based index). */
export function locatorFileName(index: number): string {
  return `a${String(index).padStart(2, '0')}.locator.json`;
}

/** `a01.png` for the first annotation's crop. */
export function cropFileName(index: number): string {
  return `a${String(index).padStart(2, '0')}.png`;
}

/**
 * The `annotations/aNN.locator.json` documents of a capture's annotations, numbered in the given
 * order (1-based, matching the pins and `aNN.png`). Annotations without a locator keep their
 * number and get no file. The crop points at the folder's own `aNN.png`.
 */
export function locatorFiles(annotations: { locator?: LocatorPacket | null }[]): { path: string; packet: LocatorPacket }[] {
  const out: { path: string; packet: LocatorPacket }[] = [];
  annotations.forEach((a, i) => {
    if (!a.locator) return;
    const packet: LocatorPacket = a.locator.crop ? { ...a.locator, crop: { ...a.locator.crop, file: cropFileName(i + 1) } } : a.locator;
    out.push({ path: `annotations/${locatorFileName(i + 1)}`, packet });
  });
  return out;
}

// ---------- SvelteKit route table ----------

export interface KitRoute {
  id: string;
  /** the page has a server load (`+page.server.*`): SvelteKit marks its leaf node with `~n` */
  serverLoad: boolean;
}

/**
 * Finds SvelteKit's client route dictionary in the app's entry module and returns the route ids.
 * Production (`i={"/":[2],"/c/[id]":[-4,[0,2]]}`) and dev
 * (`export const dictionary = { "/": [2], "/form": [~5] }`) both work. Null when absent.
 */
export function parseRouteDictionary(js: string): KitRoute[] | null {
  // an object literal whose every key is a quoted path and every value an array of node refs
  const entry = String.raw`"(\/[^"\\]*)"\s*:\s*\[(?:[^\[\]]|\[[^\[\]]*\])*\]`;
  const re = new RegExp(String.raw`\{\s*${entry}(?:\s*,\s*${entry})*\s*,?\s*\}`, 'g');
  let best: KitRoute[] | null = null;
  for (const m of js.matchAll(re)) {
    const routes: KitRoute[] = [];
    for (const e of m[0].matchAll(new RegExp(entry, 'g'))) {
      const leaf = /\[\s*([~-]?)\s*(\d+)/.exec(e[0].slice(e[0].indexOf('[')));
      routes.push({ id: e[1]!, serverLoad: !!leaf && (leaf[1] === '~' || leaf[1] === '-') });
    }
    if (!best || routes.length > best.length) best = routes;
  }
  return best;
}

/** URLs in a page's HTML that point at SvelteKit's client entry module (prod and dev). */
export const KIT_ENTRY_PATTERN = /(?:\/entry\/app\.[\w-]+\.js|\/generated\/(?:dev\/)?client(?:-optimized)?\/app\.js)(?:\?[^"'\s)]*)?$/;

/** The base path of a SvelteKit app from the URL of its entry module (`/docs/_app/immutable/entry/app.x.js` -> `/docs`). */
export function kitBaseFromEntry(entryUrl: string): string | undefined {
  try {
    const p = new URL(entryUrl).pathname;
    const i = p.indexOf('/immutable/entry/');
    if (i < 0) return undefined;
    const appDir = p.slice(0, i); // "/docs/_app"
    const base = appDir.slice(0, appDir.lastIndexOf('/'));
    return base;
  } catch {
    return undefined;
  }
}

interface Compiled {
  id: string;
  re: RegExp;
  names: string[];
  score: number;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** SvelteKit route id -> matcher, after the rules of kit's parse_route_id (groups drop out). */
export function compileRouteId(id: string): Compiled {
  const names: string[] = [];
  let score = 0;
  let src = '^';
  const segs = id
    .split('/')
    .filter(Boolean)
    .filter((s) => !/^\(.+\)$/.test(s));
  if (!segs.length) return { id, re: /^\/?$/, names, score: 1000 };
  for (const seg of segs) {
    const rest = /^\[\.\.\.(\w+)(?:=\w+)?\]$/.exec(seg);
    if (rest) {
      names.push(rest[1]!);
      src += '(?:/(.*))?';
      continue;
    }
    const optional = /^\[\[(\w+)(?:=\w+)?\]\]$/.exec(seg);
    if (optional) {
      names.push(optional[1]!);
      src += '(?:/([^/]+))?';
      score += 1;
      continue;
    }
    let part = '';
    let dynamic = false;
    let lastIndex = 0;
    for (const m of seg.matchAll(/\[(\w+)(?:=\w+)?\]/g)) {
      part += escapeRe(seg.slice(lastIndex, m.index));
      part += '([^/]+?)';
      names.push(m[1]!);
      dynamic = true;
      lastIndex = m.index! + m[0].length;
    }
    part += escapeRe(seg.slice(lastIndex));
    // kit's hex escapes ([x+2f] and friends) stay literal enough for matching here
    src += '/' + part;
    score += dynamic ? (seg.startsWith('[') && seg.endsWith(']') ? 2 : 3) : 4;
  }
  return { id, re: new RegExp(src + '/?$'), names, score };
}

export interface RouteMatch {
  id: string;
  params: Record<string, string>;
  score: number;
}

/** Route ids that match a pathname, most specific first (static over dynamic over rest). */
export function matchRoutes(pathname: string, ids: string[]): RouteMatch[] {
  let path = pathname;
  try {
    path = decodeURI(pathname);
  } catch {
    /* keep encoded */
  }
  const out: RouteMatch[] = [];
  for (const id of ids) {
    const c = compileRouteId(id);
    const m = c.re.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    c.names.forEach((n, i) => {
      if (m[i + 1] !== undefined) params[n] = m[i + 1]!;
    });
    out.push({ id, params, score: c.score });
  }
  return out.sort((a, b) => b.score - a.score || a.id.length - b.id.length);
}

/** Looks like an id rather than a word: digits, uuid, hex, or a slug with digits. */
export function looksDynamic(seg: string): boolean {
  if (/^\d+$/.test(seg)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return true;
  if (/^[0-9a-f]{8,}$/i.test(seg) && /\d/.test(seg)) return true;
  if (seg.length >= 6 && /\d/.test(seg) && /[a-z]/i.test(seg) && !/^v\d+$/i.test(seg)) return true;
  if (/^[A-Za-z0-9_-]{16,}$/.test(seg) && /[A-Z]/.test(seg) && /[a-z]/.test(seg)) return true;
  return false;
}

function paramName(prev: string | undefined): string {
  if (!prev) return 'id';
  const w = prev.replace(/[^a-z]/gi, '').toLowerCase();
  if (!w) return 'id';
  const single = w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w;
  return single.length > 1 && single.length <= 20 ? `${single}Id`.replace(/IdId$/, 'Id') : 'id';
}

/** Route ids built from the URL alone: the literal path, then dynamic-looking segments as params. */
export function guessRouteIds(pathname: string): { id: string; params: Record<string, string> }[] {
  const segs = pathname.split('/').filter(Boolean);
  const literal = { id: '/' + segs.join('/'), params: {} };
  const params: Record<string, string> = {};
  let changed = false;
  const id =
    '/' +
    segs
      .map((s, i) => {
        if (!looksDynamic(s)) return s;
        changed = true;
        let n = paramName(segs[i - 1]);
        while (n in params) n += '2';
        params[n] = s;
        return `[${n}]`;
      })
      .join('/');
  return changed ? [{ id, params }, literal] : [literal];
}

/** `src/routes/c/[id]/+page.svelte` for route id `/c/[id]`. */
export function routeFilesOf(routeId: string, opts: { serverLoad?: boolean; source: RouteFile['source']; params?: Record<string, string> }): RouteFile[] {
  const dir = routeId === '/' ? 'src/routes' : `src/routes${routeId}`;
  const params = opts.params && Object.keys(opts.params).length ? { params: opts.params } : {};
  const out: RouteFile[] = [{ file: `${dir}/+page.svelte`, routeId, role: 'page', source: opts.source, ...params }];
  if (opts.serverLoad) out.push({ file: `${dir}/+page.server.ts`, routeId, role: 'page-server', source: opts.source, ...params });
  return out;
}

/** Route id of a route file path (`src/routes/(app)/c/[id]/+page.svelte` -> `/(app)/c/[id]`). */
export function routeIdOfFile(file: string): string | null {
  const m = /(?:^|\/)src\/routes((?:\/[^/]+)*?)\/\+(?:page|layout|error)(?:@[^.]*)?\.(?:svelte|server\.[jt]s|[jt]s)$/.exec(file);
  if (!m) return null;
  return m[1] || '/';
}

export interface CandidateInput {
  pathname: string;
  /** SvelteKit route table of the app, when its entry module was found */
  routes?: KitRoute[] | null;
  /** the app's base path, stripped from the pathname */
  base?: string;
  /** Svelte dev info: the element's own file and the files of the components around it */
  svelteFiles?: string[];
  /** the route a Next.js page carries (nextRouteOf); route files then follow Next's layout */
  next?: NextRoute | null;
  max?: number;
}

/** Route path of a URL pathname with the app's base removed. */
export function stripBase(pathname: string, base?: string): string {
  if (!base || base === '/') return pathname || '/';
  if (pathname === base) return '/';
  return pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname;
}

/**
 * Candidate route files, best first: exact files from Svelte dev info, then route-table matches,
 * then guesses from the URL. Duplicates collapse onto the best source.
 */
export function candidateRouteFiles(input: CandidateInput): { files: RouteFile[]; routeId?: string } {
  const max = input.max ?? 8;
  const path = stripBase(input.pathname, input.base);
  const out: RouteFile[] = [];
  const seen = new Set<string>();
  const add = (f: RouteFile) => {
    if (seen.has(f.file) || out.length >= max) return;
    seen.add(f.file);
    out.push(f);
  };
  let routeId: string | undefined;
  if (input.next) {
    const n = nextRouteFiles(input.next, path);
    for (const f of n.files) add(f);
    return { files: out, routeId: n.routeId };
  }
  for (const file of input.svelteFiles ?? []) {
    const id = routeIdOfFile(file);
    if (id && /\+page\.svelte$/.test(file)) {
      routeId ??= id;
      add({ file, routeId: id, role: 'page', source: 'svelte-meta' });
    }
  }
  for (const file of input.svelteFiles ?? []) {
    if (!/\+page\.svelte$/.test(file) && /\.svelte$/.test(file)) add({ file, routeId: routeIdOfFile(file) ?? routeId ?? path, role: 'component', source: 'svelte-meta' });
  }
  if (input.routes?.length) {
    const byId = new Map(input.routes.map((r) => [r.id, r]));
    const matches = matchRoutes(path, input.routes.map((r) => r.id));
    for (const m of matches.slice(0, 3)) {
      routeId ??= m.id;
      for (const f of routeFilesOf(m.id, { serverLoad: byId.get(m.id)?.serverLoad, source: 'manifest', params: m.params })) add(f);
    }
    if (matches.length) return { files: out, routeId };
  }
  for (const g of guessRouteIds(path)) for (const f of routeFilesOf(g.id, { source: 'guess', params: g.params })) add(f);
  return { files: out, routeId };
}

// ---------- stacks ----------

export interface StackFrame {
  fn?: string;
  url: string;
  line: number;
  col: number;
}

/** Frames of a V8 (`at fn (url:1:2)`) or Firefox/Safari (`fn@url:1:2`) stack. */
export function parseStack(stack: string | undefined, max = 30): StackFrame[] {
  if (!stack) return [];
  const out: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    let m = /^at (?:(.+?) \()?(?:async )?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (m) {
      out.push({ ...(m[1] ? { fn: m[1] } : {}), url: m[2]!, line: Number(m[3]), col: Number(m[4]) });
    } else if ((m = /^(?:(.*?)@)?(\S+?):(\d+):(\d+)$/.exec(line)) && /[/:]/.test(m[2]!)) {
      out.push({ ...(m[1] ? { fn: m[1] } : {}), url: m[2]!, line: Number(m[3]), col: Number(m[4]) });
    }
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A source path from a map made project relative: `../../src/routes/+page.svelte`,
 * `webpack://app/./src/x.ts`, `/@fs/home/me/app/src/x.ts` and `http://host/src/x.ts?t=1` all
 * become `src/...` when they hold a `src/` segment; otherwise the path loses its leading `../`.
 */
export function projectPath(source: string): string {
  let s = source.replace(/^webpack:\/\/[^/]*\//, '').replace(/[?#].*$/, '');
  try {
    if (/^[a-z]+:\/\//i.test(s)) s = new URL(s).pathname;
  } catch {
    /* keep */
  }
  const i = s.lastIndexOf('/src/') >= 0 && !s.includes('/node_modules/') ? s.lastIndexOf('/src/') + 1 : s.startsWith('src/') ? 0 : -1;
  if (i >= 0) return s.slice(i);
  return s.replace(/^(?:\.\.?\/)+/, '').replace(/^\/@fs\//, '/');
}
