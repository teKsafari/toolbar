// "Start trace" and "Stop trace" (Part 2, PLAN "What a trace is"). A trace is a capture of kind
// `trace`: the events and the DOM replay of one tab between start and stop. While it runs, the
// tab is attached like a recording (rrweb, canvas samples), its ring is kept whole, and the span
// engine runs live here to time keyframes: screenshots on route changes, annotations, changed
// spans and DOM bursts, at most one every 1.5 s, near-duplicates (33x32 dHash) dropped. Stop reads the
// ring, uploads the events and the replay, and finalizes; the server derives spans.jsonl from the
// stored events (GET /api/v1/recordings/:id/spans).
//
// Separate from the capture session of lib/bg/ui.ts: a trace can run beside a screenshot or a
// recording of the same tab. The running trace lives in storage (tb:trace), so a worker restart
// re-attaches it; the live engine then starts afresh (keyframes resume, spans come from the server).
import { browser, type Browser } from 'wxt/browser';
import { toNdjson, type CaptureEvent } from '@toolbar/shared';
import { uuidv7 } from '@toolbar/shared/ids';
import { projectForUrl, traceOpenMsOf } from '@toolbar/shared/projects';
import type { BgError, BgRequest, BgRequestType, TraceResult, TraceState } from '@toolbar/shared/ext';
import { KEYFRAME_HASH_SIZE, LiveTrace, dHash, isNearDuplicate, type KeyframeRequest, type Span } from '@toolbar/trace';
import { CaptureError, isRestrictedUrl, type CaptureService } from '../capture/service';
import { getAuth, getPrivate, serverUrl, setPrivate } from '../capture/store';
import { CaptureQueue, cropImage, dataUrlToBlob } from '../crop';
import { TEST_HOOKS } from '../flags';
import { projects } from '../scope';
import { api, HttpError, type UploadAuthLike } from '../upload/client';
import { enqueueNdjson } from '../upload/draft';
import { drain, withRetry } from '../upload/queue';

const KEY = 'tb:trace';
const TICK_MS = 250;

interface Stored {
  recordingId: string;
  tabId: number;
  windowId: number;
  startedAt: number;
  url: string;
  title: string;
  /** span window for open requests, from the page's project (D-166) */
  openMs?: number;
}

export class TraceController {
  private cur: Stored | null = null;
  private live: LiveTrace | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private untap: (() => void) | null = null;
  private lastHash: string | null = null;
  private keyframeCount = 0;
  private shots = new CaptureQueue(600);
  private stopping: Promise<TraceResult> | null = null;
  /** The live engine's spans of the last trace that stopped (e2e compares them with the server's). */
  lastSpans: readonly Span[] = [];
  readonly loaded: Promise<void>;
  /** e2e and debugging: the keyframes kept and dropped */
  readonly stats = { keyframes: 0, duplicates: 0, keyframeErrors: 0, lastError: null as string | null };

  constructor(private svc: CaptureService) {
    this.loaded = this.restore();
  }

  private async restore() {
    const s = await getPrivate<Stored | null>(KEY, null);
    if (!s) return;
    const tab = await browser.tabs.get(s.tabId).catch(() => null);
    this.cur = s;
    this.svc.attachTrace(s.tabId, s.recordingId, s.startedAt);
    this.begin();
    if (!tab) void this.stop({ open: false }).catch(() => undefined);
  }

  state(): TraceState | null {
    const c = this.cur;
    if (!c) return null;
    const outcomes: Record<string, number> = {};
    for (const s of this.live?.spans ?? []) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
    return { recordingId: c.recordingId, tabId: c.tabId, startedAt: c.startedAt, url: c.url, title: c.title, spans: this.live?.spans.length ?? 0, outcomes, keyframes: this.keyframeCount };
  }

  private async auth(): Promise<UploadAuthLike & { workspaceId: string | null }> {
    const a = await getAuth();
    if (!a?.token) throw new CaptureError('not_signed_in', 'Sign in to start a trace');
    return { serverUrl: a.serverUrl || (await serverUrl()), token: a.token, workspaceId: a.activeWorkspaceId };
  }

