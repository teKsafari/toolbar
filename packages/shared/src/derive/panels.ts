// Panel models derived from the merged event list (events.json.gz): network, console, actions,
// markers and the event index. The shapes follow the API contract (ConsoleRow, NetworkEntry,
// action rows, markers, event index). Ported from the viewer area's packages/ui/src/viewer/derive.ts
// so the server (REST, MCP, markdown) and the viewer share one model (docs/parallel.md).
// Each row also carries `at`: its position on the player clock (time.ts).
import { REDACT_HEADER_RE } from '../constants.ts';
import type { CaptureEvent, ConsoleLevel, EventKind, EventOf, NetRequest, NetResponse, TargetRef } from '../events.ts';
import type { ConsoleRow, EventIndex, NetworkEntry, TimelineMarker } from '../api/index.ts';
import type { z } from 'zod';
import type { actionRowSchema } from '../api/index.ts';
import { fmtArgs, hostOf } from './format.ts';
import type { TimeMap } from './time.ts';

export type ActionRow = z.infer<typeof actionRowSchema>;
export type At<T> = T & { at: number };
export type ConsoleViewRow = At<ConsoleRow> & { status?: number | null; rid?: string; target?: TargetRef | null };
export type NetworkViewRow = At<NetworkEntry> & {
  frames: WsFrameRow[];
  /** ms since the first request, for the waterfall */
  startAt: number;
};
export type ActionViewRow = At<ActionRow>;
export interface WsFrameRow {
  at: number;
  t: number;
  op: 'open' | 'send' | 'recv' | 'close' | 'error' | 'message';
  data: string | null;
  event: string | null;
}

const LEVEL_OF: Partial<Record<ConsoleLevel, ConsoleRow['level']>> = {
  log: 'log',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
  trace: 'log',
  table: 'log',
  dir: 'log',
  group: 'log',
  groupCollapsed: 'log',
  assert: 'error',
  count: 'info',
  time: 'info',
  timeEnd: 'info',
};

const FRAME_RE = /at (?:(.+?) \()?((?:https?|file|chrome-extension):\/\/[^\s)]+):(\d+):(\d+)\)?/;

/** Top stack frame as a call-site link (J-056). */
export function topFrame(stack: string | undefined | null): ConsoleRow['source'] {
  if (!stack) return null;
  const m = stack.match(FRAME_RE);
  if (!m) return null;
  return { fn: m[1] ?? null, url: m[2]!, line: Number(m[3]), col: Number(m[4]) };
}

