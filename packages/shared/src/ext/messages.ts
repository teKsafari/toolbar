// Messages between extension contexts. One union per channel keeps routing typed.
//
// Contexts: sw (service worker), popup, content (isolated content script, which also hosts the
// in-page UI in <toolbar-root>: screenshot mode, countdown, recording bar, editor modal),
// main (MAIN-world capture script; talks only to content over the private MessageChannel in
// @toolbar/capture), offscreen (MediaRecorder, clipboard), editor (the editor UI, in the content
// shadow root or in an extension-page iframe inside it), permissions (one-time mic grant page).
//
// Channels:
//   content -> sw     port CAPTURE_PORT            PortMessage
//   sw -> content     same port                    PortCommand
//   any page -> sw    runtime.sendMessage          BgRequest -> BgResult<type>
//   sw -> content     tabs.sendMessage(tabId)      ContentCommand
//   sw -> everyone    runtime + tabs broadcast     Broadcast
//   sw -> offscreen   runtime.sendMessage          OffscreenRequest (to: 'offscreen')
//   offscreen -> sw   runtime.sendMessage          OffscreenEvent (from: 'offscreen')
//   editor iframe <-> content host   window.postMessage   EditorFrameMessage (tag EDITOR_FRAME_TAG)
import type { CaptureEvent, Rect } from '../events.ts';
import type { ExtBootstrap, ExtensionSettings } from '../api/account.ts';
import type { FinalizeCaptureBody } from '../api/captures.ts';
import type { LinkedIssue } from '../api/captures.ts';
import type { Person } from '../api/common.ts';
import type { RecordingLink } from '../api/folders.ts';
import type { StreamName } from '../constants.ts';
import type { CaptureSession, MicState, RecordMode, ReplayState } from './state.ts';
import type { Draft, DraftSummary } from './storage.ts';
import type { ServerCoreBgRequests, ServerCoreContentCommand } from './areas/server-core.ts';
import type { AuthBgRequests, AuthContentCommand } from './areas/auth.ts';
import type { CaptureBgRequests, CaptureContentCommand } from './areas/capture.ts';
import type { ExtUiBgRequests, ExtUiContentCommand } from './areas/ext-ui.ts';
import type { EditorBgRequests, EditorContentCommand } from './areas/editor.ts';
import type { ViewerBgRequests, ViewerContentCommand } from './areas/viewer.ts';
import type { DashboardBgRequests, DashboardContentCommand } from './areas/dashboard.ts';
import type { AgentBgRequests, AgentContentCommand } from './areas/agent.ts';
import type { TraceBgRequests } from './areas/trace.ts';

export const CAPTURE_PORT = 'capture';
/** postMessage tag between the editor iframe and its content-script host. */
export const EDITOR_FRAME_TAG = '__tb_editor';

// ---------- content <-> sw over the capture port ----------

/** Content script (isolated world) -> service worker. */
export type PortMessage =
  /** `loadId` is the document's performance.timeOrigin, one value per page load (J-011) */
  | { type: 'hello'; url: string; top: boolean; title?: string; frameId?: number; loadId?: number }
  | { type: 'events'; batch: CaptureEvent[] }
  /** rrweb events go to their own stream (architecture s4) */
  | { type: 'rrweb'; batch: unknown[]; full: boolean }
  /** DOM size for the heavy-page guard (J-011) */
  | { type: 'page-weight'; nodes: number; mutationsPerSec: number };

/** Service worker -> content script over the same port. */
export type PortCommand =
  /** stream events and rrweb into a recording from now on */
  | { type: 'attach'; recordingId: string; t0: number }
  | { type: 'detach'; recordingId: string }
  /** instant-replay ring on or off for this document */
  | { type: 'ring'; enabled: boolean; minutes: number }
  /** take an rrweb full snapshot now (start of a recording, replay cut point) */
  | { type: 'checkout' }
  | { type: 'config'; captureUserEvents: boolean; maskingPreset: 'staging' | 'production' | 'none' };

