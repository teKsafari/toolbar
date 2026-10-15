// Service worker, ext-ui area: the capture session store and everything the user sees outside
// the editor. It owns
//   - the session (ext/state.ts transition()) in chrome.storage.session, with one dispatch()
//     that every area calls, and the fan-out of each change to the tab UI, the popup and the
//     action icon (J-033);
//   - the popup and in-page requests: capture rows, screenshot mode, countdown, bar controls,
//     settings, recording links, restart and reset;
//   - the keyboard commands (J-179 to J-184; Chrome opens the popup for _execute_action itself);
//   - the recording cap timer (J-013).
// Media work (tabCapture, offscreen recorders, captureVisibleTab, replay ring, drafts) sits
// behind CaptureDriver, which the capture area implements in lib/bg/capture.ts and installs
// with setCaptureDriver(). Until then every media call fails with not_implemented.
import { browser } from 'wxt/browser';
import { migrateStorage } from '../migrate';
import { applyBrandIcon, setIconBusy } from './brand';
import { DEFAULT_SERVER_URL, uuidv7, type RecordingKind } from '@toolbar/shared';
import {
  DEFAULT_USER_SETTINGS,
  ROUTES,
  buildPath,
  extensionSettingsSchema,
  type ExtBootstrap,
  type ExtensionSettings,
  type Folder,
  type RecordingLink,
  type UserSettings,
} from '@toolbar/shared/api';
import {
  DEFAULT_REPLAY,
  IDLE,
  STORAGE,
  elapsedMs,
  transition,
  type BgError,
  type BgRequestMap,
  type BgRequestType,
  type CaptureSession,
  type ContentCommand,
  type MicState,
  type PopupContext,
  type RecordMode,
  type ReplayState,
  type SessionEvent,
  type UiSessionCommand,
  type StorageName,
  type StorageValues,
} from '@toolbar/shared/ext';
import { COUNTDOWN_FROM, DEFAULT_REPLAY_BLOCKED_SITES, isReplayBlocked, isRestrictedUrl } from '@toolbar/shared/areas/ext-ui';
import type { Rect } from '@toolbar/shared/events';
import { TEST_HOOKS } from '../flags';
import { ensureContent } from '../registration';

// ---------------------------------------------------------------- errors

export class BgFailure extends Error {
  constructor(
    readonly code: BgError,
    message?: string,
  ) {
    super(message ?? code);
  }
}

// ---------------------------------------------------------------- storage

export async function readStore<K extends StorageName>(name: K): Promise<StorageValues[K] | undefined> {
  await migrateStorage();
  const { area, key } = STORAGE[name];
  const got = await browser.storage[area].get(key);
  return got[key] as StorageValues[K] | undefined;
}

export async function writeStore<K extends StorageName>(name: K, value: StorageValues[K]): Promise<void> {
  const { area, key } = STORAGE[name];
  await browser.storage[area].set({ [key]: value });
}

/** Defaults for a fresh install: account defaults plus our replay blocked-sites list (J-012). */
export function defaultSettings(): ExtensionSettings {
  return { ...DEFAULT_USER_SETTINGS.extension, replayBlockedSites: [...DEFAULT_REPLAY_BLOCKED_SITES] };
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await readStore('settings');
  return { ...defaultSettings(), ...(stored ?? {}) };
}

async function saveSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const next = { ...(await getSettings()), ...patch };
  await writeStore('settings', next);
  return next;
}

export async function serverUrl(): Promise<string> {
  const override = await readStore('serverUrl');
  if (override) return override;
  const auth = await readStore('auth');
  if (auth?.serverUrl) return auth.serverUrl;
  return (import.meta.env.WXT_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL;
}

// ---------------------------------------------------------------- API calls with the device token

async function apiCall<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const auth = await readStore('auth');
  if (!auth?.token) throw new BgFailure('not_signed_in', 'Sign in first');
  const url = new URL(path, auth.serverUrl || (await serverUrl()));
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${auth.token}`, ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new BgFailure('network', 'The server did not answer');
  }
  if (res.status === 401) throw new BgFailure('not_signed_in', 'Your sign-in expired');
  if (res.status === 404) throw new BgFailure('not_found');
  if (res.status === 501) throw new BgFailure('not_implemented');
  if (!res.ok) {
    let message = `Server error ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message ?? body.error ?? message;
    } catch {
      /* not JSON */
    }
    throw new BgFailure(res.status >= 500 ? 'server' : 'invalid', message);
  }
  return (res.status === 204 ? {} : await res.json()) as T;
}

// ---------------------------------------------------------------- capture driver (capture area)

export interface StartRecordingOptions {
  tabId: number;
  mode: RecordMode;
  recordingId: string;
  mic: boolean;
  micDeviceId: string | null;
}

export interface DraftHandle {
  draftId: string;
  kind: RecordingKind;
  recordingId: string | null;
  tabId: number;
}

/**
 * Media side of the session. The capture area implements it (lib/bg/capture.ts) and calls
 * setCaptureDriver() at worker start. Methods throw BgFailure on failure; startRecording
 * throws BgFailure('permission_denied', 'picker_cancelled') when Chrome's picker is cancelled.
 */
