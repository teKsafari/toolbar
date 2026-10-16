// Service-worker side of the in-page reviewer toolbar (Part 2, "What the reviewer can do").
// Keeps each tab's unsent feedback items (chrome.storage.session, blobs in IndexedDB), reads the
// 60 s context of a comment from the tab's ring, takes element screenshots, records voice notes
// through the offscreen document and submits everything to the server: onto a running trace, or
// into a new capture of kind `feedback`. background.ts registers it with registerReview(svc).
import { browser } from 'wxt/browser';
import { createEmitter, type CaptureEvent, type EnvInfo } from '@toolbar/shared';
import { ROUTES, buildPath } from '@toolbar/shared/api';
import { CONTEXT_WINDOW_MS, contextEventIds, contextFromEvents, type FeedbackItemInput } from '@toolbar/shared/areas/reviewer';
import type { BgError, BgRequestMap, NewReviewItem, ReviewItem, ReviewPatch, ReviewSubmitResult } from '@toolbar/shared/ext';
import { TEST_HOOKS } from '../flags';
import { CaptureQueue, cropImage, dataUrlToBlob } from '../crop';
import { getBlob, idbDelete, putBlob } from '../idb';
import { api, gzip, HttpError, sha256Hex, type UploadAuthLike } from '../upload/client';
import { getAuth, getStore, serverUrl } from '../capture/store';
import type { CaptureService } from '../capture/service';
import { noteShot, noteShotError, probeShots, shotAccess, SHOTS_BLOCKED_MESSAGE } from './shot-access';

type ReviewKey = keyof Pick<BgRequestMap, 'review.get' | 'review.context' | 'review.shot' | 'review.add' | 'review.update' | 'review.remove' | 'review.clear' | 'review.voice' | 'review.submit'>;
type Sender = { tab?: { id?: number; windowId?: number; url?: string; title?: string } };

class ReviewFailure extends Error {
  constructor(
    readonly code: BgError,
    message?: string,
  ) {
    super(message ?? code);
  }
}

/** An item plus what only the worker keeps: the raw events its context names. */
interface StoredItem extends ReviewItem {
  ctxEvents: CaptureEvent[];
}
interface TabReview {
  items: StoredItem[];
  nextN: number;
}

const STORE_KEY = 'tb:review';
const shots = new CaptureQueue();
const make = createEmitter('sw');
let tabs: Record<number, TabReview> = {};
let loaded: Promise<void> | null = null;
const hooks = { submits: [] as ReviewSubmitResult[], shots: 0, voice: [] as string[] };

function load(): Promise<void> {
  loaded ??= browser.storage.session
    .get(STORE_KEY)
    .then((r) => {
      tabs = (r[STORE_KEY] as Record<number, TabReview> | undefined) ?? {};
    })
    .catch(() => undefined);
  return loaded;
}
async function save() {
  await browser.storage.session.set({ [STORE_KEY]: tabs }).catch(() => undefined);
}
function tabOf(tabId: number): TabReview {
  return (tabs[tabId] ??= { items: [], nextN: 1 });
}
const view = ({ ctxEvents: _e, ...item }: StoredItem): ReviewItem => item;

function tabIdOf(sender: Sender): number {
  const id = sender.tab?.id;
  if (id == null || id < 0) throw new ReviewFailure('invalid', 'Open a web page first');
  return id;
}

async function dropBlobs(items: StoredItem[]) {
  for (const it of items) {
    if (it.cropBlobId) await idbDelete('blobs', it.cropBlobId).catch(() => undefined);
    if (it.voiceBlobId) await idbDelete('blobs', it.voiceBlobId).catch(() => undefined);
  }
}

async function toDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

