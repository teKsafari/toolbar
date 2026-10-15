// zod schemas for the capture events and the API DTOs.
// The server validates every request body with these; the extension may use them in tests.
import { z } from 'zod';
import { EVENT_KINDS, SCHEMA_VERSION, type CaptureEvent } from './events.ts';
import { RECORDING_KINDS, RECORDING_STATUSES, SHARE_ACCESS, STREAM_NAMES, ASSET_KINDS, LIMITS } from './constants.ts';

// ---------- building blocks ----------

export const rectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });

export const targetRefSchema = z.object({
  selector: z.string(),
  xpath: z.string().optional(),
  rrwebId: z.number().int().optional(),
  tag: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().max(500).optional(),
  testId: z.string().optional(),
  elId: z.string().optional(),
  classes: z.array(z.string()).optional(),
  rect: rectSchema,
  landmarks: z.array(z.string()).optional(),
  heading: z.string().optional(),
  attrs: z.record(z.string(), z.string()).optional(),
  frame: z.string().optional(),
});

const headersSchema = z.record(z.string(), z.string());
const serializedSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(serializedSchema), z.record(z.string(), serializedSchema)]),
);

export const envInfoSchema = z.object({
  ua: z.string(),
  platform: z.string().optional(),
  browser: z.object({ name: z.string(), version: z.string() }).optional(),
  os: z.object({ name: z.string(), version: z.string().optional() }).optional(),
  viewport: z.object({ w: z.number(), h: z.number() }),
  screen: z.object({ w: z.number(), h: z.number() }).optional(),
  dpr: z.number().positive(),
  locale: z.string().optional(),
  tz: z.string().optional(),
  extVersion: z.string().optional(),
  maskingPreset: z.enum(['staging', 'production', 'none']).optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  connection: z
    .object({ effectiveType: z.string().optional(), downlink: z.number().optional(), rtt: z.number().optional() })
    .optional(),
  incognito: z.boolean().optional(),
  battery: z.object({ level: z.number(), charging: z.boolean() }).optional(),
  cores: z.number().optional(),
  memory: z.number().optional(),
  touch: z.boolean().optional(),
  source: z.enum(['page', 'sw']).optional(),
  /** ISO 3166-1 alpha-2 country; the client derives it from the time zone, the server may replace it from the request IP. */
  country: z.string().length(2).optional(),
  countrySource: z.enum(['tz', 'ip']).optional(),
});

