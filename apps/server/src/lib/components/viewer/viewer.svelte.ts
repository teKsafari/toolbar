// Capture page state: the loaded events, the panel models derived from them, the player clock and
// the cross-panel requests (seek, open a row, highlight a comment). One instance per page, shared
// through context.
import { getContext, setContext } from 'svelte';
import type { CaptureEvent } from '@toolbar/shared';
import type { CaptureDetail, CommentThread, Comment } from '@toolbar/shared/api';
import { buildTimeMap, deriveActions, deriveConsole, deriveMarkers, deriveNetwork, isFailed, type TimeMap } from '@toolbar/ui/viewer';
import { fetchJsonMaybeGzip, setShareToken } from './api.ts';
import { loadPrefs, savePrefs, type ViewerPrefs } from './prefs.ts';
import type { ViewerData } from './types.ts';

export type TabId = 'info' | 'console' | 'network' | 'actions' | 'agent';
export const TABS: { id: TabId; label: string }[] = [
  { id: 'info', label: 'Info' },
  { id: 'console', label: 'Console' },
  { id: 'network', label: 'Network' },
  { id: 'actions', label: 'Actions' },
  { id: 'agent', label: 'Agent' },
];

export interface Chapter {
  title: string;
  startMs: number;
  endMs: number;
}

export class Viewer {
  data: ViewerData;
  detail: CaptureDetail = $state() as CaptureDetail;
  events: CaptureEvent[] = $state.raw([]);
  eventsLoaded = $state(false);
  eventsError = $state<string | null>(null);
  threads: CommentThread[] = $state([]);
  folders: { id: string; name: string }[] = $state([]);

  /** player ms (video time, paused spans left out) */
  now = $state(0);
  duration = $state(0);
  playing = $state(false);
  prefs: ViewerPrefs = $state(loadPrefs());
  tab: TabId = $state('console');
  devtoolsOpen = $state(true);
  /** narrow screens show one of the two columns (J-115) */
  narrowView: 'capture' | 'devtools' = $state('capture');
  /** request from a marker or link to show a console or network row */
  focus: { tab: TabId; id: string; n: number } | null = $state(null);
  selectedRid: string | null = $state(null);
  highlightComment: string | null = $state(null);
  /** a gutter click armed a timestamped comment (J-103) */
  armed = $state(false);
  /** set by the media component */
  seekImpl: ((ms: number) => void) | null = null;
  playImpl: (() => void) | null = null;

  hasVideo = $derived(!!this.detail?.media.video);
  /** a clock to follow: video or DOM replay */
  playable = $derived(!!this.detail?.media.video || (this.detail?.media.rrwebUrls.length ?? 0) > 0);
  map: TimeMap = $derived(buildTimeMap(this.events, this.detail.startedAt ? Date.parse(this.detail.startedAt) : null, this.hasVideo));
  network = $derived(deriveNetwork(this.events, this.map));
  consoleRows = $derived(deriveConsole(this.events, this.map, this.network));
  actions = $derived(deriveActions(this.events, this.map));
  markers = $derived(deriveMarkers(this.consoleRows, this.network, this.events, this.map));
  chapters: Chapter[] = $derived(this.computeChapters());
  /** Desktop recordings gather several tabs; show a Tab column then (J-224). */
  showTabColumn = $derived(this.detail.kind === 'screen' && new Set(this.network.map((n) => n.tabId).filter((x) => x != null)).size > 0);
  signedIn = $derived.by(() => !!this.data?.me);
  canEdit = $derived.by(() => this.detail.canEdit && this.data.mode === 'member');

  tabState = $derived.by(() => {
    const errs = this.consoleRows.some((r) => r.level === 'error');
    const failed = this.network.some((n) => isFailed(n));
    return {
      info: 'ok',
      console: this.consoleRows.length ? (errs ? 'error' : 'ok') : 'none',
      network: this.network.length ? (failed ? 'error' : 'ok') : 'none',
      actions: this.actions.length ? 'ok' : 'none',
      agent: 'none',
    } as Record<TabId, 'ok' | 'error' | 'none'>;
  });

  constructor(data: ViewerData) {
    this.data = data;
    this.detail = data.detail;
    this.threads = data.threads;
    this.folders = data.folders;
    setShareToken(data.shareToken);
    this.tab = this.prefs.lastTab;
    this.devtoolsOpen = data.devtools && this.prefs.devtoolsOpen;
    this.highlightComment = data.highlight;
    this.duration = data.detail.media.video?.durationMs ?? data.detail.durationMs ?? 0;
  }