  async start(tabId?: number): Promise<TraceState> {
    await this.loaded;
    if (this.cur) throw new CaptureError('busy', 'A trace is already running. Stop it first.');
    const auth = await this.auth();
    if (!auth.workspaceId) throw new CaptureError('invalid', 'Pick a workspace first');
    const tab = tabId !== undefined ? await browser.tabs.get(tabId).catch(() => null) : (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!tab?.id) throw new CaptureError('not_found', 'No tab to trace');
    if (isRestrictedUrl(tab.url)) throw new CaptureError('restricted_page', 'This page cannot be traced');
    const startedAt = Date.now();
    const env = await this.svc.envFor(tab.id);
    const created = await api.createCapture(auth, {
      clientId: uuidv7(),
      kind: 'trace',
      workspaceId: auth.workspaceId,
      page: { url: tab.url ?? '', title: tab.title ?? '' },
      startedAt,
      source: 'extension',
      ...(env ? { env } : {}),
    });
    const openMs = traceOpenMsOf(projectForUrl(await projects(), tab.url ?? ''));
    this.cur = { recordingId: created.id, tabId: tab.id, windowId: tab.windowId ?? -1, startedAt, url: tab.url ?? '', title: tab.title ?? '', openMs };
    await setPrivate(KEY, this.cur);
    this.svc.attachTrace(tab.id, created.id, startedAt);
    this.keyframeCount = 0;
    this.lastHash = null;
    this.begin();
    await this.badge(tab.id, true);
    // the page as the trace begins
    setTimeout(() => void this.keyframe({ t: Date.now(), reason: 'start' }), 300);
    return this.state()!;
  }

  private begin() {
    const c = this.cur!;
    this.live = new LiveTrace({ startedAt: c.startedAt, config: { maxOpenMs: traceOpenMsOf({ traceOpenMs: c.openMs }) }, onKeyframe: (k) => void this.keyframe(k) });
    this.untap?.();
    this.untap = this.svc.onEvents((batch) => {
      const mine = batch.filter((e) => e.tab === c.tabId && e.t >= c.startedAt);
      // keyframe shots are our own output, not input
      if (mine.length) this.live?.add(mine.filter((e) => !(e.kind === 'shot' && e.data.reason === 'keyframe')));
    });
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.live?.tick(Date.now()), TICK_MS);
  }

  private end() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.untap?.();
    this.untap = null;
  }

  /** Screenshot of the traced tab for a keyframe, at 1x CSS pixels, unless it is a near-duplicate. */
  private async keyframe(k: KeyframeRequest) {
    const c = this.cur;
    if (!c) return;
    try {
      const tab = await browser.tabs.get(c.tabId).catch(() => null);
      // captureVisibleTab sees only the active tab of a window
      if (!tab?.active || isRestrictedUrl(tab.url)) return;
      const dataUrl = await this.shots.run(() => browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));
      const png = await dataUrlToBlob(dataUrl);
      const css = await cropImage(png, null, tab.width ?? 1280, { cssPixels: true });
      const hash = await hashOf(css.blob);
      if (this.lastHash && isNearDuplicate(this.lastHash, hash)) {
        this.stats.duplicates++;
        return;
      }
      if (this.cur?.recordingId !== c.recordingId) return;
      const auth = await this.auth();
      const asset = await withRetry(() => api.uploadAsset(auth, { kind: 'keyframe', recordingId: c.recordingId, width: css.width, height: css.height }, css.blob, `keyframe-${k.reason}.png`));
      this.lastHash = hash;
      this.keyframeCount++;
      this.stats.keyframes++;
      this.svc.emit(c.tabId, 'shot', { assetId: asset.id, reason: 'keyframe', rect: { x: 0, y: 0, w: css.width, h: css.height } });
    } catch (e) {
      this.stats.keyframeErrors++;
      this.stats.lastError = e instanceof Error ? e.message : String(e);
    }
  }

  async stop(opts: { open?: boolean } = {}): Promise<TraceResult> {
    await this.loaded;
    if (this.stopping) return this.stopping;
    if (!this.cur) throw new CaptureError('not_found', 'No trace is running');
    this.stopping = this.finish(this.cur, opts).finally(() => (this.stopping = null));
    return this.stopping;
  }

  private async finish(c: Stored, opts: { open?: boolean }): Promise<TraceResult> {
    const stoppedAt = Date.now();
    await this.svc.flushTabs([c.tabId]).catch(() => undefined);
    this.svc.detachTrace(c.tabId);
    await new Promise((r) => setTimeout(r, 150)); // the pages' last batches after detach
    await this.svc.ring.flush();
    this.end();
    const spans = this.live?.stop(stoppedAt) ?? [];
    this.lastSpans = spans;
    const outcomes: Record<string, number> = {};
    for (const s of spans) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
    const slice = await this.svc.ring.read(c.tabId, c.startedAt - 250, Date.now());
    const events = slice.events.filter((e) => e.t >= c.startedAt - 250).sort((a, b) => a.t - b.t || (a.ctx < b.ctx ? -1 : a.ctx > b.ctx ? 1 : a.seq - b.seq));
    const auth = await this.auth();
    const id = c.recordingId;
    const streams: [string, { lastSeq: number; totalBytes: number }][] = [];
    const ev = await enqueueNdjson(id, 'events', toNdjson(events as CaptureEvent[]));
    if (ev) streams.push(['events', ev]);
    if (slice.rrweb.length) {
      const rr = await enqueueNdjson(id, 'rrweb', slice.rrweb.map((r) => JSON.stringify(r)).join('\n'));
      if (rr) streams.push(['rrweb', rr]);
    }
    for (let attempt = 1; ; attempt++) {
      const r = await drain(auth, id, id, { parallel: 4 });
      if (!r.failed) break;
      if (r.lastError && !r.lastError.retryable) throw r.lastError;
      if (attempt >= 6) throw r.lastError ?? new HttpError(0, 'network', 'upload failed');
      await new Promise((res) => setTimeout(res, Math.min(30_000, 1000 * 2 ** (attempt - 1))));
    }
    for (const [stream, s] of streams) await withRetry(() => api.completeStream(auth, id, stream as 'events' | 'rrweb', s));
    const durationMs = Math.max(0, stoppedAt - c.startedAt);
    const fin = await withRetry(() => api.finalize(auth, id, { title: `Trace: ${c.title || c.url}`.slice(0, 200), durationMs }));
    this.cur = null;
    this.live = null;
    await setPrivate(KEY, null);
    await this.badge(c.tabId, false);
    const tabGone = !(await browser.tabs.get(c.tabId).catch(() => null));
    if (tabGone) await this.svc.ring.purgeTab(c.tabId);
    const result: TraceResult = { recordingId: fin.id, shareUrl: fin.shareUrl, spans: spans.length, outcomes, durationMs };
    if (opts.open !== false) await browser.tabs.create({ url: fin.shareUrl, ...(tabGone ? {} : { openerTabId: c.tabId }) }).catch(() => undefined);
    return result;
  }

  private async badge(tabId: number, on: boolean) {
    try {
      await browser.action.setBadgeBackgroundColor({ tabId, color: '#2f6fe0' });
      await browser.action.setBadgeText({ tabId, text: on ? 'TR' : '' });
      await browser.action.setTitle({ tabId, title: on ? 'Tracing this tab. Open to stop the trace.' : '' });
    } catch {
      /* the tab closed */
    }
  }

  async onTabRemoved(tabId: number) {
    if (this.cur?.tabId === tabId) await this.stop({ open: false }).catch(() => undefined);
  }
}

