// Extension storage: chrome.storage keys with their value types, and the IndexedDB layout.
// Only the service worker writes STORAGE.session and the IndexedDB stores; other contexts read
// chrome.storage (and listen to storage.onChanged) or ask the worker with a message.
import type { EnvInfo, Rect } from '../events.ts';
import type { RecordingKind } from '../constants.ts';
import type { ExtBootstrap, ExtensionSettings } from '../api/account.ts';
import type { Person } from '../api/common.ts';
import type { AnnotationInput } from '../api/dto.ts';
import type { AiDraftText } from '../areas/editor.ts';
import type { CaptureSession, RecordMode, ReplayState } from './state.ts';

export type StorageArea = 'local' | 'session';

/** Signed-in state. `token` is the device token (tb_dev_); never log it. */
export interface AuthState {
  serverUrl: string;
  token: string;
  tokenId: string;
  user: Person;
  activeWorkspaceId: string | null;
  signedInAt: number;
}

/** PKCE pair for an in-flight launchWebAuthFlow (architecture s9). */
export interface PendingAuth {
  verifier: string;
  state: string;
  startedAt: number;
}

export interface DraftSummary {
  id: string;
  kind: RecordingKind;
  createdAt: number;
  updatedAt: number;
  host: string;
  pageUrl: string;
  pageTitle: string;
  title: string;
  durationMs: number | null;
  thumbBlobId: string | null;
  recordingId: string | null;
  status: 'open' | 'saved' | 'uploading' | 'failed';
}

/** Full draft, kept in IndexedDB store `drafts`. */
export interface Draft extends DraftSummary {
  clientId: string;
  tabId: number;
  mode: RecordMode | null;
  workspaceId: string | null;
  folderId: string | null;
  description: string;
  /** blob ids in the `blobs` store */
  screenshotBlobId: string | null;
  fullBlobId: string | null;
  /** area crop in CSS px of the viewport (J-003, J-004) */
  crop: Rect | null;
  keepFull: boolean;
  annotations: AnnotationInput[];
  trim: { startMs: number; endMs: number } | null;
  destination: { type: 'link' } | { type: 'integration'; integrationId: string; fields: Record<string, unknown> };
  attachmentBlobIds: string[];
  aiAccepted: boolean;
  error: string | null;
  // ---- capture area additions (optional; written by the capture producer) ----
  /** capture start, epoch ms (recording start, shot time, or replay window start) */
  startedAt?: number;
  /** key of this draft's rows in the IDB `uploads` store (the client id until the server id is known) */
  uploadKey?: string;
  /** full local video (WebM) for the editor preview; chunks upload separately during recording */
  videoBlobId?: string | null;
  /** mic-only WebM/Opus kept for preview; chunks upload as the `voice` stream */
  voiceBlobId?: string | null;
  /** NDJSON of the capture's events, sliced from the ring at capture time; uploads at create (J-189) */
  eventsBlobId?: string | null;
  /** NDJSON of rrweb events (instant replay and DOM view); uploads at create */
  rrwebBlobId?: string | null;
  /** replay video segments (standalone WebM each), uploaded at create as `video` chunks in order */
  replaySegmentBlobIds?: string[];
  /** first video frame time minus startedAt (architecture s4 "Clock") */
  videoOffsetMs?: number;
  /** streams already uploaded or queued during recording: last seq and bytes, for `complete` */
  streams?: Partial<Record<'events' | 'rrweb' | 'video' | 'voice' | 'screenshot', { lastSeq: number; totalBytes: number }>>;
  env?: EnvInfo | null;
  /** window.toolbar.setMetadata output (J-073) */
  metadata?: Record<string, unknown> | null;
  /** tabs the capture spans (desktop recordings, J-008, J-224) */
  tabIds?: number[];
  incognito?: boolean;
  /** video dimensions in device pixels */
  videoSize?: { w: number; h: number } | null;
  shareUrl?: string | null;
  // ---- editor area additions ----
  /** AI ghost text fetched for this draft, kept so a reopened draft shows it again (J-218, J-083). */
  ai?: AiDraftText | null;
  /** Set by draft.open: a reopened draft's close button saves for later instead of discarding (J-219). */
  reopenedAt?: number | null;
}

/** Upload progress per recording, for the bar and the editor's create button. */
export interface UploadProgress {
  recordingId: string;
  streams: Record<string, { sent: number; pending: number; done: boolean }>;
  updatedAt: number;
}