export interface CaptureDriver {
  /** At the user gesture (popup row or command), before the countdown: tabCapture stream id here. */
  prepareRecording?(o: StartRecordingOptions): Promise<void>;
  /** Resolves once MediaRecorder started. */
  startRecording(o: StartRecordingOptions): Promise<{ mic: MicState }>;
  /** Abort a recording that never went live (countdown or picker). */
  cancelRecording?(recordingId: string): Promise<void>;
  /** Stop, gather logs, write the draft. Resolves when the editor can open (J-034). */
  stopRecording(o: { recordingId: string; tabId: number; mode: RecordMode }): Promise<DraftHandle>;
  pauseRecording(recordingId: string): Promise<void>;
  resumeRecording(recordingId: string): Promise<void>;
  setMic(recordingId: string, o: { muted?: boolean; deviceId?: string }): Promise<MicState>;
  /** pen stroke, blur toggle or mark on the timeline (J-030, J-031) */
  mark?(recordingId: string, kind: 'pen' | 'blur' | 'mark', label?: string): Promise<void>;
  /** Screenshot of the viewport, cropped to rect (CSS px) when given; writes a draft. */
  takeScreenshot(o: { tabId: number; rect: Rect | null; dpr: number }): Promise<DraftHandle>;
  /** Instant replay draft from the ring (J-009, J-182). */
  triggerReplay(o: { tabId: number }): Promise<DraftHandle>;
}

const notBuilt = (): never => {
  throw new BgFailure('not_implemented', 'This capture mode is not available in this build');
};
const unavailableDriver: CaptureDriver = {
  startRecording: async () => notBuilt(),
  stopRecording: async () => notBuilt(),
  pauseRecording: async () => notBuilt(),
  resumeRecording: async () => notBuilt(),
  setMic: async () => notBuilt(),
  takeScreenshot: async () => notBuilt(),
  triggerReplay: async () => notBuilt(),
};
let driver: CaptureDriver = unavailableDriver;

export function setCaptureDriver(d: CaptureDriver) {
  driver = d;
}

// ---------------------------------------------------------------- session store

let session: CaptureSession = IDLE;
let replay: ReplayState = DEFAULT_REPLAY;
const loaded = (async () => {
  session = (await readStore('session')) ?? IDLE;
  replay = (await readStore('replay')) ?? DEFAULT_REPLAY;
})();
let queue: Promise<unknown> = Promise.resolve();

export async function getSession(): Promise<CaptureSession> {
  await loaded;
  return session;
}

/**
 * Apply a session event. Serialised, persisted, then fanned out to the tab UI, the popup and
 * the action icon. Every area changes the session through this function only.
 */
