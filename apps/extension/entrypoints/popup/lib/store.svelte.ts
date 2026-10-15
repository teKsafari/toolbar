// Popup state: read straight from chrome.storage (fast paint, J-193) plus two worker calls for
// the session and the active tab's context. Storage and session broadcasts keep it live.
import { browser } from 'wxt/browser';
import { DEFAULT_SERVER_URL } from '@toolbar/shared/constants';
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
import { migrateStorage } from '../../../lib/migrate';

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
  serverUrl = $state(DEFAULT_SERVER_URL);
  error = $state('');
  tabId = tabIdParam();

  get signedIn() {
    return !!this.auth?.token;
  }

  async load() {
    const t0 = performance.now();
    await migrateStorage();
    const local = await browser.storage.local.get([STORAGE.auth.key, STORAGE.settings.key, STORAGE.drafts.key, STORAGE.bootstrap.key, STORAGE.serverUrl.key]);
    this.auth = (local[STORAGE.auth.key] as AuthState | undefined) ?? null;
    const stored = local[STORAGE.settings.key] as ExtensionSettings | undefined;
    if (stored) this.settings = { ...defaults, ...stored };
    else {
      const r = await send('settings.update', { patch: {} });
      if (r.ok) this.settings = r.settings;
    }
    this.drafts = (local[STORAGE.drafts.key] as DraftSummary[] | undefined) ?? [];
    this.bootstrap = (local[STORAGE.bootstrap.key] as StorageValues['bootstrap'] | undefined) ?? null;
    this.serverUrl =
      (local[STORAGE.serverUrl.key] as string | undefined) ?? this.auth?.serverUrl ?? ((import.meta.env.WXT_SERVER_URL as string | undefined) || DEFAULT_SERVER_URL);
    // the tab under this popup: the active tab of the popup's own window (the worker's
    // lastFocusedWindow can name another window, such as a just-closed sign-in window)
    this.tabId ??= (await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0]?.id;
    const [sess, ctx] = await Promise.all([send('session.get', {}), send('ui.context', { tabId: this.tabId })]);
    if (sess.ok) {
      this.session = sess.session;
      this.replay = sess.replay;
    }
    if (ctx.ok) this.context = ctx.context;
    const pending = await browser.storage.session.get('tb:popup-screen').catch(() => ({}) as Record<string, unknown>);
    if (pending['tb:popup-screen'] === 'link') this.screen = 'link';
    void browser.storage.session.remove('tb:popup-screen').catch(() => undefined);
    this.loading = false;
    (globalThis as { __tbPopupPaintMs?: number }).__tbPopupPaintMs = performance.now() - t0;
    if (this.signedIn) {
      // account settings follow the user across browsers (J-215)
      void send('settings.sync', {});
      // limits (J-013), folders (J-015) and the support link (J-177) come with the bootstrap;
      // the auth area answers from its cache when it is fresh, and storage.onChanged updates us
      // D-120: on a page the extension may not run on, the project list may be new: fetch it now
      const site = this.context?.site;
      void send('bootstrap.get', { refresh: !!site && !site.allowed && !site.allSites && !this.context?.isServerPage });
    }
  }

  listen() {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[STORAGE.auth.key]) this.auth = (changes[STORAGE.auth.key]!.newValue as AuthState | undefined) ?? null;
      if (changes[STORAGE.settings.key]) this.settings = { ...defaults, ...((changes[STORAGE.settings.key]!.newValue as Partial<ExtensionSettings>) ?? {}) };
      if (changes[STORAGE.drafts.key]) this.drafts = (changes[STORAGE.drafts.key]!.newValue as DraftSummary[] | undefined) ?? [];
      if (changes[STORAGE.bootstrap.key]) {
        this.bootstrap = (changes[STORAGE.bootstrap.key]!.newValue as StorageValues['bootstrap']) ?? null;
        void this.refreshContext(); // D-120: a new project list changes what this page allows
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
    // D-120: a grant made while the prompt covered the popup
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
