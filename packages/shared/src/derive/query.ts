// Paged, filtered reads over one capture's events: the model behind the REST event queries
// (GET /recordings/:id/{events,console,network,actions}), the MCP read tools and the CLI.
// Everything here is pure; the server loads events.json.gz and hands the array in.
import type { CaptureEvent } from '../events.ts';
import type { Page } from '../api/common.ts';
import type { ConsoleRow, NetworkEntry } from '../api/captures.ts';
import { buildTimeMap, type TimeMap } from './time.ts';
import {
  computeEventIndex,
  deriveActions,
  deriveConsole,
  deriveNetwork,
  isFailed,
  type ActionViewRow,
  type ConsoleViewRow,
  type NetworkViewRow,
  type WsFrameRow,
} from './panels.ts';

/** One capture's events with the derived panel models, computed once per request. */
export interface Prepared {
  events: CaptureEvent[];
  map: TimeMap;
  network: NetworkViewRow[];
  console: ConsoleViewRow[];
  actions: ActionViewRow[];
}

export function prepare(events: readonly CaptureEvent[], startedAt: number | null, hasVideo: boolean): Prepared {
  const sorted = [...events].sort((a, b) => a.t - b.t || (a.ctx < b.ctx ? -1 : a.ctx > b.ctx ? 1 : 0) || a.seq - b.seq);
  const map = buildTimeMap(sorted, startedAt, hasVideo);
  const network = deriveNetwork(sorted, map);
  return { events: sorted, map, network, console: deriveConsole(sorted, map, network), actions: deriveActions(sorted, map) };
}

export const indexOf = (p: Prepared) => computeEventIndex(p.events, p.map);

// ---------- paging ----------