async function capture(windowId: number, tabId: number): Promise<string> {
  try {
    const shot = await shots.run(() => browser.tabs.captureVisibleTab(windowId, { format: 'png' }));
    noteShot(tabId, 'ok');
    return shot;
  } catch (e) {
    // no activeTab on this tab: retrying will not help, and the reviewer needs to know why (D-185)
    if (noteShotError(tabId, e)) throw new ReviewFailure('permission_denied', SHOTS_BLOCKED_MESSAGE);
    // another part of the extension (a trace keyframe) may have used this second's quota
    await new Promise((r) => setTimeout(r, 600));
    try {
      const shot = await shots.run(() => browser.tabs.captureVisibleTab(windowId, { format: 'png' }));
      noteShot(tabId, 'ok');
      return shot;
    } catch (e2) {
      if (noteShotError(tabId, e2)) throw new ReviewFailure('permission_denied', SHOTS_BLOCKED_MESSAGE);
      throw e2;
    }
  }
}

async function readContext(svc: CaptureService, tabId: number, now = Date.now()) {
  await svc.flushTabs([tabId]).catch(() => undefined);
  const slice = await svc.ring.read(tabId, now - CONTEXT_WINDOW_MS, now + 1000);
  const context = contextFromEvents(slice.events, now);
  const ids = contextEventIds(slice.events, context);
  return { context, events: slice.events.filter((e) => ids.has(e.id)) };
}

async function uploadAuth(): Promise<UploadAuthLike & { workspaceId: string }> {
  const auth = await getAuth();
  if (!auth?.token) throw new ReviewFailure('not_signed_in', 'Sign in to send feedback');
  const boot = (await getStore('bootstrap'))?.data;
  const workspaceId = auth.activeWorkspaceId ?? boot?.activeWorkspaceId ?? boot?.workspaces[0]?.id;
  if (!workspaceId) throw new ReviewFailure('invalid', 'No workspace yet');
  return { serverUrl: (auth.serverUrl || (await serverUrl())).replace(/\/$/, ''), token: auth.token, workspaceId };
}

async function envOf(tabId: number): Promise<EnvInfo | undefined> {
  const r = (await browser.tabs.sendMessage(tabId, { type: 'capture.env' }).catch(() => null)) as { env?: EnvInfo | null } | null;
  const shotsState = shotAccess(tabId);
  return r?.env ? { ...r.env, extVersion: browser.runtime.getManifest().version, ...(shotsState !== 'unknown' ? { shots: shotsState } : {}) } : undefined;
}