// ---------- requests to the service worker ----------

export type CaptureMode = 'screenshot' | 'video' | 'replay' | 'link';

/**
 * Request name -> request fields and success payload. Areas add requests in ext/areas/<area>.ts;
 * they merge in through `extends`.
 */
export interface BgRequestMap
  extends ServerCoreBgRequests,
    AuthBgRequests,
    CaptureBgRequests,
    ExtUiBgRequests,
    EditorBgRequests,
    ViewerBgRequests,
    DashboardBgRequests,
    AgentBgRequests,
    TraceBgRequests {
  /** debug and e2e: counters */
  status: { req: {}; res: { stats: unknown } };
  'session.get': { req: {}; res: { session: CaptureSession; replay: ReplayState; tabId: number | null; restricted: boolean } };
  /** popup row, command or dashboard button (J-001, J-018). Recording again while recording stops (J-181). */
  capture: { req: { mode: CaptureMode; tabId?: number; recordMode?: RecordMode; delaySec?: number }; res: { session: CaptureSession } };
  /** from screenshot mode: the click or drag (rect in CSS px, viewport coordinates) */
  'screenshot.take': { req: { rect: Rect | null; dpr: number }; res: { draftId: string } };
  'screenshot.cancel': { req: {}; res: {} };
  'countdown.pause': { req: {}; res: {} };
  'countdown.resume': { req: {}; res: {} };
  'countdown.cancel': { req: {}; res: {} };
  /** the page painted without the countdown veil (J-006): the recorder may start */
  'countdown.cleared': { req: { recordingId: string }; res: {} };
  'recording.stop': { req: {}; res: { session: CaptureSession } };
  'recording.pause': { req: {}; res: {} };
  'recording.resume': { req: {}; res: {} };
  'recording.mic': { req: { muted?: boolean; deviceId?: string }; res: { mic: MicState } };
  /** microphones the extension can record from, and the one in use, for the bar's device menu (J-211) */
  'recording.micDevices': { req: {}; res: { devices: { id: string; label: string }[]; current: string | null } };
  /** pen stroke, blur toggle or user mark, kept as a marker event (J-030, J-031) */
  'recording.mark': { req: { kind: 'pen' | 'blur' | 'mark'; label?: string }; res: {} };
  'replay.trigger': { req: { tabId?: number }; res: { draftId: string } };
  'replay.set': { req: { enabled: boolean; video?: boolean; tabId?: number; allowHeavy?: boolean }; res: { replay: ReplayState } };
  'draft.list': { req: {}; res: { drafts: DraftSummary[] } };
  'draft.get': { req: { draftId: string }; res: { draft: Draft; blobs: Record<string, string> } };
  'draft.update': { req: { draftId: string; patch: Partial<Omit<Draft, 'id' | 'kind' | 'createdAt'>> }; res: { draft: Draft } };
  /** create: uploads what is left, finalizes, copies the link, opens the capture tab (J-086) */
  'draft.create': {
    req: { draftId: string; finalize: FinalizeCaptureBody };
    res: { recordingId: string; shareUrl: string; issue: LinkedIssue | null; issueError: string | null };
  };
  'draft.discard': { req: { draftId: string }; res: {} };
  'draft.saveForLater': { req: { draftId: string }; res: {} };
  /** reopen the editor on a draft in a tab (J-218) */
  'draft.open': { req: { draftId: string; tabId?: number }; res: {} };
  'auth.state': { req: {}; res: { signedIn: boolean; user: Person | null; serverUrl: string } };
  'auth.signIn': { req: {}; res: { user: Person } };
  'auth.signOut': { req: {}; res: {} };
  'bootstrap.get': { req: { refresh?: boolean; workspaceId?: string }; res: { bootstrap: ExtBootstrap } };
  'settings.update': { req: { patch: Partial<ExtensionSettings> }; res: { settings: ExtensionSettings } };
  'link.create': {
    req: { name: string; folderId: string | null; recorderDomain: string | null; workspaceId?: string };
    res: { link: RecordingLink };
  };
  'clipboard.write': { req: { text: string }; res: {} };
  /** opens the permissions page once if needed (J-014, J-200) */
  'mic.request': { req: {}; res: { granted: boolean } };
  /** from the permissions page */
  'mic.result': { req: { granted: boolean; deviceCount: number }; res: {} };
  /** open a URL in a background tab right of the source tab (J-086) */
  'tab.open': { req: { url: string; background?: boolean }; res: { tabId: number } };
  /** restart the extension (J-177) */
  'ext.restart': { req: {}; res: {} };
}