/** Opaque cursor: the offset of the next item, base64url so callers do not do arithmetic on it. */
export function encodeCursor(offset: number): string {
  return btoa(`o:${offset}`).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor) return 0;
  try {
    const s = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    const m = /^o:(\d+)$/.exec(s);
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

export function pageItems<T>(items: readonly T[], q: { cursor?: string | null; limit?: number }): Page<T> {
  const start = decodeCursor(q.cursor);
  const limit = q.limit ?? 50;
  const slice = items.slice(start, start + limit);
  const next = start + slice.length;
  const hasMore = next < items.length;
  return { items: slice, total: items.length, returned: slice.length, hasMore, nextCursor: hasMore ? encodeCursor(next) : null };
}

// ---------- shared filters ----------

export interface Window {
  /** ms from capture start, inclusive */
  fromMs?: number;
  toMs?: number;
  q?: string;
}

const inWindow = (offsetMs: number, w: Window) => (w.fromMs === undefined || offsetMs >= w.fromMs) && (w.toMs === undefined || offsetMs <= w.toMs);
const hasText = (hay: string, q: string | undefined) => !q || hay.toLowerCase().includes(q.trim().toLowerCase());

/** Rows as the API and MCP return them: `videoMs` is the player position (seek target). */
type Out<T> = Omit<T, 'at'> & { videoMs: number };
function out<T extends { at: number }>(r: T): Out<T> {
  const { at, ...rest } = r;
  return { ...rest, videoMs: Math.round(at) };
}

// ---------- raw events ----------

export interface EventsQuery extends Window {
  kinds?: string[];
  ctx?: string;
  cursor?: string;
  limit?: number;
}

export function queryEvents(p: Prepared, q: EventsQuery) {
  const rows = p.events
    .filter((e) => (!q.kinds?.length || q.kinds.includes(e.kind)) && (!q.ctx || e.ctx === q.ctx))
    .map((e) => ({ offsetMs: e.t - p.map.startedAt, videoMs: Math.round(p.map.toPlayer(e.t)), event: e }))
    .filter((r) => inWindow(r.offsetMs, q) && hasText(JSON.stringify(r.event.data), q.q));
  return pageItems(rows, q);
}

// ---------- console ----------

export interface ConsoleQuery extends Window {
  levels?: ConsoleRow['level'][];
  kinds?: ConsoleRow['kind'][];
  cursor?: string;
  limit?: number;
}

export function queryConsole(p: Prepared, q: ConsoleQuery) {
  const rows = p.console
    .filter((r) => {
      if (q.kinds?.length && !q.kinds.includes(r.kind)) return false;
      if (q.levels?.length && !q.levels.includes(r.level)) return false;
      return inWindow(r.offsetMs, q) && hasText(r.message, q.q);
    })
    .map(({ target: _t, rid: _r, status: _s, ...r }) => out(r));
  return pageItems(rows, q);
}

// ---------- network ----------

export interface NetworkQuery extends Window {
  status?: ('1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'failed' | 'pending')[];
  types?: NetworkEntry['type'][];
  methods?: string[];
  hosts?: string[];
  /** none: no bodies; errors: bodies of failed rows only (the default); all */
  bodies?: 'none' | 'errors' | 'all';
  headers?: boolean;
  errorsOnly?: boolean;
  cursor?: string;
  limit?: number;
}

function statusClassOf(r: NetworkViewRow): string {
  if (r.state === 'pending' && r.status === null) return 'pending';
  if (r.state === 'failed' && r.status === null) return 'failed';
  return r.status !== null ? `${Math.floor(r.status / 100)}xx` : r.state;
}

export function networkMatches(r: NetworkViewRow, q: NetworkQuery): boolean {
  if (q.status?.length) {
    const c = statusClassOf(r);
    const ok = q.status.some((s) => s === c || (s === 'failed' && isFailed(r)));
    if (!ok) return false;
  }
  if (q.types?.length && !q.types.includes(r.type)) return false;
  if (q.methods?.length && !q.methods.map((m) => m.toUpperCase()).includes(r.method)) return false;
  if (q.hosts?.length && !q.hosts.some((h) => r.host === h || r.host.endsWith(`.${h}`) || r.host.split(':')[0] === h)) return false;
  if (q.errorsOnly && !isFailed(r)) return false;
  return inWindow(r.offsetMs, q) && hasText(`${r.method} ${r.url} ${r.status ?? ''} ${r.errorMessage ?? ''}`, q.q);
}

export type NetworkOut = Out<Omit<NetworkViewRow, 'frames' | 'startAt'>>;

export function shapeNetwork(r: NetworkViewRow, q: Pick<NetworkQuery, 'bodies' | 'headers'>): NetworkOut {
  const { frames: _f, startAt: _s, ...row } = r;
  const bodies = q.bodies ?? 'errors';
  const keepBody = bodies === 'all' || (bodies === 'errors' && isFailed(r));
  const shaped: Omit<NetworkViewRow, 'frames' | 'startAt'> = { ...row };
  if (!keepBody) {
    delete shaped.requestBody;
    delete shaped.responseBody;
  }
  if (!q.headers) {
    delete shaped.requestHeaders;
    delete shaped.responseHeaders;
  }
  return out(shaped);
}

export function queryNetwork(p: Prepared, q: NetworkQuery) {
  const rows = p.network.filter((r) => networkMatches(r, q)).map((r) => shapeNetwork(r, q));
  return pageItems(rows, q);
}

// ---------- WebSocket and SSE frames ----------

export interface FramesQuery {
  q?: string;
  direction?: 'send' | 'recv';
  cursor?: string;
  limit?: number;
}

/** Frames of one stream row; null when the rid names no WebSocket or EventSource row. */
export function querySocketFrames(p: Prepared, rid: string, q: FramesQuery) {
  const row = p.network.find((r) => r.rid === rid && (r.type === 'websocket' || r.type === 'eventsource'));
  if (!row) return null;
  const rows = row.frames
    .filter((f) => {
      if (q.direction === 'send' && f.op !== 'send') return false;
      if (q.direction === 'recv' && f.op !== 'recv' && f.op !== 'message') return false;
      return hasText(`${f.event ?? ''} ${f.data ?? ''}`, q.q);
    })
    .map((f: WsFrameRow) => ({
      t: f.t,
      offsetMs: f.t - p.map.startedAt,
      videoMs: Math.round(f.at),
      op: f.op,
      data: f.data,
      binary: f.binary,
      length: f.length ?? 0,
      event: f.event,
    }));
  return pageItems(rows, q);
}

// ---------- actions ----------

export interface ActionsQuery extends Window {
  types?: ActionViewRow['type'][];
  cursor?: string;
  limit?: number;
}

export function queryActions(p: Prepared, q: ActionsQuery) {
  const rows = p.actions
    .filter((r) => (!q.types?.length || q.types.includes(r.type)) && inWindow(r.offsetMs, q))
    .filter((r) => hasText(`${r.type} ${r.target?.selector ?? ''} ${r.target?.text ?? ''} ${r.target?.name ?? ''} ${r.value ?? ''} ${r.url ?? ''}`, q.q))
    .map(out);
  return pageItems(rows, q);
}