/** Pseudo tag for a click target, as in DevTools: <button data-testid="x">Text</button>. */
export function describeTarget(t: TargetRef | undefined | null): string {
  if (!t) return 'element';
  const attrs: string[] = [];
  if (t.elId) attrs.push(`id="${t.elId}"`);
  if (t.testId) attrs.push(`data-testid="${t.testId}"`);
  else if (t.classes?.length) attrs.push(`class="${t.classes.join(' ')}"`);
  const text = t.text ?? t.name ?? '';
  const open = `<${t.tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  return text ? `${open}${text.slice(0, 80)}</${t.tag}>` : open;
}

/** Every attribute we know for the chip that expands a click (J-067, J-108). */
export function targetAttributes(t: TargetRef | null | undefined): [string, string][] {
  if (!t) return [];
  const out: [string, string][] = [['selector', t.selector]];
  if (t.role) out.push(['role', t.role]);
  if (t.name) out.push(['name', t.name]);
  if (t.testId) out.push(['data-testid', t.testId]);
  if (t.elId) out.push(['id', t.elId]);
  if (t.classes?.length) out.push(['class', t.classes.join(' ')]);
  if (t.xpath) out.push(['xpath', t.xpath]);
  if (t.heading) out.push(['heading', t.heading]);
  if (t.landmarks?.length) out.push(['landmarks', t.landmarks.join(', ')]);
  return out;
}

function inputLabel(t: TargetRef | undefined): string {
  if (!t) return 'a field';
  return t.name ? `${t.tag}[name=${t.name}]` : t.selector;
}

const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

// ---------- network ----------

function typeOf(req: NetRequest | undefined, res: NetResponse | undefined, url: string): NetworkEntry['type'] {
  const ct = (res?.contentType ?? res?.headers?.['content-type'] ?? '').toLowerCase();
  switch (req?.initiator) {
    case 'fetch':
      return 'fetch';
    case 'xhr':
      return 'xhr';
    case 'beacon':
      return 'beacon';
    case 'document':
      return 'document';
  }
  const path = pathOf(url).split('?')[0]!.toLowerCase();
  if (ct.startsWith('image/') || req?.initiator === 'image' || /\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(path)) return 'image';
  if (ct.includes('javascript') || req?.initiator === 'script' || /\.m?js$/.test(path)) return 'script';
  if (ct.includes('css') || /\.css$/.test(path)) return 'stylesheet';
  if (ct.startsWith('font/') || /\.(woff2?|ttf|otf)$/.test(path)) return 'font';
  if (ct.startsWith('video/') || ct.startsWith('audio/') || /\.(mp4|webm|mp3|ogg|wav)$/.test(path)) return 'media';
  if (ct.includes('html')) return 'document';
  return 'other';
}

/** Error text from a failed JSON body, for marker pills (J-095). */
export function errorMessageOf(body: string | undefined | null): string | null {
  if (!body) return null;
  try {
    const j = JSON.parse(body) as unknown;
    const pick = (o: unknown): string | null => {
      if (typeof o === 'string') return o;
      if (o && typeof o === 'object') {
        const r = o as Record<string, unknown>;
        return pick(r.message) ?? pick(r.error) ?? pick(r.detail) ?? pick(r.title) ?? null;
      }
      return null;
    };
    return pick(j);
  } catch {
    return body.length < 200 ? body : null;
  }
}

const isRedacted = (name: string, value: string) => value === '[redacted]' || /\[redacted\]/i.test(value) || REDACT_HEADER_RE.test(name);

function graphqlOf(reqBody: string | undefined, resBody: string | undefined): NetworkEntry['graphql'] {
  if (!reqBody || !reqBody.includes('query')) return null;
  try {
    const q = JSON.parse(reqBody) as { query?: unknown; operationName?: unknown };
    if (typeof q.query !== 'string') return null;
    let hasErrors = false;
    try {
      hasErrors = Array.isArray((JSON.parse(resBody ?? '{}') as { errors?: unknown }).errors);
    } catch {
      /* not JSON */
    }
    const name = typeof q.operationName === 'string' ? q.operationName : (q.query.match(/(?:query|mutation|subscription)\s+(\w+)/)?.[1] ?? null);
    return { operationName: name, hasErrors };
  } catch {
    return null;
  }
}

/**
 * One row per request: net.req paired with net.res or net.fail by rid; a webRequest sighting of
 * a request the page hooks also saw (same method and URL within 50 ms) merges into it; WebSocket
 * and EventSource streams become one row each with their frames.
 */
export function deriveNetwork(events: readonly CaptureEvent[], map: TimeMap): NetworkViewRow[] {
  type Acc = { req: EventOf<'net.req'>; res?: EventOf<'net.res'>; fail?: EventOf<'net.fail'>; webReq?: EventOf<'net.req'>; webRes?: EventOf<'net.res'> };
  const byRid = new Map<string, Acc>();
  const order: Acc[] = [];
  const streams = new Map<string, { kind: 'ws' | 'sse'; first: CaptureEvent; url: string; frames: WsFrameRow[]; closed: boolean; error: boolean }>();
  const resByRid = new Map<string, EventOf<'net.res'>>();
  const failByRid = new Map<string, EventOf<'net.fail'>>();

  for (const e of events) {
    if (e.kind === 'net.res') resByRid.set(`${e.ctx}|${e.data.rid}`, e);
    else if (e.kind === 'net.fail') failByRid.set(`${e.ctx}|${e.data.rid}`, e);
  }
  const webOnly: EventOf<'net.req'>[] = [];
  for (const e of events) {
    if (e.kind === 'net.req') {
      const key = `${e.ctx}|${e.data.rid}`;
      if (e.data.source === 'webRequest') {
        webOnly.push(e);
        continue;
      }
      const acc: Acc = { req: e, res: resByRid.get(key), fail: failByRid.get(key) };
      byRid.set(key, acc);
      order.push(acc);
    } else if (e.kind === 'ws' || e.kind === 'sse') {
      const sid = `${e.kind}|${e.ctx}|${e.data.sid}`;
      let s = streams.get(sid);
      if (!s) {
        s = { kind: e.kind, first: e, url: e.data.url ?? '', frames: [], closed: false, error: false };
        streams.set(sid, s);
      }
      if (e.data.url && !s.url) s.url = e.data.url;
      const op = e.data.op;
      if (op === 'close') s.closed = true;
      if (op === 'error') s.error = true;
      s.frames.push({
        at: map.toPlayer(e.t),
        t: e.t,
        op,
        data: e.data.data ?? null,
        event: e.kind === 'sse' ? (e.data.event ?? null) : null,
      });
    }
  }
  // merge webRequest sightings into page rows
  for (const w of webOnly) {
    const twin = order.find((a) => !a.webReq && a.req.data.method === w.data.method && a.req.data.url === w.data.url && Math.abs(a.req.t - w.t) < 50);
    const key = `${w.ctx}|${w.data.rid}`;
    if (twin) {
      twin.webReq = w;
      twin.webRes = resByRid.get(key);
      if (!twin.fail && !twin.res) twin.fail = failByRid.get(key);
    } else {
      const acc: Acc = { req: w, res: resByRid.get(key), fail: failByRid.get(key) };
      order.push(acc);
    }
  }

  const rows: NetworkViewRow[] = [];
  for (const a of order) {
    const { req } = a;
    const res = a.res ?? a.webRes;
    const status = res?.data.status ?? null;
    const failed = !!a.fail || (status !== null && status >= 400);
    const state: NetworkEntry['state'] = a.fail ? 'failed' : res ? 'done' : 'pending';
    const reqHeaders = { ...(a.webReq?.data.headers ?? {}), ...(req.data.headers ?? {}) };
    const resHeaders = { ...(a.webRes?.data.headers ?? {}), ...(res?.data.headers ?? {}) };
    const redacted = [...Object.entries(reqHeaders), ...Object.entries(resHeaders)].filter(([k, v]) => isRedacted(k, v)).map(([k]) => k.toLowerCase());
    const timing = res?.data.timing;
    const end = timing?.end ?? res?.t ?? a.fail?.t ?? null;
    const startT = timing?.start ?? req.t;
    const body = res?.data.body;
    rows.push({
      rid: req.data.rid,
      index: 0,
      t: req.t,
      offsetMs: req.t - map.startedAt,
      at: map.toPlayer(req.t),
      startAt: 0,
      method: req.data.method.toUpperCase(),
      url: req.data.url,
      host: hostOf(req.data.url),
      path: pathOf(req.data.url),
      status,
      statusText: res?.data.statusText ?? null,
      state,
      error: a.fail?.data.error ?? null,
      errorMessage: failed ? (errorMessageOf(body) ?? a.fail?.data.error ?? null) : null,
      type: typeOf(req.data, res?.data, req.data.url),
      initiator: req.data.initiator ?? null,
      source: a.webReq ? 'both' : req.data.source,
      frame: req.ctx === 'sw' ? 'top' : req.ctx,
      tabId: (req.data as NetRequest & { tabId?: number }).tabId ?? null,
      durationMs: end !== null ? Math.max(0, end - startT) : null,
      size: res?.data.encodedSize ?? (body != null ? body.length : null),
      contentType: res?.data.contentType ?? resHeaders['content-type'] ?? null,
      timing: timing
        ? {
            dns: timing.dns ?? null,
            connect: timing.connect ?? null,
            ttfb: timing.ttfb ?? null,
            download: timing.ttfb != null ? Math.max(0, timing.end - timing.start - timing.ttfb) : null,
          }
        : null,
      requestHeaders: reqHeaders,
      responseHeaders: resHeaders,
      requestBody: req.data.body ?? null,
      responseBody: body ?? null,
      truncated: !!(res?.data.truncated || req.data.bodyTruncated),
      redacted: [...new Set(redacted)],
      graphql: graphqlOf(req.data.body, body),
      cors: /cors/i.test(a.fail?.data.error ?? ''),
      wsFrames: null,
      frames: [],
    });
  }
  for (const s of streams.values()) {
    const msgs = s.frames.filter((f) => f.op === 'send' || f.op === 'recv' || f.op === 'message').length;
    const last = s.frames[s.frames.length - 1]!;
    rows.push({
      rid: `${s.kind}:${s.first.ctx}:${(s.first.data as { sid: string }).sid}`,
      index: 0,
      t: s.first.t,
      offsetMs: s.first.t - map.startedAt,
      at: map.toPlayer(s.first.t),
      startAt: 0,
      method: 'GET',
      url: s.url,
      host: hostOf(s.url),
      path: pathOf(s.url),
      status: s.kind === 'ws' ? 101 : 200,
      statusText: s.kind === 'ws' ? 'Switching Protocols' : 'OK',
      state: s.error ? 'failed' : s.closed ? 'done' : 'pending',
      error: s.error ? 'stream error' : null,
      errorMessage: null,
      type: s.kind === 'ws' ? 'websocket' : 'eventsource',
      initiator: null,
      source: 'page',
      frame: s.first.ctx === 'sw' ? 'top' : s.first.ctx,
      tabId: null,
      durationMs: s.closed ? last.t - s.first.t : null,
      size: s.frames.reduce((n, f) => n + (f.data?.length ?? 0), 0),
      contentType: s.kind === 'sse' ? 'text/event-stream' : null,
      timing: null,
      requestHeaders: {},
      responseHeaders: {},
      requestBody: null,
      responseBody: null,
      truncated: false,
      redacted: [],
      graphql: null,
      cors: false,
      wsFrames: msgs,
      frames: s.frames,
    });
  }
  rows.sort((a, b) => a.t - b.t);
  const firstT = rows[0]?.t ?? 0;
  rows.forEach((r, i) => {
    r.index = i;
    r.startAt = r.t - firstT;
  });
  return rows;
}

export const isFailed = (r: Pick<NetworkEntry, 'state' | 'status'>) => r.state === 'failed' || (r.status !== null && r.status >= 400);

// ---------- console ----------

/**
 * The merged console timeline (J-102): console calls, uncaught errors, failed requests,
 * navigations, clicks, typing, and video start, pause, resume and stop (J-233).
 */
export function deriveConsole(events: readonly CaptureEvent[], map: TimeMap, network?: readonly NetworkViewRow[]): ConsoleViewRow[] {
  const rows: ConsoleViewRow[] = [];
  const base = (e: CaptureEvent) => ({ id: e.id, t: e.t, offsetMs: e.t - map.startedAt, at: map.toPlayer(e.t), args: undefined, stack: null, source: null, url: null, count: 1 });
  for (const e of events) {
    switch (e.kind) {
      case 'console': {
        const level = LEVEL_OF[e.data.level];
        if (!level) break;
        const first = e.data.args.find((a) => typeof a === 'object' && a !== null && (a as Record<string, unknown>).$t === 'error') as { stack?: string } | undefined;
        const stack = e.data.stack ?? first?.stack ?? null;
        rows.push({ ...base(e), kind: 'console', level, message: fmtArgs(e.data.args), args: e.data.args, stack, source: topFrame(stack), count: e.data.count ?? 1 });
        break;
      }
      case 'error': {
        const msg = e.data.type === 'unhandledrejection' ? `Uncaught (in promise) ${e.data.name ? e.data.name + ': ' : ''}${e.data.message}` : `Uncaught ${e.data.name ? e.data.name + ': ' : ''}${e.data.message}`;
        rows.push({
          ...base(e),
          kind: 'error',
          level: 'error',
          message: msg,
          stack: e.data.stack ?? null,
          source: topFrame(e.data.stack) ?? (e.data.src ? { url: e.data.src, line: e.data.line ?? 0, col: e.data.col ?? 0, fn: null } : null),
          url: e.data.src ?? null,
        });
        break;
      }
      case 'nav':
        rows.push({ ...base(e), kind: 'navigation', level: 'info', message: `${e.data.type === 'load' ? 'Page load' : 'Navigated'} to ${e.data.url}`, url: e.data.url });
        break;
      case 'user': {
        const d = e.data;
        if (d.type === 'click' || d.type === 'dblclick' || d.type === 'contextmenu') {
          const verb = d.type === 'click' ? 'Click' : d.type === 'dblclick' ? 'Double click' : 'Right click';
          rows.push({ ...base(e), kind: 'click', level: 'info', message: `${verb} on ${describeTarget(d.target)}`, target: d.target ?? null });
        } else if (d.type === 'input') {
          rows.push({ ...base(e), kind: 'input', level: 'info', message: `Typed ${d.masked ? 'masked text' : JSON.stringify(d.value ?? '')} into ${inputLabel(d.target)}`, target: d.target ?? null });
        } else if (d.type === 'key' && d.key) {
          rows.push({ ...base(e), kind: 'input', level: 'info', message: `Pressed ${[...(d.mods ?? []), d.key].join('+')}`, target: d.target ?? null });
        }
        break;
      }
      case 'media': {
        if (e.data.stream !== 'video' && e.data.stream !== 'screen') break;
        const words: Record<string, string> = { start: 'Video started', pause: 'Video paused', resume: 'Video resumed', stop: 'Video stopped' };
        const w = words[e.data.op];
        if (w) rows.push({ ...base(e), kind: 'media', level: 'info', message: w });
        break;
      }
      case 'shot':
        rows.push({ ...base(e), kind: 'media', level: 'info', message: 'Screenshot taken' });
        break;
    }
  }
  for (const n of network ?? []) {
    if (!isFailed(n) || n.type === 'websocket' || n.type === 'eventsource') continue;
    const what = n.status !== null ? `${n.status}${n.statusText ? ` (${n.statusText})` : ''}` : (n.error ?? 'failed');
    rows.push({
      id: `net:${n.rid}`,
      t: n.t,
      offsetMs: n.offsetMs,
      at: n.at,
      kind: 'network',
      level: 'error',
      message: `${n.method} ${n.url} ${what}`,
      stack: null,
      source: null,
      url: n.url,
      count: 1,
      status: n.status,
      rid: n.rid,
    });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

// ---------- actions ----------

export function deriveActions(events: readonly CaptureEvent[], map: TimeMap): ActionViewRow[] {
  const rows: ActionViewRow[] = [];
  for (const e of events) {
    const base = { id: e.id, t: e.t, offsetMs: e.t - map.startedAt, at: map.toPlayer(e.t) };
    if (e.kind === 'nav') {
      rows.push({ ...base, type: 'navigation', target: null, value: null, masked: false, key: null, url: e.data.url, cause: e.data.type });
    } else if (e.kind === 'user') {
      const d = e.data;
      if (d.type === 'scroll' || d.type === 'focus' || d.type === 'blur' || d.type === 'resize') continue;
      if (d.type === 'visibility') {
        rows.push({ ...base, type: 'visibility', target: null, value: d.visible === false ? 'hidden' : 'visible', masked: false, key: null, url: null, cause: null });
        continue;
      }
      rows.push({ ...base, type: d.type, target: d.target ?? null, value: d.value ?? null, masked: !!d.masked, key: d.key ?? null, url: null, cause: null });
    }
  }
  return rows;
}

// ---------- markers and index ----------

const GROUP_MS = 400;

/** Timeline markers (J-072): errors and failed requests grouped by moment, pen and blur marks, pauses. */
export function deriveMarkers(consoleRows: readonly ConsoleViewRow[], network: readonly NetworkViewRow[], events: readonly CaptureEvent[], map: TimeMap): (TimelineMarker & { at: number; items: string[] })[] {
  type M = TimelineMarker & { at: number; items: string[] };
  const out: M[] = [];
  const push = (kind: M['kind'], at: number, label: string, ref: string | null, status: number | null) => {
    const prev = [...out].reverse().find((m) => m.kind === kind);
    if (prev && (kind === 'error' || kind === 'net-fail') && at - prev.at <= GROUP_MS) {
      prev.count += 1;
      prev.items.push(label);
      if (status !== null && prev.status === null) prev.status = status;
      return;
    }
    out.push({ kind, offsetMs: map.toEpoch(at) - map.startedAt, at, label, ref, status, count: 1, items: [label] });
  };
  const errs = consoleRows.filter((r) => r.level === 'error' && r.kind !== 'network');
  const fails = network.filter((n) => isFailed(n) && n.type !== 'websocket' && n.type !== 'eventsource');
  const merged = [
    ...errs.map((r) => ({ at: r.at, f: () => push('error', r.at, r.message, r.id, null) })),
    ...fails.map((n) => ({ at: n.at, f: () => push('net-fail', n.at, n.errorMessage ? `${n.method} ${n.path}: ${n.errorMessage}` : `${n.method} ${n.path}`, `net:${n.rid}`, n.status) })),
  ].sort((a, b) => a.at - b.at);
  for (const m of merged) m.f();
  for (const e of events) {
    if (e.kind === 'marker') {
      const kind = e.data.type === 'mark' ? (e.data.label === 'blur' ? 'blur' : e.data.label === 'pen' ? 'pen' : 'mark') : 'voice';
      push(kind, map.toPlayer(e.t), e.data.label ?? kind, e.id, null);
    } else if (e.kind === 'media' && (e.data.op === 'pause' || e.data.op === 'resume') && (e.data.stream === 'video' || e.data.stream === 'screen')) {
      push(e.data.op, map.toPlayer(e.t), e.data.op === 'pause' ? 'Video paused' : 'Video resumed', e.id, null);
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

export function computeEventIndex(events: readonly CaptureEvent[], map: TimeMap): EventIndex {
  const counts: Partial<Record<EventKind, number>> = {};
  const consoleCounts: EventIndex['console'] = {};
  let clicks = 0;
  let inputs = 0;
  let keys = 0;
  let navigations = 0;
  let errors = 0;
  for (const e of events) {
    counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    if (e.kind === 'console') {
      consoleCounts[e.data.level] = (consoleCounts[e.data.level] ?? 0) + 1;
      if (e.data.level === 'error' || e.data.level === 'assert') errors++;
    } else if (e.kind === 'error') errors++;
    else if (e.kind === 'nav') navigations++;
    else if (e.kind === 'user') {
      if (e.data.type === 'click' || e.data.type === 'dblclick' || e.data.type === 'contextmenu') clicks++;
      else if (e.data.type === 'input') inputs++;
      else if (e.data.type === 'key') keys++;
    }
  }
  const net = deriveNetwork(events, map);
  const byClass: EventIndex['network']['byClass'] = {};
  for (const n of net) {
    if (n.status === null) continue;
    const c = `${Math.floor(n.status / 100)}xx` as keyof typeof byClass;
    byClass[c] = (byClass[c] ?? 0) + 1;
  }
  const consoleRows = deriveConsole(events, map, net);
  const markers = deriveMarkers(consoleRows, net, events, map).map(({ at: _at, items: _items, ...m }) => m);
  return {
    counts,
    console: consoleCounts,
    errors,
    network: {
      total: net.length,
      failed: net.filter((n) => isFailed(n)).length,
      pending: net.filter((n) => n.state === 'pending' && n.type !== 'websocket' && n.type !== 'eventsource').length,
      byClass,
    },
    user: { clicks, inputs, keys, navigations },
    markers,
    firstT: events[0]?.t ?? null,
    lastT: events[events.length - 1]?.t ?? null,
  };
}

// ---------- filters ----------

/** Network type chips (J-105). */
export const NETWORK_CHIPS = [
  { id: 'all', label: 'All', types: null },
  { id: 'fetch', label: 'Fetch/XHR', types: ['fetch', 'xhr', 'beacon'] },
  { id: 'ws', label: 'WS', types: ['websocket', 'eventsource'] },
  { id: 'js', label: 'JS', types: ['script'] },
  { id: 'css', label: 'CSS', types: ['stylesheet'] },
  { id: 'media', label: 'Media', types: ['image', 'media'] },
  { id: 'font', label: 'Font', types: ['font'] },
  { id: 'doc', label: 'Doc', types: ['document'] },
  { id: 'other', label: 'Other', types: ['other'] },
] as const satisfies readonly { id: string; label: string; types: readonly NetworkEntry['type'][] | null }[];
export type NetworkChip = (typeof NETWORK_CHIPS)[number]['id'];

export function filterNetwork(rows: readonly NetworkViewRow[], f: { chip: NetworkChip; q: string; errorsOnly: boolean }): NetworkViewRow[] {
  const chip = NETWORK_CHIPS.find((c) => c.id === f.chip);
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (chip?.types && !(chip.types as readonly string[]).includes(r.type)) return false;
    if (f.errorsOnly && !isFailed(r)) return false;
    if (q && !`${r.method} ${r.url} ${r.status ?? ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export type NetworkSortKey = 'index' | 'name' | 'method' | 'status' | 'domain' | 'type' | 'size' | 'time';
export function sortNetwork(rows: readonly NetworkViewRow[], key: NetworkSortKey, dir: 1 | -1): NetworkViewRow[] {
  const val = (r: NetworkViewRow): string | number => {
    switch (key) {
      case 'name':
        return r.path;
      case 'method':
        return r.method;
      case 'status':
        return r.status ?? (r.state === 'pending' ? -1 : 0);
      case 'domain':
        return r.host;
      case 'type':
        return r.type;
      case 'size':
        return r.size ?? -1;
      case 'time':
        return r.durationMs ?? Number.MAX_SAFE_INTEGER;
      default:
        return r.index;
    }
  };
  return rows.slice().sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return (x < y ? -1 : x > y ? 1 : a.index - b.index) * dir;
  });
}

