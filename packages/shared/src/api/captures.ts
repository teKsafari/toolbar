// Capture contracts: upload (create, chunks, complete, finalize, assets), read (detail, event
// index, media URLs), event queries (raw, console, network, actions), update, delete, bulk.
// The API path says "recordings"; the UI says "capture". They are the same thing.
import { z } from 'zod';
import { ASSET_KINDS, RECORDING_KINDS, RECORDING_STATUSES, SHARE_ACCESS, STREAM_NAMES } from '../constants.ts';
import { CONSOLE_LEVELS, EVENT_KINDS } from '../events.ts';
import {
  annotationInputSchema,
  captureEventSchema,
  chunkInfoSchema,
  completeStreamSchema,
  createRecordingSchema,
  envInfoSchema,
  finalizeRecordingSchema,
  recordingSummarySchema,
  targetRefSchema,
} from '../schemas.ts';
import { api, boolQuery, csvOf, defineRoute, idSchema, isoSchema, pageOf, pageQuerySchema, personSchema } from './common.ts';

// ---------- enums ----------

/** Where a capture came from (J-160 source filter). */
export const CAPTURE_SOURCES = ['extension', 'recording-link', 'upload', 'cli', 'injector'] as const;
export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

/**
 * Asset kinds accepted by POST /assets: the capture kinds plus uploads that are not capture media.
 * For image captures, `screenshot` is the full viewport and `crop` the area crop (J-003, J-004);
 * either one carries the annotations flattened in (J-051). `voice` is a voice note for a comment
 * (WebM/Opus or another audio type); attached to a comment, it gets a transcript (D-087).
 */
export const UPLOAD_ASSET_KINDS = [...ASSET_KINDS, 'attachment', 'comment', 'avatar', 'logo', 'voice', 'feedback', 'voice-note'] as const;
export type UploadAssetKind = (typeof UPLOAD_ASSET_KINDS)[number];

export const MAX_ASSET_BYTES = 200 * 1024 * 1024;

/** Transcript states (D-087): `skipped` when the length or monthly limit, or a provider of none, stopped it. */
export const TRANSCRIPT_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;

const recordingIdParams = z.object({ id: idSchema });

// ---------- shared pieces ----------

export const assetSchema = z.object({
  id: idSchema,
  kind: z.enum(UPLOAD_ASSET_KINDS),
  url: z.string(),
  contentType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  bytes: z.number().int().nonnegative(),
  name: z.string().nullable(),
});
export type Asset = z.infer<typeof assetSchema>;

export const authorSnapshotSchema = z.object({
  userId: idSchema.nullable(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  image: z.string().nullable(),
  /** OIDC issuer and subject at creation (Part 2: every record stores who left it). */
  issuer: z.string().nullable(),
  subject: z.string().nullable(),
});

export const trimSchema = z
  .object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() })
  .refine((t) => t.endMs > t.startMs, 'endMs must be after startMs');
export type Trim = z.infer<typeof trimSchema>;

export const linkedIssueSchema = z.object({
  integrationId: idSchema.nullable(),
  type: z.string(),
  url: z.string(),
  /** "org/repo#12", "group/project#3" */
  key: z.string(),
  title: z.string().nullable(),
  createdAt: isoSchema,
});
export type LinkedIssue = z.infer<typeof linkedIssueSchema>;

export const chapterSchema = z.object({ title: z.string(), startMs: z.number(), endMs: z.number(), thumbUrl: z.string().nullable() });

/** Card in the grid and search results (J-158). Superset of the older recordingSummarySchema. */
export const captureSummarySchema = recordingSummarySchema.extend({
  workspaceId: idSchema,
  folderId: idSchema.nullable(),
  source: z.enum(CAPTURE_SOURCES),
  author: personSchema.nullable(),
  recordingLinkId: idSchema.nullable(),
  recordingLinkName: z.string().nullable(),
  commentCount: z.number().int().nonnegative(),
  hasLinkedIssue: z.boolean(),
  url: z.string(),
});
export type CaptureSummary = z.infer<typeof captureSummarySchema>;

