// Popup state: read straight from chrome.storage (fast paint, J-193) plus two worker calls for
// the session and the active tab's context. Storage and session broadcasts keep it live.
import { browser } from 'wxt/browser';
import { API_PREFIX } from '@toolbar/shared/constants';
import {
  DEFAULT_REPLAY,
  IDLE,
  STORAGE,
  type AuthState,
  type Broadcast,
  type CaptureSession,
  type DraftSummary,
  type PopupContext,
  type ReplayState,
  type StorageValues,
} from '@toolbar/shared/ext';
import type { ExtensionSettings } from '@toolbar/shared/api';
import { send } from '../../capture.content/ui/send';
import { BUILT_SERVER_URL, managedPolicy, resolveServerUrl } from '../../../lib/server-url';

export type Screen = 'main' | 'settings' | 'sites' | 'drafts' | 'link' | 'link-help' | 'heavy';

// Placeholder until storage answers; the worker fills real defaults on first use. Kept local so
// the popup bundle does not pull the zod contracts (D-028).
const defaults: ExtensionSettings = {
  instantReplay: false,
  replayMinutes: 2,
  replayVideo: false,
  replayBlockedSites: [],
  openInNewTab: true,
  captureUserEvents: true,
  sendErrorLogs: true,
  screenshotDelaySec: 0,
  recordMode: 'tab',
  mic: false,
  micDeviceId: null,
};

/** How long the popup waits for the service worker or the server before it says so. */
export const POPUP_WAIT_MS = 8000;

/** Resolves to `fallback` when `p` takes longer than `ms` (a worker that never answers). */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      () => (clearTimeout(t), resolve(fallback)),
    );
  });
}

const NO_ANSWER = { ok: false as const, error: 'not_implemented' as const, message: 'no answer' };

/** Tab id from ?tabId= (tests open popup.html in a tab), else the active tab. */
function tabIdParam(): number | undefined {
  const v = new URLSearchParams(location.search).get('tabId');
  return v ? Number(v) : undefined;
}

class PopupStore {
  loading = $state(true);
  screen: Screen = $state('main');
  auth: AuthState | null = $state(null);
  settings: ExtensionSettings = $state(defaults);
  drafts: DraftSummary[] = $state([]);
  session: CaptureSession = $state(IDLE);
  replay: ReplayState = $state(DEFAULT_REPLAY);
  context: PopupContext | null = $state(null);
  bootstrap: StorageValues['bootstrap'] = $state(null);
  /** the configured server (lib/server-url.ts); the build's until storage answers */
  serverUrl = $state(resolveServerUrl(null));
  /** D-202: an admin's policy locks the server; the signed-out screen hides "Use another server" */
  lockServerUrl = $state(false);
  error = $state('');
  /** set when the popup could not finish loading; the popup shows it with a retry button */
  loadError = $state('');
  /** the service worker did not answer: the error offers a restart of the extension (D-199) */
  workerDown = $state(false);
  /** signed out: the configured server did not answer its public branding request */
  serverError = $state('');
  tabId = tabIdParam();

  get signedIn() {
    return !!this.auth?.token;
  }