/** dHash of an image blob, drawn to 33x32 pixels (KEYFRAME_HASH_SIZE). */
async function hashOf(blob: Blob): Promise<string> {
  const { w, h } = KEYFRAME_HASH_SIZE;
  const bmp = await createImageBitmap(blob);
  try {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0, w, h);
    return dHash(g.getImageData(0, 0, w, h).data, w, h);
  } finally {
    bmp.close();
  }
}

type Handler = (msg: BgRequest, sender: Browser.runtime.MessageSender) => Promise<Record<string, unknown>>;

/** Wires the trace requests (popup, in-page UI, e2e). Called once from background.ts. */
export function registerTrace(svc: CaptureService): TraceController {
  const ctl = new TraceController(svc);
  const handlers: Partial<Record<BgRequestType, Handler>> = {
    'trace.start': async (m, sender) => ({ trace: await ctl.start((m as Extract<BgRequest, { type: 'trace.start' }>).tabId ?? sender.tab?.id) }),
    'trace.stop': async (m) => ({ result: await ctl.stop({ open: (m as Extract<BgRequest, { type: 'trace.stop' }>).open }) }),
    'trace.get': async () => {
      await ctl.loaded;
      return { trace: ctl.state() };
    },
  };
  browser.runtime.onMessage.addListener((msg: unknown, sender, reply) => {
    const type = (msg as { type?: string } | null)?.type as BgRequestType | undefined;
    const h = type && handlers[type];
    if (!h) return false;
    h(msg as BgRequest, sender as Browser.runtime.MessageSender).then(
      (res) => reply({ ok: true, ...res }),
      (e: unknown) => {
        const error: BgError = e instanceof CaptureError ? e.code : e instanceof HttpError ? (e.status === 401 ? 'not_signed_in' : e.status === 0 ? 'network' : 'server') : 'invalid';
        reply({ ok: false, error, message: e instanceof Error ? e.message : String(e) });
      },
    );
    return true;
  });
  browser.tabs.onRemoved.addListener((tabId) => void ctl.onTabRemoved(tabId));
  if (TEST_HOOKS) {
    queueMicrotask(() => {
      const g = globalThis as unknown as { __tb?: Record<string, unknown> };
      g.__tb = { ...(g.__tb ?? {}), trace: ctl, traceSpans: () => structuredClone([...(ctl['live']?.spans ?? ctl.lastSpans)]) };
    });
  }
  return ctl;
}