export const renditionSchema = z.object({
  label: z.string(),
  height: z.number().int().nullable(),
  url: z.string(),
  /** false while the server is still making this rendition after the capture became ready (J-054) */
  ready: z.boolean().optional(),
});

/** Media URLs. All point at the Range-capable proxy (member or share route), never at S3. */
export const captureMediaSchema = z.object({
  video: z
    .object({
      url: z.string(),
      mime: z.string(),
      width: z.number().int().nullable(),
      height: z.number().int().nullable(),
      durationMs: z.number().nullable(),
      /** original first, then 720p..240p (J-054) */
      renditions: z.array(renditionSchema),
    })
    .nullable(),
  /** The image shown first: the `crop` asset for area shots, else the `screenshot` asset (J-051). */
  screenshot: assetSchema.nullable(),
  /** The full-viewport `screenshot` asset kept next to an area crop (J-004, J-209); null otherwise. */
  fullScreenshot: assetSchema.nullable(),
  thumbUrl: z.string().nullable(),
  /** Merged, time-sorted events (events.json.gz); the viewer loads this one file. */
  eventsUrl: z.string().nullable(),
  /** rrweb NDJSON.gz chunks in order (instant replay and DOM view). */
  rrwebUrls: z.array(z.string()),
  voiceUrl: z.string().nullable(),
  transcriptVttUrl: z.string().nullable(),
});
export type CaptureMedia = z.infer<typeof captureMediaSchema>;

export const MARKER_KINDS = ['error', 'net-fail', 'nav', 'comment', 'pen', 'blur', 'pause', 'resume', 'mark', 'voice'] as const;
export const markerSchema = z.object({
  kind: z.enum(MARKER_KINDS),
  /** ms from capture start (the clock the player uses) */
  offsetMs: z.number(),
  label: z.string(),
  /** event id (`ctx:seq`) or comment id the marker jumps to */
  ref: z.string().nullable(),
  /** HTTP status for net-fail markers (J-072) */
  status: z.number().int().nullable(),
  count: z.number().int().positive(),
});
export type TimelineMarker = z.infer<typeof markerSchema>;

/** Counts and markers, computed at finalize, so lists and the info header need no event fetch. */
export const eventIndexSchema = z.object({
  counts: z.partialRecord(z.enum(EVENT_KINDS), z.number().int().nonnegative()),
  console: z.partialRecord(z.enum(CONSOLE_LEVELS), z.number().int().nonnegative()),
  errors: z.number().int().nonnegative(),
  network: z.object({
    total: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    byClass: z.partialRecord(z.enum(['1xx', '2xx', '3xx', '4xx', '5xx']), z.number().int().nonnegative()),
  }),
  user: z.object({ clicks: z.number().int(), inputs: z.number().int(), keys: z.number().int(), navigations: z.number().int() }),
  markers: z.array(markerSchema),
  firstT: z.number().nullable(),
  lastT: z.number().nullable(),
});
export type EventIndex = z.infer<typeof eventIndexSchema>;

export const annotationSchema = annotationInputSchema.extend({
  id: idSchema,
  authorId: idSchema.nullable(),
  createdAt: isoSchema,
});

export const streamStateSchema = z.object({
  name: z.enum(STREAM_NAMES),
  contentType: z.string(),
  lastSeq: z.number().int().nullable(),
  totalBytes: z.number().int().nonnegative(),
  completed: z.boolean(),
});

