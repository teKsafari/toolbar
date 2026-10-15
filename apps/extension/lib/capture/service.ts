// The capture service in the worker: content ports, the per-tab ring, webRequest, the session
// state machine for screenshots and recordings, instant replay, the offscreen recorder and the
// background upload drainer. lib/bg/capture.ts wires it to browser events and messages.
import { browser, type Browser } from 'wxt/browser';
import { createEmitter, type CaptureEvent, type EnvInfo, type EventDataMap, type EventKind, type Rect } from '@toolbar/shared';
import { redactEvent } from '@toolbar/shared/redact';
import { uuidv7 } from '@toolbar/shared/ids';
import { LIMITS } from '@toolbar/shared/constants';
import {
  DEFAULT_REPLAY,
  IDLE,
  recordingKindOf,
  transition,
  type BarState,
  type BgError,
  type CaptureSession,
  type ContentCommand,
  type Draft,
  type MicState,
  type OffscreenEvent,
  type OffscreenRequest,
  type PageGeometry,
  type PortCommand,
  type PortMessage,
  type RecordMode,
  type ReplayState,
  type SessionEvent,
  type UploadAuth,
} from '@toolbar/shared/ext';
import type { ExtensionSettings, FinalizeCaptureBody } from '@toolbar/shared/api';
import { Ring } from '../ring';
import { CaptureQueue, cropImage, dataUrlToBlob } from '../crop';
import { idbGet, idbPut } from '../idb';
import { api, type UploadAuthLike } from '../upload/client';
import { allPendingIds, drain, rekey } from '../upload/queue';
import { discardDraftData, uploadDraft } from '../upload/draft';
import { createDraft, saveDraft } from './drafts';
import { CAPTURE_KEYS, getAuth, getPrivate, getSettings, getStore, serverUrl, setPrivate, setStore } from './store';
import { installWebRequest } from './webrequest';
import { isReplayBlocked } from '@toolbar/shared/areas/ext-ui';
import { presetFor, scope, workspaceForUrl } from '../scope';

type Port = ReturnType<typeof browser.runtime.connect>;
export class CaptureError extends Error {
  constructor(
    readonly code: BgError,
    message: string,
  ) {
    super(message);
  }
}

/** Pages where content scripts and captureVisibleTab cannot run. */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return /^(chrome|edge|brave|about|devtools|view-source|chrome-extension|chrome-search|chrome-untrusted):/i.test(url) || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i.test(url);
}

/** Countdown before a tab recording (J-027): 3-2-1. */
export const COUNTDOWN_MS = 3000;
/** Stop to editor budget; after this the session shows an error with an open-drafts action (J-034). */
export const STOP_TIMEOUT_MS = 60_000;
const PRUNE_EVERY_MS = 10_000;
const DRAIN_ALARM = 'tb-upload-drain';

interface PortInfo {
  port: Port;
  tabId: number;
  frameId: number;
  top: boolean;
  url: string;
  /** events received on this port, compared with the content script's count at flush */
  received: number;
  /** the document's performance.timeOrigin: one value per page load (J-011) */
  loadId?: number;
}

export interface CaptureStats {
  ports: number;
  events: number;
  rrweb: number;
  byKind: Record<string, number>;
  drafts: string[];
  lastError: string | null;
}

/**
 * Driver mode (the merged build): ext-ui's session store in lib/bg/ui.ts owns the capture
 * session, the countdown, the in-page UI and the keyboard commands, and calls this service
 * through its CaptureDriver interface (lib/bg/capture.ts). The service then keeps a private
 * copy of the session for its media work only: it never persists or broadcasts it, never sends
 * `ui.*` commands to the page, and returns drafts instead of opening the editor.
 */
export interface CaptureServiceOptions {
  external?: boolean;
  /** the authoritative session (driver mode), for broadcasts */
  sessionSource?: () => Promise<CaptureSession>;
  /** a recording the browser ended (Chrome's stop-sharing bar): ask the session owner to stop */
  onMediaEnded?: () => void;
}

export class CaptureService {
  readonly ring = new Ring();
  readonly stats: CaptureStats = { ports: 0, events: 0, rrweb: 0, byKind: {}, drafts: [], lastError: null };
  private ports = new Set<PortInfo>();
  private session: CaptureSession = IDLE;
  private replay: ReplayState = DEFAULT_REPLAY;
  private settings: ExtensionSettings | null = null;
  private make = createEmitter('sw');
  private shots = new CaptureQueue();
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownLeft = COUNTDOWN_MS;
  private pendingStream: { recordingId: string; streamId: string | null; localId: string; serverId: string | null; upload: UploadAuth | null; pageUrl: string; pageTitle: string } | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private micWaiters: ((granted: boolean) => void)[] = [];
  private loaded: Promise<void>;
  /** recording id -> media start time and offscreen facts */
  private media = new Map<string, { t: number; mime: string; width: number; height: number; mic: MicState }>();
  private undoWebRequest: (() => void) | null = null;
  /** video size measured when the tab stream was taken, so the start after the countdown skips a page round trip */
  private heldSize = new Map<string, { w: number; h: number }>();
  /** Stop to editor budget; e2e lowers it to exercise the timeout path (J-034). */
  stopTimeoutMs = STOP_TIMEOUT_MS;

  readonly external: boolean;
  private opts: CaptureServiceOptions;
  /** driver mode: the session's recording id -> the id the media and uploads use (server id when known) */
  private mediaIds: Record<string, string> = {};
  private startWaiters = new Map<string, { resolve: (mic: MicState) => void; reject: (e: unknown) => void }>();
  /** Listeners on every event the worker takes in (Part 2 traces, lib/bg/trace.ts). */
  private taps = new Set<(batch: CaptureEvent[]) => void>();
  /** Tabs a trace holds: attached like a recording, and kept whole in the ring. */
  private traceHolds = new Map<number, { id: string; t0: number }>();

  constructor(opts: CaptureServiceOptions = {}) {
    this.opts = opts;
    this.external = !!opts.external;
    this.loaded = this.load();
  }

  // ---------- state ----------

  private async load() {
    this.session = (await getStore('session')) ?? IDLE;
    if (this.external) {
      // the stored session is the owner's; keep a live recording (with its media id), drop the rest
      this.mediaIds = await getPrivate<Record<string, string>>(CAPTURE_KEYS.mediaIds, {});
      const s = this.session;
      this.session = s.state === 'recording' ? { ...s, recordingId: this.mediaIds[s.recordingId] ?? s.recordingId } : IDLE;
    }
    this.replay = (await getStore('replay')) ?? DEFAULT_REPLAY;
    this.settings = await getSettings();
    if (this.replay.enabled !== this.settings.instantReplay || this.replay.minutes !== this.settings.replayMinutes) {
      this.replay = { ...this.replay, enabled: this.settings.instantReplay, minutes: this.settings.replayMinutes };
      await setStore('replay', this.replay);
    }
    // a worker restart in the middle of a countdown cannot resume the timer: start now
    if (!this.external && this.session.state === 'countdown') void this.countdownDone();
  }

  ready() {
    return this.loaded;
  }

  getSession() {
    return this.session;
  }
  getReplay() {
    return this.replay;
  }

  /** Applies a session event; persists and broadcasts when it changed. */
  async apply(e: SessionEvent): Promise<CaptureSession> {
    await this.loaded;
    const next = transition(this.session, e);
    if (next === this.session) return next;
    if (this.external) {
      // private copy: a finished draft belongs to the editor and the owner's session
      this.session = next.state === 'draft' ? IDLE : next;
      return next;
    }
    this.session = next;
    await setStore('session', next);
    this.broadcast();
    return next;
  }

