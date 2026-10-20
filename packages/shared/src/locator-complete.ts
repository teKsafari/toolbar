// Completes the page's part of a locator packet (D-128, D-164): candidate route files from the
// app's SvelteKit route table and the console errors of the last minute with stacks mapped
// through the app's source maps. Shared by the extension's service worker (`locator.capture`,
// which the reviewer toolbar calls for each note) and the embed's page bundle, which runs in
// the page and fetches with the fetch it saved before the capture hooks.
import type { CaptureEvent, ConsoleEntry, PageError } from './events.ts';
import { candidateRouteFiles, kitBaseFromEntry, parseRouteDictionary, stripBase, type KitRoute, type LocatorError, type LocatorPacket } from './locator.ts';
import type { FetchedText, StackMapper } from './sourcemap.ts';

/** Console args as one line (strings as is, errors as "Name: message", the rest as JSON). */
function argsText(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      const o = a as Record<string, unknown> | null;
      if (o && typeof o === 'object' && o.$t === 'error') return `${String(o.name)}: ${String(o.message)}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/** Stack and message of an error-like event, or null for other events. */
export function errorOf(e: Pick<CaptureEvent, 'kind' | 'data'>): { kind: 'error' | 'console'; type?: string; message: string; stack?: string } | null {
  if (e.kind === 'error') {
    const d = e.data as PageError;
    if (d.type === 'resource' || d.type === 'csp') return null;
    return { kind: 'error', type: d.type, message: d.name ? `${d.name}: ${d.message}` : d.message, ...(d.stack ? { stack: d.stack } : {}) };
  }
  if (e.kind === 'console') {
    const d = e.data as ConsoleEntry;
    if (d.level !== 'error') return null;
    const errArg = d.args.find((a) => a && typeof a === 'object' && !Array.isArray(a) && (a as Record<string, unknown>).$t === 'error') as { stack?: string } | undefined;
    const stack = errArg?.stack ?? d.stack;
    return { kind: 'console', message: argsText(d.args).slice(0, 2000), ...(stack ? { stack } : {}) };
  }
  return null;
}

/** A cached reader of SvelteKit route tables, one fetch per entry module. */
export function createRouteTables(fetchText: (url: string) => Promise<FetchedText | null>, max = 32) {
  const tables = new Map<string, Promise<KitRoute[] | null>>();
  return {
    get(entryUrl: string): Promise<KitRoute[] | null> {
      let p = tables.get(entryUrl);
      if (!p) {
        p = fetchText(entryUrl).then(
          (r) => (r ? parseRouteDictionary(r.text) : null),
          () => null,
        );
        tables.set(entryUrl, p);
        if (tables.size > max) tables.delete(tables.keys().next().value!);
      }
      return p;
    },
    clear: () => tables.clear(),
  };
}
export type RouteTables = ReturnType<typeof createRouteTables>;

export interface CompleteOptions {
  routes: RouteTables;
  mapper: StackMapper;
  /** events of the error window (any kinds; only errors and console errors are used) */
  events?: CaptureEvent[];
  maxErrors?: number;
}

/** Adds route-table candidates and mapped errors to the page's packet, in place. */
export async function completeLocator(page: { packet: LocatorPacket; kitEntries: string[] }, opts: CompleteOptions): Promise<LocatorPacket> {
  const packet = page.packet;
  const entry = page.kitEntries[0];
  if (entry) {
    const routes = await opts.routes.get(entry);
    if (routes) {
      const base = packet.framework?.base ?? kitBaseFromEntry(entry);
      if (base) {
        packet.framework = { ...(packet.framework ?? { name: 'sveltekit', dev: false }), base };
        packet.route = stripBase(new URL(packet.url).pathname, base);
      }
      const svelteFiles = packet.source ? [packet.source.file, ...(packet.components ?? []).map((c) => c.file).filter((f): f is string => !!f)] : [];
      const cand = candidateRouteFiles({ pathname: packet.route, routes, svelteFiles });
      packet.routeFiles = cand.files.slice(0, 20);
      if (cand.routeId) packet.framework = { ...(packet.framework ?? { name: 'sveltekit', dev: false }), routeId: cand.routeId };
    }
  }
  const max = opts.maxErrors ?? 10;
  const events = (opts.events ?? []).filter((e) => e.kind === 'error' || e.kind === 'console');
  const errs: LocatorError[] = [];
  for (const e of [...events].reverse()) {
    const x = errorOf(e);
    if (!x) continue;
    const m = await opts.mapper.mapStack(x.stack);
    // within the server's packet schema: long messages and stacks are cut, not refused
    errs.push({
      t: e.t,
      kind: x.kind,
      ...(x.type ? { type: x.type.slice(0, 100) } : {}),
      message: x.message.slice(0, 4000),
      ...(x.stack ? { stack: x.stack.slice(0, 20_000) } : {}),
      ...(m.frames.length ? { frames: m.frames.slice(0, 50) } : {}),
      mapped: m.mapped,
      ...(m.reason ? { reason: m.reason.slice(0, 200) } : {}),
    });
    if (errs.length >= max) break;
  }
  if (errs.length) packet.errors = errs.reverse();
  return packet;
}