async function postJson<T>(a: UploadAuthLike, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(a.serverUrl + path, { method: 'POST', headers: { authorization: `Bearer ${a.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) {
    throw new HttpError(0, 'network', e instanceof Error ? e.message : String(e));
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new HttpError(res.status, data.error ?? `http_${res.status}`, data.message ?? `Server error ${res.status}`);
  return data;
}

function titleOf(items: StoredItem[]): string {
  const first = items.find((i) => i.comment.trim())?.comment.trim().split('\n')[0] ?? '';
  if (first) return first.length > 80 ? `${first.slice(0, 79)}…` : first;
  try {
    return `Feedback on ${new URL(items[0]!.page.url).pathname}`;
  } catch {
    return 'Feedback';
  }
}

async function submit(svc: CaptureService, tabId: number, req: BgRequestMap['review.submit']['req']): Promise<ReviewSubmitResult> {
  const st = tabOf(tabId);
  const items = st.items.slice();
  if (!items.length) throw new ReviewFailure('invalid', 'Nothing to send yet');
  const a = await uploadAuth();
  const onTrace = !!req.traceRecordingId;
  let recordingId = req.traceRecordingId ?? '';
  let shareUrl = '';
  if (!onTrace) {
    const startedAt = Math.min(...items.map((i) => Math.min(i.t, ...i.ctxEvents.map((e) => e.t))));
    const page = items[0]!.page;
    const created = await api.createCapture(a, {
      clientId: crypto.randomUUID(),
      kind: 'feedback',
      workspaceId: a.workspaceId,
      page: { url: page.url, title: page.title },
      startedAt,
      env: await envOf(tabId),
    });
    recordingId = created.id;
    shareUrl = created.shareUrl;
  }

  // assets first: crops at 1x CSS pixels and voice notes, claimed by the feedback rows
  const inputs: FeedbackItemInput[] = [];
  for (const it of items) {
    const name = `a${String(it.n).padStart(2, '0')}`;
    let cropAssetId: string | undefined;
    let voiceAssetId: string | undefined;
    const crop = it.cropBlobId ? await getBlob(it.cropBlobId) : undefined;
    if (crop) cropAssetId = (await api.uploadAsset(a, { kind: 'feedback', recordingId, sha256: await sha256Hex(crop) }, crop, `${name}.png`)).id;
    const voice = it.voiceBlobId ? await getBlob(it.voiceBlobId) : undefined;
    if (voice) voiceAssetId = (await api.uploadAsset(a, { kind: 'voice-note', recordingId }, voice, `${name}.webm`)).id;
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
  await postJson(a, buildPath(ROUTES['feedback.create'].path, { id: recordingId }), { items: inputs });

  if (!onTrace) {
    // the errors and requests the items attached become the capture's console and network
    const seen = new Set<string>();
    const events = items
      .flatMap((i) => i.ctxEvents)
      .filter((e) => !seen.has(e.id) && !!seen.add(e.id))
      .sort((x, y) => x.t - y.t);
    if (events.length) {
      const body = await gzip(events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      await api.putChunk(a, recordingId, 'events', 0, body, { sha256: await sha256Hex(body), t0: events[0]!.t, t1: events[events.length - 1]!.t, contentType: 'application/x-ndjson', contentEncoding: 'gzip' });
      await api.completeStream(a, recordingId, 'events', { lastSeq: 0, totalBytes: body.size });
    }
    const fin = await api.finalize(a, recordingId, { title: req.title ?? titleOf(items), description: '', annotations: [] });
    shareUrl = fin.shareUrl || shareUrl;
  }
  await dropBlobs(items);
  const sent = new Set(items.map((i) => i.id));
  st.items = st.items.filter((i) => !sent.has(i.id));
  if (!st.items.length) st.nextN = 1;
  await save();
  const result: ReviewSubmitResult = { recordingId, url: `${a.serverUrl}/c/${recordingId}`, count: items.length, trace: onTrace };
  void shareUrl;
  if (TEST_HOOKS) hooks.submits.push(result);
  return result;
}

async function offscreen(svc: CaptureService, msg: Record<string, unknown>) {
  await svc.ensureOffscreen();
  return (await browser.runtime.sendMessage({ to: 'offscreen', ...msg })) as { ok: boolean; error?: string; message?: string; blobId?: string; durationMs?: number } | undefined;
}

function handlersFor(svc: CaptureService): { [K in ReviewKey]: (req: BgRequestMap[K]['req'], sender: Sender) => Promise<BgRequestMap[K]['res']> } {
  return {
    'review.get': async (_req, sender) => {
      await load();
      return { items: tabOf(tabIdOf(sender)).items.map(view) };
    },
    'review.context': async (_req, sender) => {
      const tabId = tabIdOf(sender);
      // the toolbar polls this every 5 s while awake: probe screenshots once, and again while blocked
      const tab = await browser.tabs.get(tabId).catch(() => null);
      const shotsState = tab?.active ? await probeShots(tabId, () => shots.run(() => browser.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 10 }))) : shotAccess(tabId);
      return { context: (await readContext(svc, tabId)).context, shots: shotsState };
    },
    'review.shot': async (req, sender) => {
      const tabId = tabIdOf(sender);
      const tab = await browser.tabs.get(tabId);
      const png = await dataUrlToBlob(await capture(tab.windowId, tabId));
      const crop = await cropImage(png, req.rect, req.vw, { cssPixels: true });
      const blobId = await putBlob(`review-${crypto.randomUUID()}`, crop.blob);
      hooks.shots++;
      return { blobId, preview: await toDataUrl(crop.blob), width: crop.width, height: crop.height };
    },
    'review.add': async (req, sender) => {
      await load();
      const tabId = tabIdOf(sender);
      const st = tabOf(tabId);
      const now = Date.now();
      const { context, events } = await readContext(svc, tabId, now);
      const src: NewReviewItem = req.item;
      const item: StoredItem = {
        ...src,
        id: src.id && /^[0-9a-f-]{36}$/i.test(src.id) ? src.id : crypto.randomUUID(),
        n: st.nextN++,
        comment: (src.comment ?? '').slice(0, 10_000),
        shapes: src.shapes ?? [],
        context,
        t: now,
        ctxEvents: events,
      };
      st.items.push(item);
      await save();
      // a running trace gets the note as an action (its span engine reads annotation events)
      if (req.trace) {
        const e = { ...make('annotation', { annotationId: item.id, op: 'create' }), tab: tabId } as CaptureEvent;
        svc.ring.appendEvents(tabId, [e]);
      }
      return { item: view(item) };
    },
    'review.update': async (req, sender) => {
      await load();
      const st = tabOf(tabIdOf(sender));
      const it = st.items.find((i) => i.id === req.id);
      if (!it) throw new ReviewFailure('not_found', 'That note is gone');
      const patch: ReviewPatch = req.patch;
      if (patch.voiceBlobId !== undefined && it.voiceBlobId && it.voiceBlobId !== patch.voiceBlobId) await idbDelete('blobs', it.voiceBlobId).catch(() => undefined);
      Object.assign(it, patch);
      await save();
      return { item: view(it) };
    },
    'review.remove': async (req, sender) => {
      await load();
      const st = tabOf(tabIdOf(sender));
      const gone = st.items.filter((i) => i.id === req.id);
      st.items = st.items.filter((i) => i.id !== req.id);
      if (!st.items.length) st.nextN = 1;
      await dropBlobs(gone);
      await save();
      return {};
    },
    'review.clear': async (_req, sender) => {
      await load();
      const tabId = tabIdOf(sender);
      await dropBlobs(tabOf(tabId).items);
      delete tabs[tabId];
      await save();
      return {};
    },
    'review.voice': async (req) => {
      hooks.voice.push(req.op);
      if (req.op === 'start') {
        const settings = (await getStore('settings')) as { micDeviceId?: string } | undefined;
        const r = await offscreen(svc, { type: 'note-start', ...(settings?.micDeviceId ? { deviceId: settings.micDeviceId } : {}) });
        if (!r?.ok) throw new ReviewFailure(r?.error === 'permission_denied' ? 'permission_denied' : 'server', r?.error === 'permission_denied' ? 'Allow the microphone for the extension first' : (r?.message ?? 'The microphone did not start'));
        return { recording: true };
      }
      const r = await offscreen(svc, { type: 'note-stop', cancel: req.op === 'cancel' });
      return { recording: false, ...(r?.blobId ? { blobId: r.blobId, durationMs: r.durationMs } : {}) };
    },
    'review.submit': async (req, sender) => {
      await load();
      return { result: await submit(svc, tabIdOf(sender), req) };
    },
  };
}

function asFailure(e: unknown): { ok: false; error: BgError; message?: string } {
  if (e instanceof ReviewFailure) return { ok: false, error: e.code, message: e.message };
  if (e instanceof HttpError) return { ok: false, error: e.status === 401 ? 'not_signed_in' : e.status === 0 ? 'network' : 'server', message: e.message };
  const code = (e as { code?: unknown })?.code;
  return { ok: false, error: typeof code === 'string' ? (code as BgError) : 'server', message: e instanceof Error ? e.message : String(e) };
}

export function registerReview(svc: CaptureService) {
  void load();
  const handlers = handlersFor(svc) as Record<string, (req: unknown, sender: Sender) => Promise<object>>;
  browser.runtime.onMessage.addListener(((msg: { type?: string }, sender: Sender, reply: (r: unknown) => void) => {
    const h = msg?.type ? handlers[msg.type] : undefined;
    if (!h) return false;
    h(msg, sender).then(
      (res) => reply({ ok: true, ...res }),
      (e: unknown) => reply(asFailure(e)),
    );
    return true;
  }) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

  // a closed tab's unsent notes go with it
  browser.tabs.onRemoved.addListener((tabId) => {
    void load().then(async () => {
      const st = tabs[tabId];
      if (!st) return;
      delete tabs[tabId];
      await dropBlobs(st.items);
      await save();
    });
  });

  if (TEST_HOOKS)
    (globalThis as unknown as { __tbReview: unknown }).__tbReview = {
      state: async () => {
        await load();
        return structuredClone(tabs);
      },
      submits: () => hooks.submits.slice(),
      shots: () => hooks.shots,
      voice: () => hooks.voice.slice(),
    };
}
