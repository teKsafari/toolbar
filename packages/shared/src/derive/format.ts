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

/** One serialized console value as short text. Objects become one-line JSON (J-055). */
export function fmtValue(v: unknown, top = true): string {
  if (v === null) return 'null';
  if (typeof v === 'string') return top ? v : JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (isTagged(v)) return fmtTagged(v);
  if (Array.isArray(v)) return `[${v.map((x) => fmtValue(x, false)).join(', ')}]`;
  if (typeof v === 'object') {
    const parts = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${fmtValue(x, false)}`);
    return `{${parts.join(', ')}}`;
  }
  return String(v);
}

function fmtTagged(v: Tagged): string {
  switch (v[SERIALIZED_TAG]) {
    case 'error':
      return `${String(v.name ?? 'Error')}: ${String(v.message ?? '')}`;
    case 'node': {
      const t = v.target as { tag?: string; elId?: string; classes?: string[] } | undefined;
      return `<${t?.tag ?? 'node'}${t?.elId ? `#${t.elId}` : ''}${t?.classes?.length ? '.' + t.classes.join('.') : ''}>`;
    }
    case 'map':
    case 'set':
      return `${v[SERIALIZED_TAG] === 'map' ? 'Map' : 'Set'}(${String(v.size ?? '?')})`;
    case 'typed':
      return `${String(v.type)}(${String(v.length)})`;
    case 'fn':
      return `f ${String(v.name || 'anonymous')}()`;
    case 'date':
    case 'regexp':
      return String(v.value ?? '');
    case 'undefined':
      return 'undefined';
    case 'bigint':
      return `${String(v.value)}n`;
    case 'symbol':
      return `Symbol(${String(v.desc ?? '')})`;
    case 'cycle':
      return '[Circular]';
    case 'more':
      return `...${String(v.keys)} more`;
    case 'trunc':
      return `${String(v.head)}... (${String(v.bytes)} bytes)`;
    default:
      return JSON.stringify(v);
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
