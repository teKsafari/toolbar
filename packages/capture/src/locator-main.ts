// MAIN world half of the locator (D-117). Svelte keeps its dev location on DOM elements as an
// expando property (`__svelte_meta`), which only the page's own world can read. The isolated
// world dispatches LOCATE_EVENT on the element with a request id; this listener, installed at
// document_start before any page script, takes it in the capture phase, hides it from the page
// and answers over the private bridge. No DOM attribute is written, so the page, rrweb and our
// DOM summary see nothing.
import { BRIDGE_TAG } from '@toolbar/shared/constants';
import type { MainReply } from './bridge.ts';

export const LOCATE_EVENT = `${BRIDGE_TAG}:locate`;

export interface SvelteMetaInfo {
  file: string;
  line: number;
  column: number;
  /** ancestors walked up to find an element with meta (0 = the element itself) */
  depth: number;
  /** 5 for Svelte 5 meta (`{ loc, parent }`), 4 for Svelte 3 and 4 (`{ loc }` with 0-based lines) */
  version: 4 | 5;
  /** Svelte 5 dev stack around the element, innermost first */
  chain: { type: string; file?: string; line?: number; column?: number; tag?: string }[];
}

export interface LocateReply {
  reply: 'locate';
  id: number;
  svelte?: SvelteMetaInfo | null;
  /** SvelteKit's runtime global (`__sveltekit_<hash>`) was found */
  kit?: { base?: string } | null;
}

type Meta = {
  loc?: { file?: string; line?: number; column?: number };
  parent?: Stack | null;
};
type Stack = { type?: string; file?: string; line?: number; column?: number; componentTag?: string; parent?: Stack | null };

const str = (v: unknown, max = 500) => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Reads `__svelte_meta` from the element or its nearest ancestor that has it. */
export function readSvelteMeta(el: Element | null, maxDepth = 25): SvelteMetaInfo | null {
  let depth = 0;
  for (let n: Element | null = el; n && depth <= maxDepth; n = n.parentElement, depth++) {
    let meta: Meta | null | undefined;
    try {
      meta = (n as unknown as { __svelte_meta?: Meta | null }).__svelte_meta;
    } catch {
      return null;
    }
    const loc = meta?.loc;
    const file = str(loc?.file, 1000);
    if (!meta || !file) continue;
    const v5 = 'parent' in meta;
    const line = num(loc?.line) ?? 0;
    const column = num(loc?.column) ?? 0;
    const chain: SvelteMetaInfo['chain'] = [];
    let p = v5 ? meta.parent : null;
    for (let i = 0; p && i < 30; i++, p = p.parent) {
      const entry: SvelteMetaInfo['chain'][number] = { type: str(p.type, 40) ?? 'block' };
      const f = str(p.file, 1000);
      if (f) entry.file = f;
      if (num(p.line) !== undefined) entry.line = p.line;
      if (num(p.column) !== undefined) entry.column = p.column;
      const tag = str(p.componentTag, 200);
      if (tag) entry.tag = tag;
      chain.push(entry);
    }
    // Svelte 3 and 4 count lines from 0, Svelte 5 from 1; columns are 0-based in both
    return { file, line: v5 ? line : line + 1, column, depth, version: v5 ? 5 : 4, chain };
  }
  return null;
}

/** SvelteKit's runtime global, with the app's base path, or null on other apps. */
export function readKitGlobal(win: Window): { base?: string } | null {
  try {
    for (const k of Object.keys(win)) {
      if (!k.startsWith('__sveltekit_')) continue;
      const v = (win as unknown as Record<string, unknown>)[k] as { base?: unknown } | undefined;
      const base = typeof v?.base === 'string' ? v.base : undefined;
      return base !== undefined ? { base } : {};
    }
  } catch {
    /* proxies */
  }
  return null;
}

export function installLocatorMain(win: Window, bridge: { post(m: unknown): void }) {
  win.addEventListener(
    LOCATE_EVENT,
    (e) => {
      e.stopImmediatePropagation();
      const id = Number((e as CustomEvent).detail);
      if (!Number.isFinite(id)) return;
      const target = e.target instanceof Element ? e.target : null;
      let reply: LocateReply;
      try {
        reply = { reply: 'locate', id, svelte: readSvelteMeta(target), kit: readKitGlobal(win) };
      } catch {
        reply = { reply: 'locate', id, svelte: null, kit: null };
      }
      bridge.post(reply satisfies MainReply);
    },
    true,
  );
}
