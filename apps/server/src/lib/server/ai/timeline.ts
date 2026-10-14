// A compact timeline of a capture's events for the summarizer: user actions, navigations,
// console errors and warnings, page errors, failed requests and markers, with times from the
// recording start. Masked values stay masked; long text is cut.
import type { CaptureEvent, Serialized, TargetRef } from '@toolbar/shared';

const MAX_LINES = 160;
const MAX_TEXT = 160;

const cut = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function clockOf(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function argText(a: Serialized): string {
  if (a === null) return 'null';
  if (typeof a === 'string') return a;
  if (typeof a === 'number' || typeof a === 'boolean') return String(a);
  if (Array.isArray(a)) return `[${a.map(argText).join(', ')}]`;
  const o = a as Record<string, Serialized>;
  if (o.$t === 'error') return `${o.name ?? 'Error'}: ${o.message ?? ''}`;
  if (o.$t === 'trunc') return String(o.head ?? '');
  if (o.$t) return `<${String(o.$t)}>`;
  try {
    return JSON.stringify(o);
  } catch {
    return '{...}';
  }
}

function target(t: TargetRef | undefined): string {
  if (!t) return 'the page';
  const label = t.name || t.text || t.testId || t.elId || t.selector;
  return `${t.role ?? t.tag} "${cut(oneLine(label ?? ''), 60)}"`;
}

function path(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Lines like "[0:03] clicked button "Place order"". */
export function buildTimeline(events: CaptureEvent[], t0: number): string[] {
  const reqs = new Map<string, { method: string; url: string }>();
  const out: string[] = [];
  const push = (t: number, s: string) => out.push(`[${clockOf(t - t0)}] ${cut(oneLine(s))}`);
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    switch (e.kind) {
      case 'nav':
        if (e.data.type !== 'replaceState') push(e.t, `navigated to ${path(e.data.url)}${e.data.title ? ` (${e.data.title})` : ''}`);
        break;
      case 'user': {
        const d = e.data;
        if (d.type === 'click' || d.type === 'dblclick') push(e.t, `clicked ${target(d.target)}`);
        else if (d.type === 'input') push(e.t, `typed ${d.masked ? '(masked)' : `"${cut(d.value ?? '', 60)}"`} into ${target(d.target)}`);
        else if (d.type === 'key' && (d.key === 'Enter' || d.key === 'Escape')) push(e.t, `pressed ${d.mods?.length ? `${d.mods.join('+')}+` : ''}${d.key}`);
        else if (d.type === 'select') push(e.t, `selected "${cut(d.value ?? '', 60)}" in ${target(d.target)}`);
        break;
      }
      case 'console':
        if (e.data.level === 'error' || e.data.level === 'warn' || e.data.level === 'assert') push(e.t, `console.${e.data.level}: ${e.data.args.map(argText).join(' ')}`);
        break;
      case 'error':
        push(e.t, `uncaught ${e.data.type === 'unhandledrejection' ? 'promise rejection' : 'error'}: ${e.data.name ? `${e.data.name}: ` : ''}${e.data.message}`);
        break;
      case 'net.req':
        reqs.set(e.data.rid, { method: e.data.method, url: e.data.url });
        break;
      case 'net.res': {
        if (e.data.status < 400) break;
        const r = reqs.get(e.data.rid);
        const body = e.data.body ? ` ${cut(oneLine(e.data.body), 100)}` : '';
        push(e.t, `request ${r ? `${r.method} ${path(r.url)}` : e.data.rid} failed with ${e.data.status}${e.data.statusText ? ` ${e.data.statusText}` : ''}${body}`);
        break;
      }
      case 'net.fail': {
        const r = reqs.get(e.data.rid);
        push(e.t, `request ${r ? `${r.method} ${path(r.url)}` : e.data.rid} failed: ${e.data.error}`);
        break;
      }
      case 'marker':
        if (e.data.type === 'mark') push(e.t, `reviewer marked this moment${e.data.label ? `: ${e.data.label}` : ''}`);
        break;
      default:
        break;
    }
  }
  if (out.length <= MAX_LINES) return out;
  // keep the start and the end, where the bug usually is
  return [...out.slice(0, 40), `... ${out.length - MAX_LINES} lines left out ...`, ...out.slice(out.length - (MAX_LINES - 41))];
}

/** Plain text of a WebVTT transcript. */
export function vttText(vtt: string | null | undefined): string | null {
  if (!vtt) return null;
  const lines = vtt
    .split(/\r?\n/)
    .filter((l) => l && l !== 'WEBVTT' && !/^\d+$/.test(l) && !l.includes('-->') && !/^NOTE\b/.test(l));
  const s = lines.join(' ').trim();
  return s || null;
}