export const eventDataSchemas = {
  env: envInfoSchema,
  nav: z.object({
    type: z.enum(['load', 'pushState', 'replaceState', 'popstate', 'hashchange', 'bfcache']),
    url: z.string(),
    from: z.string().optional(),
    title: z.string().optional(),
    cause: z.enum(['reload', 'typed', 'link', 'back_forward', 'form', 'other']).optional(),
  }),
  console: z.object({
    level: z.enum([
      'log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir', 'group', 'groupCollapsed',
      'groupEnd', 'assert', 'count', 'time', 'timeEnd', 'clear',
    ]),
    args: z.array(serializedSchema),
    stack: z.string().optional(),
    count: z.number().optional(),
  }),
  error: z.object({
    type: z.enum(['error', 'unhandledrejection', 'resource', 'csp']),
    message: z.string(),
    name: z.string().optional(),
    stack: z.string().optional(),
    src: z.string().optional(),
    line: z.number().optional(),
    col: z.number().optional(),
  }),
  'net.req': z.object({
    rid: z.string(),
    method: z.string(),
    url: z.string(),
    headers: headersSchema.optional(),
    body: z.string().optional(),
    bodyTruncated: z.boolean().optional(),
    initiator: z
      .enum(['fetch', 'xhr', 'beacon', 'document', 'script', 'image', 'other', 'stylesheet', 'font', 'media', 'websocket', 'eventsource', 'subdocument', 'ping'])
      .optional(),
    source: z.enum(['page', 'webRequest']),
    graphql: z.object({ operationName: z.string().nullable() }).optional(),
    frameId: z.number().optional(),
    origin: z.string().optional(),
    tabId: z.number().int().optional(),
  }),
  'net.res': z.object({
    rid: z.string(),
    status: z.number().int(),
    statusText: z.string().optional(),
    headers: headersSchema.optional(),
    body: z.string().optional(),
    truncated: z.boolean().optional(),
    contentType: z.string().optional(),
    encodedSize: z.number().optional(),
    timing: z
      .object({ start: z.number(), dns: z.number().optional(), connect: z.number().optional(), ttfb: z.number().optional(), end: z.number() })
      .optional(),
    source: z.enum(['page', 'webRequest']).optional(),
    graphqlErrors: z.number().int().optional(),
    fromCache: z.boolean().optional(),
    binary: z.boolean().optional(),
  }),
  'net.fail': z.object({ rid: z.string(), error: z.string(), cors: z.boolean().optional(), source: z.enum(['page', 'webRequest']).optional() }),
  ws: z.object({
    sid: z.string(),
    op: z.enum(['open', 'send', 'recv', 'close', 'error']),
    url: z.string().optional(),
    data: z.string().optional(),
    truncated: z.boolean().optional(),
    code: z.number().optional(),
    reason: z.string().optional(),
    binary: z.boolean().optional(),
    length: z.number().optional(),
    protocol: z.string().optional(),
  }),
  sse: z.object({
    sid: z.string(),
    op: z.enum(['open', 'message', 'error', 'close']),
    url: z.string().optional(),
    event: z.string().optional(),
    data: z.string().optional(),
    lastEventId: z.string().optional(),
  }),
  user: z.object({
    type: z.enum(['click', 'dblclick', 'contextmenu', 'input', 'key', 'scroll', 'focus', 'blur', 'select', 'resize', 'visibility']),
    target: targetRefSchema.optional(),
    value: z.string().optional(),
    masked: z.boolean().optional(),
    key: z.string().optional(),
    mods: z.array(z.enum(['ctrl', 'shift', 'alt', 'meta'])).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    scroll: z.object({ x: z.number(), y: z.number() }).optional(),
    visible: z.boolean().optional(),
  }),
  dom: z.object({
    added: z.number().int(),
    removed: z.number().int(),
    attrs: z.number().int(),
    text: z.number().int(),
    rects: z.array(rectSchema).max(5),
    texts: z.array(z.string().max(200)).max(5).optional(),
  }),
  rrweb: z.object({ chunk: z.number().int(), first: z.number(), last: z.number() }),
  media: z.object({
    stream: z.enum(['video', 'mic', 'cam', 'screen']),
    op: z.enum(['start', 'pause', 'resume', 'stop', 'segment']),
    mime: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    mic: z.enum(['off', 'on', 'muted', 'denied']).optional(),
    deviceId: z.string().optional(),
    segment: z.number().int().optional(),
  }),
  shot: z.object({
    assetId: z.string(),
    rect: rectSchema.optional(),
    reason: z.enum(['user', 'keyframe']),
    target: targetRefSchema.optional(),
  }),
  annotation: z.object({ annotationId: z.string(), op: z.enum(['create', 'update', 'delete']) }),
  marker: z.object({
    type: z.enum(['mark', 'voice.start', 'voice.end', 'pen', 'blur', 'screenshot']),
    label: z.string().optional(),
    /** the selected area of an area screenshot, CSS px in the viewport (J-209) */
    rect: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
  }),
  'canvas.sample': z.object({
    phase: z.enum(['before', 'after']),
    key: z.string(),
    rect: rectSchema,
    hash: z.string().nullable(),
    blank: z.boolean().optional(),
    diff: z.number().min(0).max(1).optional(),
    at: z.number(),
  }),
} as const satisfies Record<(typeof EVENT_KINDS)[number], z.ZodType>;