export const CONSOLE_KIND_CHIPS = [
  { id: 'navigation', label: 'Navigations', kinds: ['navigation'] },
  { id: 'network', label: 'Network errors', kinds: ['network'] },
  { id: 'user', label: 'User activity', kinds: ['click', 'input'] },
] as const;
export type ConsoleKindChip = (typeof CONSOLE_KIND_CHIPS)[number]['id'];

export function filterConsole(rows: readonly ConsoleViewRow[], f: { q: string; levels: readonly ConsoleRow['level'][]; hidden: readonly ConsoleKindChip[] }): ConsoleViewRow[] {
  const q = f.q.trim().toLowerCase();
  const hiddenKinds = new Set<string>(CONSOLE_KIND_CHIPS.filter((c) => f.hidden.includes(c.id)).flatMap((c) => [...c.kinds]));
  return rows.filter((r) => {
    if (hiddenKinds.has(r.kind)) return false;
    if ((r.kind === 'console' || r.kind === 'error') && f.levels.length && !f.levels.includes(r.level)) return false;
    if (q && !r.message.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Chips only for kinds present (J-102). */
export function presentConsoleChips(rows: readonly ConsoleViewRow[]) {
  const kinds = new Set(rows.map((r) => r.kind));
  return CONSOLE_KIND_CHIPS.filter((c) => c.kinds.some((k) => kinds.has(k)));
}
