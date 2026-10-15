// The editor talks to its surroundings only through EditorHost, so the same component runs in
// the extension's editor iframe, in tests, and in a dev harness.
import type { ExtBootstrap } from '@toolbar/shared/api';
import type { Draft } from '@toolbar/shared/ext';
import type { AiDraftText, AiUnavailableReason, EditorPrefs, TrackerOptions, TrackerRecent } from '@toolbar/shared/areas/editor';
import type { FinalizeCaptureBody } from '@toolbar/shared/api';

export type { AiDraftText, AiUnavailableReason, EditorPrefs, TrackerOptions, TrackerRecent };

export interface AttachmentInfo {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface EditorData {
  draft: Draft;
  /** object URLs for the draft's media */
  screenshotUrl: string | null;
  fullUrl: string | null;
  videoUrl: string | null;
  /** rrweb events of an instant-replay draft (from the capture area's `rrwebBlobId`), for the DOM replay preview */
  replayEvents?: { type: number; timestamp: number; data?: unknown }[] | null;
  /** epoch ms of draft time 0 (the capture area's `startedAt`); trim ranges count from here */
  startedAt?: number | null;
  /** errors, failed requests and pen marks on the draft clock, drawn above the trim track (J-009, J-085) */
  markers?: DraftMarker[];
  attachments: AttachmentInfo[];
}

export interface DraftMarker {
  /** ms on the draft clock (the trim track's scale) */
  ms: number;
  kind: 'error' | 'net-fail' | 'pen' | 'blur' | 'mark' | 'voice' | 'pause' | 'resume';
  label: string;
  /** HTTP status of a failed request, shown on its badge */
  status: number | null;
  count: number;
}

export type DraftPatch = Partial<Omit<Draft, 'id' | 'kind' | 'createdAt'>>;

export interface CreateRequest {
  finalize: FinalizeCaptureBody;
  /** flattened images in the blobs store */
  flatBlobId: string | null;
  flatFullBlobId: string | null;
}

export interface CreateResult {
  recordingId: string;
  shareUrl: string;
  issueError: string | null;
  issueUrl: string | null;
}

export interface EditorHost {
  load(): Promise<EditorData>;
  bootstrap(workspaceId?: string | null): Promise<ExtBootstrap | null>;
  prefs(): Promise<EditorPrefs>;
  savePrefs(patch: Partial<EditorPrefs>): Promise<void>;
  update(patch: DraftPatch): Promise<void>;
  putBlob(blob: Blob): Promise<string>;
  deleteBlob(id: string): Promise<void>;
  create(req: CreateRequest): Promise<CreateResult>;
  discard(): Promise<void>;
  saveForLater(): Promise<void>;
  ai(): Promise<{ ai: AiDraftText | null; reason: AiUnavailableReason | null }>;
  /** copy from the extension, never from the page (J-202) */
  copy(text: string): Promise<boolean>;
  /** the editor is done; the host removes it */
  close(reason: 'created' | 'discarded' | 'saved', info?: { copied?: boolean; opened?: boolean; issueError?: string | null }): void;
  /** Open the created capture right of the source tab, after the link is copied (J-086). */
  openCapture?(res: CreateResult, tabId: number): Promise<{ opened: boolean } | void>;
  /**
   * Tracker field form data (J-140): repos, labels, assignees and milestones for a repo, the values
   * last filed with this integration, and an error when the tracker did not answer.
   */
  trackerOptions?(integrationId: string, repo?: string): Promise<{ options: TrackerOptions | null; recent: TrackerRecent | null; error: string | null }>;
  openUrl(url: string): void;
  /** server base URL for settings links */
  serverUrl(): string;
}