export function dispatch(e: SessionEvent): Promise<CaptureSession> {
  const run = queue.then(async () => {
    await loaded;
    const prev = session;
    const next = transition(prev, e);
    if (next === prev) return prev;
    session = next;
    await writeStore('session', next);
    await onSessionChange(prev, next);
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------- fan-out

/** Per-session extras the in-page UI needs and the state machine does not hold. */
interface UiExtras {
  countdownLeftMs: number;
  capMs: number | null;
  tool: 'pen' | 'blur' | null;
}
const extras: UiExtras = { countdownLeftMs: COUNTDOWN_FROM * 1000, capMs: null, tool: null };

export function sendToTab(tabId: number | null | undefined, cmd: ContentCommand) {
  if (tabId == null || tabId < 0) return Promise.resolve();
  // a tab without our content script (restricted, or still loading) has no receiver
  return Promise.resolve()
    .then(() => browser.tabs.sendMessage(tabId, cmd, { frameId: 0 }))
    .catch(() => undefined);
}

function sessionCommand(s: CaptureSession): UiSessionCommand {
  return { type: 'ui.session', session: s, now: Date.now(), ...extras };
}

const tabOf = (s: CaptureSession): number | null => ('tabId' in s ? s.tabId : null);
const LIVE = new Set(['countdown', 'starting', 'recording']);

async function onSessionChange(prev: CaptureSession, next: CaptureSession) {
  stats.transitions.push(`${prev.state}>${next.state}`);
  void browser.runtime.sendMessage({ type: 'session.changed', session: next, replay }).catch(() => undefined);

  const prevTab = tabOf(prev);
  const nextTab = tabOf(next);
  if (prevTab !== null && prevTab !== nextTab) void sendToTab(prevTab, sessionCommand(IDLE));
  if (nextTab !== null) void sendToTab(nextTab, sessionCommand(next));

  if (LIVE.has(prev.state) && !LIVE.has(next.state)) {
    extras.tool = null;
    pausedForBlur = false;
    for (const t of new Set([prevTab, ...(prev.state === 'recording' ? prev.tabs : [])])) void sendToTab(t, { type: 'ui.tools-reset' });
  }
  if (next.state === 'draft' && prev.state !== 'draft') {
    // a draft whose tab is gone (closed while recording or stopping) has nowhere to open its
    // editor; it goes to the Drafts list instead of holding the session (J-035, J-218)
    const alive = await browser.tabs.get(next.tabId).catch(() => null);
    // a tab whose script went with a restart gets a live one first (J-218)
    if (alive) void ensureContent(next.tabId).catch(() => false).then(() => sendToTab(next.tabId, { type: 'ui.editor-open', draftId: next.draftId }));
    else void dispatch({ type: 'SAVE_FOR_LATER' });
  }

  await updateActionIcon(next);
  armCapTimer(next);
}

// ---------------------------------------------------------------- action icon (J-033)

let iconIsRecording = false;

function cameraImage(size: number): ImageData {
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d')!;
  const k = size / 24;
  g.scale(k, k);
  g.fillStyle = '#e0402f';
  g.beginPath();
  g.roundRect(2, 6, 14, 12, 2.5);
  g.fill();
  g.beginPath();
  g.moveTo(16.5, 10.5);
  g.lineTo(22, 7);
  g.lineTo(22, 17);
  g.lineTo(16.5, 13.5);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(9, 12, 2.4, 0, Math.PI * 2);
  g.fill();
  return g.getImageData(0, 0, size, size);
}

async function updateActionIcon(s: CaptureSession) {
  const recording = s.state === 'recording' || s.state === 'starting';
  try {
    if (recording && !iconIsRecording) {
      setIconBusy(true);
      await browser.action.setIcon({ imageData: { 16: cameraImage(16), 32: cameraImage(32) } as never });
      await browser.action.setTitle({ title: 'Recording: click to stop' });
    } else if (!recording && iconIsRecording) {
      // back to the server's brand when signed in, else the packaged icon and name (D-112)
      setIconBusy(false);
      await applyBrandIcon();
    }
    iconIsRecording = recording;
    stats.icon = recording ? 'camera' : 'default';
    const badge = s.state === 'countdown' ? String(Math.max(1, Math.ceil(extras.countdownLeftMs / 1000))) : '';
    await browser.action.setBadgeBackgroundColor({ color: '#e0402f' });
    await browser.action.setBadgeText({ text: badge });
  } catch (e) {
    console.debug('[toolbar] action icon', e);
  }
}

// ---------------------------------------------------------------- countdown (J-027)

let countdownTimer: ReturnType<typeof setTimeout> | null = null;
let countdownTick: ReturnType<typeof setInterval> | null = null;
let countdownStartedAt = 0;

function clearCountdown() {
  if (countdownTimer) clearTimeout(countdownTimer);
  if (countdownTick) clearInterval(countdownTick);
  countdownTimer = countdownTick = null;
}

function runCountdown(leftMs: number) {
  clearCountdown();
  extras.countdownLeftMs = leftMs;
  countdownStartedAt = Date.now();
  countdownTimer = setTimeout(() => void countdownDone(), leftMs);
  countdownTick = setInterval(() => {
    const s = session;
    if (s.state === 'countdown') void updateActionIcon(s).then(() => undefined);
    extras.countdownLeftMs = Math.max(0, leftMs - (Date.now() - countdownStartedAt));
  }, 250);
}

/** The page's word that it painted without the veil, for the recording it names (J-006). */
let veilCleared: { recordingId: string; resolve: () => void } | null = null;
/** No word from the page (a background tab paints nothing): start anyway after this long. */
const VEIL_ACK_TIMEOUT_MS = 700;
/** After the page painted, the tab capture still needs a moment to deliver that frame. */
const VEIL_SETTLE_MS = 80;

async function countdownDone() {
  clearCountdown();
  extras.countdownLeftMs = 0;
  const before = session;
  const recordingId = before.state === 'countdown' ? before.recordingId : null;
  // The page drops the veil on the starting state. The recorder waits until the page says it
  // painted without it, so the video never opens on the veil or the countdown card (J-006): the
  // tab stream was taken at the click and holds its last frame. A fixed wait was not enough
  // when the worker or the page ran late.
  const t0 = Date.now();
  const cleared = new Promise<'ack' | 'timeout'>((resolve) => {
    veilCleared = recordingId ? { recordingId, resolve: () => resolve('ack') } : null;
    setTimeout(() => resolve('timeout'), VEIL_ACK_TIMEOUT_MS);
  });
  const s = await dispatch({ type: 'COUNTDOWN_DONE' });
  if (s.state === 'starting') {
    const how = await cleared;
    stats.veil.push(`${how} ${Date.now() - t0}ms`);
    await new Promise((r) => setTimeout(r, VEIL_SETTLE_MS));
  }
  veilCleared = null;
  if (session.state === 'starting') await beginMedia();
}

// ---------------------------------------------------------------- recording cap (J-013)

let capTimer: ReturnType<typeof setTimeout> | null = null;

function armCapTimer(s: CaptureSession) {
  if (capTimer) clearTimeout(capTimer);
  capTimer = null;
  if (s.state !== 'recording' || !extras.capMs || s.pausedAt !== null) return;
  const left = extras.capMs - elapsedMs(s, Date.now());
  capTimer = setTimeout(() => void stopRecording('cap'), Math.max(0, left));
}

const BOOTSTRAP_STALE_MS = 10 * 60_000;

async function loadCap(): Promise<number | null> {
  const b = await readStore('bootstrap');
  // a recording started by its shortcut may come before any popup fetched the bootstrap:
  // refresh it in the background and pick the cap up before the countdown ends
  if (!b || Date.now() - b.at > BOOTSTRAP_STALE_MS) void refreshBootstrap();
  return b?.data.limits.maxRecordingMs ?? null;
}

async function refreshBootstrap() {
  const data = await apiCall<ExtBootstrap>(ROUTES['ext.bootstrap'].path).catch(() => null);
  if (!data) return;
  await writeStore('bootstrap', { at: Date.now(), data });
  const cap = data.limits.maxRecordingMs ?? null;
  const s = session;
  if (cap !== extras.capMs && (s.state === 'countdown' || s.state === 'starting' || s.state === 'recording')) {
    extras.capMs = cap;
    armCapTimer(s);
    if ('tabId' in s) void sendToTab(s.tabId, sessionCommand(s));
  }
}

// ---------------------------------------------------------------- flows

async function settingsFor(tabId: number) {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  if (!tab || isRestrictedUrl(tab.url)) throw new BgFailure('restricted_page', 'Open a normal web page first');
  return tab;
}

async function toastError(tabId: number | null, e: unknown) {
  const msg = e instanceof BgFailure ? e.message : e instanceof Error ? e.message : String(e);
  stats.errors.push(msg);
  await sendToTab(tabId, { type: 'ui.toast', kind: 'error', text: msg });
}

async function armScreenshot(tabId: number, delaySec: number | undefined) {
  const settings = await getSettings();
  const delay = delaySec ?? settings.screenshotDelaySec;
  const s = await dispatch({ type: 'ARM_SCREENSHOT', tabId, delaySec: delay, now: Date.now() });
  // the delay applies to one shot; the chevron is off again next time (J-005)
  if (settings.screenshotDelaySec !== 0) await saveSettings({ screenshotDelaySec: 0 });
  return s;
}

async function startRecording(tabId: number, mode: RecordMode) {
  const settings = await getSettings();
  const opts: StartRecordingOptions = { tabId, mode, recordingId: uuidv7(), mic: settings.mic, micDeviceId: settings.micDeviceId };
  extras.capMs = await loadCap();
  extras.tool = null;
  // The preparation (tab stream at the gesture, the server's capture row, env) runs while the
  // countdown counts, so the count starts at the click and the first live frame follows the
  // count sooner (J-027, J-195). The stream id is still asked for now, at the gesture.
  const prep = (driver.prepareRecording?.(opts) ?? Promise.resolve()).then(
    () => true,
    async (e: unknown) => {
      if (pendingStart?.recordingId === opts.recordingId) {
        pendingStart = null;
        clearCountdown();
        await dispatch({ type: 'CANCEL' });
        await updateActionIcon(session);
        await toastError(tabId, e);
      }
      return false;
    },
  );
  pendingPrep = prep;
  pendingStart = opts;
  extras.countdownLeftMs = COUNTDOWN_FROM * 1000;
  const s = await dispatch({ type: 'START_RECORDING', tabId, mode, recordingId: opts.recordingId, now: Date.now() });
  if (s.state === 'countdown') {
    runCountdown(COUNTDOWN_FROM * 1000);
    await sendToTab(tabId, sessionCommand(s));
    await updateActionIcon(s);
  } else if (s.state === 'starting') void beginMedia();
  return s;
}

let pendingStart: StartRecordingOptions | null = null;
/** The preparation of the pending start; resolves false when it failed (the start is then cancelled). */
let pendingPrep: Promise<boolean> = Promise.resolve(true);

async function beginMedia() {
  const s = session;
  if (s.state !== 'starting' || !pendingStart || pendingStart.recordingId !== s.recordingId) return;
  if (!(await pendingPrep)) return;
  if (session.state !== 'starting' || pendingStart?.recordingId !== s.recordingId) return;
  try {
    const { mic } = await driver.startRecording(pendingStart);
    await dispatch({ type: 'MEDIA_STARTED', recordingId: s.recordingId, now: Date.now(), mic });
  } catch (e) {
    if (e instanceof BgFailure && e.message === 'picker_cancelled') {
      await dispatch({ type: 'PICKER_CANCELLED' }); // J-201: bar gone, no draft
      return;
    }
    await dispatch({ type: 'RESET' });
    await toastError(s.tabId, e);
  }
}

async function cancelLive() {
  const s = session;
  clearCountdown();
  if (s.state === 'countdown' || s.state === 'starting') {
    await pendingPrep.catch(() => false); // let the preparation finish, so its stream and row are cleaned up
    await driver.cancelRecording?.(s.recordingId).catch(() => undefined);
    return dispatch({ type: 'CANCEL' });
  }
  return s;
}

async function stopRecording(reason: 'user' | 'cap' = 'user'): Promise<CaptureSession> {
  const s = session;
  if (s.state === 'countdown' || s.state === 'starting') return cancelLive();
  if (s.state !== 'recording') return s;
  // the bar also asks for a stop when its timer reaches the cap, in case the worker slept
  // through the cap timer (J-013)
  if (extras.capMs && elapsedMs(s, Date.now()) >= extras.capMs - 500) reason = 'cap';
  stats.stops.push(reason);
  const stopped = await dispatch({ type: 'STOP', now: Date.now() });
  if (stopped.state !== 'stopping') return stopped;
  try {
    const d = await driver.stopRecording({ recordingId: s.recordingId, tabId: s.tabId, mode: s.mode });
    return await dispatch({ type: 'DRAFT_READY', draftId: d.draftId, kind: d.kind, recordingId: d.recordingId ?? s.recordingId, tabId: d.tabId });
  } catch (e) {
    await dispatch({ type: 'FAIL', error: e instanceof BgFailure ? e.code : 'server', message: e instanceof Error ? e.message : String(e) });
    await toastError(s.tabId, e);
    return dispatch({ type: 'CANCEL' });
  }
}

/** Stop the live recording as the bar's stop button would; the capture driver calls it when the browser ends the media (Chrome's stop-sharing bar). */
export function requestStop(): Promise<CaptureSession> {
  return stopRecording();
}

async function pauseRecording(): Promise<void> {
  const s = session;
  if (s.state !== 'recording' || s.pausedAt !== null) return;
  await driver.pauseRecording(s.recordingId);
  await dispatch({ type: 'PAUSE', now: Date.now() });
}

async function resumeRecording(): Promise<void> {
  const s = session;
  if (s.state !== 'recording' || s.pausedAt === null) return;
  await driver.resumeRecording(s.recordingId);
  await dispatch({ type: 'RESUME', now: Date.now() });
}

let pausedForBlur = false;

async function triggerReplay(tabId: number) {
  const settings = await getSettings();
  if (!settings.instantReplay) throw new BgFailure('invalid', 'Turn on instant replay in the extension settings first');
  if (session.state !== 'idle') throw new BgFailure('busy', 'Finish the open capture first');
  const d = await driver.triggerReplay({ tabId });
  return dispatch({ type: 'DRAFT_READY', draftId: d.draftId, kind: d.kind, recordingId: d.recordingId, tabId: d.tabId });
}

/** Opens the popup, optionally on a given screen (recording-link command, restart). */
async function openPopup(screen?: 'link' | 'main') {
  if (screen) await browser.storage.session.set({ [POPUP_SCREEN_KEY]: screen });
  try {
    await browser.action.openPopup();
    stats.popupOpens++;
  } catch (e) {
    console.debug('[toolbar] openPopup', e);
  }
}

export const POPUP_SCREEN_KEY = 'tb:popup-screen';
const REOPEN_KEY = 'tb:reopen-popup';

async function activeTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new BgFailure('restricted_page', 'No active tab');
  return tab.id;
}

// ---------------------------------------------------------------- handlers

type Sender = { tab?: { id?: number; url?: string } };
type Handler<K extends BgRequestType> = (req: BgRequestMap[K]['req'], sender: Sender) => Promise<BgRequestMap[K]['res']>;
type Handlers = { [K in BgRequestType]?: Handler<K> };

const handlers: Handlers = {
  'session.get': async (_req, sender) => {
    await loaded;
    const tabId = sender.tab?.id ?? null;
    return { session, replay, tabId, restricted: isRestrictedUrl(sender.tab?.url ?? null) && tabId !== null };
  },

  'ui.state': async (_req, sender) => {
    await loaded;
    return { cmd: sessionCommand(session), tabId: sender.tab?.id ?? null };
  },

  'ui.context': async (req) => {
    const tabId = req.tabId ?? (await activeTabId().catch(() => null));
    const tab = tabId != null ? await browser.tabs.get(tabId).catch(() => null) : null;
    const settings = await getSettings();
    const url = tab?.url ?? null;
    let host: string | null = null;
    let isServerPage = false;
    try {
      if (url) {
        const u = new URL(url);
        host = u.host;
        isServerPage = u.origin === new URL(await serverUrl()).origin;
      }
    } catch {
      /* not a URL */
    }
    // the capture service clears `heavy` for the page load the person continued on (J-011)
    const ring = tabId != null ? replay.tabs[tabId] : undefined;
    const context: PopupContext = {
      tabId,
      url,
      host,
      restricted: isRestrictedUrl(url),
      isServerPage,
      recordMode: isServerPage && settings.recordMode === 'tab' ? 'desktop' : settings.recordMode,
      heavy: !!ring?.heavy && tabId != null,
      replayBlocked: url ? isReplayBlocked(url, settings.replayBlockedSites) : false,
    };
    stats.popupOpens++;
    return { context };
  },

  capture: async (req, sender) => {
    await loaded;
    const tabId = req.tabId ?? sender.tab?.id ?? (await activeTabId());
    stats.captures.push(req.mode);
    if (req.mode === 'link') {
      await openPopup('link');
      return { session };
    }
    await settingsFor(tabId);
    // a tab opened before install or update has no in-page UI yet
    await ensureContent(tabId);
    // a finished error (failed start, stop or upload) never blocks the next capture (J-196)
    if (session.state === 'error') await dispatch({ type: 'CANCEL' });
    const s = session;
    if (req.mode === 'screenshot') {
      if (s.state === 'arming-screenshot') return { session: await dispatch({ type: 'CANCEL' }) };
      if (s.state !== 'idle') throw new BgFailure('busy', 'Finish the open capture first');
      return { session: await armScreenshot(tabId, req.delaySec) };
    }
    if (req.mode === 'video') {
      if (s.state === 'countdown' || s.state === 'starting' || s.state === 'recording') return { session: await stopRecording() };
      if (s.state === 'arming-screenshot') await dispatch({ type: 'CANCEL' });
      else if (s.state !== 'idle') throw new BgFailure('busy', 'Finish the open capture first');
      const mode = req.recordMode ?? (await getSettings()).recordMode;
      return { session: await startRecording(tabId, mode) };
    }
    // replay
    return { session: await triggerReplay(tabId) };
  },

  'screenshot.take': async (req, sender) => {
    const s = session;
    if (s.state !== 'arming-screenshot') throw new BgFailure('invalid', 'Screenshot mode is not armed');
    const tabId = sender.tab?.id ?? s.tabId;
    stats.shots.push({ rect: req.rect, dpr: req.dpr });
    try {
      const d = await driver.takeScreenshot({ tabId, rect: req.rect, dpr: req.dpr });
      await dispatch({ type: 'SHOT_TAKEN', draftId: d.draftId, kind: d.kind });
      return { draftId: d.draftId };
    } catch (e) {
      await dispatch({ type: 'CANCEL' });
      await toastError(tabId, e);
      throw e;
    }
  },

  'screenshot.cancel': async () => {
    if (session.state === 'arming-screenshot') await dispatch({ type: 'CANCEL' });
    return {};
  },

  'countdown.pause': async () => {
    if (session.state !== 'countdown' || session.paused) return {};
    clearCountdown();
    extras.countdownLeftMs = Math.max(0, extras.countdownLeftMs - (Date.now() - countdownStartedAt));
    await dispatch({ type: 'COUNTDOWN_PAUSE' });
    return {};
  },
  'countdown.resume': async () => {
    if (session.state !== 'countdown' || !session.paused) return {};
    const left = extras.countdownLeftMs;
    countdownStartedAt = Date.now();
    await dispatch({ type: 'COUNTDOWN_RESUME', now: countdownStartedAt });
    runCountdown(left);
    return {};
  },
  'countdown.cancel': async () => {
    await cancelLive();
    return {};
  },
  'countdown.cleared': async ({ recordingId }) => {
    const v = veilCleared;
    if (v && v.recordingId === recordingId) {
      veilCleared = null;
      v.resolve();
    }
    return {};
  },

  'recording.stop': async () => ({ session: await stopRecording() }),
  'recording.pause': async () => {
    await pauseRecording();
    return {};
  },
  'recording.resume': async () => {
    pausedForBlur = false;
    await resumeRecording();
    return {};
  },
  'recording.mic': async (req) => {
    const s = session;
    if (s.state !== 'recording') throw new BgFailure('invalid', 'Not recording');
    if (s.mic === 'denied') throw new BgFailure('permission_denied', 'Microphone permission is missing');
    const mic = await driver.setMic(s.recordingId, req);
    await dispatch({ type: 'MIC', mic });
    // a microphone picked during a recording is the one the next recording starts with (J-211)
    if (req.deviceId) await saveSettings({ micDeviceId: req.deviceId });
    return { mic };
  },
  'recording.micDevices': async () => {
    const r = (await browser.runtime.sendMessage({ to: 'offscreen', type: 'mic-devices' }).catch(() => null)) as { ok?: boolean; devices?: { id: string; label: string }[]; current?: string | null } | null;
    return { devices: r?.devices ?? [], current: r?.current ?? null };
  },
  'recording.mark': async (req) => {
    const s = session;
    stats.marks.push(req.kind);
    if (s.state === 'recording') await driver.mark?.(s.recordingId, req.kind, req.label).catch(() => undefined);
    return {};
  },
  'recording.tool': async (req) => {
    extras.tool = req.tool;
    const s = session;
    // blurring pauses the recording, so the reporter can pick elements off camera (J-031)
    if (req.tool === 'blur' && s.state === 'recording' && s.pausedAt === null) {
      pausedForBlur = true;
      await pauseRecording().catch(() => (pausedForBlur = false));
    } else if (req.tool !== 'blur' && pausedForBlur) {
      pausedForBlur = false;
      await resumeRecording().catch(() => undefined);
    }
    const now = session;
    if (now.state !== 'idle' && 'tabId' in now) await sendToTab(now.tabId, sessionCommand(now));
    return {};
  },

  'settings.update': async (req) => {
    const parsed = extensionSettingsSchema.partial().safeParse(req.patch);
    if (!parsed.success) throw new BgFailure('invalid', parsed.error.issues[0]?.message);
    const settings = await saveSettings(parsed.data);
    // J-215: the account keeps the extension settings; local wins at once, the server follows
    void apiCall(ROUTES['account.updateSettings'].path, { method: 'PATCH', body: { extension: parsed.data } })
      .then(() => stats.settingsPushed++)
      .catch(() => undefined);
    return { settings };
  },

  'settings.sync': async () => {
    const remote = await apiCall<UserSettings>(ROUTES['account.getSettings'].path).catch(() => null);
    if (!remote?.extension) return { changed: false };
    const local = await getSettings();
    const r = remote.extension;
    const patch: Partial<ExtensionSettings> = {};
    if (r.instantReplay !== local.instantReplay) patch.instantReplay = r.instantReplay;
    if (r.replayMinutes !== local.replayMinutes) patch.replayMinutes = r.replayMinutes;
    if (r.replayVideo !== local.replayVideo) patch.replayVideo = r.replayVideo;
    if (!Object.keys(patch).length) return { changed: false };
    await saveSettings(patch);
    return { changed: true };
  },

  'link.options': async (req) => {
    const auth = await readStore('auth');
    const boot = (await readStore('bootstrap'))?.data as ExtBootstrap | undefined;
    const workspaceId = req.workspaceId ?? auth?.activeWorkspaceId ?? boot?.activeWorkspaceId ?? boot?.workspaces[0]?.id ?? null;
    let folders: Pick<Folder, 'id' | 'name'>[] = [];
    if (boot && workspaceId && boot.activeWorkspaceId === workspaceId) folders = boot.folders;
    else if (workspaceId) {
      const r = await apiCall<{ items: Folder[] }>(buildPath(ROUTES['folders.list'].path, { workspaceId })).catch(() => null);
      folders = r?.items ?? [];
    }
    return { folders: folders.map((f) => ({ id: f.id, name: f.name })), recorderDomain: new URL(await serverUrl()).host, workspaceId };
  },

  'link.create': async (req) => {
    const auth = await readStore('auth');
    const boot = (await readStore('bootstrap'))?.data;
    const workspaceId = req.workspaceId ?? auth?.activeWorkspaceId ?? boot?.activeWorkspaceId ?? boot?.workspaces[0]?.id;
    if (!workspaceId) throw new BgFailure(auth ? 'invalid' : 'not_signed_in', auth ? 'No workspace yet' : 'Sign in first');
    const link = await apiCall<RecordingLink>(buildPath(ROUTES['recordingLinks.create'].path, { workspaceId }), {
      method: 'POST',
      body: { name: req.name, folderId: req.folderId, recorderDomain: req.recorderDomain },
    });
    return { link };
  },

  'tab.open': async (req, sender) => {
    const src = sender.tab?.id != null ? await browser.tabs.get(sender.tab.id).catch(() => null) : null;
    const tab = await browser.tabs.create({ url: req.url, active: !req.background, ...(src ? { index: src.index + 1, openerTabId: src.id } : {}) });
    return { tabId: tab.id ?? -1 };
  },

  'ext.restart': async () => {
    await browser.storage.local.set({ [REOPEN_KEY]: Date.now() });
    // The old content scripts outlive the reload: close every open editor first, so none stays
    // over a page as an orphan frame (J-218). The draft itself stays in Drafts.
    const tabs = await browser.tabs.query({}).catch(() => [] as { id?: number }[]);
    await Promise.race([
      Promise.all(tabs.map((t) => (t.id != null && t.id >= 0 ? browser.tabs.sendMessage(t.id, { type: 'ui.editor-close' }).catch(() => undefined) : undefined))),
      new Promise((r) => setTimeout(r, 400)),
    ]);
    setTimeout(() => browser.runtime.reload(), 50);
    return {};
  },

  'ext.reset': async () => {
    const s = session;
    if (s.state === 'countdown' || s.state === 'starting' || s.state === 'recording')
      await driver.cancelRecording?.(s.recordingId).catch(() => undefined);
    clearCountdown();
    await writeStore('settings', defaultSettings());
    await dispatch({ type: 'RESET' });
    await browser.storage.session.remove([STORAGE.heavyOverride.key, POPUP_SCREEN_KEY]);
    return {};
  },
};

// ---------------------------------------------------------------- worker restart

/**
 * The worker can stop and start again while a session is open (MV3 idle shutdown). Timers
 * live in memory, so a countdown or a start that was waiting on one is lost: end it rather
 * than leave a veil that never counts. A live recording keeps going (the offscreen document
 * holds the media); its cap timer is armed again.
 */
async function recoverAfterWake() {
  const s = session;
  if (s.state === 'countdown' || s.state === 'starting') {
    await pendingPrep.catch(() => false); // let the preparation finish, so its stream and row are cleaned up
    await driver.cancelRecording?.(s.recordingId).catch(() => undefined);
    await dispatch({ type: 'CANCEL' });
  } else if (s.state === 'recording') {
    extras.capMs = await loadCap();
    armCapTimer(s);
  }
  await updateActionIcon(session);
}

// ---------------------------------------------------------------- commands (J-180 to J-183)

async function onCommand(command: string, tab: { id?: number; url?: string } | undefined) {
  if (command === 'recording-link') return openPopup('link');
  const tabId = tab?.id;
  // restricted pages: shortcuts do nothing, with no message (J-199)
  if (tabId == null || isRestrictedUrl(tab?.url)) return;
  try {
    if (command === 'screenshot-mode') await handlers.capture!({ mode: 'screenshot', tabId }, {});
    else if (command === 'record-tab') {
      const s = session;
      if (s.state === 'countdown' || s.state === 'starting' || s.state === 'recording') await stopRecording();
      else await handlers.capture!({ mode: 'video', tabId, recordMode: 'tab' }, {});
    } else if (command === 'instant-replay') await handlers.capture!({ mode: 'replay', tabId }, {});
  } catch (e) {
    if (e instanceof BgFailure && e.code === 'busy') return;
    await toastError(tabId, e);
  }
}

// ---------------------------------------------------------------- tab tracking (desktop mode, J-008)

async function onTabActivated(info: { tabId: number }) {
  const s = session;
  if (s.state === 'recording' && s.mode === 'desktop') await dispatch({ type: 'TAB_ACTIVATED', tabId: info.tabId });
}

async function onTabRemoved(tabId: number) {
  const s = session;
  if (s.state === 'arming-screenshot' && s.tabId === tabId) await dispatch({ type: 'CANCEL' });
  if ((s.state === 'countdown' || s.state === 'starting') && s.tabId === tabId) await cancelLive();
  if (s.state === 'recording' && s.tabId === tabId && s.mode === 'tab') await stopRecording();
  // the editor went with its tab: keep the draft in the Drafts list and free the session, or
  // every later capture is refused as busy (J-035, J-218)
  if (s.state === 'draft' && s.tabId === tabId) await dispatch({ type: 'SAVE_FOR_LATER' });
}

/** A full navigation or reload of the editor's tab destroys the editor; the draft is kept. */
async function onTabLoading(tabId: number) {
  const s = session;
  if (s.state === 'draft' && s.tabId === tabId) await dispatch({ type: 'SAVE_FOR_LATER' });
}

// ---------------------------------------------------------------- stats and test hooks

const stats = {
  popupOpens: 0,
  captures: [] as string[],
  shots: [] as { rect: Rect | null; dpr: number }[],
  marks: [] as string[],
  stops: [] as string[],
  transitions: [] as string[],
  errors: [] as string[],
  settingsPushed: 0,
  icon: 'default' as 'default' | 'camera',
  commands: [] as string[],
  /** how each recording start learned the veil was gone (J-006): ack or timeout, and after how long */
  veil: [] as string[],
};

const stubs = new Map<string, unknown>();

function fakeDriver(opts: { mic?: MicState; startDelayMs?: number; failStart?: string } = {}) {
  const calls: { fn: string; args: unknown }[] = [];
  const rec = (fn: string, args: unknown) => calls.push({ fn, args });
  const d: CaptureDriver & { calls: typeof calls } = {
    calls,
    prepareRecording: async (o) => void rec('prepare', o),
    startRecording: async (o) => {
      rec('start', o);
      await new Promise((r) => setTimeout(r, opts.startDelayMs ?? 50));
      if (opts.failStart) throw new BgFailure('permission_denied', opts.failStart);
      return { mic: opts.mic ?? (o.mic ? 'on' : 'off') };
    },
    cancelRecording: async (id) => void rec('cancel', id),
    stopRecording: async (o) => {
      rec('stop', o);
      return { draftId: `draft-${o.recordingId}`, kind: o.mode === 'tab' ? 'video' : 'screen', recordingId: o.recordingId, tabId: o.tabId };
    },
    pauseRecording: async (id) => void rec('pause', id),
    resumeRecording: async (id) => void rec('resume', id),
    setMic: async (id, o) => {
      rec('mic', { id, ...o });
      return o.muted ? 'muted' : 'on';
    },
    mark: async (id, kind) => void rec('mark', { id, kind }),
    takeScreenshot: async (o) => {
      rec('shot', o);
      return { draftId: 'draft-shot', kind: 'screenshot', recordingId: null, tabId: o.tabId };
    },
    triggerReplay: async (o) => {
      rec('replay', o);
      return { draftId: 'draft-replay', kind: 'replay', recordingId: null, tabId: o.tabId };
    },
  };
  return d;
}

export interface TbUiHooks {
  useFakeDriver(opts?: { mic?: MicState; startDelayMs?: number; failStart?: string }): void;
  calls(): { fn: string; args: unknown }[];
  stats(): typeof stats;
  stub(type: string, res: unknown): void;
  clearStubs(): void;
  session(): Promise<CaptureSession>;
  dispatch(e: SessionEvent): Promise<CaptureSession>;
  reset(): Promise<void>;
  command(name: string, tabId: number): Promise<void>;
  /** replace settings with defaults plus a patch */
  setSettings(patch: Partial<ExtensionSettings>): Promise<ExtensionSettings>;
  /** run one of this module's request handlers as if a page sent it (capture e2e drives the real flows) */
  request(type: string, req: unknown, sender?: Sender): Promise<unknown>;
}

// ---------------------------------------------------------------- registration

export function registerUi() {
  browser.runtime.onMessage.addListener((msg: { type?: string } & Record<string, unknown>, sender, reply) => {
    const type = msg?.type as BgRequestType | undefined;
    if (!type) return false;
    if (TEST_HOOKS && stubs.has(type)) {
      reply(stubs.get(type));
      return true;
    }
    const h = handlers[type] as Handler<BgRequestType> | undefined;
    if (!h) return false;
    h(msg as never, sender as Sender).then(
      (res) => reply({ ok: true, ...(res as object) }),
      (e: unknown) =>
        reply({ ok: false, error: e instanceof BgFailure ? e.code : 'server', message: e instanceof Error ? e.message : String(e) }),
    );
    return true;
  });

  browser.commands.onCommand.addListener((command, tab) => {
    stats.commands.push(command);
    void onCommand(command, tab);
  });
  browser.tabs.onActivated.addListener((info) => void onTabActivated(info));
  browser.tabs.onRemoved.addListener((tabId) => void onTabRemoved(tabId));
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading') void onTabLoading(tabId);
  });

  // A restart from the popup menu reopens the popup (J-177).
  void browser.storage.local.get(REOPEN_KEY).then(async (got) => {
    const at = got[REOPEN_KEY] as number | undefined;
    if (!at) return;
    await browser.storage.local.remove(REOPEN_KEY);
    if (Date.now() - at < 30_000) setTimeout(() => void openPopup('main'), 300);
  });

  // a fresh install starts with the default replay blocked-sites list
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (reason === 'install' && !(await readStore('settings'))) await writeStore('settings', defaultSettings());
  });

  // the capture area keeps the replay ring state; follow it for the popup context (J-011)
  browser.storage.onChanged.addListener((changes, area) => {
    const c = changes[STORAGE.replay.key];
    if (area === 'session' && c) replay = (c.newValue as ReplayState | undefined) ?? DEFAULT_REPLAY;
  });

  void loaded.then(recoverAfterWake);

  if (TEST_HOOKS) {
    let fake: ReturnType<typeof fakeDriver> | null = null;
    const hooks: TbUiHooks = {
      useFakeDriver(opts) {
        fake = fakeDriver(opts);
        setCaptureDriver(fake);
      },
      calls: () => structuredClone(fake?.calls ?? []),
      stats: () => structuredClone(stats),
      stub: (type, res) => void stubs.set(type, res),
      clearStubs: () => stubs.clear(),
      session: () => getSession(),
      dispatch: (e) => dispatch(e),
      async reset() {
        clearCountdown();
        stubs.clear();
        for (const v of Object.values(stats)) if (Array.isArray(v)) v.length = 0;
        stats.popupOpens = 0;
        stats.settingsPushed = 0;
        await dispatch({ type: 'RESET' });
      },
      command: (name, tabId) => browser.tabs.get(tabId).then((t) => onCommand(name, t)),
      async setSettings(patch) {
        const next = { ...defaultSettings(), ...patch };
        await writeStore('settings', next);
        return next;
      },
      request: (type, req, sender = {}) => {
        const h = handlers[type as BgRequestType] as Handler<BgRequestType> | undefined;
        if (!h) return Promise.reject(new BgFailure('not_found', `no handler for ${type}`));
        return h(req as never, sender);
      },
    };
    (globalThis as unknown as { __tbUi: TbUiHooks }).__tbUi = hooks;
  }
}
