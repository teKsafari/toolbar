// Trace sessions (Part 2, PLAN "What a trace is", D-214). A tab's session is one server capture of
// kind `trace`, made at its first Start trace, holding one or more traces: each the events and DOM
// replay of the tab between a Start trace and its Stop trace, with a note the reviewer writes
// about it. While a trace runs, the tab is attached like a recording (rrweb, canvas samples), its
// ring is kept whole, and the span engine runs live here to time keyframes: screenshots on route
// changes, annotations, changed spans and DOM bursts, at most one every 1.5 s, near-duplicates
// (33x32 dHash) dropped.
//
// Stop reads the trace from the ring and queues its events and replay as chunks (the ring keeps
// only its normal window once the tab is detached, so this happens once per trace, D-190), then
// uploads them in the background; nothing is sent to anyone. `send` (from review.submit, with the
// tab's notes) uploads what is left, completes the streams and finalizes with the traces and
// their notes; the server keeps only what lies inside them, so a removed trace leaves nothing.
//
// Separate from the capture session of lib/bg/ui.ts: a trace can run beside a screenshot or a
// recording of the same tab. The session lives in storage (tb:trace), so a worker restart
// re-attaches a running trace; the live engine then starts afresh (keyframes resume, spans come
// from the server).
import { browser, type Browser } from 'wxt/browser';
import { toNdjson, type CaptureEvent } from '@toolbar/shared';
import { uuidv7 } from '@toolbar/shared/ids';
import { projectForUrl, traceOpenMsOf } from '@toolbar/shared/projects';
import type { BgError, BgRequest, BgRequestType, TraceState, TraceTakeState } from '@toolbar/shared/ext';
import { KEYFRAME_HASH_SIZE, LiveTrace, TRACE_LEAD_MS, dHash, isNearDuplicate, type KeyframeRequest, type Span } from '@toolbar/trace';
import { CaptureError, isRestrictedUrl, type CaptureService } from '../capture/service';
import { noteShot, noteShotError, probeShots } from './shot-access';
import { getAuth, getPrivate, serverUrl, setPrivate } from '../capture/store';
import { CaptureQueue, cropImage, dataUrlToBlob } from '../crop';
import { TEST_HOOKS } from '../flags';
import { projects } from '../scope';
import { api, HttpError, type UploadAuthLike } from '../upload/client';
import { enqueueNdjson } from '../upload/draft';
import { drain, dropRows, withRetry } from '../upload/queue';

const KEY = 'tb:trace';
const TICK_MS = 250;
const STREAMS = ['events', 'rrweb'] as const;
type Stream = (typeof STREAMS)[number];

interface Stored {
  recordingId: string;
  tabId: number;
  /** span window for open requests, from the page's project (D-166) */
  openMs?: number;
  takes: TraceTakeState[];
  nextN: number;
  /** chunks queued so far per stream: the next trace's chunks continue the numbering */
  queued: Record<Stream, { seq: number; bytes: number }>;
}

/** What `send` finalizes with, besides the traces. */
export interface SendText {
  title: string;
  description: string;
}