  private broadcast() {
    if (this.external) {
      const src = this.opts.sessionSource;
      if (src) void src().then((session) => browser.runtime.sendMessage({ type: 'session.changed' as const, session, replay: this.replay }).catch(() => {}));
      return;
    }
    const msg = { type: 'session.changed' as const, session: this.session, replay: this.replay };
    void browser.runtime.sendMessage(msg).catch(() => {});
  }

  async onSettingsChanged() {
    this.settings = await getSettings();
    const enabled = this.settings.instantReplay;
    const minutes = this.settings.replayMinutes;
    if (enabled !== this.replay.enabled || minutes !== this.replay.minutes) await this.setReplay({ enabled, minutes });
    else if (enabled) {
      // J-012: a change to the blocked-sites list reaches open pages: a newly blocked site stops
      // its ring and drops what it held, an unblocked one starts
      for (const p of this.ports) {
        const want = this.ringWanted(p.tabId, p.url);
        this.postPort(p, { type: 'ring', enabled: want, minutes });
        if (!want && p.top && !this.activeRecording()?.tabs.includes(p.tabId)) await this.ring.purgeTab(p.tabId).catch(() => {});
      }
    }
    await this.reconfigurePorts();
  }

  /** Masking preset and body policy of the page's project (D-125), sent to every open page. */
  async reconfigurePorts() {
    const s = await this.settingsNow();
    const sc = await scope();
    for (const p of this.ports) this.postPort(p, { type: 'config', captureUserEvents: s.captureUserEvents, ...this.privacyOf(sc, p) });
  }

  private privacyOf(sc: Awaited<ReturnType<typeof scope>>, p: PortInfo) {
    const { maskingPreset, bodyPolicy } = presetFor(sc, p.url);
    return { maskingPreset, bodyPolicy };
  }

  /**
   * A new capture dismisses a finished error (stop timeout, media failure, failed upload):
   * the error is shown once and must not block the next capture.
   */
  private async clearError() {
    if (this.session.state === 'error') await this.apply({ type: 'CANCEL' });
  }

  /** The bar's or popup's dismiss on an error state. */
  async dismissError() {
    await this.loaded;
    const s = this.session;
    if (s.state !== 'error') return s;
    if (s.tabId !== null) await this.sendContent(s.tabId, { type: 'ui.processing', visible: false });
    return this.apply({ type: 'CANCEL' });
  }

  private async settingsNow() {
    return (this.settings ??= await getSettings());
  }

  // ---------- content ports ----------

  onConnect(port: Port) {
    const tab = port.sender?.tab;
    if (!tab?.id || tab.id < 0) return;
    const info: PortInfo = { port, tabId: tab.id, frameId: port.sender?.frameId ?? 0, top: (port.sender?.frameId ?? 0) === 0, url: port.sender?.url ?? tab.url ?? '', received: 0 };
    this.ports.add(info);
    this.stats.ports = this.ports.size;
    port.onMessage.addListener((m: PortMessage) => void this.onPortMessage(info, m));
    port.onDisconnect.addListener(() => {
      this.ports.delete(info);
      this.stats.ports = this.ports.size;
    });
    void this.configurePort(info);
  }

  // ---------- traces (Part 2, lib/bg/trace.ts) ----------

  /** Calls `fn` with each batch of events the worker takes in (stamped with their tab). */
  onEvents(fn: (batch: CaptureEvent[]) => void): () => void {
    this.taps.add(fn);
    return () => this.taps.delete(fn);
  }

  private tap(batch: CaptureEvent[]) {
    for (const fn of this.taps) {
      try {
        fn(batch);
      } catch {
        /* a listener's failure stays its own */
      }
    }
  }

  /** A trace starts in a tab: its pages record rrweb and canvas samples, and its ring is kept whole. */
  attachTrace(tabId: number, id: string, t0: number) {
    this.traceHolds.set(tabId, { id, t0 });
    for (const p of this.ports) if (p.tabId === tabId) this.postPort(p, { type: 'attach', recordingId: id, t0 });
  }

  /** The trace ends: pages flush and stop the trace-only recording. */
  detachTrace(tabId: number) {
    const h = this.traceHolds.get(tabId);
    if (!h) return;
    this.traceHolds.delete(tabId);
    for (const p of this.ports) if (p.tabId === tabId) this.postPort(p, { type: 'detach', recordingId: h.id });
  }

  private postPort(p: PortInfo, c: PortCommand) {
    try {
      p.port.postMessage(c);
    } catch {
      this.ports.delete(p);
    }
  }

  private async configurePort(p: PortInfo) {
    await this.loaded;
    const s = await this.settingsNow();
    this.postPort(p, { type: 'config', captureUserEvents: s.captureUserEvents, ...this.privacyOf(await scope(), p) });
    if (this.ringWanted(p.tabId, p.url)) this.postPort(p, { type: 'ring', enabled: true, minutes: this.replay.minutes });
    const held = this.traceHolds.get(p.tabId);
    if (held) this.postPort(p, { type: 'attach', recordingId: held.id, t0: held.t0 });
    const rec = this.activeRecording();
    if (rec && rec.tabs.includes(p.tabId)) {
      this.postPort(p, { type: 'attach', recordingId: rec.recordingId, t0: rec.startedAt });
      if (p.top) void this.sendBar(p.tabId); // J-032: the bar returns after a reload with the timer running
    }
  }

  private ringWanted(tabId: number, url: string): boolean {
    if (!this.replay.enabled || tabId < 0) return false;
    if (this.replay.tabs[tabId]?.heavy) return false;
    return !isReplayBlocked(url, this.settings?.replayBlockedSites ?? []);
  }

  private async onPortMessage(p: PortInfo, m: PortMessage) {
    switch (m.type) {
      case 'hello':
        p.url = m.url;
        p.loadId = m.loadId;
        if (p.top) await this.onPageLoad(p);
        return;
      case 'events': {
        p.received += m.batch.length;
        const s = await this.settingsNow();
        const batch = m.batch
          .filter((e) => s.captureUserEvents || e.kind !== 'user' || (e.data as { type?: string }).type === 'visibility')
          .map((e) => ({ ...e, tab: p.tabId }));
        this.stats.events += batch.length;
        for (const e of batch) this.stats.byKind[e.kind] = (this.stats.byKind[e.kind] ?? 0) + 1;
        this.ring.appendEvents(p.tabId, batch);
        if (this.taps.size) this.tap(batch);
        return;
      }
      case 'rrweb':
        this.stats.rrweb += m.batch.length;
        this.ring.appendRrweb(p.tabId, m.batch);
        return;
      case 'page-weight':
        if (p.top) await this.onPageWeight(p, m);
        return;
    }
  }

  // ---------- heavy-page guard (J-011) ----------

  /** A new document in a tab: its weight is measured again, and a continue from an earlier load lapses. */
  private async onPageLoad(p: PortInfo) {
    await this.loaded;
    const overrides = (await getStore('heavyOverride')) ?? {};
    if (overrides[p.tabId] !== undefined && overrides[p.tabId] !== this.loadKey(p)) {
      delete overrides[p.tabId];
      await setStore('heavyOverride', overrides);
    }
    const cur = this.replay.tabs[p.tabId];
    if (cur?.heavy) {
      this.replay = { ...this.replay, tabs: { ...this.replay.tabs, [p.tabId]: { ...cur, heavy: false } } };
      await setStore('replay', this.replay);
      if (this.ringWanted(p.tabId, p.url)) this.postPort(p, { type: 'ring', enabled: true, minutes: this.replay.minutes });
      this.broadcast();
    }
  }

  /** The override value for one page load of a tab: its URL and the document's time origin. */
  private loadKey(p: PortInfo) {
    return `${p.url}#${p.loadId ?? 0}`;
  }

  /** Thresholds for a heavy page: storage override (the lab e2e lowers them) or the defaults. */
  private async heavyThresholds() {
    const t = (await getStore('heavyThresholds')) ?? null;
    return { nodes: t?.nodes ?? LIMITS.heavyPageNodes, mutationsPerSec: t?.mutationsPerSec ?? LIMITS.heavyPageMutationsPerSec };
  }

