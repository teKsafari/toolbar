// serialize(): turns console arguments into JSON-safe values (architecture s4).
// Depth 4, 100 keys, 10 KB per string, cycles marked, Error keeps name/message/stack, DOM nodes
// become a TargetRef, Map/Set/TypedArray summarized. Tagged values use SERIALIZED_TAG ("$t").
// Never throws: a getter that throws becomes a string describing the failure.
import { LIMITS } from '@toolbar/shared/constants';
import { SERIALIZED_TAG, type Serialized, type TargetRef } from '@toolbar/shared/events';

export interface SerializeOptions {
  depth?: number;
  keys?: number;
  stringBytes?: number;
  /** Describes DOM nodes; injected so this file runs without a DOM. */
  describeNode?: (n: unknown) => TargetRef | null;
}

const T = SERIALIZED_TAG;

function truncString(s: string, max: number): Serialized {
  if (s.length <= max) return s;
  return { [T]: 'trunc', head: s.slice(0, max), bytes: s.length };
}

function isNode(v: object): boolean {
  const n = v as { nodeType?: unknown; nodeName?: unknown };
  return typeof n.nodeType === 'number' && typeof n.nodeName === 'string';
}

export function serialize(value: unknown, opts: SerializeOptions = {}): Serialized {
  const maxDepth = opts.depth ?? LIMITS.serializeDepth;
  const maxKeys = opts.keys ?? LIMITS.serializeKeys;
  const maxStr = opts.stringBytes ?? LIMITS.stringBytes;
  const seen = new WeakSet<object>();

  const walk = (v: unknown, depth: number): Serialized => {
    switch (typeof v) {
      case 'string':
        return truncString(v, maxStr);
      case 'number':
        return Number.isFinite(v) ? v : { [T]: 'number', value: String(v) };
      case 'boolean':
        return v;
      case 'undefined':
        return { [T]: 'undefined' };
      case 'bigint':
        return { [T]: 'bigint', value: v.toString() };
      case 'symbol':
        return { [T]: 'symbol', desc: v.description ?? '' };
      case 'function':
        return { [T]: 'fn', name: (v as { name?: string }).name || 'anonymous' };
    }
    if (v === null) return null;
    const o = v as object;
    if (seen.has(o)) return { [T]: 'cycle' };

    if (o instanceof Error || (typeof (o as Error).message === 'string' && typeof (o as Error).stack === 'string')) {
      const e = o as Error & { cause?: unknown };
      const out: { [k: string]: Serialized } = { [T]: 'error', name: String(e.name ?? 'Error'), message: truncString(String(e.message ?? ''), maxStr) };
      if (typeof e.stack === 'string') out.stack = truncString(e.stack, maxStr);
      if (e.cause !== undefined && depth < maxDepth) {
        seen.add(o);
        out.cause = walk(e.cause, depth + 1);
      }
      return out;
    }
    if (isNode(o)) {
      const target = opts.describeNode?.(o) ?? null;
      const n = o as unknown as { nodeName: string };
      return target ? { [T]: 'node', target: target as unknown as Serialized } : { [T]: 'node', name: n.nodeName.toLowerCase() };
    }
    if (o instanceof Date) return Number.isNaN(o.getTime()) ? { [T]: 'date', value: 'Invalid Date' } : { [T]: 'date', value: o.toISOString() };
    if (o instanceof RegExp) return { [T]: 'regexp', value: String(o) };
    if (ArrayBuffer.isView(o) || o instanceof ArrayBuffer) {
      const name = o.constructor?.name ?? 'ArrayBuffer';
      const length = o instanceof ArrayBuffer ? o.byteLength : (o as unknown as { length?: number }).length ?? (o as ArrayBufferView).byteLength;
      return { [T]: 'typed', type: name, length };
    }
    if (depth >= maxDepth) {
      if (Array.isArray(o)) return { [T]: 'more', kind: 'array', length: o.length };
      return { [T]: 'more', kind: 'object', name: ctorName(o) };
    }
    seen.add(o);
    try {
      if (o instanceof Map) {
        const entries: Serialized[] = [];
        let i = 0;
        for (const [k, x] of o) {
          if (i++ >= maxKeys) break;
          entries.push([walk(k, depth + 1), walk(x, depth + 1)]);
        }
        return { [T]: 'map', size: o.size, entries };
      }
      if (o instanceof Set) {
        const entries: Serialized[] = [];
        let i = 0;
        for (const x of o) {
          if (i++ >= maxKeys) break;
          entries.push(walk(x, depth + 1));
        }
        return { [T]: 'set', size: o.size, entries };
      }
      if (Array.isArray(o)) {
        const out: Serialized[] = [];
        for (let i = 0; i < Math.min(o.length, maxKeys); i++) out.push(safeGet(() => walk(o[i], depth + 1)));
        if (o.length > maxKeys) out.push({ [T]: 'more', keys: o.length - maxKeys });
        return out;
      }
      if (typeof (o as Promise<unknown>).then === 'function') return { [T]: 'promise' };
      const out: { [k: string]: Serialized } = {};
      let keys: string[];
      try {
        keys = Object.keys(o);
      } catch {
        keys = [];
      }
      for (let i = 0; i < Math.min(keys.length, maxKeys); i++) {
        const k = keys[i]!;
        out[k === T ? `${T}_` : k] = safeGet(() => walk((o as Record<string, unknown>)[k], depth + 1));
      }
      if (keys.length > maxKeys) out[T + 'more'] = { [T]: 'more', keys: keys.length - maxKeys };
      return out;
    } finally {
      seen.delete(o);
    }
  };

  return walk(value, 0);
}

function safeGet(fn: () => Serialized): Serialized {
  try {
    return fn();
  } catch (e) {
    return { [T]: 'throws', message: e instanceof Error ? e.message : String(e) };
  }
}

function ctorName(o: object): string {
  try {
    return (Object.getPrototypeOf(o)?.constructor?.name as string | undefined) ?? 'Object';
  } catch {
    return 'Object';
  }
}

/** One-line text of serialized args, as a console row shows them (J-055). */
export function formatArgs(args: Serialized[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a && typeof a === 'object' && !Array.isArray(a) && (a as Record<string, unknown>)[T] === 'error') {
        const e = a as Record<string, Serialized>;
        return `${String(e.name)}: ${String(e.message)}`;
      }
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}