export type BgRequestType = keyof BgRequestMap;
export type BgRequest = { [K in BgRequestType]: { type: K } & BgRequestMap[K]['req'] }[BgRequestType];
export type BgRequestOf<K extends BgRequestType> = { type: K } & BgRequestMap[K]['req'];

export const BG_ERRORS = ['not_signed_in', 'restricted_page', 'busy', 'not_found', 'not_implemented', 'permission_denied', 'network', 'server', 'invalid'] as const;
export type BgError = (typeof BG_ERRORS)[number];

export type BgResult<K extends BgRequestType> = ({ ok: true } & BgRequestMap[K]['res']) | { ok: false; error: BgError; message?: string };

// ---------- sw -> content (tabs.sendMessage) ----------

export interface BarState {
  recordingId: string;
  mode: RecordMode;
  startedAt: number;
  pausedAt: number | null;
  pausedMs: number;
  mic: MicState;
  /** recording cap in ms (J-013); the timer turns orange then red near it */
  capMs: number | null;
}

export type ContentCommand =
  | { type: 'ui.screenshot-mode'; armed: boolean; delaySec: number }
  | { type: 'ui.countdown'; from: number; startedAt: number; paused: boolean }
  | { type: 'ui.countdown-hide' }
  | { type: 'ui.bar'; bar: BarState | null }
  /** spinner on the bar after stop (J-034) */
  | { type: 'ui.processing'; visible: boolean }
  | { type: 'ui.editor-open'; draftId: string }
  | { type: 'ui.editor-close' }
  | { type: 'ui.toast'; kind: 'info' | 'success' | 'error'; text: string; action?: { label: string; request: BgRequest } }
  /** delay timer pill before a screenshot (J-005) */
  | { type: 'ui.shot-delay'; seconds: number }
  /** worker asks the page for geometry before cropping */
  | { type: 'page.geometry' }
  // per-area additions (ext/areas/<area>.ts)
  | ServerCoreContentCommand
  | AuthContentCommand
  | CaptureContentCommand
  | ExtUiContentCommand
  | EditorContentCommand
  | ViewerContentCommand
  | DashboardContentCommand
  | AgentContentCommand;

/** Reply to page.geometry. */
export interface PageGeometry {
  viewport: { w: number; h: number };
  scroll: { x: number; y: number };
  dpr: number;
  url: string;
  title: string;
}

// ---------- broadcasts ----------

export type Broadcast =
  | { type: 'session.changed'; session: CaptureSession; replay: ReplayState }
  | { type: 'upload.progress'; recordingId: string; sent: number; total: number }
  | { type: 'auth.changed'; signedIn: boolean };

// ---------- sw <-> offscreen ----------

export interface UploadAuth {
  serverUrl: string;
  /** device token, or the upload token for recording-link captures */
  token: string;
}

