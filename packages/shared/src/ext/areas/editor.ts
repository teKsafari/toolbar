// Extension messages the editor area adds. Only the editor area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.
import type { ExtBootstrap } from '../../api/account.ts';
import type { FinalizeCaptureBody, LinkedIssue } from '../../api/captures.ts';
import type { AiDraftText, AiUnavailableReason, EditorPrefs } from '../../areas/editor.ts';

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface EditorBgRequests {
  /**
   * Create from the editor (J-086): like draft.create, plus the flattened PNGs the editor wrote
   * to the `blobs` store (annotations burned in, J-051). The worker creates the capture if the
   * draft has none yet, uploads the images and attachments, finalizes, and opens the capture in
   * a background tab right of the source tab.
   */
  'editor.create': {
    req: { draftId: string; finalize: FinalizeCaptureBody; flatBlobId?: string | null; flatFullBlobId?: string | null; openTab?: boolean };
    res: { recordingId: string; shareUrl: string; issue: LinkedIssue | null; issueError: string | null };
  };
  /** AI ghost text for a video or replay draft (J-083); `ai` is null with a reason when there is none. */
  'editor.ai': { req: { draftId: string }; res: { ai: AiDraftText | null; reason: AiUnavailableReason | null } };
  /** Workspaces, folders and integrations for the pickers (J-080, J-081, J-079); null when signed out. */
  'editor.bootstrap': { req: { workspaceId?: string | null; refresh?: boolean }; res: { bootstrap: ExtBootstrap | null } };
  'editor.prefs': { req: { patch?: Partial<EditorPrefs> }; res: { prefs: EditorPrefs } };
  /**
   * Open a created capture (and its filed issue) in background tabs right of the source tab
   * (J-086). The editor sends it after the link is on the clipboard, so the copy never races the
   * new tab.
   */
  'editor.openCapture': { req: { recordingId: string; tabId: number; issueUrl?: string | null }; res: {} };
  /** Open a server page (integration settings) in a new tab next to the source tab. */
  'editor.openTab': { req: { url: string; tabId?: number }; res: {} };
}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type EditorContentCommand = never;