  /** Pauses the ring on a heavy page until the popup's continue (`replay.set` with `allowHeavy`). */
  async onPageWeight(p: PortInfo, w: { nodes: number; mutationsPerSec: number }) {
    await this.loaded;
    if (!this.ringWanted(p.tabId, p.url)) return;
    const t = await this.heavyThresholds();
    if (w.nodes < t.nodes && w.mutationsPerSec < t.mutationsPerSec) return;
    const overrides = (await getStore('heavyOverride')) ?? {};
    if (overrides[p.tabId] === this.loadKey(p)) return;
    const cur = this.replay.tabs[p.tabId];
    this.replay = { ...this.replay, tabs: { ...this.replay.tabs, [p.tabId]: { since: cur?.since ?? Date.now(), video: cur?.video ?? false, heavy: true } } };
    await setStore('replay', this.replay);
    for (const q of this.ports) if (q.tabId === p.tabId) this.postPort(q, { type: 'ring', enabled: false, minutes: this.replay.minutes });
    // the ring's rows go too, unless a recording of this tab holds them
    if (!this.activeRecording()?.tabs.includes(p.tabId)) await this.ring.purgeTab(p.tabId).catch(() => {});
    this.broadcast();
  }

  /** The popup's continue on the heavy-page warning: replay runs on this tab for this page load. */
  async allowHeavy(tabId: number) {
    await this.loaded;
    const top = [...this.ports].find((q) => q.tabId === tabId && q.top);
    const overrides = (await getStore('heavyOverride')) ?? {};
    if (top) overrides[tabId] = this.loadKey(top);
    await setStore('heavyOverride', overrides);
    const cur = this.replay.tabs[tabId];
    if (cur) this.replay = { ...this.replay, tabs: { ...this.replay.tabs, [tabId]: { ...cur, heavy: false } } };
    await setStore('replay', this.replay);
    for (const q of this.ports) if (q.tabId === tabId && this.ringWanted(q.tabId, q.url)) this.postPort(q, { type: 'ring', enabled: true, minutes: this.replay.minutes });
    this.broadcast();
    return this.replay;
  }

  /** An event produced in the worker (webRequest, media, markers), redacted and stamped. */
  emit<K extends EventKind>(tabId: number, kind: K, data: EventDataMap[K], t?: number) {
    const e = this.make(kind, data);
    if (t !== undefined) e.t = t;
    const out = { ...redactEvent(e as CaptureEvent), tab: tabId } as CaptureEvent;
    this.stats.byKind[kind] = (this.stats.byKind[kind] ?? 0) + 1;
    this.ring.appendEvents(tabId, [out]);
    if (this.taps.size) this.tap([out]);
  }

  startWebRequest() {
    if (this.undoWebRequest || !browser.webRequest) return;
    let prefixes: string[] = [browser.runtime.getURL('/')];
    void serverUrl().then((u) => (prefixes = [browser.runtime.getURL('/'), u.replace(/\/$/, '') + '/api/']));
    this.undoWebRequest = installWebRequest(browser.webRequest as unknown as typeof Browser.webRequest, {
      wants: (tabId) => tabId >= 0,
      ownPrefixes: () => prefixes,
      emit: (tabId, e) => this.emit(tabId, e.kind as EventKind, e.data as never, e.t),
    });
  }

  /** Prunes every tab's ring to the replay window, keeping active recordings whole. */
  async prune(now = Date.now()) {
    const minutes = Math.max(this.replay.minutes, LIMITS.replayDefaultMin);
    const rec = this.activeRecording();
    for (const tabId of await this.ring.tabs()) {
      let keepFrom = now - minutes * 60_000;
      if (rec?.tabs.includes(tabId)) keepFrom = Math.min(keepFrom, rec.startedAt - 1000);
      const held = this.traceHolds.get(tabId);
      if (held) keepFrom = Math.min(keepFrom, held.t0 - 1000);
      await this.ring.prune(tabId, keepFrom);
    }
  }

  startTimers() {
    setInterval(() => void this.prune().catch(() => {}), PRUNE_EVERY_MS);
    try {
      void browser.alarms.create(DRAIN_ALARM, { periodInMinutes: 0.5 });
    } catch {
      /* alarms permission */
    }
  }

  isDrainAlarm(name: string) {
    return name === DRAIN_ALARM;
  }

  async onTabRemoved(tabId: number) {
    // a traced tab's ring stays until the trace has read it (lib/bg/trace.ts purges it then)
    if (this.traceHolds.has(tabId)) return;
    await this.ring.purgeTab(tabId);
  }

  async onTabActivated(tabId: number) {
    const rec = this.activeRecording();
    if (!rec || rec.mode !== 'desktop' || rec.tabId === tabId) return;
    // J-008: the bar follows tab switches during a desktop recording; logs come from every tab.
    const prev = rec.tabId;
    await this.apply({ type: 'TAB_ACTIVATED', tabId });
    for (const p of this.ports) if (p.tabId === tabId) this.postPort(p, { type: 'attach', recordingId: rec.recordingId, t0: rec.startedAt });
    await this.sendContent(prev, { type: 'ui.bar', bar: null });
    await this.sendBar(tabId);
  }

  async onTabUpdated(tabId: number, status?: string) {
    const rec = this.activeRecording();
    if (status === 'complete' && rec?.tabs.includes(tabId) && rec.tabId === tabId) await this.sendBar(tabId);
  }

  // ---------- helpers ----------

  private activeRecording() {
    return this.session.state === 'recording' ? this.session : null;
  }

  async sendContent(tabId: number, c: ContentCommand, frameId = 0): Promise<unknown> {
    // driver mode: the session owner drives the page UI (ui.session, ui.editor-open)
    if (this.external && c.type.startsWith('ui.')) return undefined;
    try {
      return await browser.tabs.sendMessage(tabId, c, { frameId });
    } catch {
      return undefined;
    }
  }

  private async sendBar(tabId: number) {
    const s = this.session;
    if (s.state !== 'recording') return;
    const bootstrap = await getStore('bootstrap');
    const bar: BarState = { recordingId: s.recordingId, mode: s.mode, startedAt: s.startedAt, pausedAt: s.pausedAt, pausedMs: s.pausedMs, mic: s.mic, capMs: bootstrap?.data.limits.maxRecordingMs ?? null };
    await this.sendContent(tabId, { type: 'ui.bar', bar });
  }

  private async activeTabId(): Promise<number> {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new CaptureError('not_found', 'No active tab');
    return tab.id;
  }

  private async tabOrThrow(tabId?: number) {
    const id = tabId ?? (await this.activeTabId());
    const tab = await browser.tabs.get(id);
    if (isRestrictedUrl(tab.url)) throw new CaptureError('restricted_page', 'This page does not allow captures');
    return tab;
  }

  private async uploadAuth(): Promise<(UploadAuthLike & { workspaceId: string | null }) | null> {
    const auth = await getAuth();
    if (!auth?.token) return null;
    return { serverUrl: auth.serverUrl || (await serverUrl()), token: auth.token, workspaceId: auth.activeWorkspaceId };
  }

  private async geometry(tabId: number): Promise<PageGeometry | null> {
    const g = (await this.sendContent(tabId, { type: 'page.geometry' })) as PageGeometry | undefined;
    if (g?.viewport) return g;
    try {
      const [r] = await browser.scripting.executeScript({
        target: { tabId },
        func: () => ({ viewport: { w: innerWidth, h: innerHeight }, scroll: { x: scrollX, y: scrollY }, dpr: devicePixelRatio, url: location.href, title: document.title }),
      });
      return (r?.result as PageGeometry) ?? null;
    } catch {
      return null;
    }
  }

