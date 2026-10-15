// Framework awareness without app integration (PLAN "SvelteKit awareness"): name SvelteKit data
// loads, form actions and remote functions, and Next.js RSC requests and server actions, from
// what the request itself shows (URL, method, headers).
//
// SvelteKit: a client-side navigation or invalidation fetches `<route>/__data.json` (with
// `x-sveltekit-invalidated` when only some loads rerun); `use:enhance` posts a form action to
// `<route>?/<name>` (`?/` alone is never sent: the default action posts to the bare route) with
// header `x-sveltekit-action: true`; remote functions live under `/_app/remote/<id>`.
// Next.js App Router: RSC payload requests carry header `RSC: 1` and a `_rsc` query; prefetches
// add `Next-Router-Prefetch: 1`; server actions are POSTs with a `Next-Action` header.
import type { RequestName } from './types.ts';

export interface RequestLike {
  method: string;
  url: string;
  headers?: Record<string, string>;
}

function header(h: Record<string, string> | undefined, name: string): string | undefined {
  if (!h) return undefined;
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(h)) if (k.toLowerCase() === want) return v;
  return undefined;
}

function parse(url: string): URL | null {
  try {
    return new URL(url, 'http://x.invalid');
  } catch {
    return null;
  }
}

/** The framework name of a request, or null for a plain one. */
export function classifyRequest(r: RequestLike): RequestName | null {
  const u = parse(r.url);
  if (!u) return null;
  const method = r.method.toUpperCase();
  const path = u.pathname;

  // SvelteKit data load: /__data.json at the root, /x/__data.json below it
  if (path === '/__data.json' || path.endsWith('/__data.json')) {
    const route = path.slice(0, -'/__data.json'.length) || '/';
    const partial = u.searchParams.has('x-sveltekit-invalidated');
    return { framework: 'sveltekit', type: 'load', route, label: `SvelteKit load ${route}${partial ? ' (invalidated)' : ''}` };
  }
  // SvelteKit remote functions (query, command, form, prerender)
  const remote = /\/_app\/remote\/([^/?#]+)/.exec(path);
  if (remote) {
    const name = decodeURIComponent(remote[1]!);
    return { framework: 'sveltekit', type: 'remote', route: path, name, label: `SvelteKit remote function ${name}` };
  }
  // SvelteKit form action: POST ?/name, or the enhance header on the default action
  if (method === 'POST') {
    const search = u.search;
    const named = /^\?\/([^&=]*)/.exec(search);
    const enhanced = header(r.headers, 'x-sveltekit-action') === 'true';
    if (named || enhanced) {
      const name = named?.[1] ? decodeURIComponent(named[1]) : 'default';
      return { framework: 'sveltekit', type: 'action', route: path, name, label: `SvelteKit form action ${name === 'default' ? 'default' : `?/${name}`} on ${path}` };
    }
  }

  // Next.js server action
  const action = header(r.headers, 'next-action');
  if (action && method === 'POST') {
    return { framework: 'next', type: 'server-action', route: path, name: action, label: `Next.js server action on ${path}` };
  }
  // Next.js RSC payload
  const rsc = header(r.headers, 'rsc') === '1' || u.searchParams.has('_rsc');
  if (rsc) {
    const prefetch = header(r.headers, 'next-router-prefetch') === '1';
    return prefetch
      ? { framework: 'next', type: 'prefetch', route: path, label: `Next.js prefetch ${path}` }
      : { framework: 'next', type: 'rsc', route: path, label: `Next.js RSC ${path}` };
  }
  return null;
}

/** Short words for one request: its framework name, else `METHOD /path`. */
export function requestLabel(r: RequestLike): string {
  const n = classifyRequest(r);
  if (n) return n.label;
  const u = parse(r.url);
  const where = u ? u.pathname + (u.search.length > 40 ? u.search.slice(0, 40) + '...' : u.search) : r.url;
  return `${r.method.toUpperCase()} ${where}`;
}