  /**
   * Fill the popup. It always leaves the loading state: a failed step or a worker that does not
   * answer within POPUP_WAIT_MS shows loadError with a retry instead of an endless spinner.
   */
  async load() {
    const t0 = performance.now();
    this.loadError = '';
    this.workerDown = false;
    try {
      await this.fill();
    } catch (e) {
      this.loadError = `The popup could not load: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.loading = false;
      (globalThis as { __tbPopupPaintMs?: number }).__tbPopupPaintMs = performance.now() - t0;
    }
    if (this.loadError) return;
    if (!this.signedIn) {
      void this.checkServer();
      return;
    }
    // account settings follow the user across browsers (J-215)
    void send('settings.sync', {});
    // limits (J-013), folders (J-015) and the support link (J-177) come with the bootstrap;
    // the auth area answers from its cache when it is fresh, and storage.onChanged updates us
    // D-126: on a page the extension may not run on, the project list may be new: fetch it now
    const site = this.context?.site;
    void send('bootstrap.get', { refresh: !!site && !site.allowed && site.reason === 'not-in-project' && !this.context?.isServerPage });
  }

  private async fill() {
    const [local, policy] = await Promise.all([
      browser.storage.local.get([STORAGE.auth.key, STORAGE.settings.key, STORAGE.drafts.key, STORAGE.bootstrap.key, STORAGE.serverUrl.key]),
      managedPolicy(),
    ]);
    // first, so the home button and the signed-out screen name the right server whatever follows;
    // an admin's policy wins over the options-page override (D-202)
    this.serverUrl = resolveServerUrl(local[STORAGE.serverUrl.key], BUILT_SERVER_URL, policy.serverUrl);
    this.lockServerUrl = policy.lockServerUrl;
    this.auth = (local[STORAGE.auth.key] as AuthState | undefined) ?? null;
    this.drafts = (local[STORAGE.drafts.key] as DraftSummary[] | undefined) ?? [];
    this.bootstrap = (local[STORAGE.bootstrap.key] as StorageValues['bootstrap'] | undefined) ?? null;
    const stored = local[STORAGE.settings.key] as ExtensionSettings | undefined;
    if (stored) this.settings = { ...defaults, ...stored };
    else {
      const r = await within(send('settings.update', { patch: {} }), POPUP_WAIT_MS, NO_ANSWER);
      if (r.ok) this.settings = r.settings;
    }
    // the tab under this popup: the active tab of the popup's own window (the worker's
    // lastFocusedWindow can name another window, such as a just-closed sign-in window)
    this.tabId ??= (await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0]?.id;
    const [sess, ctx] = await Promise.all([
      within(send('session.get', {}), POPUP_WAIT_MS, NO_ANSWER),
      within(send('ui.context', { tabId: this.tabId }), POPUP_WAIT_MS, NO_ANSWER),
    ]);
    if (sess.ok) {
      this.session = sess.session;
      this.replay = sess.replay;
    }
    if (ctx.ok) this.context = ctx.context;
    // neither answer: the service worker is not running (or failed to start)
    if (!sess.ok && !ctx.ok) {
      this.workerDown = true;
      throw new Error(`the extension's background worker did not answer (${sess.message ?? sess.error}). Restart the extension, or try again.`);
    }
    const pending = await browser.storage.session.get('tb:popup-screen').catch(() => ({}) as Record<string, unknown>);
    if (pending['tb:popup-screen'] === 'link') this.screen = 'link';
    void browser.storage.session.remove('tb:popup-screen').catch(() => undefined);
  }

  /** Signed out: ask the server's public branding endpoint, so an unreachable server says so before sign-in. */
  async checkServer() {
    const url = this.serverUrl;
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      /* keep the raw value */
    }
    let msg = '';
    try {
      const r = await fetch(`${url}${API_PREFIX}/branding`, { cache: 'no-store', signal: AbortSignal.timeout(POPUP_WAIT_MS) });
      if (!r.ok) msg = `${host} answered with an error (${r.status}). Check the server address.`;
    } catch {
      msg = `Cannot reach ${host}. Check your connection or the server address.`;
    }
    if (url === this.serverUrl) this.serverError = msg;
  }

  /** Retry after a failed load or an unreachable server. */
  /**
   * Reload the whole extension from the popup itself, without the worker (which is what does not
   * answer): a stuck worker after an update no longer needs a browser restart. The new worker
   * reopens the popup, as the menu's restart does (J-177).
   */
  async restartExtension() {
    await Promise.race([browser.storage.local.set({ 'tb:reopen-popup': Date.now() }).catch(() => undefined), new Promise((r) => setTimeout(r, 300))]);
    browser.runtime.reload();
  }

  async retry() {
    this.loading = true;
    this.serverError = '';
    await this.load();
  }

  listen() {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE.auth.key]) this.auth = (changes[STORAGE.auth.key]!.newValue as AuthState | undefined) ?? null;
      if (changes[STORAGE.settings.key]) this.settings = { ...defaults, ...((changes[STORAGE.settings.key]!.newValue as Partial<ExtensionSettings>) ?? {}) };
      if (changes[STORAGE.drafts.key]) this.drafts = (changes[STORAGE.drafts.key]!.newValue as DraftSummary[] | undefined) ?? [];
      if (changes[STORAGE.bootstrap.key]) {
        this.bootstrap = (changes[STORAGE.bootstrap.key]!.newValue as StorageValues['bootstrap']) ?? null;
        void this.refreshContext(); // D-126: a new project list changes what this page allows
      }
    });
    browser.runtime.onMessage.addListener((msg: Broadcast) => {
      if (msg?.type === 'session.changed') {
        this.session = msg.session;
        this.replay = msg.replay;
      }
      if (msg?.type === 'auth.changed') void this.load();
      return undefined;
    });
    // D-126: a grant made while the prompt covered the popup
    browser.permissions?.onAdded?.addListener(() => {
      setTimeout(() => void this.refreshContext(), 300);
    });
  }

  async refreshContext() {
    const ctx = await send('ui.context', { tabId: this.tabId });
    if (ctx.ok) this.context = ctx.context;
  }

  async updateSettings(patch: Partial<ExtensionSettings>) {
    this.settings = { ...this.settings, ...patch };
    const r = await send('settings.update', { patch });
    if (r.ok) this.settings = r.settings;
    else this.error = r.message ?? 'Could not save the setting';
  }
}

export const store = new PopupStore();
