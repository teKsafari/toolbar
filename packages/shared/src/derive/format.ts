// Formatting helpers for the capture page: clock times, sizes, durations, console values.
import { SERIALIZED_TAG } from '../events.ts';

/** m:ss for the panels and the seek bar; negative values (logs before a screenshot) get a minus. */
export function fmtClock(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  const neg = ms < 0 && s > 0;
  const m = Math.floor(s / 60);
  const out = `${m}:${String(s % 60).padStart(2, '0')}`;
  return neg ? `-${out}` : out;
}

/** m:ss.cc, used by the share-at-time pill (two decimals, J-097). */
export function fmtClockPrecise(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  const rest = (s - m * 60).toFixed(2).padStart(5, '0');
  return `${m}:${rest}`;
}

/** Seconds with at most two decimals, for ?t= links. */
export function secondsParam(ms: number): string {
  return String(Math.round(Math.max(0, ms) / 10) / 100);
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  return fmtClock(ms);
}

/** Wall-clock time with milliseconds (hovering a row time, J-103). */
export function fmtWallMs(t: number, timeZone?: string): string {
  const d = new Date(t);
  const base = d.toLocaleTimeString('en-GB', { hour12: false, timeZone });
  return `${base}.${String(Math.floor(t % 1000)).padStart(3, '0')}`;
}

export type ZoneChoice = 'capture' | 'local' | 'utc';

/** Full timestamp for the info tab in the chosen zone (J-101). */
export function fmtTimestamp(t: number, zone: ZoneChoice, captureTz?: string): string {
  const timeZone = zone === 'utc' ? 'UTC' : zone === 'capture' ? captureTz : undefined;
  try {
    const s = new Date(t).toLocaleString('en-GB', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    });
    return s;
  } catch {
    return new Date(t).toISOString();
  }
}

type Tagged = { [SERIALIZED_TAG]: string; [k: string]: unknown };
const isTagged = (v: unknown): v is Tagged =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as Record<string, unknown>)[SERIALIZED_TAG] === 'string';

/**
 * One serialized console value as short text, the way a browser console prints it (J-055,
 * J-056). Objects become one line; tagged values (SERIALIZED_TAG) print as readable values, never
 * as their wire form: a Date as its ISO string, a RegExp as its source, a Map as Map(n) {k => v}.
 */
export function fmtValue(v: unknown, top = true): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return top ? v : JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isTagged(v)) return fmtTagged(v, top);
  if (Array.isArray(v)) return `[${v.map((x) => fmtValue(x, false)).join(', ')}]`;
  if (typeof v === 'object') {
    const parts: string[] = [];
    let more: unknown = null;
    for (const [k0, x] of Object.entries(v as Record<string, unknown>)) {
      // the serializer renames an own "$t" key to "$t_" and puts the key-cap marker under "$tmore"
      if (k0 === `${SERIALIZED_TAG}more`) {
        more = x;
        continue;
      }
      const k = k0 === `${SERIALIZED_TAG}_` ? SERIALIZED_TAG : k0;
      parts.push(`${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${fmtValue(x, false)}`);
    }
    if (more) parts.push(fmtValue(more, false));
    return `{${parts.join(', ')}}`;
  }
  return String(v);
}

function fmtTagged(v: Tagged, top: boolean): string {
  switch (v[SERIALIZED_TAG]) {
    case 'error':
      return `${String(v.name ?? 'Error')}: ${String(v.message ?? '')}`;
    case 'node': {
      const t = v.target as { tag?: string; elId?: string; classes?: string[] } | undefined;
      return `<${t?.tag ?? (typeof v.name === 'string' ? v.name : 'node')}${t?.elId ? `#${t.elId}` : ''}${t?.classes?.length ? '.' + t.classes.join('.') : ''}>`;
    }
    case 'map':
    case 'set': {
      const name = `${v[SERIALIZED_TAG] === 'map' ? 'Map' : 'Set'}(${String(v.size ?? '?')})`;
      const entries = Array.isArray(v.entries) ? v.entries : null;
      if (!entries) return name;
      const items =
        v[SERIALIZED_TAG] === 'map'
          ? entries.map((e) => (Array.isArray(e) ? `${fmtValue(e[0], false)} => ${fmtValue(e[1], false)}` : fmtValue(e, false)))
          : entries.map((e) => fmtValue(e, false));
      if (typeof v.size === 'number' && v.size > entries.length) items.push(`...${v.size - entries.length} more`);
      return `${name} {${items.join(', ')}}`;
    }
    case 'typed':
      return `${String(v.type)}(${String(v.length)})`;
    case 'fn':
      return `f ${String(v.name || 'anonymous')}()`;
    case 'date':
    case 'regexp':
      return String(v.value ?? '');
    case 'number':
      return String(v.value ?? 'NaN');
    case 'undefined':
      return 'undefined';
    case 'bigint':
      return `${String(v.value)}n`;
    case 'symbol':
      return `Symbol(${String(v.desc ?? '')})`;
    case 'promise':
      return 'Promise';
    case 'throws':
      return `[Exception: ${String(v.message ?? '')}]`;
    case 'cycle':
      return '[Circular]';
    case 'more':
      // depth cap: Array(3) or Object {...}; key cap: ...12 more
      if (v.kind === 'array') return `Array(${String(v.length ?? '?')})`;
      if (v.kind === 'object') return `${String(v.name ?? 'Object')} {...}`;
      return `...${String(v.keys)} more`;
    case 'trunc':
      return top ? `${String(v.head)}... (${String(v.bytes)} bytes)` : `${JSON.stringify(String(v.head))}... (${String(v.bytes)} bytes)`;
    default: {
      // an unknown tag: its fields without the tag, never the wire form
      const rest = Object.entries(v).filter(([k]) => k !== SERIALIZED_TAG);
      return `${String(v[SERIALIZED_TAG])} {${rest.map(([k, x]) => `${k}: ${fmtValue(x, false)}`).join(', ')}}`;
    }
  }
}

export function fmtArgs(args: readonly unknown[]): string {
  return args.map((a) => fmtValue(a)).join(' ');
}

/** Pretty JSON when the text parses, else the text itself. */
export function prettyBody(text: string | null | undefined): { text: string; json: boolean } {
  if (text == null) return { text: '', json: false };
  try {
    return { text: JSON.stringify(JSON.parse(text), null, 2), json: true };
  } catch {
    return { text, json: false };
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}