/** GET /recordings/:id: everything the capture page needs except the event bodies. */
export const captureDetailSchema = captureSummarySchema.extend({
  description: z.string(),
  pageTitle: z.string().nullable(),
  startedAt: isoSchema.nullable(),
  updatedAt: isoSchema,
  folder: z.object({ id: idSchema, shortId: z.string(), name: z.string() }).nullable(),
  env: envInfoSchema.nullable(),
  authorSnapshot: authorSnapshotSchema,
  access: z.enum(SHARE_ACCESS),
  /** The caller's rights on this capture (false for share-token viewers). */
  canEdit: z.boolean(),
  canComment: z.boolean(),
  media: captureMediaSchema,
  streams: z.array(streamStateSchema),
  index: eventIndexSchema,
  annotations: z.array(annotationSchema),
  attachments: z.array(assetSchema),
  transcript: z.object({ status: z.enum(TRANSCRIPT_STATUSES), language: z.string().nullable() }).nullable(),
  chapters: z.array(chapterSchema),
  trim: trimSchema.nullable(),
  linkedIssues: z.array(linkedIssueSchema),
  /** recording start to first video frame, for the shared clock (architecture s4 "Clock") */
  videoOffsetMs: z.number(),
  /** Custom metadata from window.toolbar.setMetadata (J-073), at most 10 KB */
  metadata: z.record(z.string(), z.unknown()).nullable(),
  /** The project whose origin the page was on (D-123); null for captures made before projects or outside one. */
  project: z.object({ id: idSchema, name: z.string() }).nullable().optional(),
  /** Masking preset applied in the browser when the capture was made (D-125). */
  maskingPreset: z.enum(['staging', 'production', 'none']).nullable().optional(),
});
export type CaptureDetail = z.infer<typeof captureDetailSchema>;

// ---------- upload: create, chunks, complete, finalize, assets ----------

export const createCaptureBodySchema = createRecordingSchema.extend({
  source: z.enum(CAPTURE_SOURCES).default('extension'),
  durationMs: z.number().int().nonnegative().optional(),
});
export const captureCreatedSchema = z.object({
  id: idSchema,
  shareUrl: z.string(),
  /** Only for recording-link recipients: bearer for this capture's upload routes. */
  uploadToken: z.string().optional(),
});

export const createCapture = defineRoute({
  name: 'captures.create',
  method: 'POST',
  path: api('/recordings'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  body: createCaptureBodySchema,
  response: captureCreatedSchema,
  errors: ['unauthorized', 'forbidden', 'invalid_body'],
  area: 'server-core',
  tasks: ['X-01', 'J-189'],
  summary: 'Create a capture before upload. Idempotent on clientId (200 with the same id on repeat). Nothing is listed until finalize.',
});

export const putChunkParams = z.object({
  id: idSchema,
  stream: z.enum(STREAM_NAMES),
  seq: z.coerce.number().int().nonnegative(),
});
export const chunkStoredSchema = z.object({ seq: z.number().int(), stored: z.enum(['new', 'duplicate']) });

export const putChunk = defineRoute({
  name: 'captures.putChunk',
  method: 'PUT',
  path: api('/recordings/:id/streams/:stream/chunks/:seq'),
  auth: 'upload',
  scope: 'write',
  params: putChunkParams,
  body: 'binary',
  response: chunkStoredSchema,
  status: 201,
  errors: ['unauthorized', 'forbidden', 'not_found', 'hash_mismatch', 'too_large', 'already_finalized'],
  area: 'server-core',
  tasks: ['X-01', 'J-087'],
  summary:
    'Store one chunk (<= LIMITS.chunkBytes). Headers: Content-Type, Content-Encoding (gzip for NDJSON), x-sha256 (hex of the body as sent), x-t0, x-t1. 201 new, 200 same hash already stored, 409 hash_mismatch.',
});

export const chunkListSchema = z.object({
  stream: z.enum(STREAM_NAMES),
  chunks: z.array(chunkInfoSchema),
  lastSeq: z.number().int().nullable(),
  completed: z.boolean(),
});

export const listChunks = defineRoute({
  name: 'captures.listChunks',
  method: 'GET',
  path: api('/recordings/:id/streams/:stream/chunks'),
  auth: 'upload',
  params: z.object({ id: idSchema, stream: z.enum(STREAM_NAMES) }),
  response: chunkListSchema,
  area: 'server-core',
  tasks: ['X-01'],
  summary: 'Chunks the server holds for a stream, so a resumed uploader re-sends only the missing seqs.',
});

export const completeStream = defineRoute({
  name: 'captures.completeStream',
  method: 'POST',
  path: api('/recordings/:id/streams/:stream/complete'),
  auth: 'upload',
  scope: 'write',
  params: z.object({ id: idSchema, stream: z.enum(STREAM_NAMES) }),
  body: completeStreamSchema,
  response: z.object({ stream: z.enum(STREAM_NAMES), completed: z.boolean(), missing: z.array(z.number().int()) }),
  status: 200,
  errors: ['unauthorized', 'forbidden', 'not_found', 'stream_incomplete'],
  area: 'server-core',
  tasks: ['X-01'],
  summary: 'Mark a stream complete. 409 stream_incomplete lists missing seqs when chunks are absent.',
});

/** Where the capture goes at create (J-079, J-137). The share link is always made. */
export const destinationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('link') }),
  z.object({
    type: z.literal('integration'),
    integrationId: idSchema,
    fields: z.record(z.string(), z.unknown()).default({}),
  }),
]);