  /** Page env (from the content script) plus what only the worker knows. */
  async envFor(tabId: number): Promise<EnvInfo | null> {
    const r = (await this.sendContent(tabId, { type: 'capture.env' })) as { env?: EnvInfo | null } | undefined;
    const tab = await browser.tabs.get(tabId).catch(() => null);
    const base = r?.env ?? null;
    const extVersion = browser.runtime.getManifest().version;
    if (!base) return null;
    return { ...base, extVersion, incognito: tab?.incognito ?? false };
  }

  private async metadataFor(tabId: number): Promise<Record<string, unknown> | null> {
    const r = (await this.sendContent(tabId, { type: 'capture.metadata' })) as { value?: Record<string, unknown> | null; error?: string } | undefined;
    if (r?.error) this.emit(tabId, 'console', { level: 'warn', args: [`Custom metadata was not attached: ${r.error}`] });
    return r?.value ?? null;
  }

  /** Asks each tab to flush, then waits until the worker has received what the top frame sent. */
  async flushTabs(tabIds: number[]) {
    await Promise.all(
      tabIds.map(async (t) => {
        const r = (await this.sendContent(t, { type: 'capture.flush' })) as { sent?: number } | undefined;
        const want = r?.sent ?? 0;
        for (let i = 0; i < 40; i++) {
          const got = [...this.ports].find((p) => p.tabId === t && p.top)?.received ?? want;
          if (got >= want) break;
          await new Promise((res) => setTimeout(res, 25));
        }
      }),
    );
    await new Promise((r) => setTimeout(r, 30)); // frames other than the top one
    await this.ring.flush();
  }

  // ---------- screenshot (J-002, J-003, J-004, J-071) ----------

  async armScreenshot(tabId?: number, delaySec?: number) {
    await this.loaded;
    await this.clearError();
    const tab = await this.tabOrThrow(tabId);
    const s = await this.settingsNow();
    const delay = delaySec ?? s.screenshotDelaySec;
    const next = await this.apply({ type: 'ARM_SCREENSHOT', tabId: tab.id!, delaySec: delay, now: Date.now() });
    await this.sendContent(tab.id!, { type: 'ui.screenshot-mode', armed: next.state === 'arming-screenshot', delaySec: delay });
    return next;
  }

  async cancelScreenshot() {
    const s = this.session;
    if (s.state !== 'arming-screenshot') return;
    await this.apply({ type: 'CANCEL' });
    await this.sendContent(s.tabId, { type: 'ui.screenshot-mode', armed: false, delaySec: 0 });
  }

