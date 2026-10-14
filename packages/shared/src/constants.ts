// Values shared by the extension, the server and the tests. Change them here only.

/** Working product name (D-018). The repo stays "toolbar". */
export const PRODUCT_NAME = 'Nib';
export const PRODUCT_SLUG = 'nib';

/** Tag name of the in-page UI host element (closed shadow root). */
export const UI_HOST_TAG = 'toolbar-root';

/** postMessage tag for the MAIN <-> ISOLATED handshake (spikes S3). */
export const BRIDGE_TAG = '__tb';

export const DEFAULT_SERVER_URL = 'http://localhost:3000';
export const API_PREFIX = '/api/v1';

export const RECORDING_KINDS = ['screenshot', 'video', 'replay', 'screen', 'link'] as const;
export type RecordingKind = (typeof RECORDING_KINDS)[number];

export const RECORDING_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

export const STREAM_NAMES = ['events', 'rrweb', 'video', 'voice', 'screenshot'] as const;
export type StreamName = (typeof STREAM_NAMES)[number];

export const STREAM_CONTENT_TYPES: Record<StreamName, string> = {
  events: 'application/x-ndjson',
  rrweb: 'application/x-ndjson',
  video: 'video/webm',
  voice: 'audio/webm',
  screenshot: 'image/png',
};

export const ASSET_KINDS = ['screenshot', 'crop', 'annotation', 'keyframe', 'thumb'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const SHARE_ACCESS = ['anyone', 'workspace'] as const;
export type ShareAccess = (typeof SHARE_ACCESS)[number];

export const JOB_TYPES = [
  'finalize-recording',
  'remux-video',
  'transcribe',
  'thumbnail',
  'purge-recording',
  'expire-shares',
  // server-core additions
  'renditions',
  'chapters',
  'sweep-drafts',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const INTEGRATION_TYPES = ['webhook', 'slack', 'github', 'linear', 'jira', 'gitlab', 'asana', 'notion'] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const LIMITS = {
  /** Max bytes per uploaded chunk. */
  chunkBytes: 8 * 1024 * 1024,
  /** Max captured body per request or response. */
  bodyBytes: 256 * 1024,
  /** Max string length kept by serialize(). */
  stringBytes: 10 * 1024,
  serializeDepth: 4,
  serializeKeys: 100,
  /** Service worker flush cadence for event batches. */
  flushMs: 2000,
  flushBytes: 1024 * 1024,
  /** Instant replay window. */
  replayDefaultMin: 2,
  replayMaxMin: 5,
  rrwebCheckoutMs: 30_000,
  /** Free-plan video cap observed in the catalogue (J-013). */
  videoCapMs: 5 * 60 * 1000,
  shareTokenBytes: 16,
  extAuthCodeTtlMs: 60_000,
} as const;

/** Token prefixes so leaked tokens are recognisable by secret scanners. */
export const TOKEN_PREFIX = {
  device: 'tb_dev_',
  personal: 'tb_pat_',
} as const;

/** Upload headers (architecture section 5). */
export const HEADERS = {
  sha256: 'x-sha256',
  t0: 'x-t0',
  t1: 'x-t1',
} as const;

/**
 * Extension commands. Keys are the command names in the manifest; suggested keys follow
 * the catalogue's shortcut rows (J-179 to J-182). Chrome allows at most four suggested keys.
 */
export const COMMANDS = {
  _execute_action: { key: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y', description: 'Open the capture menu' },
  'screenshot-mode': { key: 'Ctrl+Shift+S', mac: 'Command+Shift+S', description: 'Take a screenshot' },
  'record-tab': { key: 'Ctrl+Shift+Space', mac: 'Command+Shift+Space', description: 'Start or stop recording this tab' },
  'instant-replay': { key: 'Ctrl+Shift+X', mac: 'Command+Shift+X', description: 'Share the last moments of this tab' },
  'recording-link': { key: null, mac: null, description: 'Create a recording link' },
} as const;
export type CommandName = keyof typeof COMMANDS;

/** Headers stripped before upload (architecture section 10). */
export const REDACT_HEADER_RE = /^(authorization|cookie|set-cookie|x-api-key|.*(token|secret|key).*)$/i;