export class TraceController {
  private cur: Stored | null = null;
  private live: LiveTrace | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private untap: (() => void) | null = null;
  private lastHash: string | null = null;
  private keyframeCount = 0;
  private shots = new CaptureQueue(600);
  /** one change to the session at a time (popup, toolbar and tab events can race) */
  private chain: Promise<unknown> = Promise.resolve();
  /** the card image, taken at each Stop; the last one goes up with the session */
  private still: Awaited<ReturnType<CaptureService['cardStillOf']>> = null;
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
    this.cur = s;
    const tab = await browser.tabs.get(s.tabId).catch(() => null);
    if (!tab) return void this.discard().catch(() => undefined);
    const run = this.running();
    if (!run) return;
    this.svc.attachTrace(s.tabId, s.recordingId, run.startedAt);
    this.begin(run);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(async () => {
      await this.loaded;
      return fn();
    });
    this.chain = p.catch(() => undefined);
    return p;
  }

  private running(): TraceTakeState | null {
    const last = this.cur?.takes.at(-1);
    return last && last.endedAt === null ? last : null;
  }

  /** The session, with the running trace's live counts. `tabId`: only the session of that tab. */
  state(tabId?: number): TraceState | null {
    const c = this.cur;
    if (!c || (tabId !== undefined && c.tabId !== tabId)) return null;
    const run = this.running();
    const takes = c.takes.map((t) => {
      if (t !== run || !this.live) return { ...t };
      const outcomes: Record<string, number> = {};
      for (const s of this.live.spans) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
      return { ...t, spans: this.live.spans.length, outcomes };
    });
    return { recordingId: c.recordingId, tabId: c.tabId, takes, keyframes: this.keyframeCount };
  }

  /** The tab whose running trace takes annotations (review.add). */
  runningIn(tabId: number): boolean {
    return this.cur?.tabId === tabId && !!this.running();
  }

  private async auth(): Promise<UploadAuthLike & { workspaceId: string | null }> {
    const a = await getAuth();
    if (!a?.token) throw new CaptureError('not_signed_in', 'Sign in to start a trace');
    return { serverUrl: a.serverUrl || (await serverUrl()), token: a.token, workspaceId: a.activeWorkspaceId };
  }

  private async save() {
    await setPrivate(KEY, this.cur);
  }

  start(tabId?: number): Promise<TraceState> {
    return this.serial(async () => {
      const tab = tabId !== undefined ? await browser.tabs.get(tabId).catch(() => null) : (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      if (!tab?.id) throw new CaptureError('not_found', 'No tab to trace');
      if (this.cur && this.cur.tabId !== tab.id) throw new CaptureError('busy', 'Traces are waiting in another tab. Send or discard them there first.');
      if (this.running()) throw new CaptureError('busy', 'A trace is already running. Stop it first.');
      if (isRestrictedUrl(tab.url)) throw new CaptureError('restricted_page', 'This page cannot be traced');
      const startedAt = Date.now();
      if (!this.cur) {
        const auth = await this.auth();
        if (!auth.workspaceId) throw new CaptureError('invalid', 'Pick a workspace first');
        const env = await this.svc.envFor(tab.id);
        // keyframes need captureVisibleTab: say in the capture when the browser refuses it (D-185)
        if (env && tab.active && tab.windowId != null) {
          const windowId = tab.windowId;
          const shots = await probeShots(tab.id, () => this.shots.run(() => browser.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 10 })), { retryMs: 0 });
          if (shots !== 'unknown') env.shots = shots;
        }
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
        this.cur = { recordingId: created.id, tabId: tab.id, openMs, takes: [], nextN: 1, queued: { events: { seq: 0, bytes: 0 }, rrweb: { seq: 0, bytes: 0 } } };
        this.keyframeCount = 0;
      }
      const take: TraceTakeState = { n: this.cur.nextN++, startedAt, endedAt: null, note: '', url: tab.url ?? '', title: tab.title ?? '', spans: 0, outcomes: {} };
      this.cur.takes.push(take);
      await this.save();
      this.svc.attachTrace(tab.id, this.cur.recordingId, startedAt);
      this.lastHash = null;
      this.begin(take);
      await this.badge(tab.id, true);
      // the page as the trace begins
      setTimeout(() => void this.keyframe({ t: Date.now(), reason: 'start' }), 300);
      return this.state()!;
    });
  }

  private begin(take: TraceTakeState) {
    const c = this.cur!;
    this.live = new LiveTrace({ startedAt: take.startedAt, config: { maxOpenMs: traceOpenMsOf({ traceOpenMs: c.openMs }) }, onKeyframe: (k) => void this.keyframe(k) });
    this.untap?.();
    this.untap = this.svc.onEvents((batch) => {
      const mine = batch.filter((e) => e.tab === c.tabId && e.t >= take.startedAt);
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
    if (!c || !this.running()) return;
    try {
      const tab = await browser.tabs.get(c.tabId).catch(() => null);
      // captureVisibleTab sees only the active tab of a window
      if (!tab?.active || isRestrictedUrl(tab.url)) return;
      const dataUrl = await this.shots.run(() => browser.tabs.captureVisibleTab(tab.windowId, { format: 'png' })).catch((e) => {
        noteShotError(c.tabId, e);
        throw e;
      });
      noteShot(c.tabId, 'ok');
      const png = await dataUrlToBlob(dataUrl);
      const css = await cropImage(png, null, tab.width ?? 1280, { cssPixels: true });
      const hash = await hashOf(css.blob);
      if (this.lastHash && isNearDuplicate(this.lastHash, hash)) {
        this.stats.duplicates++;
        return;
      }
      if (this.cur?.recordingId !== c.recordingId || !this.running()) return;
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

  stop(): Promise<TraceState> {
    return this.serial(async () => {
      if (!this.running()) throw new CaptureError('not_found', 'No trace is running');
      await this.stopRunning(true);
      this.upload();
      return this.state()!;
    });
  }

  /**
   * Detach the tab and end the running trace. `keep`: read it from the ring and queue it as
   * chunks; a trace that is being removed is only detached.
   */
  private async stopRunning(keep: boolean) {
    const c = this.cur!;
    const take = this.running()!;
    const stoppedAt = Date.now();
    const tab = await browser.tabs.get(c.tabId).catch(() => null);
    if (keep && tab?.active) this.still = (await this.svc.cardStillOf(tab)) ?? this.still;
    await this.svc.flushTabs([c.tabId]).catch(() => undefined);
    this.svc.detachTrace(c.tabId);
    await new Promise((r) => setTimeout(r, 150)); // the pages' last batches after detach
    await this.svc.ring.flush();
    this.end();
    const spans = this.live?.stop(stoppedAt) ?? [];
    this.live = null;
    this.lastSpans = spans;
    await this.badge(c.tabId, false);
    if (!keep) return;
    take.spans = spans.length;
    take.outcomes = {};
    for (const s of spans) take.outcomes[s.outcome] = (take.outcomes[s.outcome] ?? 0) + 1;
    const from = take.startedAt - TRACE_LEAD_MS;
    const slice = await this.svc.ring.read(c.tabId, from, Date.now());
    const events = slice.events.filter((e) => e.t >= from).sort((a, b) => a.t - b.t || (a.ctx < b.ctx ? -1 : a.ctx > b.ctx ? 1 : a.seq - b.seq));
    await this.queue('events', toNdjson(events as CaptureEvent[]));
    if (slice.rrweb.length) await this.queue('rrweb', slice.rrweb.map((r) => JSON.stringify(r)).join('\n'));
    take.endedAt = stoppedAt;
    await this.save();
  }

  private async queue(stream: Stream, ndjson: string) {
    const c = this.cur!;
    const q = c.queued[stream];
    const r = await enqueueNdjson(c.recordingId, stream, ndjson, q.seq);
    if (r) c.queued[stream] = { seq: r.lastSeq + 1, bytes: q.bytes + r.totalBytes };
  }

  /** Upload the queued chunks now, so Send has little left to do; failures wait for Send. */
  private upload() {
    const c = this.cur;
    if (!c) return;
    void this.auth()
      .then((auth) => drain(auth, c.recordingId, c.recordingId, { parallel: 4 }))
      .catch(() => undefined);
  }

  note(n: number, note: string): Promise<TraceState> {
    return this.serial(async () => {
      const take = this.cur?.takes.find((t) => t.n === n);
      if (!take) throw new CaptureError('not_found', 'That trace is gone');
      take.note = note.slice(0, 4000);
      await this.save();
      return this.state()!;
    });
  }

  remove(n: number): Promise<TraceState | null> {
    return this.serial(async () => {
      const c = this.cur;
      const take = c?.takes.find((t) => t.n === n);
      if (!c || !take) throw new CaptureError('not_found', 'That trace is gone');
      if (take === this.running()) await this.stopRunning(false);
      c.takes = c.takes.filter((t) => t !== take);
      if (!c.takes.length) {
        await this.drop();
        return null;
      }
      await this.save();
      return this.state();
    });
  }

  /** Discard the tab's session: the server's draft and the queued chunks go too. */
  discard(tabId?: number): Promise<void> {
    return this.serial(async () => {
      if (!this.cur || (tabId !== undefined && this.cur.tabId !== tabId)) return;
      if (this.running()) await this.stopRunning(false);
      await this.drop();
    });
  }

  private async drop() {
    const c = this.cur!;
    this.cur = null;
    this.still = null;
    this.live = null;
    await this.save();
    await dropRows(c.recordingId).catch(() => undefined);
    await this.auth()
      .then((auth) => api.deleteCapture(auth, c.recordingId))
      .catch(() => undefined); // the server sweeps drafts left behind (J-189)
  }

  /** The session's capture, when the tab has one (review.submit sends the notes onto it first). */
  recordingOf(tabId: number): string | null {
    return this.cur?.tabId === tabId ? this.cur.recordingId : null;
  }

  /**
   * Send the tab's session (review.submit, after the notes went up): stop a running trace, upload
   * what is queued, complete the streams and finalize with the traces and their notes.
   */
  send(tabId: number, text: SendText): Promise<{ recordingId: string; shareUrl: string; traces: number }> {
    return this.serial(async () => {
      const c = this.cur;
      if (!c || c.tabId !== tabId) throw new CaptureError('not_found', 'No traces to send');
      if (this.running()) await this.stopRunning(true);
      const auth = await this.auth();
      const id = c.recordingId;
      for (let attempt = 1; ; attempt++) {
        const r = await drain(auth, id, id, { parallel: 4 });
        if (!r.failed) break;
        if (r.lastError && !r.lastError.retryable) throw r.lastError;
        if (attempt >= 6) throw r.lastError ?? new HttpError(0, 'network', 'upload failed');
        await new Promise((res) => setTimeout(res, Math.min(30_000, 1000 * 2 ** (attempt - 1))));
      }
      for (const stream of STREAMS) {
        const q = c.queued[stream];
        if (q.seq > 0) await withRetry(() => api.completeStream(auth, id, stream, { lastSeq: q.seq - 1, totalBytes: q.bytes }));
      }
      // the card image: the page as the last trace stopped, masked per preset (D-184)
      const still = this.still;
      if (still) await withRetry(() => api.uploadAsset(auth, { kind: 'thumb', recordingId: id, width: still.width, height: still.height }, still.blob, 'thumb.webp')).catch(() => undefined);
      const first = c.takes[0]!;
      const last = c.takes.at(-1)!;
      const fin = await withRetry(() =>
        api.finalize(auth, id, {
          title: text.title.slice(0, 500),
          description: text.description,
          durationMs: Math.max(0, (last.endedAt ?? Date.now()) - first.startedAt),
          traces: c.takes.map((t) => ({ n: t.n, startedAt: t.startedAt, endedAt: t.endedAt ?? t.startedAt, note: t.note })),
        }),
      );
      this.cur = null;
      this.still = null;
      await this.save();
      if (!(await browser.tabs.get(tabId).catch(() => null))) await this.svc.ring.purgeTab(tabId);
      return { recordingId: fin.id, shareUrl: fin.shareUrl, traces: c.takes.length };
    });
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

  /** A closed tab's session goes with it, as its unsent notes do (lib/bg/review.ts). */
  async onTabRemoved(tabId: number) {
    await this.discard(tabId).catch(() => undefined);
  }

  /**
   * Chrome clears a tab's own badge, title and icon when the tab loads a new document, so a trace
   * that follows the reviewer to another page lost its "TR" badge (docs/real-world/second-app.md).
   * Set it again on each load of the traced tab.
   */
  async onTabUpdated(tabId: number, status: string | undefined) {
    if (!status) return;
    await this.loaded;
    if (this.cur?.tabId !== tabId || !this.running()) return;
    await this.badge(tabId, true);
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
type Req<K extends BgRequestType> = Extract<BgRequest, { type: K }>;

/** Wires the trace requests (popup, in-page UI, e2e). Called once from background.ts. */
export function registerTrace(svc: CaptureService): TraceController {
  const ctl = new TraceController(svc);
  const handlers: Partial<Record<BgRequestType, Handler>> = {
    'trace.start': async (m, sender) => ({ trace: await ctl.start((m as Req<'trace.start'>).tabId ?? sender.tab?.id) }),
    'trace.stop': async () => ({ trace: await ctl.stop() }),
    // a page sees its own tab's session; the popup (no sender tab) sees the one there is
    'trace.get': async (_m, sender) => {
      await ctl.loaded;
      return { trace: ctl.state(sender.tab?.id) };
    },
    'trace.note': async (m) => ({ trace: await ctl.note((m as Req<'trace.note'>).n, (m as Req<'trace.note'>).note) }),
    'trace.remove': async (m) => ({ trace: await ctl.remove((m as Req<'trace.remove'>).n) }),
    'trace.focus': async () => {
      await ctl.loaded;
      const tab = ctl.state() && (await browser.tabs.get(ctl.state()!.tabId).catch(() => null));
      if (!tab?.id) throw new CaptureError('not_found', 'No traces are waiting');
      await browser.tabs.update(tab.id, { active: true });
      await browser.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
      return {};
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
  browser.tabs.onUpdated.addListener((tabId, info) => void ctl.onTabUpdated(tabId, info.status));
  if (TEST_HOOKS) {
    queueMicrotask(() => {
      const g = globalThis as unknown as { __tb?: Record<string, unknown> };
      g.__tb = { ...(g.__tb ?? {}), trace: ctl, traceSpans: () => structuredClone([...(ctl['live']?.spans ?? ctl.lastSpans)]) };
    });
  }
  return ctl;
}