export const finalizeCaptureBodySchema = finalizeRecordingSchema.extend({
  /** The draft's workspace picker can move the capture before create (J-080). */
  workspaceId: idSchema.optional(),
  trim: trimSchema.nullable().optional(),
  destination: destinationSchema.default({ type: 'link' }),
  /** Image capture: the flattened PNG asset and, for area shots, the kept full viewport (J-004). */
  screenshotAssetId: idSchema.optional(),
  fullScreenshotAssetId: idSchema.nullable().optional(),
  attachmentAssetIds: z.array(idSchema).max(20).default([]),
  /** AI ghost text was accepted (J-083); informational. */
  aiAccepted: z.boolean().default(false),
  durationMs: z.number().int().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type FinalizeCaptureBody = z.input<typeof finalizeCaptureBodySchema>;

export const finalizedSchema = z.object({
  id: idSchema,
  shareUrl: z.string(),
  status: z.enum(RECORDING_STATUSES),
  /** Set when the destination filed an issue; null when it failed (capture is saved anyway, J-140). */
  issue: linkedIssueSchema.nullable(),
  issueError: z.string().nullable(),
});

export const finalizeCapture = defineRoute({
  name: 'captures.finalize',
  method: 'POST',
  path: api('/recordings/:id/finalize'),
  auth: 'upload',
  scope: 'write',
  params: recordingIdParams,
  body: finalizeCaptureBodySchema,
  response: finalizedSchema,
  status: 200,
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_body', 'already_finalized'],
  area: 'server-core',
  tasks: ['X-01', 'J-086', 'J-087', 'J-227'],
  summary: 'Create the capture from the draft: title, description, annotations, trim, folder, destination. Enqueues finalize-recording.',
});

/** Text fields of the multipart body of POST /assets; the file part is named "file". */
export const uploadAssetFieldsSchema = z.object({
  kind: z.enum(UPLOAD_ASSET_KINDS),
  recordingId: idSchema.optional(),
  width: z.coerce.number().int().positive().optional(),
  height: z.coerce.number().int().positive().optional(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

export const uploadAsset = defineRoute({
  name: 'captures.uploadAsset',
  method: 'POST',
  path: api('/assets'),
  auth: 'upload',
  scope: 'write',
  body: 'multipart',
  response: assetSchema,
  errors: ['unauthorized', 'forbidden', 'too_large', 'unsupported_media_type', 'invalid_body'],
  area: 'server-core',
  tasks: ['X-01', 'J-002', 'J-082', 'J-132'],
  summary: 'Upload a screenshot PNG, crop, full viewport, attachment, comment image, avatar or logo (multipart: file + uploadAssetFieldsSchema).',
});

// ---------- read ----------

export const listCapturesQuerySchema = pageQuerySchema.extend({
  workspaceId: idSchema.optional(),
  /** a folder id, "none" (unfiled, the main grid, J-158) or "all" */
  folderId: z.union([idSchema, z.enum(['none', 'all'])]).default('all'),
  kinds: csvOf(z.enum(RECORDING_KINDS)),
  sources: csvOf(z.enum(CAPTURE_SOURCES)),
  authors: csvOf(idSchema),
  recordingLinkId: idSchema.optional(),
  hasIssue: boolQuery,
  q: z.string().max(500).optional(),
  from: isoSchema.optional(),
  to: isoSchema.optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

export const listCaptures = defineRoute({
  name: 'captures.list',
  method: 'GET',
  path: api('/recordings'),
  auth: 'member',
  role: 'viewer',
  scope: 'read',
  query: listCapturesQuerySchema,
  response: pageOf(captureSummarySchema),
  errors: ['unauthorized', 'forbidden', 'invalid_query'],
  area: 'dashboard',
  tasks: ['J-158', 'J-160', 'J-203', 'J-150'],
  summary: 'Captures in a workspace, newest first, with type, source, creator, folder and linked-issue filters.',
});

export const getCapture = defineRoute({
  name: 'captures.get',
  method: 'GET',
  path: api('/recordings/:id'),
  auth: 'viewer',
  scope: 'read',
  params: recordingIdParams,
  response: captureDetailSchema,
  area: 'viewer',
  tasks: ['J-090', 'J-101', 'J-121', 'J-149', 'J-205'],
  summary: 'Capture metadata, event index (counts, markers) and media URLs. 404 for deleted or unknown ids.',
});

export const captureStatusEventSchema = z.object({
  status: z.enum(RECORDING_STATUSES),
  /** 0..1 while processing (trim, remux) */
  progress: z.number().min(0).max(1).nullable(),
  error: z.string().nullable(),
});

export const captureStatus = defineRoute({
  name: 'captures.status',
  method: 'GET',
  path: api('/recordings/:id/status'),
  auth: 'viewer',
  params: recordingIdParams,
  response: 'sse',
  area: 'server-core',
  tasks: ['J-034', 'J-087'],
  summary: 'Server-sent events, one captureStatusEventSchema per change; closes after ready or failed.',
});

export const mediaParams = z.object({
  id: idSchema,
  /** video | video-720 | ... | screenshot | full | thumb | voice | transcript | transcript-<assetId> (a comment voice note) | events | rrweb-000 | asset id */
  name: z.string().regex(/^[a-z0-9-]+$/),
});

export const getMedia = defineRoute({
  name: 'captures.media',
  method: 'GET',
  path: api('/recordings/:id/media/:name'),
  auth: 'viewer',
  scope: 'read',
  params: mediaParams,
  response: 'binary',
  area: 'server-core',
  tasks: ['X-03', 'J-054', 'J-098'],
  summary: 'Range-capable media proxy (206 on Range). 404 at once after delete (J-191). Share pages use /s/:token/media/:name.',
});

// ---------- event queries (viewer panels fetch events.json.gz; MCP and CLI use these) ----------

const eventWindow = {
  /** ms from capture start, inclusive */
  fromMs: z.coerce.number().optional(),
  toMs: z.coerce.number().optional(),
  q: z.string().max(500).optional(),
};

export const eventsQuerySchema = pageQuerySchema.extend({
  kinds: csvOf(z.enum(EVENT_KINDS)),
  ctx: z.string().optional(),
  ...eventWindow,
});

export const eventRowSchema = z.object({ offsetMs: z.number(), event: captureEventSchema });

export const queryEvents = defineRoute({
  name: 'captures.events',
  method: 'GET',
  path: api('/recordings/:id/events'),
  auth: 'viewer',
  scope: 'read',
  params: recordingIdParams,
  query: eventsQuerySchema,
  response: pageOf(eventRowSchema),
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_query'],
  area: 'agent',
  tasks: ['J-149', 'J-247'],
  summary: 'Raw event envelopes in time order, filtered by kind, frame context, time window and text.',
});

export const CONSOLE_ROW_KINDS = ['console', 'error', 'network', 'navigation', 'click', 'input', 'media'] as const;

/** One row of the merged console tab (J-102): console, errors, failed requests, navigations, user events, video start/pause/stop. */
export const consoleRowSchema = z.object({
  id: z.string(),
  t: z.number(),
  offsetMs: z.number(),
  kind: z.enum(CONSOLE_ROW_KINDS),
  level: z.enum(['debug', 'info', 'log', 'warn', 'error']),
  message: z.string(),
  args: z.array(z.unknown()).optional(),
  stack: z.string().nullable(),
  /** parsed top frame for the call-site link (J-056) */
  source: z.object({ url: z.string(), line: z.number().int(), col: z.number().int(), fn: z.string().nullable() }).nullable(),
  url: z.string().nullable(),
  count: z.number().int().positive(),
});
export type ConsoleRow = z.infer<typeof consoleRowSchema>;

export const consoleQuerySchema = pageQuerySchema.extend({
  levels: csvOf(z.enum(['debug', 'info', 'log', 'warn', 'error'])),
  kinds: csvOf(z.enum(CONSOLE_ROW_KINDS)),
  ...eventWindow,
});

export const queryConsole = defineRoute({
  name: 'captures.console',
  method: 'GET',
  path: api('/recordings/:id/console'),
  auth: 'viewer',
  scope: 'read',
  params: recordingIdParams,
  query: consoleQuerySchema,
  response: pageOf(consoleRowSchema),
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_query'],
  area: 'agent',
  tasks: ['J-102', 'J-149', 'J-247'],
  summary: 'Merged console rows with level and kind filters (the console tab model; shared with MCP getConsoleLogs).',
});

export const NETWORK_TYPES = ['fetch', 'xhr', 'document', 'script', 'stylesheet', 'image', 'font', 'media', 'websocket', 'eventsource', 'beacon', 'other'] as const;
export const STATUS_CLASSES = ['1xx', '2xx', '3xx', '4xx', '5xx', 'failed', 'pending'] as const;

/** One request with its response or failure merged (J-058 to J-066, J-105, J-106). */
export const networkEntrySchema = z.object({
  rid: z.string(),
  index: z.number().int().nonnegative(),
  t: z.number(),
  offsetMs: z.number(),
  method: z.string(),
  url: z.string(),
  host: z.string(),
  path: z.string(),
  status: z.number().int().nullable(),
  statusText: z.string().nullable(),
  state: z.enum(['done', 'failed', 'pending']),
  /** net::ERR_*, abort, timeout, cors */
  error: z.string().nullable(),
  /** error text parsed from a failed JSON body, for marker pills (J-095) */
  errorMessage: z.string().nullable(),
  type: z.enum(NETWORK_TYPES),
  initiator: z.string().nullable(),
  source: z.enum(['page', 'webRequest', 'both']),
  /** frame context ("top", "f3") */
  frame: z.string(),
  tabId: z.number().int().nullable(),
  durationMs: z.number().nullable(),
  size: z.number().int().nullable(),
  contentType: z.string().nullable(),
  timing: z
    .object({ dns: z.number().nullable(), connect: z.number().nullable(), ttfb: z.number().nullable(), download: z.number().nullable() })
    .nullable(),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  requestBody: z.string().nullable().optional(),
  responseBody: z.string().nullable().optional(),
  truncated: z.boolean(),
  /** header names whose values were redacted (J-185 shield badge) */
  redacted: z.array(z.string()),
  graphql: z.object({ operationName: z.string().nullable(), hasErrors: z.boolean() }).nullable(),
  cors: z.boolean(),
  wsFrames: z.number().int().nullable(),
});
export type NetworkEntry = z.infer<typeof networkEntrySchema>;

export const networkQuerySchema = pageQuerySchema.extend({
  status: csvOf(z.enum(STATUS_CLASSES)),
  types: csvOf(z.enum(NETWORK_TYPES)),
  methods: csvOf(z.string().toUpperCase()),
  hosts: csvOf(z.string()),
  /** none: no bodies; errors: bodies of failed rows only (MCP default); all */
  bodies: z.enum(['none', 'errors', 'all']).default('errors'),
  headers: boolQuery,
  errorsOnly: boolQuery,
  ...eventWindow,
});

export const queryNetwork = defineRoute({
  name: 'captures.network',
  method: 'GET',
  path: api('/recordings/:id/network'),
  auth: 'viewer',
  scope: 'read',
  params: recordingIdParams,
  query: networkQuerySchema,
  response: pageOf(networkEntrySchema),
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_query'],
  area: 'agent',
  tasks: ['J-105', 'J-149', 'J-247'],
  summary: 'Merged requests with status, type, method and host filters; bodies and headers on request.',
});

export const wsFrameSchema = z.object({
  t: z.number(),
  offsetMs: z.number(),
  op: z.enum(['open', 'send', 'recv', 'close', 'error', 'message']),
  data: z.string().nullable(),
  binary: z.boolean(),
  length: z.number().int(),
  event: z.string().nullable(),
});

export const queryFrames = defineRoute({
  name: 'captures.socketFrames',
  method: 'GET',
  path: api('/recordings/:id/network/:rid/frames'),
  auth: 'viewer',
  scope: 'read',
  params: z.object({ id: idSchema, rid: z.string() }),
  query: pageQuerySchema.extend({ q: z.string().optional(), direction: z.enum(['send', 'recv']).optional() }),
  response: pageOf(wsFrameSchema),
  area: 'agent',
  tasks: ['J-062', 'J-063'],
  summary: 'WebSocket frames or SSE messages of one stream row.',
});

export const actionRowSchema = z.object({
  id: z.string(),
  t: z.number(),
  offsetMs: z.number(),
  type: z.enum(['click', 'dblclick', 'contextmenu', 'input', 'key', 'navigation', 'visibility', 'scroll', 'select']),
  target: targetRefSchema.nullable(),
  value: z.string().nullable(),
  masked: z.boolean(),
  key: z.string().nullable(),
  url: z.string().nullable(),
  /** navigation cause: load, pushState, popstate, reload, typed, link (J-069) */
  cause: z.string().nullable(),
});

export const queryActions = defineRoute({
  name: 'captures.actions',
  method: 'GET',
  path: api('/recordings/:id/actions'),
  auth: 'viewer',
  scope: 'read',
  params: recordingIdParams,
  query: pageQuerySchema.extend(eventWindow),
  response: pageOf(actionRowSchema),
  area: 'agent',
  tasks: ['J-108', 'J-149'],
  summary: 'Clicks, committed inputs, keys and navigations (the actions tab model; MCP getUserEvents).',
});

export const getVideoFrame = defineRoute({
  name: 'captures.videoFrame',
  method: 'GET',
  path: api('/recordings/:id/frames'),
  auth: 'viewer',
  scope: 'read',
  params: recordingIdParams,
  query: z.object({
    /** ms from start; omit for a 4x3 overview grid */
    at: z.coerce.number().nonnegative().optional(),
    size: z.enum(['360', '720', '1080']).default('720'),
  }),
  response: 'binary',
  errors: ['unauthorized', 'forbidden', 'not_found', 'conflict'],
  area: 'agent',
  tasks: ['J-149', 'J-247'],
  summary: 'One JPEG frame at a time, or an overview grid. 409 conflict for captures without video.',
});

export const transcriptSchema = z.object({
  status: z.enum(['none', ...TRANSCRIPT_STATUSES]),
  /** detected language codes, most spoken first, comma separated (`sw,en`) */
  language: z.string().nullable(),
  vtt: z.string().nullable(),
  cues: z.array(z.object({ startMs: z.number(), endMs: z.number(), text: z.string() })),
  /** why there is no transcript: no-voice, provider-off, failed, or the skip reason (length or monthly limit) */
  reason: z.string().nullable(),
});

export const transcriptQuerySchema = z.object({
  /** a comment's voice note (asset id); without it, the capture's own voice track */
  asset: idSchema.optional(),
});

export const getTranscript = defineRoute({
  name: 'captures.transcript',
  method: 'GET',
  path: api('/recordings/:id/transcript'),
  auth: 'viewer',
  scope: 'read',
  params: recordingIdParams,
  query: transcriptQuerySchema,
  response: transcriptSchema,
  area: 'server-core',
  tasks: ['J-074', 'J-236'],
  summary: 'WebVTT transcript and parsed cues of the voice track, or of a comment voice note with ?asset=<id>; status none with a reason when there was no voice, skipped with the reason when a length or monthly limit stopped it.',
});

export const aiDraftSchema = z.object({
  title: z.string(),
  summary: z.string(),
  steps: z.array(z.object({ text: z.string(), tMs: z.number().nullable() })),
  result: z.string(),
});

export const aiDraft = defineRoute({
  name: 'captures.aiDraft',
  method: 'POST',
  path: api('/recordings/:id/ai-draft'),
  auth: 'member',
  role: 'creator',
  params: recordingIdParams,
  response: aiDraftSchema,
  status: 200,
  errors: ['unauthorized', 'forbidden', 'not_found', 'unavailable'],
  area: 'editor',
  tasks: ['J-083', 'J-230'],
  summary: 'Ghost title, summary, steps with times and result for a video or replay draft. Paused (FEATURE_AI): 503 unavailable while the flag is off, when AI_PROVIDER=none or when the workspace switch is off.',
  paused: ['ai'],
});

// ---------- update, delete, bulk ----------

export const updateCaptureBodySchema = z
  .object({
    title: z.string().max(500),
    description: z.string().max(100_000),
    folderId: idSchema.nullable(),
  })
  .partial();

export const updateCapture = defineRoute({
  name: 'captures.update',
  method: 'PATCH',
  path: api('/recordings/:id'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  params: recordingIdParams,
  body: updateCaptureBodySchema,
  response: captureSummarySchema,
  errors: ['unauthorized', 'forbidden', 'not_found', 'invalid_body'],
  area: 'viewer',
  tasks: ['J-110', 'J-113', 'J-151'],
  summary: 'Edit title, description or folder (inline editing, move to folder).',
});

export const deleteCapture = defineRoute({
  name: 'captures.delete',
  method: 'DELETE',
  path: api('/recordings/:id'),
  auth: 'upload',
  role: 'creator',
  scope: 'write',
  params: recordingIdParams,
  response: z.object({ ok: z.literal(true), purged: z.boolean() }),
  area: 'server-core',
  tasks: ['J-114', 'J-191', 'J-189'],
  summary:
    'Archive a capture: gone from lists, search and URLs, share links revoked, media 404 at once, purge job enqueued. A draft (status uploading) is purged at once (discard, J-189).',
});

export const bulkCaptures = defineRoute({
  name: 'captures.bulk',
  method: 'POST',
  path: api('/recordings/bulk'),
  auth: 'member',
  role: 'creator',
  scope: 'write',
  body: z.discriminatedUnion('action', [
    z.object({ action: z.literal('move'), ids: z.array(idSchema).min(1).max(500), folderId: idSchema.nullable() }),
    z.object({ action: z.literal('delete'), ids: z.array(idSchema).min(1).max(500) }),
  ]),
  response: z.object({ updated: z.number().int().nonnegative() }),
  status: 200,
  area: 'dashboard',
  tasks: ['J-165', 'J-166'],
  summary: 'Move or delete several captures from the grid selection bar or a drag onto a folder.',
});

export const recordView = defineRoute({
  name: 'captures.view',
  method: 'POST',
  path: api('/recordings/:id/views'),
  auth: 'viewer',
  params: recordingIdParams,
  response: z.object({ ok: z.literal(true) }),
  status: 200,
  area: 'viewer',
  tasks: ['J-136', 'J-161'],
  summary: 'Record a view: feeds the recently viewed palette rows (and the first-view mail, paused with FEATURE_EMAIL).',
});

/** Pull a capture id out of a pasted URL or text (MCP and CLI accept either, J-150). */
export function parseCaptureRef(text: string): string | null {
  const m = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}

export const captureRoutes = [
  createCapture,
  putChunk,
  listChunks,
  completeStream,
  finalizeCapture,
  uploadAsset,
  listCaptures,
  getCapture,
  captureStatus,
  getMedia,
  queryEvents,
  queryConsole,
  queryNetwork,
  queryFrames,
  queryActions,
  getVideoFrame,
  getTranscript,
  aiDraft,
  updateCapture,
  deleteCapture,
  bulkCaptures,
  recordView,
] as const;
