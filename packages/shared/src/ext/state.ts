// Capture session state machine for the extension (one session per browser profile).
// The service worker owns it and keeps it in chrome.storage.session (STORAGE.session), so a
// worker restart resumes where it stopped. `transition()` is pure; side effects (tabCapture,
// offscreen, uploads, UI commands) run in the worker after a transition is accepted.
import type { RecordingKind } from '../constants.ts';

/**
 * How a video is recorded.
 * - tab: chrome.tabCapture of the current tab, 3-2-1 countdown, viewport only (J-006).
 * - screen: getDisplayMedia, the user picks a window or tab in Chrome's picker (J-007).
 * - desktop: getDisplayMedia of a whole screen; the bar follows tab switches (J-007, J-008).
 * screen and desktop store RecordingKind "screen"; tab stores "video".
 */
export const RECORD_MODES = ['tab', 'screen', 'desktop'] as const;
export type RecordMode = (typeof RECORD_MODES)[number];

export const recordingKindOf = (mode: RecordMode): RecordingKind => (mode === 'tab' ? 'video' : 'screen');

export type MicState = 'off' | 'on' | 'muted' | 'denied';

export type CaptureSession =
  | { state: 'idle' }
  /** Screenshot mode armed: cursor pill, next click or drag takes the shot (J-025, J-003). */
  | { state: 'arming-screenshot'; tabId: number; delaySec: number; armedAt: number }
  /** 3-2-1 veil before a tab recording (J-027). */
  | { state: 'countdown'; tabId: number; mode: RecordMode; startedAt: number; paused: boolean; recordingId: string }
  /** Waiting for MediaRecorder start (and for Chrome's picker on screen and desktop). */
  | { state: 'starting'; tabId: number; mode: RecordMode; recordingId: string }
  | {
      state: 'recording';
      tabId: number;
      mode: RecordMode;
      recordingId: string;
      startedAt: number;
      /** set while paused (J-029) */
      pausedAt: number | null;
      pausedMs: number;
      mic: MicState;
      /** every tab the recording visited (desktop mode, J-008) */
      tabs: number[];
    }
  /** After stop: processing pill on the bar until the draft is ready (J-034). */
  | { state: 'stopping'; tabId: number; mode: RecordMode; recordingId: string; stoppedAt: number }
  /** Editor open on a draft; capture rows disabled in the popup (J-035). */
  | { state: 'draft'; draftId: string; tabId: number; kind: RecordingKind; recordingId: string | null }
  /** Create clicked: finalize and remaining uploads in flight (J-086). */
  | { state: 'uploading'; draftId: string; tabId: number; recordingId: string }
  | { state: 'error'; error: string; message: string; draftId: string | null; tabId: number | null };

export type SessionState = CaptureSession['state'];
export const SESSION_STATES = [
  'idle',
  'arming-screenshot',
  'countdown',
  'starting',
  'recording',
  'stopping',
  'draft',
  'uploading',
  'error',
] as const satisfies readonly SessionState[];

/** Instant replay is orthogonal to the session: the ring runs while the user records or edits. */
export interface ReplayState {
  enabled: boolean;
  minutes: number;
  /** tabs with a live ring, and whether that ring includes video (opt-in, D-013) */
  tabs: Record<number, { since: number; video: boolean; heavy: boolean }>;
}
export const DEFAULT_REPLAY: ReplayState = { enabled: false, minutes: 2, tabs: {} };

export type SessionEvent =
  | { type: 'ARM_SCREENSHOT'; tabId: number; delaySec: number; now: number }
  | { type: 'SHOT_TAKEN'; draftId: string; kind?: RecordingKind }
  | { type: 'CANCEL' }
  | { type: 'START_RECORDING'; tabId: number; mode: RecordMode; recordingId: string; now: number }
  | { type: 'COUNTDOWN_PAUSE' }
  | { type: 'COUNTDOWN_RESUME'; now: number }
  | { type: 'COUNTDOWN_DONE' }
  | { type: 'MEDIA_STARTED'; recordingId: string; now: number; mic: MicState }
  | { type: 'PICKER_CANCELLED' }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'MIC'; mic: MicState }
  | { type: 'TAB_ACTIVATED'; tabId: number }
  | { type: 'STOP'; now: number }
  | { type: 'DRAFT_READY'; draftId: string; kind: RecordingKind; recordingId: string | null; tabId: number }
  | { type: 'CREATE'; recordingId: string }
  | { type: 'UPLOAD_DONE' }
  | { type: 'UPLOAD_FAILED'; error: string; message: string }
  | { type: 'DISCARD' }
  | { type: 'SAVE_FOR_LATER' }
  | { type: 'FAIL'; error: string; message: string }
  | { type: 'RESET' };

export const IDLE: CaptureSession = { state: 'idle' };

/**
 * Next session for an event. Returns the same object when the event does not apply, so
 * `transition(s, e) === s` means "ignored".
 */
