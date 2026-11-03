// The embed's ReviewPlatform (D-212): what the extension's service worker does for the reviewer
// toolbar (apps/extension/lib/bg/review.ts), done in the page. Notes stay in the tab's
// sessionStorage with their crops and clips in IndexedDB (store.ts); a note's context comes from
// PageSession's one-minute ring; crops from the DOM rasteriser (shot.ts); voice notes from
// getUserMedia (voice.ts); traces from PageSession. Send uploads in the extension's order through
// the key's create route and the capture's upload token: create, assets, feedback items, events
// chunk, complete, finalize.
import { CONTEXT_WINDOW_MS, autoFeedbackTitle, contextEventIds, contextFromEvents, type FeedbackItemInput } from '@toolbar/shared/areas/reviewer';
import type { BgError, NewReviewItem, ReviewSubmitResult } from '@toolbar/shared/ext';
import type { LocatorTarget } from '@toolbar/shared/ext';
import type { LocatorPacket } from '@toolbar/shared/locator';
import type { Rect } from '@toolbar/shared';
import type { ReviewPlatform, ReviewRequestMap, ReviewRequestType, ReviewStorage, ReviewTrace } from '@toolbar/review/platform';
import { EmbedHttpError, gzipText, ndjson, type EmbedCapture, type EmbedClient, type EmbedConfig, type EmbedReviewer } from './client.ts';
import { runningTake, uuid, type PageSession, type TraceState } from './session.ts';
import { BlobStore, ItemStore, type StoredItem } from './store.ts';
import { MicUnavailableError, VoiceRecorder, clipExt, requestMic } from './voice.ts';
import { toDataUrl, type Shot } from './shot.ts';

/** The session as the toolbar shows it; the server counts the actions. */
const traceView = (t: TraceState | null): ReviewTrace | null => (t ? { recordingId: t.id, takes: t.takes.map((k) => ({ n: k.n, startedAt: k.startedAt, endedAt: k.endedAt, note: k.note })) } : null);