  async loadEvents() {
    const url = this.detail.media.eventsUrl;
    if (!url) {
      this.eventsLoaded = true;
      return;
    }
    try {
      const ev = await fetchJsonMaybeGzip<CaptureEvent[]>(url);
      this.events = Array.isArray(ev) ? ev : [];
    } catch (e) {
      this.eventsError = (e as Error).message;
    } finally {
      this.eventsLoaded = true;
    }
  }

  private computeChapters(): Chapter[] {
    // AI chapters and the chapters menu are paused unless FEATURE_AI is on (docs/scope.md)
    if (!this.data.chapters) return [];
    const end = this.duration || 0;
    const given = this.detail.chapters ?? [];
    if (given.length) return given.map((c) => ({ title: c.title, startMs: c.startMs, endMs: c.endMs }));
    // Without AI chapters (J-075), split at page navigations when there are at least two pages.
    const navs = this.events.filter((e) => e.kind === 'nav');
    if (!this.hasVideo || navs.length < 2 || !end) return [];
    const starts = navs.map((n, i) => ({
      title: (n.kind === 'nav' && n.data.title) || (n.kind === 'nav' ? new URL(n.data.url, 'http://x').pathname : `Part ${i + 1}`),
      startMs: Math.max(0, i === 0 ? 0 : this.map.toPlayer(n.t)),
    }));
    return starts.map((s, i) => ({ ...s, endMs: starts[i + 1]?.startMs ?? end })).filter((c) => c.endMs > c.startMs);
  }

  chapterAt(ms: number): Chapter | null {
    return this.chapters.findLast((c) => c.startMs <= ms) ?? null;
  }

  setTab(t: TabId) {
    this.tab = t;
    this.setPref({ lastTab: t });
  }

  setPref(p: Partial<ViewerPrefs>) {
    Object.assign(this.prefs, p);
    savePrefs(p, this.signedIn);
  }

  toggleDevtools(open = !this.devtoolsOpen) {
    this.devtoolsOpen = open;
    this.setPref({ devtoolsOpen: open });
  }

  seek(ms: number, opts: { arm?: boolean } = {}) {
    const clamped = Math.max(0, this.duration ? Math.min(ms, this.duration) : ms);
    this.now = clamped;
    this.seekImpl?.(clamped);
    if (opts.arm) this.armed = true;
  }

  /** Open a tab at a row (marker click, J-095). */
  reveal(tab: TabId, id: string) {
    this.setTab(tab);
    if (!this.devtoolsOpen) this.toggleDevtools(true);
    this.narrowView = 'devtools';
    this.focus = { tab, id, n: (this.focus?.n ?? 0) + 1 };
  }

  // ---------- comments ----------

  allComments(): Comment[] {
    return this.threads.flatMap((t) => [t, ...t.replies]);
  }

  upsertComment(c: Comment) {
    if (c.parentId) {
      const parent = this.threads.find((t) => t.id === c.parentId);
      if (!parent) return;
      const i = parent.replies.findIndex((r) => r.id === c.id);
      if (i >= 0) parent.replies[i] = c;
      else parent.replies.push(c);
      return;
    }
    const i = this.threads.findIndex((t) => t.id === c.id);
    if (i >= 0) this.threads[i] = { ...c, replies: this.threads[i]!.replies };
    else this.threads.push({ ...c, replies: [] });
  }

  removeComment(id: string) {
    this.threads = this.threads.filter((t) => t.id !== id).map((t) => ({ ...t, replies: t.replies.filter((r) => r.id !== id) }));
  }

  setReactions(id: string, reactions: Comment['reactions']) {
    for (const t of this.threads) {
      if (t.id === id) t.reactions = reactions;
      for (const r of t.replies) if (r.id === id) r.reactions = reactions;
    }
  }

  /** Timed comments for timeline bubbles (J-128). */
  timedComments = $derived(this.threads.filter((t) => t.tMs !== null && !t.resolvedAt));
}

const KEY = Symbol('nib-viewer');
export const provideViewer = (v: Viewer) => setContext(KEY, v);
export const useViewer = () => getContext<Viewer>(KEY);