  /** Captures the viewport (rect null) or an area, makes a draft and opens the editor. */
  async takeScreenshot(rect: Rect | null, opts: { tabId?: number; openEditor?: boolean } = {}): Promise<Draft> {
    await this.loaded;
    const tabId = this.session.state === 'arming-screenshot' ? this.session.tabId : (opts.tabId ?? (await this.activeTabId()));
    const tab = await browser.tabs.get(tabId);
    if (isRestrictedUrl(tab.url)) throw new CaptureError('restricted_page', 'This page does not allow captures');
    const geo = await this.geometry(tabId);
    const innerWidth = geo?.viewport.w ?? tab.width ?? 1280;
    const dataUrl = await this.shots.run(() => browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));
    const t = Date.now();
    const png = await dataUrlToBlob(dataUrl);
    const full = await cropImage(png, null, innerWidth, { cssPixels: true });
    const crop = rect && rect.w > 2 && rect.h > 2 ? await cropImage(png, rect, innerWidth, { cssPixels: true }) : null;
    this.emit(tabId, 'marker', { type: 'screenshot', label: crop ? 'area' : 'viewport', ...(crop && rect ? { rect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } } : {}) }, t);
    const [env, metadata, auth] = await Promise.all([this.envFor(tabId), this.metadataFor(tabId), getAuth()]);
    await this.flushTabs([tabId]);
    const lastEnd = (await getPrivate<Record<number, number>>(CAPTURE_KEYS.lastCaptureEnd, {}))[tabId] ?? 0;
    const minutes = Math.max(this.replay.minutes, LIMITS.replayDefaultMin);
    const from = Math.max(t - minutes * 60_000, lastEnd);
    const slice = await this.ring.read(tabId, from, Date.now());
    const draft = await createDraft({
      kind: 'screenshot',
      tabId,
      pageUrl: geo?.url ?? tab.url ?? '',
      pageTitle: geo?.title ?? tab.title ?? '',
      startedAt: t,
      durationMs: null,
      workspaceId: (await workspaceForUrl(geo?.url ?? tab.url)) ?? auth?.activeWorkspaceId ?? null, // D-124: the project's workspace
      events: slice.events,
      screenshot: crop?.blob ?? full.blob,
      full: crop ? full.blob : null,
      crop: crop ? rect : null,
      env,
      metadata,
      extra: { incognito: tab.incognito, tabIds: [tabId] },
    });
    await this.markCaptureEnd(tabId, t);
    this.stats.drafts.push(draft.id);
    if (this.session.state === 'arming-screenshot') {
      await this.apply({ type: 'SHOT_TAKEN', draftId: draft.id });
      await this.sendContent(tabId, { type: 'ui.screenshot-mode', armed: false, delaySec: 0 });
    } else await this.apply({ type: 'DRAFT_READY', draftId: draft.id, kind: 'screenshot', recordingId: null, tabId });
    if (opts.openEditor !== false) await this.sendContent(tabId, { type: 'ui.editor-open', draftId: draft.id });
    return draft;
  }

  private async markCaptureEnd(tabId: number, t: number) {
    const m = await getPrivate<Record<number, number>>(CAPTURE_KEYS.lastCaptureEnd, {});
    m[tabId] = t;
    await setPrivate(CAPTURE_KEYS.lastCaptureEnd, m);
  }

  // ---------- recording (J-006, J-007, J-008, J-014, J-029, J-032, J-034, J-201, J-211) ----------

  async ensureOffscreen() {
    const url = browser.runtime.getURL('/offscreen.html');
    const rt = browser.runtime as unknown as { getContexts?: (f: { contextTypes: string[]; documentUrls: string[] }) => Promise<unknown[]> };
    if (rt.getContexts && (await rt.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] })).length) return;
    try {
      await (browser as unknown as { offscreen: typeof Browser.offscreen }).offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'CLIPBOARD'] as Browser.offscreen.Reason[],
        justification: 'Records tab and screen video and the microphone while you capture a bug.',
      });
    } catch (e) {
      if (!String(e).includes('single offscreen')) throw e;
    }
  }

  async offscreen<T = { ok: boolean; error?: string; message?: string }>(req: OffscreenRequest): Promise<T> {
    await this.ensureOffscreen();
    return (await browser.runtime.sendMessage(req)) as T;
  }

  /**
   * Takes the tab stream at the gesture. Chrome expires a stream id a few seconds after it is
   * issued and refuses a second id while one is outstanding, so the id cannot wait for the
   * three-second countdown: the offscreen document opens the stream now and keeps it.
   */
  private async holdTab(tabId: number): Promise<string> {
    const streamId = await (browser.tabCapture as unknown as typeof Browser.tabCapture).getMediaStreamId({ targetTabId: tabId });
    const tab = await browser.tabs.get(tabId);
    const geo = await this.geometry(tabId);
    const dpr = geo?.dpr ?? 1;
    const w = Math.round((geo?.viewport.w ?? tab.width ?? 1280) * dpr);
    const h = Math.round((geo?.viewport.h ?? tab.height ?? 720) * dpr);
    this.heldSize.set(streamId, { w, h });
    const settings = await this.settingsNow();
    const mic = settings.mic && ((await getStore('micGranted')) ?? false);
    const r = await this.offscreen({ to: 'offscreen', type: 'hold-tab', streamId, w, h, mic, ...(settings.micDeviceId ? { micDeviceId: settings.micDeviceId } : {}) });
    if (!r?.ok) throw new CaptureError('permission_denied', r?.message ?? 'Could not capture this tab');
    return streamId;
  }

  /** Lets go of a stream taken at the gesture when the countdown ends without recording. */
  private releaseHeld() {
    const id = this.pendingStream?.streamId;
    if (id) void this.offscreen({ to: 'offscreen', type: 'release-tab', streamId: id }).catch(() => undefined);
  }

  /** Starts a recording. Tab mode takes its stream now (needs the gesture), then counts down. */
  async startRecording(opts: { tabId?: number; mode?: RecordMode; delaySec?: number }): Promise<CaptureSession> {
    await this.loaded;
    if (this.session.state === 'recording' || this.session.state === 'countdown' || this.session.state === 'starting') {
      return this.stopRecording(); // J-181: the record chord again stops
    }
    await this.clearError();
    if (this.session.state !== 'idle') throw new CaptureError('busy', `Busy: ${this.session.state}`);
    const s = await this.settingsNow();
    const mode = opts.mode ?? s.recordMode;
    const tab = await this.tabOrThrow(opts.tabId);
    const tabId = tab.id!;
    const localId = uuidv7();
    let streamId: string | null = null;
    if (mode === 'tab') streamId = await this.holdTab(tabId);
    // The server capture is made now so video chunks upload while recording (J-087); it stays
    // unlisted until create (J-189). Without a session the chunks wait in IndexedDB.
    let serverId: string | null = null;
    const auth = await this.uploadAuth();
    if (auth?.workspaceId) {
      try {
        const env = await this.envFor(tabId);
        const created = await api.createCapture(auth, {
          clientId: localId,
          kind: recordingKindOf(mode),
          workspaceId: auth.workspaceId,
          page: { url: tab.url ?? '', title: tab.title ?? '' },
          startedAt: Date.now(),
          ...(env ? { env } : {}),
        });
        serverId = created.id;
        await this.rememberServerId(localId, serverId);
      } catch (e) {
        this.stats.lastError = `create: ${String(e)}`;
      }
    }
    const recordingId = serverId ?? localId;
    this.pendingStream = { recordingId, streamId, localId, serverId, upload: auth && serverId ? { serverUrl: auth.serverUrl, token: auth.token } : null, pageUrl: tab.url ?? '', pageTitle: tab.title ?? '' };
    const next = await this.apply({ type: 'START_RECORDING', tabId, mode, recordingId, now: Date.now() });
    if (next.state === 'countdown') {
      this.countdownLeft = (opts.delaySec ?? COUNTDOWN_MS / 1000) * 1000;
      await this.sendContent(tabId, { type: 'ui.countdown', from: Math.ceil(this.countdownLeft / 1000), startedAt: Date.now(), paused: false });
      this.countdownTimer = setTimeout(() => void this.countdownDone(), this.countdownLeft);
      return next;
    }
    void this.beginMedia();
    return next;
  }

  async pauseCountdown() {
    const s = this.session;
    if (s.state !== 'countdown' || s.paused) return;
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownLeft = Math.max(0, this.countdownLeft - (Date.now() - s.startedAt));
    await this.apply({ type: 'COUNTDOWN_PAUSE' });
    await this.sendContent(s.tabId, { type: 'ui.countdown', from: Math.ceil(this.countdownLeft / 1000), startedAt: Date.now(), paused: true });
  }

  async resumeCountdown() {
    const s = this.session;
    if (s.state !== 'countdown' || !s.paused) return;
    await this.apply({ type: 'COUNTDOWN_RESUME', now: Date.now() });
    await this.sendContent(s.tabId, { type: 'ui.countdown', from: Math.ceil(this.countdownLeft / 1000), startedAt: Date.now(), paused: false });
    this.countdownTimer = setTimeout(() => void this.countdownDone(), this.countdownLeft);
  }

  async cancelCountdown() {
    const s = this.session;
    if (s.state !== 'countdown' && s.state !== 'starting') return;
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    await this.apply({ type: 'CANCEL' });
    await this.sendContent(s.tabId, { type: 'ui.countdown-hide' });
    this.releaseHeld();
    if (this.pendingStream?.serverId) await this.discardServer(this.pendingStream.serverId);
    this.pendingStream = null;
  }

  private async countdownDone() {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.countdownTimer = null;
    const s = this.session;
    if (s.state !== 'countdown') return;
    await this.sendContent(s.tabId, { type: 'ui.countdown-hide' });
    await this.apply({ type: 'COUNTDOWN_DONE' });
    await this.beginMedia();
  }

  private async beginMedia() {
    const s = this.session;
    if (s.state !== 'starting') return;
    const pend = this.pendingStream;
    const settings = await this.settingsNow();
    const micGranted = (await getStore('micGranted')) ?? false;
    const mic = settings.mic && micGranted;
    const upload: UploadAuth = pend?.upload ?? { serverUrl: '', token: '' };
    try {
      if (s.mode === 'tab') {
        const known = pend?.streamId ? this.heldSize.get(pend.streamId) : undefined;
        if (pend?.streamId) this.heldSize.delete(pend.streamId);
        let w = known?.w ?? 0;
        let h = known?.h ?? 0;
        if (!known) {
          const tab = await browser.tabs.get(s.tabId);
          const geo = await this.geometry(s.tabId);
          const dpr = geo?.dpr ?? 1;
          w = Math.round((geo?.viewport.w ?? tab.width ?? 1280) * dpr);
          h = Math.round((geo?.viewport.h ?? tab.height ?? 720) * dpr);
        }
        // the stream itself was taken at the gesture (holdTab); the offscreen document uses it
        const streamId: string = pend?.streamId ?? (await (browser.tabCapture as unknown as typeof Browser.tabCapture).getMediaStreamId({ targetTabId: s.tabId }));
        const r = await this.offscreen<{ ok: boolean; message?: string }>({ to: 'offscreen', type: 'record-tab', streamId, recordingId: s.recordingId, w, h, mic, ...(settings.micDeviceId ? { micDeviceId: settings.micDeviceId } : {}), upload });
        if (!r?.ok) throw new Error(r?.message ?? 'record-tab failed');
      } else {
        // Chrome's picker is the consent step; no countdown (J-007).
        const r = await this.offscreen<{ ok: boolean; error?: string; message?: string }>({ to: 'offscreen', type: 'record-screen', recordingId: s.recordingId, surface: s.mode === 'desktop' ? 'desktop' : 'screen', mic, ...(settings.micDeviceId ? { micDeviceId: settings.micDeviceId } : {}), upload });
        if (!r?.ok) {
          if (r?.error === 'permission_denied') return; // picker-cancelled event handles it
          throw new Error(r?.message ?? 'record-screen failed');
        }
      }
    } catch (e) {
      this.stats.lastError = String(e);
      this.startWaiters.get(s.recordingId)?.reject(e);
      await this.apply({ type: 'FAIL', error: 'media', message: e instanceof Error ? e.message : String(e) });
    }
  }

  async onOffscreenEvent(e: OffscreenEvent) {
    await this.loaded;
    switch (e.type) {
      case 'started': {
        const s = this.session;
        if (s.state !== 'starting' || s.recordingId !== e.recordingId) return;
        this.media.set(e.recordingId, { t: e.t, mime: e.mime, width: e.width, height: e.height, mic: e.mic });
        await this.apply({ type: 'MEDIA_STARTED', recordingId: e.recordingId, now: e.t, mic: e.mic });
        this.startWaiters.get(e.recordingId)?.resolve(e.mic);
        this.emit(s.tabId, 'media', { stream: s.mode === 'tab' ? 'video' : 'screen', op: 'start', mime: e.mime, width: e.width, height: e.height, mic: e.mic }, e.t);
        if (e.mic === 'on') this.emit(s.tabId, 'media', { stream: 'mic', op: 'start', mic: 'on' }, e.t);
        for (const p of this.ports) if (p.tabId === s.tabId) this.postPort(p, { type: 'attach', recordingId: e.recordingId, t0: e.t });
        await this.sendBar(s.tabId);
        return;
      }
      case 'picker-cancelled':
        if (e.recordingId) this.startWaiters.get(e.recordingId)?.reject(new CaptureError('permission_denied', 'picker_cancelled'));
        if (this.session.state === 'starting') {
          const tabId = this.session.tabId;
          await this.apply({ type: 'PICKER_CANCELLED' });
          await this.sendContent(tabId, { type: 'ui.bar', bar: null });
          this.releaseHeld();
          if (this.pendingStream?.serverId) await this.discardServer(this.pendingStream.serverId);
          this.pendingStream = null;
        }
        return;
      case 'ended':
        if (this.session.state === 'recording' && this.session.recordingId === e.recordingId) {
          if (this.external) this.opts.onMediaEnded?.();
          else await this.stopRecording();
        }
        return;
      case 'error':
        this.stats.lastError = `${e.error}: ${e.message}`;
        return;
      default:
        return;
    }
  }

  async pauseRecording() {
    const s = this.activeRecording();
    if (!s || s.pausedAt !== null) return;
    await this.offscreen({ to: 'offscreen', type: 'pause', recordingId: s.recordingId });
    await this.apply({ type: 'PAUSE', now: Date.now() });
    this.emit(s.tabId, 'media', { stream: s.mode === 'tab' ? 'video' : 'screen', op: 'pause' }); // J-233 video-paused row
    await this.sendBar(s.tabId);
  }

  async resumeRecording() {
    const s = this.activeRecording();
    if (!s || s.pausedAt === null) return;
    await this.offscreen({ to: 'offscreen', type: 'resume', recordingId: s.recordingId });
    await this.apply({ type: 'RESUME', now: Date.now() });
    this.emit(s.tabId, 'media', { stream: s.mode === 'tab' ? 'video' : 'screen', op: 'resume' });
    await this.sendBar(s.tabId);
  }

  async setMic(muted?: boolean, deviceId?: string): Promise<MicState> {
    const s = this.activeRecording();
    if (!s) throw new CaptureError('not_found', 'Not recording');
    const r = await this.offscreen<{ ok: boolean; mic?: MicState }>({ to: 'offscreen', type: 'mic', recordingId: s.recordingId, muted: muted ?? s.mic === 'muted', ...(deviceId ? { deviceId } : {}) });
    const mic = r?.mic ?? s.mic;
    await this.apply({ type: 'MIC', mic });
    this.emit(s.tabId, 'media', { stream: 'mic', op: mic === 'muted' ? 'pause' : 'resume', mic, ...(deviceId ? { deviceId } : {}) });
    await this.sendBar(s.tabId);
    return mic;
  }

  async mark(kind: 'pen' | 'blur' | 'mark', label?: string) {
    const s = this.activeRecording();
    if (!s) return;
    this.emit(s.tabId, 'marker', { type: kind, ...(label ? { label } : {}) });
  }

  async stopRecording(): Promise<CaptureSession> {
    await this.loaded;
    const s = this.session;
    if (s.state === 'countdown' || s.state === 'starting') {
      await this.cancelCountdown();
      return this.session;
    }
    if (s.state !== 'recording') return s;
    const stoppedAt = Date.now();
    const next = await this.apply({ type: 'STOP', now: stoppedAt });
    await this.sendContent(s.tabId, { type: 'ui.processing', visible: true });
    this.stopTimer = setTimeout(() => void this.stopTimedOut(s.tabId), this.stopTimeoutMs);
    void this.finishRecording(s, stoppedAt);
    return next;
  }

  /** J-034: no editor within the budget. The bar leaves, the error offers Drafts, and the draft lands there when processing ends. */
  private async stopTimedOut(tabId: number) {
    if (this.session.state !== 'stopping') return;
    await this.apply({ type: 'FAIL', error: 'stop_timeout', message: 'Processing took too long. The recording will be in Drafts.' });
    await this.sendContent(tabId, { type: 'ui.processing', visible: false });
    await this.sendContent(tabId, { type: 'ui.bar', bar: null });
  }

  private async finishRecording(s: Extract<CaptureSession, { state: 'recording' }>, stoppedAt: number): Promise<Draft | null> {
    try {
      const kind = s.mode === 'tab' ? 'video' : 'screen';
      const media = this.media.get(s.recordingId);
      this.emit(s.tabId, 'media', { stream: kind === 'video' ? 'video' : 'screen', op: 'stop' }, stoppedAt);
      const [env, metadata, auth] = await Promise.all([this.envFor(s.tabId), this.metadataFor(s.tabId), getAuth()]);
      await this.flushTabs(s.tabs);
      for (const p of this.ports) if (s.tabs.includes(p.tabId)) this.postPort(p, { type: 'detach', recordingId: s.recordingId });
      const off = await this.offscreen<{ ok: boolean; durationMs: number; lastSeq: Record<string, number>; bytes: Record<string, number>; blobs: Record<string, string>; message?: string }>({ to: 'offscreen', type: 'stop', recordingId: s.recordingId });
      if (!off?.ok) throw new Error(off?.message ?? 'stop failed');
      const startedAt = media?.t ?? s.startedAt;
      const events: CaptureEvent[] = [];
      let rrweb: unknown[] = [];
      for (const tabId of s.tabs) {
        const slice = await this.ring.read(tabId, startedAt - 250, Date.now());
        events.push(...slice.events);
        if (tabId === s.tabId || !rrweb.length) rrweb = slice.rrweb.length ? slice.rrweb : rrweb;
      }
      events.sort((a, b) => a.t - b.t || (a.ctx < b.ctx ? -1 : a.ctx > b.ctx ? 1 : a.seq - b.seq));
      const tab = await browser.tabs.get(s.tabId).catch(() => null);
      const pend = this.pendingStream?.recordingId === s.recordingId ? this.pendingStream : null;
      const startUrl = pend?.pageUrl || tab?.url || '';
      const streams: Draft['streams'] = {};
      for (const [name, last] of Object.entries(off.lastSeq)) (streams as Record<string, unknown>)[name] = { lastSeq: last, totalBytes: off.bytes[name] ?? 0 };
      const draft = await createDraft({
        kind,
        tabId: s.tabId,
        pageUrl: startUrl, // J-070: the URL at capture start, even after route changes
        pageTitle: pend?.pageTitle || tab?.title || '',
        startedAt,
        durationMs: off.durationMs,
        clientId: pend?.localId,
        recordingId: pend?.serverId ?? null,
        mode: s.mode,
        workspaceId: (await workspaceForUrl(startUrl)) ?? auth?.activeWorkspaceId ?? null, // D-124: the project's workspace
        events,
        rrweb,
        env,
        metadata,
        extra: {
          uploadKey: s.recordingId,
          videoBlobId: off.blobs.video ?? null,
          voiceBlobId: off.blobs.voice ?? null,
          videoOffsetMs: 0,
          streams,
          tabIds: s.tabs,
          incognito: tab?.incognito ?? false,
          videoSize: media ? { w: media.width, h: media.height } : null,
        },
      });
      for (const t of s.tabs) await this.markCaptureEnd(t, stoppedAt);
      this.pendingStream = null;
      this.media.delete(s.recordingId);
      this.stats.drafts.push(draft.id);
      if (this.stopTimer) clearTimeout(this.stopTimer);
      if (this.session.state !== 'stopping') return draft; // timed out: the draft is in Drafts
      await this.apply({ type: 'DRAFT_READY', draftId: draft.id, kind, recordingId: draft.recordingId, tabId: s.tabId });
      await this.sendContent(s.tabId, { type: 'ui.bar', bar: null });
      await this.sendContent(s.tabId, { type: 'ui.processing', visible: false });
      await this.sendContent(s.tabId, { type: 'ui.editor-open', draftId: draft.id }); // J-008: the tab active at stop
      return draft;
    } catch (e) {
      if (this.stopTimer) clearTimeout(this.stopTimer);
      this.stats.lastError = `finish: ${String(e)}`;
      await this.sendContent(s.tabId, { type: 'ui.processing', visible: false });
      await this.apply({ type: 'FAIL', error: 'stop_failed', message: e instanceof Error ? e.message : String(e) });
      if (this.external) throw e;
      return null;
    }
  }

  // ---------- driver mode (ext-ui owns the session; lib/bg/capture.ts adapts these) ----------

  private async rememberMediaId(sessionId: string, mediaId: string) {
    this.mediaIds = { ...this.mediaIds, [sessionId]: mediaId };
    await setPrivate(CAPTURE_KEYS.mediaIds, this.mediaIds);
  }

  mediaIdOf(sessionId: string): string {
    return this.mediaIds[sessionId] ?? sessionId;
  }

  /**
   * At the user gesture: checks the tab, takes the tabCapture stream id and creates the server
   * capture (unlisted until create, J-087), so chunks upload while recording.
   */
  async prepareFor(o: { tabId: number; mode: RecordMode; recordingId: string }) {
    await this.loaded;
    if (this.session.state !== 'idle') await this.apply({ type: 'RESET' });
    const tab = await this.tabOrThrow(o.tabId);
    const tabId = tab.id!;
    let streamId: string | null = null;
    if (o.mode === 'tab') streamId = await this.holdTab(tabId);
    let serverId: string | null = null;
    const auth = await this.uploadAuth();
    if (auth?.workspaceId) {
      try {
        const env = await this.envFor(tabId);
        const created = await api.createCapture(auth, {
          clientId: o.recordingId,
          kind: recordingKindOf(o.mode),
          workspaceId: auth.workspaceId,
          page: { url: tab.url ?? '', title: tab.title ?? '' },
          startedAt: Date.now(),
          ...(env ? { env } : {}),
        });
        serverId = created.id;
        await this.rememberServerId(o.recordingId, serverId);
      } catch (e) {
        this.stats.lastError = `create: ${String(e)}`;
      }
    }
    const mediaId = serverId ?? o.recordingId;
    await this.rememberMediaId(o.recordingId, mediaId);
    this.pendingStream = { recordingId: mediaId, streamId, localId: o.recordingId, serverId, upload: auth && serverId ? { serverUrl: auth.serverUrl, token: auth.token } : null, pageUrl: tab.url ?? '', pageTitle: tab.title ?? '' };
    // the owner runs the countdown; the private copy goes straight to starting
    await this.apply({ type: 'START_RECORDING', tabId, mode: o.mode, recordingId: mediaId, now: Date.now() });
    await this.apply({ type: 'COUNTDOWN_DONE' });
  }

  /** Starts the media; resolves with the mic state once MediaRecorder runs. */
  async startFor(o: { tabId: number; mode: RecordMode; recordingId: string }): Promise<MicState> {
    await this.loaded;
    const mediaId = this.mediaIdOf(o.recordingId);
    if (this.session.state !== 'starting' || this.session.recordingId !== mediaId) await this.prepareFor(o);
    const started = new Promise<MicState>((resolve, reject) => {
      const timer = setTimeout(() => reject(new CaptureError('server', 'The recorder did not start')), 120_000);
      const done = () => {
        clearTimeout(timer);
        this.startWaiters.delete(mediaId);
      };
      this.startWaiters.set(mediaId, {
        resolve: (mic) => (done(), resolve(mic)),
        reject: (e) => (done(), reject(e)),
      });
    });
    void this.beginMedia();
    return started;
  }

  /** Aborts a recording that never went live, or a live one on reset; the server copy goes. */
  async cancelFor(sessionId: string) {
    await this.loaded;
    const mediaId = this.mediaIdOf(sessionId);
    const s = this.session;
    if ((s.state === 'countdown' || s.state === 'starting') && s.recordingId === mediaId) {
      this.startWaiters.get(mediaId)?.reject(new CaptureError('permission_denied', 'picker_cancelled'));
      await this.cancelCountdown();
      return;
    }
    if (s.state === 'recording' && s.recordingId === mediaId) {
      await this.offscreen({ to: 'offscreen', type: 'stop', recordingId: mediaId }).catch(() => undefined);
      await this.apply({ type: 'RESET' });
      this.releaseHeld();
      if (this.pendingStream?.serverId) await this.discardServer(this.pendingStream.serverId);
      this.pendingStream = null;
    }
  }

  /** Stops, gathers logs and writes the draft; resolves when the editor can open (J-034). */
  async stopFor(sessionId: string): Promise<Draft> {
    await this.loaded;
    const s = this.session;
    const mediaId = this.mediaIdOf(sessionId);
    if (s.state !== 'recording' || s.recordingId !== mediaId) throw new CaptureError('not_found', 'Not recording');
    const stoppedAt = Date.now();
    await this.apply({ type: 'STOP', now: stoppedAt });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      // J-034: past the budget the owner shows an error; the draft still lands in Drafts
      timer = setTimeout(() => reject(new CaptureError('server', 'Processing took too long. The recording will be in Drafts.')), this.stopTimeoutMs);
    });
    try {
      const draft = await Promise.race([this.finishRecording(s, stoppedAt), timeout]);
      if (!draft) throw new CaptureError('server', 'The recording could not be saved');
      return draft;
    } finally {
      if (timer) clearTimeout(timer);
      if (this.session.state === 'stopping') await this.apply({ type: 'RESET' });
    }
  }

  // ---------- microphone grant (J-014, J-200) ----------

  /** A pill click asked to turn the mic on and is waiting for the one-time grant. */
  private micWantedOn = false;

  async requestMic(): Promise<boolean> {
    if (await getStore('micGranted')) return true;
    this.micWantedOn = true;
    const granted = new Promise<boolean>((resolve) => {
      this.micWaiters.push(resolve);
      setTimeout(() => resolve(false), 120_000);
    });
    await browser.tabs.create({ url: browser.runtime.getURL('/permissions.html'), active: true });
    return granted;
  }

  async onMicResult(granted: boolean, deviceCount: number) {
    await setStore('micGranted', granted);
    const s = await this.settingsNow();
    if (!granted || deviceCount === 0) {
      // no device or blocked: the pill shows off
      if (s.mic) await setStore('settings', { ...s, mic: false });
    } else if (this.micWantedOn && !s.mic) {
      // The grant tab took the focus and Chrome closed the popup before it could turn the mic
      // on, so the worker finishes the click the user made: the pill reads on (J-014).
      await setStore('settings', { ...s, mic: true });
      this.settings = null;
    }
    this.micWantedOn = false;
    for (const w of this.micWaiters.splice(0)) w(granted);
  }

  // ---------- instant replay (J-009, J-010, J-189) ----------

  async setReplay(opts: { enabled: boolean; minutes?: number; video?: boolean; tabId?: number }): Promise<ReplayState> {
    await this.loaded;
    const minutes = Math.min(LIMITS.replayMaxMin, Math.max(1, opts.minutes ?? this.replay.minutes));
    const tabs = { ...this.replay.tabs };
    if (opts.tabId !== undefined && opts.video !== undefined) {
      if (opts.video && opts.enabled) {
        const streamId = await (browser.tabCapture as unknown as typeof Browser.tabCapture).getMediaStreamId({ targetTabId: opts.tabId });
        await this.offscreen({ to: 'offscreen', type: 'replay-video-start', tabId: opts.tabId, streamId, minutes });
        tabs[opts.tabId] = { since: Date.now(), video: true, heavy: tabs[opts.tabId]?.heavy ?? false };
      } else {
        await this.offscreen({ to: 'offscreen', type: 'replay-video-stop', tabId: opts.tabId });
        if (tabs[opts.tabId]) tabs[opts.tabId] = { ...tabs[opts.tabId]!, video: false };
      }
    }
    this.replay = { enabled: opts.enabled, minutes, tabs: opts.enabled ? tabs : {} };
    await setStore('replay', this.replay);
    for (const p of this.ports) this.postPort(p, { type: 'ring', enabled: this.ringWanted(p.tabId, p.url), minutes });
    this.broadcast();
    return this.replay;
  }

  /** Builds a replay draft from the ring. Nothing is uploaded until create (J-189). */
  async triggerReplay(tabId?: number, opts: { openEditor?: boolean } = {}): Promise<Draft> {
    await this.loaded;
    if (!this.replay.enabled) throw new CaptureError('invalid', 'Instant replay is off');
    await this.clearError();
    if (this.session.state !== 'idle') throw new CaptureError('busy', `Busy: ${this.session.state}`);
    const tab = await this.tabOrThrow(tabId);
    const id = tab.id!;
    const [env, metadata, auth] = await Promise.all([this.envFor(id), this.metadataFor(id), getAuth()]);
    await this.flushTabs([id]);
    const now = Date.now();
    const windowMs = this.replay.minutes * 60_000;
    const slice = await this.ring.read(id, now - windowMs, now);
    if (!slice.rrweb.length) throw new CaptureError('not_found', 'Nothing recorded on this tab yet');
    // The replay starts at its first full snapshot: never before the window, never before the last load.
    const start = Math.max(now - windowMs, slice.rrwebStart ?? now - windowMs);
    const events = slice.events.filter((e) => e.t >= start - 1000);
    const durationMs = now - start;
    const draftKey = uuidv7();
    // A still of the page as it is now: the drafts list and the dashboard card show it, since a
    // DOM replay has no video frame to take one from (J-158).
    let thumb: Blob | null = null;
    try {
      const geo = await this.geometry(id);
      const shot = await dataUrlToBlob(await this.shots.run(() => browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' })));
      thumb = (await cropImage(shot, null, geo?.viewport.w ?? tab.width ?? 1280, { cssPixels: true })).blob;
    } catch {
      thumb = null; // not the active tab, or a page that refuses captures: no still
    }
    let replaySegmentBlobIds: string[] = [];
    if (this.replay.tabs[id]?.video) {
      const r = await this.offscreen<{ ok: boolean; blobIds?: string[] }>({ to: 'offscreen', type: 'replay-video-flush', tabId: id, recordingId: draftKey, upload: { serverUrl: '', token: '' } });
      replaySegmentBlobIds = r?.blobIds ?? [];
    }
    const draft = await createDraft({
      kind: 'replay',
      tabId: id,
      pageUrl: tab.url ?? '',
      pageTitle: tab.title ?? '',
      startedAt: start,
      durationMs,
      clientId: draftKey,
      workspaceId: (await workspaceForUrl(tab.url)) ?? auth?.activeWorkspaceId ?? null, // D-124: the project's workspace
      events,
      rrweb: slice.rrweb,
      thumb,
      env,
      metadata,
      extra: { trim: { startMs: Math.max(0, Math.round(durationMs) - 30_000), endMs: Math.max(1, Math.round(durationMs)) }, replaySegmentBlobIds, tabIds: [id], incognito: tab.incognito },
    });
    await this.markCaptureEnd(id, now);
    this.stats.drafts.push(draft.id);
    await this.apply({ type: 'DRAFT_READY', draftId: draft.id, kind: 'replay', recordingId: null, tabId: id });
    if (opts.openEditor !== false) await this.sendContent(id, { type: 'ui.editor-open', draftId: draft.id });
    return draft;
  }

  // ---------- uploads ----------

  private async rememberServerId(localId: string, serverId: string) {
    const ids = await getPrivate<Record<string, string>>(CAPTURE_KEYS.serverIds, {});
    ids[localId] = serverId;
    ids[serverId] = serverId;
    await setPrivate(CAPTURE_KEYS.serverIds, ids);
  }

  private async discardServer(serverId: string) {
    const auth = await this.uploadAuth();
    if (auth) await api.deleteCapture(auth, serverId).catch(() => {});
  }

  /** Background drain (alarm, startup): sends queued chunks of captures the server knows. */
  async drainAll(): Promise<{ sent: number; failed: number }> {
    const auth = await this.uploadAuth();
    if (!auth) return { sent: 0, failed: 0 };
    const ids = await getPrivate<Record<string, string>>(CAPTURE_KEYS.serverIds, {});
    let sent = 0;
    let failed = 0;
    for (const key of await allPendingIds()) {
      const serverId = ids[key];
      if (!serverId) continue; // a draft nobody created yet stays local (J-189)
      if (key !== serverId) await rekey(key, serverId);
      const r = await drain(auth, serverId, serverId);
      sent += r.sent;
      failed += r.failed;
    }
    return { sent, failed };
  }

  /** Create from a draft (the editor's create button runs this through draft.create). */
  async createFromDraft(draftId: string, finalize: FinalizeCaptureBody, onProgress?: (sent: number, total: number) => void) {
    const draft = await idbGet<Draft>('drafts', draftId);
    if (!draft) throw new CaptureError('not_found', 'Draft not found');
    const auth = await this.uploadAuth();
    if (!auth) throw new CaptureError('not_signed_in', 'Sign in to create captures');
    const workspaceId = finalize.workspaceId ?? draft.workspaceId ?? auth.workspaceId;
    if (!workspaceId) throw new CaptureError('invalid', 'No workspace');
    if (this.session.state === 'draft' && this.session.draftId === draftId) await this.apply({ type: 'CREATE', recordingId: draft.recordingId ?? draft.clientId });
    try {
      await saveDraft({ ...draft, status: 'uploading', updatedAt: Date.now() });
      const res = await uploadDraft(draft, finalize, { auth, workspaceId, onProgress });
      await this.rememberServerId(draft.uploadKey ?? draft.clientId, res.recordingId);
      await saveDraft({ ...draft, status: 'saved', recordingId: res.recordingId, shareUrl: res.shareUrl, updatedAt: Date.now() });
      if (this.session.state === 'uploading') await this.apply({ type: 'UPLOAD_DONE' });
      return res;
    } catch (e) {
      await saveDraft({ ...draft, status: 'failed', error: String(e), updatedAt: Date.now() });
      if (this.session.state === 'uploading') await this.apply({ type: 'UPLOAD_FAILED', error: 'upload', message: String(e) });
      throw e;
    }
  }

  /** Discard: delete server chunks and local data (J-189). */
  async discardDraft(draftId: string) {
    const draft = await idbGet<Draft>('drafts', draftId);
    if (!draft) return;
    await discardDraftData(draft, await this.uploadAuth());
    await saveDraft({ ...draft, status: 'failed', error: 'discarded', updatedAt: Date.now() });
    if (this.session.state === 'draft' && this.session.draftId === draftId) await this.apply({ type: 'DISCARD' });
  }

  /** captureVisibleTab through the shared queue (two calls a second at most); locator crops use it (D-128). */
  captureTab(windowId: number): Promise<string> {
    return this.shots.run(() => browser.tabs.captureVisibleTab(windowId, { format: 'png' }));
  }

  async ringInfo(tabId: number, sinceMs = 5 * 60_000, full = false) {
    await this.ring.flush();
    const slice = await this.ring.read(tabId, Date.now() - sinceMs);
    const kinds: Record<string, number> = {};
    for (const e of slice.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    return { events: slice.events.length, rrweb: slice.rrweb.length, kinds, ...(full ? { slice: { events: slice.events, rrweb: slice.rrweb } } : {}) };
  }

  /** Keeps a draft record in step (used after offscreen saves blobs). */
  async putDraft(d: Draft) {
    await idbPut('drafts', d);
  }
}