class Failure extends Error {
  constructor(
    readonly code: BgError,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export interface PagePlatformDeps {
  client: EmbedClient;
  config: EmbedConfig;
  session: PageSession;
  /** the locator packet of a target (D-164); never rejects */
  locate: (target: LocatorTarget) => Promise<LocatorPacket | undefined>;
  shoot: (rect: Rect) => Promise<Shot | null>;
  reviewer: { get(): EmbedReviewer } & NonNullable<ReviewPlatform['reviewer']>;
  env: () => Promise<unknown>;
  assetUrl: (file: string) => string;
  items?: ItemStore;
  blobs?: BlobStore;
  voice?: VoiceRecorder;
  storage?: ReviewStorage;
  now?: () => number;
}

/** localStorage as the toolbar's settings store; another tab's change arrives as a storage event. */
export function localStore(): ReviewStorage {
  const ls = (): Storage | null => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  };
  return {
    async get<T>(key: string) {
      const raw = ls()?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : undefined;
    },
    async set(key, value) {
      ls()?.setItem(key, JSON.stringify(value));
    },
    onChange(key, fn) {
      const listener = (e: StorageEvent) => {
        if (e.key !== key) return;
        try {
          fn(e.newValue ? JSON.parse(e.newValue) : undefined);
        } catch {
          /* not ours */
        }
      };
      addEventListener('storage', listener);
      return () => removeEventListener('storage', listener);
    },
  };
}

function asFailure(e: unknown): { ok: false; error: BgError; message?: string } {
  if (e instanceof Failure) return { ok: false, error: e.code, message: e.message };
  if (e instanceof MicUnavailableError) return { ok: false, error: 'permission_denied', message: e.message };
  if (e instanceof EmbedHttpError) {
    if (e.status === 0) return { ok: false, error: 'network', message: 'The server did not answer' };
    if (e.status === 429) return { ok: false, error: 'server', message: 'Too many notes from this browser just now. Try again in a while' };
    if (e.status === 403 || e.status === 404) return { ok: false, error: 'server', message: 'Feedback is turned off for this site' };
    return { ok: false, error: 'server', message: e.message };
  }
  return { ok: false, error: 'server', message: e instanceof Error ? e.message : String(e) };
}

type Handlers = { [K in ReviewRequestType]: (req: ReviewRequestMap[K]['req']) => Promise<ReviewRequestMap[K]['res']> };

export function createPagePlatform(deps: PagePlatformDeps): ReviewPlatform & { handlers: Handlers } {
  const { client, config, session } = deps;
  const items = deps.items ?? new ItemStore();
  const blobs = deps.blobs ?? new BlobStore();
  const voice = deps.voice ?? new VoiceRecorder();
  const now = deps.now ?? Date.now;
  const st = items.state;
  const view = ({ ctxEvents: _e, ...item }: StoredItem) => item;

  function readContext(at = now()) {
    session.command({ type: 'flush' });
    const events = session.ring.slice(at).events.filter((e) => e.t >= at - CONTEXT_WINDOW_MS && e.t <= at + 1000);
    const context = contextFromEvents(events, at);
    const ids = contextEventIds(events, context);
    return { context, events: events.filter((e) => ids.has(e.id)) };
  }

  async function dropBlobs(list: StoredItem[]) {
    for (const it of list) {
      if (it.cropBlobId) await blobs.delete(it.cropBlobId);
      if (it.voiceBlobId) await blobs.delete(it.voiceBlobId);
    }
  }

  async function submit(req: ReviewRequestMap['review.submit']['req']): Promise<ReviewSubmitResult> {
    const list = st.items.slice();
    const traced = session.trace;
    if (!list.length && !traced) throw new Failure('invalid', 'Nothing to send yet');
    const reviewer = deps.reviewer.get();
    let cap: EmbedCapture;
    if (traced) {
      cap = traced;
    } else {
      const startedAt = Math.min(...list.map((i) => Math.min(i.t, ...i.ctxEvents.map((e) => e.t))));
      const page = list[0]!.page;
      cap = await client.createCapture({
        clientId: uuid(),
        kind: 'feedback',
        workspaceId: config.workspaceId,
        page: { url: page.url, title: page.title },
        startedAt,
        env: await deps.env().catch(() => undefined),
        source: 'embed',
        reviewer,
      });
    }

    // assets first: crops at 1x CSS pixels and voice notes, claimed by the feedback rows
    const inputs: FeedbackItemInput[] = [];
    for (const it of list) {
      const name = `a${String(it.n).padStart(2, '0')}`;
      let cropAssetId: string | undefined;
      let voiceAssetId: string | undefined;
      const crop = it.cropBlobId ? await blobs.get(it.cropBlobId) : undefined;
      if (crop) cropAssetId = (await client.uploadAsset(cap, 'feedback', crop, `${name}.png`)).id;
      const clip = it.voiceBlobId ? await blobs.get(it.voiceBlobId) : undefined;
      if (clip) voiceAssetId = (await client.uploadAsset(cap, 'voice-note', clip, `${name}.${clipExt(clip.type)}`)).id;
      inputs.push({
        clientId: it.id,
        n: it.n,
        kind: it.kind,
        comment: it.comment,
        ...(it.quote ? { quote: it.quote } : {}),
        ...(it.target ? { target: it.target } : {}),
        ...(it.locator ? { locator: it.locator } : {}),
        ...(it.anchor ? { anchor: it.anchor } : {}),
        shapes: it.shapes,
        ...(cropAssetId ? { cropAssetId, ...(it.cropRect ? { cropRect: it.cropRect } : {}) } : {}),
        ...(voiceAssetId ? { voiceAssetId, ...(it.voiceDurationMs != null ? { voiceDurationMs: Math.round(it.voiceDurationMs) } : {}) } : {}),
        context: it.context,
        page: it.page,
        intent: it.intent,
        severity: it.severity,
        t: it.t,
      });
    }
    if (inputs.length) await client.createFeedback(cap, inputs);

    const title = req.title?.trim().slice(0, 500) || autoFeedbackTitle(list, traced?.takes ?? [], location.href);
    const description = req.description?.trim().slice(0, 10_000) ?? '';
    let traces = 0;
    if (traced) {
      traces = (await session.sendTrace({ title, description })).traces;
    } else {
      // the errors and requests the notes attached become the capture's console and network
      const seen = new Set<string>();
      const events = list
        .flatMap((i) => i.ctxEvents)
        .filter((e) => !seen.has(e.id) && !!seen.add(e.id))
        .sort((x, y) => x.t - y.t);
      if (events.length) {
        const gz = await gzipText(ndjson(events));
        await client.putChunk(cap, 'events', 0, gz, events[0]!.t, events[events.length - 1]!.t);
        await client.completeStream(cap, 'events', 0, gz.size);
      }
      await client.finalize(cap, { title, description, annotations: [] });
    }
    await dropBlobs(list);
    const sent = new Set(list.map((i) => i.id));
    st.items = st.items.filter((i) => !sent.has(i.id));
    if (!st.items.length) st.nextN = 1;
    items.save();
    // the reviewer cannot open the dashboard: no link
    return { recordingId: cap.id, url: '', count: list.length, traces };
  }

  const handlers: Handlers = {
    'review.get': async () => ({ items: st.items.map(view) }),
    'review.context': async () => ({ context: readContext().context, shots: 'ok' }),
    'review.shot': async (req) => {
      const shot = await deps.shoot(req.rect);
      if (!shot) throw new Failure('server', 'This part of the page could not be captured');
      const blobId = await blobs.put('crop', shot.blob);
      return { blobId, preview: await toDataUrl(shot.blob), width: shot.width, height: shot.height };
    },
    'review.add': async (req) => {
      const at = now();
      const { context, events } = readContext(at);
      const src: NewReviewItem = req.item;
      const item: StoredItem = {
        ...src,
        id: src.id && /^[0-9a-f-]{36}$/i.test(src.id) ? src.id : uuid(),
        n: st.nextN++,
        comment: (src.comment ?? '').slice(0, 10_000),
        shapes: src.shapes ?? [],
        context,
        t: at,
        ctxEvents: events,
      };
      st.items.push(item);
      items.save();
      if (runningTake(session.trace)) session.annotate(item.id);
      return { item: view(item) };
    },
    'review.update': async (req) => {
      const it = st.items.find((i) => i.id === req.id);
      if (!it) throw new Failure('not_found', 'That note is gone');
      if (req.patch.voiceBlobId !== undefined && it.voiceBlobId && it.voiceBlobId !== req.patch.voiceBlobId) await blobs.delete(it.voiceBlobId);
      Object.assign(it, req.patch);
      items.save();
      return { item: view(it) };
    },
    'review.remove': async (req) => {
      const gone = st.items.filter((i) => i.id === req.id);
      st.items = st.items.filter((i) => i.id !== req.id);
      if (!st.items.length) st.nextN = 1;
      await dropBlobs(gone);
      items.save();
      return {};
    },
    'review.clear': async () => {
      await dropBlobs(st.items);
      st.items = [];
      st.nextN = 1;
      items.save();
      await session.discardTrace();
      return {};
    },
    'review.voice': async (req) => {
      if (req.op === 'start') {
        await voice.start();
        return { recording: true };
      }
      const clip = await voice.stop(req.op === 'cancel');
      if (!clip) return { recording: false };
      return { recording: false, blobId: await blobs.put('voice', clip.blob), durationMs: clip.durationMs };
    },
    'review.submit': async (req) => ({ result: await submit(req) }),
    'locator.capture': async (req) => {
      const locator = await deps.locate(req);
      if (!locator) throw new Failure('not_found', 'No locator for this point');
      return { locator, crop: null };
    },
    'mic.request': async () => {
      try {
        (await requestMic()).getTracks().forEach((t) => t.stop());
        return { granted: true };
      } catch {
        return { granted: false };
      }
    },
    'trace.get': async () => ({ trace: traceView(session.trace) }),
    'trace.start': async () => {
      await session.startTrace();
      if (!session.trace) throw new Failure('server', 'The trace did not start');
      return { trace: traceView(session.trace)! };
    },
    'trace.stop': async () => {
      if (!runningTake(session.trace)) throw new Failure('not_found', 'No trace is running');
      await session.stopTrace();
      return { trace: traceView(session.trace)! };
    },
    'trace.note': async (req) => {
      if (!session.trace?.takes.some((t) => t.n === req.n)) throw new Failure('not_found', 'That trace is gone');
      session.noteTrace(req.n, req.note);
      return { trace: traceView(session.trace)! };
    },
    'trace.remove': async (req) => {
      if (!session.trace?.takes.some((t) => t.n === req.n)) throw new Failure('not_found', 'That trace is gone');
      await session.removeTrace(req.n);
      return { trace: traceView(session.trace) };
    },
  };

  void blobs.sweep();

  return {
    handlers,
    async request(type, req) {
      try {
        const h = handlers[type] as (r: typeof req) => Promise<object>;
        return { ok: true, ...(await h(req)) } as never;
      } catch (e) {
        return asFailure(e) as never;
      }
    },
    storage: deps.storage ?? localStore(),
    assetUrl: deps.assetUrl,
    reviewer: deps.reviewer,
    // another page of the tab came back from the back-forward cache with the session moved on
    onTraceChange: (fn) => session.subscribe(fn),
    caps: { canScreenshot: true },
  };
}