export function transition(s: CaptureSession, e: SessionEvent): CaptureSession {
  if (e.type === 'RESET') return IDLE;
  if (e.type === 'FAIL') {
    const draftId = 'draftId' in s ? s.draftId : null;
    const tabId = 'tabId' in s ? s.tabId : null;
    return { state: 'error', error: e.error, message: e.message, draftId, tabId };
  }
  switch (s.state) {
    case 'idle':
      if (e.type === 'ARM_SCREENSHOT') return { state: 'arming-screenshot', tabId: e.tabId, delaySec: e.delaySec, armedAt: e.now };
      if (e.type === 'START_RECORDING')
        return e.mode === 'tab'
          ? { state: 'countdown', tabId: e.tabId, mode: e.mode, recordingId: e.recordingId, startedAt: e.now, paused: false }
          : { state: 'starting', tabId: e.tabId, mode: e.mode, recordingId: e.recordingId };
      // instant replay and recording links go straight to a draft
      if (e.type === 'DRAFT_READY') return { state: 'draft', draftId: e.draftId, tabId: e.tabId, kind: e.kind, recordingId: e.recordingId };
      return s;
    case 'arming-screenshot':
      if (e.type === 'CANCEL') return IDLE;
      if (e.type === 'SHOT_TAKEN') return { state: 'draft', draftId: e.draftId, tabId: s.tabId, kind: e.kind ?? 'screenshot', recordingId: null };
      if (e.type === 'ARM_SCREENSHOT') return IDLE; // the same chord toggles screenshot mode off (J-026)
      return s;
    case 'countdown':
      if (e.type === 'CANCEL') return IDLE;
      if (e.type === 'COUNTDOWN_PAUSE') return { ...s, paused: true };
      if (e.type === 'COUNTDOWN_RESUME') return { ...s, paused: false, startedAt: e.now };
      if (e.type === 'COUNTDOWN_DONE') return { state: 'starting', tabId: s.tabId, mode: s.mode, recordingId: s.recordingId };
      return s;
    case 'starting':
      if (e.type === 'MEDIA_STARTED' && e.recordingId === s.recordingId)
        return { state: 'recording', tabId: s.tabId, mode: s.mode, recordingId: s.recordingId, startedAt: e.now, pausedAt: null, pausedMs: 0, mic: e.mic, tabs: [s.tabId] };
      if (e.type === 'PICKER_CANCELLED' || e.type === 'CANCEL') return IDLE; // J-201: no draft left
      return s;
    case 'recording':
      if (e.type === 'PAUSE' && s.pausedAt === null) return { ...s, pausedAt: e.now };
      if (e.type === 'RESUME' && s.pausedAt !== null) return { ...s, pausedAt: null, pausedMs: s.pausedMs + (e.now - s.pausedAt) };
      if (e.type === 'MIC') return { ...s, mic: e.mic };
      if (e.type === 'TAB_ACTIVATED' && s.mode === 'desktop')
        return { ...s, tabId: e.tabId, tabs: s.tabs.includes(e.tabId) ? s.tabs : [...s.tabs, e.tabId] };
      if (e.type === 'STOP') return { state: 'stopping', tabId: s.tabId, mode: s.mode, recordingId: s.recordingId, stoppedAt: e.now };
      return s;
    case 'stopping':
      if (e.type === 'DRAFT_READY') return { state: 'draft', draftId: e.draftId, tabId: e.tabId, kind: e.kind, recordingId: e.recordingId };
      return s;
    case 'draft':
      if (e.type === 'CREATE') return { state: 'uploading', draftId: s.draftId, tabId: s.tabId, recordingId: e.recordingId };
      if (e.type === 'DISCARD' || e.type === 'SAVE_FOR_LATER') return IDLE;
      return s;
    case 'uploading':
      if (e.type === 'UPLOAD_DONE') return IDLE;
      if (e.type === 'UPLOAD_FAILED') return { state: 'error', error: e.error, message: e.message, draftId: s.draftId, tabId: s.tabId };
      return s;
    case 'error':
      if (e.type === 'CANCEL' || e.type === 'DISCARD') return IDLE;
      return s;
  }
}

/** Recorded time so far, excluding pauses (bar timer, J-028). */
export function elapsedMs(s: CaptureSession, now: number): number {
  if (s.state !== 'recording') return 0;
  const end = s.pausedAt ?? now;
  return Math.max(0, end - s.startedAt - s.pausedMs);
}

export type PopupAction = 'screenshot' | 'record' | 'stop' | 'replay' | 'link' | 'exit-screenshot' | 'open-drafts';

/** Which popup rows are live for a session (J-026, J-035, J-239). */
export function popupActions(s: CaptureSession, replay: ReplayState): PopupAction[] {
  switch (s.state) {
    case 'idle':
      return replay.enabled ? ['screenshot', 'record', 'replay', 'link'] : ['screenshot', 'record', 'link'];
    case 'arming-screenshot':
      // the recording link stays usable while screenshot mode is armed (J-026)
      return ['exit-screenshot', 'link'];
    case 'countdown':
    case 'starting':
    case 'recording':
      return ['stop', 'link'];
    case 'stopping':
    case 'uploading':
      return ['link'];
    case 'draft':
      return ['link', 'open-drafts'];
    case 'error':
      return ['link', 'open-drafts'];
  }
}