export type OffscreenRequest =
  | { to: 'offscreen'; type: 'record-tab'; streamId: string; recordingId: string; w: number; h: number; mic: boolean; micDeviceId?: string; upload: UploadAuth }
  /** Take the tab stream at the gesture: a stream id expires seconds after it is issued. */
  /** `mic`: open the microphone now too, so it is warm when the countdown ends (J-027) */
  | { to: 'offscreen'; type: 'hold-tab'; streamId: string; w: number; h: number; mic?: boolean; micDeviceId?: string }
  | { to: 'offscreen'; type: 'release-tab'; streamId: string }
  | { to: 'offscreen'; type: 'record-screen'; recordingId: string; surface: 'screen' | 'desktop'; mic: boolean; micDeviceId?: string; upload: UploadAuth }
  | { to: 'offscreen'; type: 'pause'; recordingId: string }
  | { to: 'offscreen'; type: 'resume'; recordingId: string }
  | { to: 'offscreen'; type: 'mic'; recordingId: string; muted: boolean; deviceId?: string }
  | { to: 'offscreen'; type: 'stop'; recordingId: string }
  /** instant replay with video: keep 10 s standalone WebM segments for a tab (D-013) */
  | { to: 'offscreen'; type: 'replay-video-start'; tabId: number; streamId: string; minutes: number }
  | { to: 'offscreen'; type: 'replay-video-stop'; tabId: number }
  /** upload the kept segments of a tab into a replay recording */
  | { to: 'offscreen'; type: 'replay-video-flush'; tabId: number; recordingId: string; upload: UploadAuth }
  | { to: 'offscreen'; type: 'clipboard'; text: string }
  | { to: 'offscreen'; type: 'mic-devices'; recordingId?: string }
  | { to: 'offscreen'; type: 'ping' };

export type OffscreenEvent =
  /** `t` is stamped in MediaRecorder's start handler (architecture s4 "Clock") */
  | { from: 'offscreen'; type: 'started'; recordingId: string; t: number; mime: string; width: number; height: number; mic: MicState }
  | { from: 'offscreen'; type: 'chunk'; recordingId: string; stream: StreamName; seq: number; bytes: number; uploaded: boolean }
  | { from: 'offscreen'; type: 'stopped'; recordingId: string; durationMs: number; lastSeq: Partial<Record<StreamName, number>> }
  | { from: 'offscreen'; type: 'picker-cancelled'; recordingId: string }
  /** the shared tab or screen ended from Chrome's own stop button */
  | { from: 'offscreen'; type: 'ended'; recordingId: string }
  | { from: 'offscreen'; type: 'error'; recordingId: string | null; error: string; message: string };

// ---------- editor iframe <-> content host ----------

export type EditorFrameMessage =
  | { [EDITOR_FRAME_TAG]: true; type: 'ready' }
  | { [EDITOR_FRAME_TAG]: true; type: 'close'; reason: 'created' | 'discarded' | 'saved'; /** created: whether the link reached the clipboard */ copied?: boolean; /** created: whether the capture page opened (J-089) */ opened?: boolean; /** created: the tracker refused the issue; the capture is saved (J-140) */ issueError?: string | null }
  | { [EDITOR_FRAME_TAG]: true; type: 'escape-pressed' }
  /** create started (J-086): the host shows a progress toast at once; create-failed takes it away */
  | { [EDITOR_FRAME_TAG]: true; type: 'creating' }
  | { [EDITOR_FRAME_TAG]: true; type: 'create-failed' }
  | { [EDITOR_FRAME_TAG]: true; type: 'size'; w: number; h: number };

export function isEditorFrameMessage(x: unknown): x is EditorFrameMessage {
  return typeof x === 'object' && x !== null && (x as Record<string, unknown>)[EDITOR_FRAME_TAG] === true;
}

export function isOffscreenRequest(x: unknown): x is OffscreenRequest {
  return typeof x === 'object' && x !== null && (x as { to?: unknown }).to === 'offscreen';
}

export function isOffscreenEvent(x: unknown): x is OffscreenEvent {
  return typeof x === 'object' && x !== null && (x as { from?: unknown }).from === 'offscreen';
}
