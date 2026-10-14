// The editor talks to its surroundings only through EditorHost, so the same component runs in
// the extension's editor iframe, in tests, and in a dev harness.
import type { ExtBootstrap } from '@toolbar/shared/api';
import type { Draft } from '@toolbar/shared/ext';
import type { AiDraftText, AiUnavailableReason, EditorPrefs } from '@toolbar/shared/areas/editor';
import type { FinalizeCaptureBody } from '@toolbar/shared/api';

export type { AiDraftText, AiUnavailableReason, EditorPrefs };

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
  attachments: AttachmentInfo[];
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
  close(reason: 'created' | 'discarded' | 'saved'): void;
  openUrl(url: string): void;
  /** server base URL for settings links */
  serverUrl(): string;
}