function envelope<K extends keyof typeof eventDataSchemas>(kind: K) {
  return z.object({
    v: z.literal(SCHEMA_VERSION),
    id: z.string(),
    ctx: z.string().min(1),
    seq: z.number().int().nonnegative(),
    t: z.number(),
    kind: z.literal(kind),
    data: eventDataSchemas[kind],
    tab: z.number().int().optional(),
  });
}

export const captureEventSchema = z.discriminatedUnion(
  'kind',
  EVENT_KINDS.map((k) => envelope(k)) as unknown as [ReturnType<typeof envelope<'env'>>, ...ReturnType<typeof envelope>[]],
);

export function parseEvent(input: unknown): CaptureEvent {
  return captureEventSchema.parse(input) as CaptureEvent;
}

export function safeParseEvent(input: unknown): { ok: true; event: CaptureEvent } | { ok: false; error: string } {
  const r = captureEventSchema.safeParse(input);
  return r.success ? { ok: true, event: r.data as CaptureEvent } : { ok: false, error: r.error.message };
}

// ---------- API DTOs (architecture section 5) ----------

const uuid = z.uuid();

export const createRecordingSchema = z.object({
  clientId: uuid,
  kind: z.enum(RECORDING_KINDS),
  workspaceId: z.string().min(1),
  folderId: z.string().optional(),
  page: z.object({ url: z.string(), title: z.string().default('') }),
  startedAt: z.number(),
  env: envInfoSchema.optional(),
});

export const recordingCreatedSchema = z.object({ id: z.string(), shareUrl: z.string() });

export const streamNameSchema = z.enum(STREAM_NAMES);

export const chunkInfoSchema = z.object({
  seq: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative().max(LIMITS.chunkBytes),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

export const completeStreamSchema = z.object({
  lastSeq: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

export const annotationInputSchema = z.object({
  id: z.string().optional(),
  assetId: z.string().optional(),
  t: z.number().optional(),
  shapes: z.array(z.record(z.string(), z.unknown())),
  target: targetRefSchema.optional(),
  comment: z.string().max(10_000).optional(),
});

export const finalizeRecordingSchema = z.object({
  title: z.string().max(500).default(''),
  description: z.string().max(100_000).default(''),
  annotations: z.array(annotationInputSchema).default([]),
  folderId: z.string().nullable().optional(),
});

export const recordingSummarySchema = z.object({
  id: z.string(),
  kind: z.enum(RECORDING_KINDS),
  status: z.enum(RECORDING_STATUSES),
  title: z.string(),
  pageUrl: z.string().nullable(),
  createdAt: z.string(),
  durationMs: z.number().nullable(),
  authorName: z.string().nullable(),
  thumbUrl: z.string().nullable(),
});

export const createCommentSchema = z.object({
  body: z.string().min(1).max(10_000),
  parentId: z.string().optional(),
  tMs: z.number().int().nonnegative().optional(),
});

export const createShareLinkSchema = z.object({
  access: z.enum(SHARE_ACCESS).default('anyone'),
  expiresInDays: z.number().int().positive().max(3650).optional(),
});

export const createFolderSchema = z.object({ name: z.string().min(1).max(200), parentId: z.string().optional() });

export const extTokenExchangeSchema = z.object({
  code: z.string().min(16),
  code_verifier: z.string().min(43).max(128),
});

export const createApiTokenSchema = z.object({ name: z.string().min(1).max(100) });

export const assetKindSchema = z.enum(ASSET_KINDS);

export const healthSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  checks: z.record(z.string(), z.object({ ok: z.boolean(), ms: z.number(), error: z.string().optional() })),
  /** paused features that are on (docs/scope.md), e.g. ["email"]; tests skip what is off (D-114) */
  features: z.array(z.string()).optional(),
});

export const apiErrorSchema = z.object({ error: z.string(), message: z.string().optional(), issues: z.unknown().optional() });
