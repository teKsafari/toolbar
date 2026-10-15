// Extension messages the ext-ui area adds. Only the ext-ui area edits this file.
// Entries merge into BgRequestMap and ContentCommand in ../messages.ts.
import type { Folder } from '../../api/folders.ts';
import type { CaptureSession, RecordMode } from '../state.ts';

/** Where the popup is opened: drives the restricted state (J-199) and context rows (J-019). */
export interface PopupContext {
  tabId: number | null;
  url: string | null;
  host: string | null;
  restricted: boolean;
  /** the tab shows our own server: the record row offers desktop instead of tab (J-019) */
  isServerPage: boolean;
  /** record mode the record row starts with on this page */
  recordMode: RecordMode;
  /** replay ring judged heavy for this page load and not overridden (J-011) */
  heavy: boolean;
  /** the page is on the replay blocked-sites list (J-012) */
  replayBlocked: boolean;
  /** D-120: may the extension run here, and what is missing (absent in older workers) */
  site?: SiteAccess;
}

/** The popup's view of host access for the tab's page (D-117, D-120). */
export interface SiteAccess {
  /** the project whose origins cover the page */
  project: { id: string; name: string; maskingPreset: 'staging' | 'production' } | null;
  /** capture scripts may run on this page */
  allowed: boolean;
  /** match patterns of the user's project origins that still lack host access */
  missing: string[];
  /** how many projects the signed-in user has across workspaces */
  projectCount: number;
  /** a test build in Part 1 mode, where every site is allowed */
  allSites: boolean;
}

/** Extra service-worker requests: `'name': { req: {...}; res: {...} }`. */
export interface ExtUiBgRequests {
  /** in-page UI mount: the session view for the sender's tab (after a navigation mid-recording) */
  'ui.state': { req: {}; res: { cmd: UiSessionCommand; tabId: number | null } };
  /** popup open: context of the active tab (J-001, J-019, J-199) */
  'ui.context': { req: { tabId?: number }; res: { context: PopupContext } };
  /** pull account-level extension settings from the server (J-215) */
  'settings.sync': { req: {}; res: { changed: boolean } };
  /** folders and the default recorder domain for the recording-link form (J-015, J-232) */
  'link.options': { req: { workspaceId?: string }; res: { folders: Pick<Folder, 'id' | 'name'>[]; recorderDomain: string; workspaceId: string | null } };
  /** in-page tools: the bar opened or closed the pen or blur tool (J-030, J-031) */
  'recording.tool': { req: { tool: 'pen' | 'blur' | null }; res: {} };
  /** reset the extension to defaults (J-176): settings, drafts index, session */
  'ext.reset': { req: {}; res: {} };
}

/** Extra sw -> content commands (a union member with a unique `type`). */
export type ExtUiContentCommand =
  /** clear live strokes and in-page blurs when a recording ends */
  | { type: 'ui.tools-reset' }
  | UiSessionCommand;

/**
 * The whole session for the tab, sent on every change: the in-page UI (screenshot mode,
 * countdown, recording bar, processing pill) is a pure view of it. The base ui.bar,
 * ui.countdown and ui.screenshot-mode commands carry the same facts in pieces; ext-ui sends
 * this one instead.
 */
export interface UiSessionCommand {
  type: 'ui.session';
  session: CaptureSession;
  /** worker clock when sent */
  now: number;
  /** countdown time left at `now` (J-027) */
  countdownLeftMs: number;
  /** recording cap in ms, or null (J-013) */
  capMs: number | null;
  /** in-page tool open on the bar (J-030, J-031) */
  tool: 'pen' | 'blur' | null;
}