/** Keys and value types. Prefix "tb:" keeps them apart from anything WXT stores. */
export const STORAGE = {
  // chrome.storage.local: survives restarts
  auth: { area: 'local', key: 'tb:auth' },
  settings: { area: 'local', key: 'tb:settings' },
  bootstrap: { area: 'local', key: 'tb:bootstrap' },
  drafts: { area: 'local', key: 'tb:drafts' },
  /** server URL override (options page); default from WXT_SERVER_URL */
  serverUrl: { area: 'local', key: 'tb:server-url' },
  installId: { area: 'local', key: 'tb:install-id' },
  micGranted: { area: 'local', key: 'tb:mic-granted' },
  /** heavy-page thresholds (J-011); unset means LIMITS.heavyPageNodes and heavyPageMutationsPerSec */
  heavyThresholds: { area: 'local', key: 'tb:heavy-thresholds' },
  // chrome.storage.session: survives worker restarts, not browser restarts
  session: { area: 'session', key: 'tb:session' },
  replay: { area: 'session', key: 'tb:replay' },
  uploads: { area: 'session', key: 'tb:uploads' },
  pendingAuth: { area: 'session', key: 'tb:pending-auth' },
  /** heavy-page replay overrides for one page load (J-011): tab id -> page URL */
  heavyOverride: { area: 'session', key: 'tb:heavy-override' },
} as const satisfies Record<string, { area: StorageArea; key: string }>;

export interface StorageValues {
  auth: AuthState | null;
  settings: ExtensionSettings;
  bootstrap: { at: number; data: ExtBootstrap } | null;
  drafts: DraftSummary[];
  serverUrl: string | null;
  installId: string;
  micGranted: boolean;
  heavyThresholds: { nodes?: number; mutationsPerSec?: number } | null;
  session: CaptureSession;
  replay: ReplayState;
  uploads: Record<string, UploadProgress>;
  pendingAuth: PendingAuth | null;
  heavyOverride: Record<number, string>;
}
export type StorageName = keyof typeof STORAGE;

/** Key prefix of extension builds before the rename to open-toolbar (D-111). */
export const LEGACY_KEY_PREFIX = 'nib:';
export const KEY_PREFIX = 'tb:';

/** The part of chrome.storage.StorageArea the migration needs. */
export interface MigratableArea {
  get(keys: null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/**
 * Moves every legacy `nib:*` value to its `tb:*` key and removes the old key. A `tb:*` value
 * that already exists wins. Safe to run more than once; returns the keys it wrote.
 */
export async function migrateLegacyKeys(area: MigratableArea): Promise<string[]> {
  const all = await area.get(null);
  const moved: Record<string, unknown> = {};
  const old: string[] = [];
  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(LEGACY_KEY_PREFIX)) continue;
    old.push(k);
    const next = KEY_PREFIX + k.slice(LEGACY_KEY_PREFIX.length);
    if (!(next in all)) moved[next] = v;
  }
  if (!old.length) return [];
  if (Object.keys(moved).length) await area.set(moved);
  await area.remove(old);
  return Object.keys(moved);
}

/** IndexedDB database in the extension origin (service worker and extension pages). */
export const IDB = {
  /** Frozen: the working name of 2026 (D-018). Renaming the database would drop queued chunks and drafts. */
  name: 'nib',
  version: 1,
  stores: {
    /** chunks written before upload, deleted after a 2xx: key [recordingId, stream, seq] */
    uploads: { keyPath: ['recordingId', 'stream', 'seq'] },
    /** instant-replay ring per tab: key [tabId, t, id]; pruned every 10 s (D-013) */
    ring: { keyPath: ['tabId', 't', 'id'] },
    /** full drafts by id */
    drafts: { keyPath: 'id' },
    /** screenshots, crops, thumbnails, attachments, video segments: key id, value { id, blob, type } */
    blobs: { keyPath: 'id' },
  },
} as const;

export interface UploadRow {
  recordingId: string;
  stream: string;
  seq: number;
  body: Blob;
  sha256: string;
  t0: number;
  t1: number;
  contentType: string;
  contentEncoding: 'gzip' | null;
  attempts: number;
}

export interface RingRow {
  tabId: number;
  t: number;
  id: string;
  /** 'event' rows hold a CaptureEvent; 'rrweb' rows hold one rrweb event */
  type: 'event' | 'rrweb';
  data: unknown;
  /** rrweb full snapshot marker, for pruning to the last checkout */
  full?: boolean;
  bytes: number;
}

export interface BlobRow {
  id: string;
  blob: Blob;
  type: string;
  createdAt: number;
}
