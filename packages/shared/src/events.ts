// Capture event schema (docs/architecture.md section 4).
// One envelope for every captured signal. NDJSON on the wire, gzip per chunk.

/** Epoch ms with sub-ms precision: performance.timeOrigin + performance.now(). */
export type Ms = number;

export const SCHEMA_VERSION = 1 as const;

export interface Envelope<K extends string, D> {
  v: typeof SCHEMA_VERSION;
  /** `${ctx}:${seq}`, unique within a recording. */
  id: string;
  /** Capture context: frame id ("top", "f3"), "sw" (service worker), "off" (offscreen). */
  ctx: string;
  /** Monotonic per ctx; gaps mean lost events. */
  seq: number;
  t: Ms;
  kind: K;
  data: D;
  /** Browser tab id, stamped by the service worker (desktop recordings span tabs, J-224). */
  tab?: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Attached to user, annotation and shot events; also the Part 2 locator packet. */
export interface TargetRef {
  selector: string;
  xpath?: string;
  rrwebId?: number;
  tag: string;
  role?: string;
  name?: string;
  text?: string;
  testId?: string;
  elId?: string;
  classes?: string[];
  rect: Rect;
  landmarks?: string[];
  heading?: string;
  /** A few attributes for the pseudo tag in action rows (J-067): type, name, href, aria-label, value (masked). */
  attrs?: Record<string, string>;
  /** Frame context of the element ("top" or a frame ctx). */
  frame?: string;
}

/** Output of serialize(): plain JSON plus tagged objects for values JSON cannot hold. */
export type Serialized =
  | null
  | boolean
  | number
  | string
  | Serialized[]
  | { [k: string]: Serialized };

/**
 * Values JSON cannot hold are tagged objects with key SERIALIZED_TAG ("$t"):
 * { $t: 'error', name, message, stack? }, { $t: 'node', target: TargetRef },
 * { $t: 'map' | 'set', size, entries }, { $t: 'typed', type, length }, { $t: 'fn', name },
 * { $t: 'undefined' }, { $t: 'bigint', value }, { $t: 'symbol', desc }, { $t: 'cycle' },
 * { $t: 'more', keys } (key cap hit), { $t: 'trunc', head, bytes } (string cap hit).
 */
export const SERIALIZED_TAG = '$t';
export type SerializedTag =
  | 'error'
  | 'node'
  | 'map'
  | 'set'
  | 'typed'
  | 'fn'
  | 'undefined'
  | 'bigint'
  | 'symbol'
  | 'cycle'
  | 'more'
  | 'trunc'
  | 'date'
  | 'regexp'
  | 'number'
  | 'promise'
  | 'throws';

export type MaskingPreset = 'staging' | 'production' | 'none';

export interface EnvInfo {
  ua: string;
  platform?: string;
  browser?: { name: string; version: string };
  os?: { name: string; version?: string };
  viewport: { w: number; h: number };
  screen?: { w: number; h: number };
  dpr: number;
  locale?: string;
  tz?: string;
  extVersion?: string;
  maskingPreset?: MaskingPreset;
  url?: string;
  title?: string;
  connection?: { effectiveType?: string; downlink?: number; rtt?: number };
  incognito?: boolean;
  battery?: { level: number; charging: boolean };
  /** Logical cores and device memory (GB), when the browser exposes them. */
  cores?: number;
  memory?: number;
  touch?: boolean;
  /** Who produced the env record: the page (isolated world) or the service worker. */
  source?: 'page' | 'sw';
  /** ISO 3166-1 alpha-2 country (J-070). The extension derives it from `tz`; the server may replace it from the request IP. */
  country?: string;
  countrySource?: 'tz' | 'ip';
}

export type NavType = 'load' | 'pushState' | 'replaceState' | 'popstate' | 'hashchange' | 'bfcache';
/** Why a full load happened (J-069), from the navigation timing entry and the referrer. */
export type NavCause = 'reload' | 'typed' | 'link' | 'back_forward' | 'form' | 'other';
export interface Nav {
  type: NavType;
  url: string;
  from?: string;
  title?: string;
  /** Full loads only. */
  cause?: NavCause;
}

export const CONSOLE_LEVELS = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'trace',
  'table',
  'dir',
  'group',
  'groupCollapsed',
  'groupEnd',
  'assert',
  'count',
  'time',
  'timeEnd',
  'clear',
] as const;
export type ConsoleLevel = (typeof CONSOLE_LEVELS)[number];

export interface ConsoleEntry {
  level: ConsoleLevel;
  args: Serialized[];
  stack?: string;
  count?: number;
}

export interface PageError {
  type: 'error' | 'unhandledrejection' | 'resource' | 'csp';
  message: string;
  name?: string;
  stack?: string;
  src?: string;
  line?: number;
  col?: number;
}

export type Headers = Record<string, string>;
export type NetSource = 'page' | 'webRequest';
export type NetInitiator =
  | 'fetch'
  | 'xhr'
  | 'beacon'
  | 'document'
  | 'script'
  | 'image'
  | 'other'
  | 'stylesheet'
  | 'font'
  | 'media'
  | 'websocket'
  | 'eventsource'
  | 'subdocument'
  | 'ping';

export interface NetRequest {
  rid: string;
  method: string;
  url: string;
  headers?: Headers;
  body?: string;
  bodyTruncated?: boolean;
  initiator?: NetInitiator;
  source: NetSource;
  /** GraphQL operation in the request body (J-064). */
  graphql?: { operationName: string | null };
  /** Chrome's frame id from webRequest (0 is the top frame). */
  frameId?: number;
  /** Page origin that issued the request (webRequest `initiator`). */
  origin?: string;
  /** Browser tab id, set on desktop recordings that follow several tabs (J-224). */
  tabId?: number;
}

export interface NetTiming {
  start: Ms;
  dns?: number;
  connect?: number;
  ttfb?: number;
  end: Ms;
}

export interface NetResponse {
  rid: string;
  status: number;
  statusText?: string;
  headers?: Headers;
  body?: string;
  truncated?: boolean;
  contentType?: string;
  encodedSize?: number;
  timing?: NetTiming;
  source?: NetSource;
  /** Count of entries in a GraphQL `errors` array at any HTTP status (J-064). */
  graphqlErrors?: number;
  fromCache?: boolean;
  /** Response body was binary; only its size is kept (J-066). */
  binary?: boolean;
}

export interface NetFailure {
  rid: string;
  /** 'net::ERR_*', 'abort', 'timeout' or 'cors'. */
  error: string;
  /** The browser blocked the response by CORS (J-065). */
  cors?: boolean;
  source?: NetSource;
}

export interface WsEvent {
  sid: string;
  op: 'open' | 'send' | 'recv' | 'close' | 'error';
  url?: string;
  data?: string;
  truncated?: boolean;
  code?: number;
  reason?: string;
  /** Binary frame: `data` is absent and `length` holds its size (J-066). */
  binary?: boolean;
  /** Payload length in bytes (UTF-8 for text). */
  length?: number;
  protocol?: string;
}

export interface SseEvent {
  sid: string;
  op: 'open' | 'message' | 'error' | 'close';
  url?: string;
  event?: string;
  data?: string;
  lastEventId?: string;
}

export type UserEventType =
  | 'click'
  | 'dblclick'
  | 'contextmenu'
  | 'input'
  | 'key'
  | 'scroll'
  | 'focus'
  | 'blur'
  | 'select'
  | 'resize'
  | 'visibility';

export interface UserEvent {
  type: UserEventType;
  target?: TargetRef;
  /** Committed input value, masked per preset. */
  value?: string;
  masked?: boolean;
  key?: string;
  mods?: ('ctrl' | 'shift' | 'alt' | 'meta')[];
  x?: number;
  y?: number;
  scroll?: { x: number; y: number };
  visible?: boolean;
}

export interface DomSummary {
  added: number;
  removed: number;
  attrs: number;
  text: number;
  /** At most five changed-region rects. */
  rects: Rect[];
}

export interface RrwebRef {
  chunk: number;
  first: Ms;
  last: Ms;
}

export type MediaStreamName = 'video' | 'mic' | 'cam' | 'screen';
export interface MediaEvent {
  stream: MediaStreamName;
  op: 'start' | 'pause' | 'resume' | 'stop' | 'segment';
  mime?: string;
  width?: number;
  height?: number;
  /** Microphone state after a mute, unmute or device switch (J-211). */
  mic?: 'off' | 'on' | 'muted' | 'denied';
  deviceId?: string;
  /** Replay video segment index. */
  segment?: number;
}

export interface Shot {
  assetId: string;
  rect?: Rect;
  reason: 'user' | 'keyframe';
  target?: TargetRef;
}

export interface AnnotationRef {
  annotationId: string;
  op: 'create' | 'update' | 'delete';
}

export interface Marker {
  type: 'mark' | 'voice.start' | 'voice.end' | 'pen' | 'blur' | 'screenshot';
  label?: string;
}

export interface EventDataMap {
  env: EnvInfo;
  nav: Nav;
  console: ConsoleEntry;
  error: PageError;
  'net.req': NetRequest;
  'net.res': NetResponse;
  'net.fail': NetFailure;
  ws: WsEvent;
  sse: SseEvent;
  user: UserEvent;
  dom: DomSummary;
  rrweb: RrwebRef;
  media: MediaEvent;
  shot: Shot;
  annotation: AnnotationRef;
  marker: Marker;
}

export type EventKind = keyof EventDataMap;

export const EVENT_KINDS = [
  'env',
  'nav',
  'console',
  'error',
  'net.req',
  'net.res',
  'net.fail',
  'ws',
  'sse',
  'user',
  'dom',
  'rrweb',
  'media',
  'shot',
  'annotation',
  'marker',
] as const satisfies readonly EventKind[];

export type CaptureEvent = { [K in EventKind]: Envelope<K, EventDataMap[K]> }[EventKind];
export type EventOf<K extends EventKind> = Envelope<K, EventDataMap[K]>;

/** Builds envelopes for one context with a monotonic seq. */
export function createEmitter(ctx: string, now: () => Ms = defaultNow) {
  let seq = 0;
  return function make<K extends EventKind>(kind: K, data: EventDataMap[K]): EventOf<K> {
    const s = seq++;
    return { v: SCHEMA_VERSION, id: `${ctx}:${s}`, ctx, seq: s, t: now(), kind, data };
  };
}

function defaultNow(): Ms {
  return typeof performance !== 'undefined' ? performance.timeOrigin + performance.now() : Date.now();
}

/** Sort by time, then context and seq, so merges from several producers are stable. */
export function compareEvents(a: CaptureEvent, b: CaptureEvent): number {
  return a.t - b.t || (a.ctx < b.ctx ? -1 : a.ctx > b.ctx ? 1 : 0) || a.seq - b.seq;
}

export function toNdjson(events: readonly CaptureEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '');
}

export function fromNdjson(text: string): unknown[] {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as unknown);
}
