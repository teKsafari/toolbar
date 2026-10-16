// Drafts: IndexedDB access (any extension context) and the service worker's draft.* and editor.*
// requests (J-086, J-088, J-218, J-219, J-083). The capture area writes new drafts with
// saveDraft() and opens the editor with openDraftInTab().
import { ensureContent } from '../registration';
import { browser } from 'wxt/browser';
import { TEST_HOOKS } from '../flags';
import { accountServerUrl } from '../server-url';
import { IDB, STORAGE, type AuthState, type BgRequestMap, type BgRequestType, type BgResult, type BlobRow, type ContentCommand, type Draft, type DraftSummary } from '@toolbar/shared/ext';
import type { ExtBootstrap, FinalizeCaptureBody, LinkedIssue } from '@toolbar/shared/api';
import { DEFAULT_EDITOR_PREFS, EDITOR_PREFS_KEY, type AiDraftText, type AiUnavailableReason, type EditorPrefs, type TrackerOptions, type TrackerRecent } from '@toolbar/shared/areas/editor';

// ---------- IndexedDB ----------

let dbp: Promise<IDBDatabase> | null = null;

/** Opens the extension database; creates every store of the IDB contract on first use. */
export function openDb(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB.name, IDB.version);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(IDB.stores)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: opts.keyPath as string | string[] });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbp = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbp = null;
      reject(req.error);
    };
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r ? r.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const getDraft = (id: string) => tx<Draft>('drafts', 'readonly', (s) => s.get(id) as IDBRequest<Draft>);
export const listDraftRows = () => tx<Draft[]>('drafts', 'readonly', (s) => s.getAll() as IDBRequest<Draft[]>).then((r) => r ?? []);
export const getBlob = (id: string) => tx<BlobRow>('blobs', 'readonly', (s) => s.get(id) as IDBRequest<BlobRow>);
export const deleteBlob = (id: string) => tx('blobs', 'readwrite', (s) => void s.delete(id));

export function newBlobId(): string {
  return `b-${crypto.randomUUID()}`;
}

export async function putBlob(blob: Blob, id = newBlobId()): Promise<string> {
  const row: BlobRow = { id, blob, type: blob.type, createdAt: Date.now() };
  await tx('blobs', 'readwrite', (s) => void s.put(row));
  return id;
}

export function summaryOf(d: Draft): DraftSummary {
  return {
    id: d.id,
    kind: d.kind,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    host: d.host,
    pageUrl: d.pageUrl,
    pageTitle: d.pageTitle,
    title: d.title,
    durationMs: d.durationMs,
    thumbBlobId: d.thumbBlobId,
    recordingId: d.recordingId,
    status: d.status,
  };
}

/** Mirror the draft list into chrome.storage.local for the popup (J-035, J-218). */
export async function syncSummaries(): Promise<DraftSummary[]> {
  const rows = await listDraftRows();
  const list = rows.map(summaryOf).sort((a, b) => b.updatedAt - a.updatedAt);
  await browser.storage.local.set({ [STORAGE.drafts.key]: list });
  return list;
}

/** Write a draft and its blobs (capture area: after a screenshot, a stop or a replay). */
export async function saveDraft(draft: Draft, blobs: { id: string; blob: Blob }[] = []): Promise<void> {
  for (const b of blobs) await putBlob(b.blob, b.id);
  await tx('drafts', 'readwrite', (s) => void s.put(draft));
  await syncSummaries();
}

export async function updateDraft(id: string, patch: Partial<Draft>): Promise<Draft> {
  const d = await getDraft(id);
  if (!d) throw new BgFailure('not_found', 'No such draft');
  const next: Draft = { ...d, ...patch, id: d.id, kind: d.kind, createdAt: d.createdAt, updatedAt: Date.now() };
  await tx('drafts', 'readwrite', (s) => void s.put(next));
  if (['title', 'status', 'thumbBlobId', 'durationMs', 'recordingId'].some((k) => k in patch)) await syncSummaries();
  return next;
}

/** Delete a draft and every blob it owns. */
export async function deleteDraft(id: string): Promise<Draft | null> {
  const d = await getDraft(id);
  if (!d) return null;
  const ids = [d.screenshotBlobId, d.fullBlobId, d.thumbBlobId, d.videoBlobId, ...(d.attachmentBlobIds ?? [])].filter((x): x is string => !!x);
  for (const b of ids) await deleteBlob(b).catch(() => {});
  await tx('drafts', 'readwrite', (s) => void s.delete(id));
  await syncSummaries();
  return d;
}

// ---------- server access ----------

class BgFailure extends Error {
  constructor(
    public code: 'not_signed_in' | 'not_found' | 'network' | 'server' | 'invalid' | 'permission_denied',
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}

async function readLocal<T>(key: string): Promise<T | null> {
  const r = await browser.storage.local.get(key);
  return (r[key] as T | undefined) ?? null;
}

export async function authState(): Promise<AuthState | null> {
  return readLocal<AuthState>(STORAGE.auth.key);
}

/** The signed-in server (captures live there), else the configured one (lib/server-url.ts). */
export async function serverUrl(): Promise<string> {
  return accountServerUrl(await authState());
}

async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const a = await authState();
  if (!a?.token) throw new BgFailure('not_signed_in', 'Sign in to create captures');
  const base = (a.serverUrl || (await serverUrl())).replace(/\/$/, '');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${a.token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers, body });
  } catch (e) {
    throw new BgFailure('network', `Cannot reach the server: ${(e as Error).message}`);
  }
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'message' in data && (data as { message?: string }).message) || `${res.status} ${res.statusText}`;
    const code = res.status === 401 ? 'not_signed_in' : res.status === 403 ? 'permission_denied' : res.status === 404 ? 'not_found' : res.status === 422 || res.status === 400 ? 'invalid' : 'server';
    throw new BgFailure(code, String(msg), res.status);
  }
  return data as T;
}

async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const s = { width: bmp.width, height: bmp.height };
    bmp.close();
    return s;
  } catch {
    return null;
  }
}

async function uploadAsset(blob: Blob, kind: string, recordingId: string, name?: string): Promise<string> {
  const fd = new FormData();
  fd.set('kind', kind);
  fd.set('recordingId', recordingId);
  if (blob.type.startsWith('image/')) {
    const size = await imageSize(blob);
    if (size) {
      fd.set('width', String(size.width));
      fd.set('height', String(size.height));
    }
  }
  fd.set('file', blob, name ?? (blob instanceof File ? blob.name : `${kind}.${blob.type.split('/')[1] || 'bin'}`));
  const r = await api<{ id: string }>('/api/v1/assets', { method: 'POST', body: fd });
  return r.id;
}

// ---------- create (J-086) ----------

/**
 * What the capture area does at the editor's end of a draft. It plugs in with one
 * setCaptureBridge() call in its bg module at merge; until then both are no-ops.
 */
export interface CaptureBridge {
  /** Upload the draft's local streams (events, rrweb, replay video) and complete them; runs before any asset or finalize call, so screenshots and replays keep their logs (J-071, J-189). */
  uploadStreams?(draft: Draft, recordingId: string): Promise<void>;
  /** The editor let go of the draft: move the capture session out of `draft` (CREATE, DISCARD, SAVE_FOR_LATER), so the popup re-enables its capture rows and the drafts pill (J-035, J-219). */
  draftClosed?(draftId: string, how: 'created' | 'discarded' | 'saved'): Promise<void>;
  /** A draft reopened from the Drafts list (draft.open): the session holds it again. Returns true when the session owner opens the editor itself. */
  draftOpened?(draft: Draft): Promise<boolean>;
  /** Discard (J-189): delete the server copy made while recording and the queued upload rows. */
  discardData?(draft: Draft): Promise<void>;
}
let bridge: CaptureBridge = {};

/** Returns the bridge it replaces, so a test that swaps in its own can put the real one back. */
export function setCaptureBridge(b: CaptureBridge | null): CaptureBridge {
  const prev = bridge;
  bridge = b ?? {};
  return prev;
}

async function closed(draftId: string, how: 'created' | 'discarded' | 'saved') {
  try {
    await bridge.draftClosed?.(draftId, how);
  } catch (e) {
    console.warn('[toolbar] capture bridge draftClosed failed', e);
  }
}

export interface CreateArgs {
  draftId: string;
  finalize: FinalizeCaptureBody;
  flatBlobId?: string | null;
  flatFullBlobId?: string | null;
  openTab?: boolean;
}

export async function createFromDraft(args: CreateArgs): Promise<{ recordingId: string; shareUrl: string; issue: LinkedIssue | null; issueError: string | null }> {
  const d = await getDraft(args.draftId);
  if (!d) throw new BgFailure('not_found', 'This draft no longer exists');
  const a = await authState();
  if (!a?.token) throw new BgFailure('not_signed_in', 'Sign in to create captures');
  await updateDraft(d.id, { status: 'uploading', error: null });
  try {
    const workspaceId = args.finalize.workspaceId ?? d.workspaceId ?? a.activeWorkspaceId;
    let recordingId = d.recordingId;
    if (!recordingId) {
      if (!workspaceId) throw new BgFailure('invalid', 'Pick a workspace first');
      const created = await api<{ id: string; shareUrl: string }>('/api/v1/recordings', {
        method: 'POST',
        json: {
          clientId: d.clientId,
          kind: d.kind,
          workspaceId,
          folderId: args.finalize.folderId ?? undefined,
          page: { url: d.pageUrl, title: d.pageTitle },
          startedAt: (d as Draft & { startedAt?: number }).startedAt ?? d.createdAt,
          // what the capture area recorded: browser and page facts, length
          ...(d.env ? { env: d.env } : {}),
          ...(d.durationMs != null ? { durationMs: Math.round(d.durationMs) } : {}),
        },
      });
      recordingId = created.id;
      await updateDraft(d.id, { recordingId });
    }

    // Events, rrweb and replay video kept locally until create (J-189) belong to the capture
    // area's uploader; it registers here at merge and runs before any asset or finalize call.
    if (bridge.uploadStreams) await bridge.uploadStreams(d, recordingId);

    const finalize: FinalizeCaptureBody = { ...args.finalize, workspaceId: workspaceId ?? undefined };
    // custom metadata (J-073) and the length come with the draft unless the editor set them
    if (d.metadata && !finalize.metadata) finalize.metadata = d.metadata;
    if (finalize.durationMs === undefined && d.durationMs != null) finalize.durationMs = Math.round(d.durationMs);
    if (d.kind === 'screenshot') {
      const shotId = args.flatBlobId ?? d.screenshotBlobId;
      const shot = shotId ? await getBlob(shotId) : undefined;
      if (!shot) throw new BgFailure('invalid', 'The screenshot is missing from this draft');
      finalize.screenshotAssetId = await uploadAsset(shot.blob, d.crop ? 'crop' : 'screenshot', recordingId);
      if (d.crop && d.keepFull !== false && finalize.fullScreenshotAssetId === undefined) {
        const fullId = args.flatFullBlobId ?? d.fullBlobId;
        const full = fullId ? await getBlob(fullId) : undefined;
        finalize.fullScreenshotAssetId = full ? await uploadAsset(full.blob, 'screenshot', recordingId) : null;
      }
    }
    // a replay without video has no frame for the server to take a card image from: send the still (J-158)
    if (d.kind === 'replay' && d.thumbBlobId && !d.videoBlobId && !(d.replaySegmentBlobIds ?? []).length) {
      const t = await getBlob(d.thumbBlobId);
      if (t) await uploadAsset(t.blob, 'thumb', recordingId).catch(() => undefined);
    }
    const attachmentIds: string[] = [];
    for (const id of d.attachmentBlobIds ?? []) {
      const b = await getBlob(id);
      if (b) attachmentIds.push(await uploadAsset(b.blob, 'attachment', recordingId));
    }
    finalize.attachmentAssetIds = attachmentIds;

    const res = await api<{ id: string; shareUrl: string; issue: LinkedIssue | null; issueError: string | null }>(
      `/api/v1/recordings/${encodeURIComponent(recordingId)}/finalize`,
      { method: 'POST', json: finalize },
    );
    // the draft is done; flattened images go with it
    for (const b of [args.flatBlobId, args.flatFullBlobId]) if (b) await deleteBlob(b).catch(() => {});
    await deleteDraft(d.id);
    await closed(d.id, 'created');
    // J-089: the extension setting decides whether the capture page opens after create
    const openTab = args.openTab ?? (await readLocal<{ openInNewTab?: boolean }>(STORAGE.settings.key))?.openInNewTab ?? true;
    if (openTab) {
      const base = await serverUrl();
      await openBesides(`${base}/c/${encodeURIComponent(res.id ?? recordingId)}`, d.tabId, false).catch(() => {});
      if (res.issue?.url) await openBesides(res.issue.url, d.tabId, false).catch(() => {});
    }
    return { recordingId: res.id ?? recordingId, shareUrl: res.shareUrl, issue: res.issue ?? null, issueError: res.issueError ?? null };
  } catch (e) {
    await updateDraft(d.id, { status: 'open', error: (e as Error).message }).catch(() => {});
    throw e;
  }
}

/** Open a URL in a new tab directly right of the source tab (J-086). */
export async function openBesides(url: string, tabId: number | undefined, active: boolean) {
  let index: number | undefined;
  let windowId: number | undefined;
  if (tabId != null && tabId >= 0) {
    const t = await browser.tabs.get(tabId).catch(() => null);
    if (t) {
      index = t.index + 1;
      windowId = t.windowId;
    }
  }
  return browser.tabs.create({ url, active, index, windowId, openerTabId: tabId != null && tabId >= 0 ? tabId : undefined });
}

// ---------- AI, bootstrap, prefs ----------

async function aiFor(draftId: string): Promise<{ ai: AiDraftText | null; reason: AiUnavailableReason | null }> {
  const d = await getDraft(draftId);
  if (!d) throw new BgFailure('not_found', 'No such draft');
  if (d.kind === 'screenshot') return { ai: null, reason: 'not-video' };
  if (d.ai) return { ai: d.ai, reason: null };
  if (!(await authState())?.token) return { ai: null, reason: 'not-signed-in' };
  if (!d.recordingId) return { ai: null, reason: 'error' };
  try {
    const ai = await api<AiDraftText>(`/api/v1/recordings/${encodeURIComponent(d.recordingId)}/ai-draft`, { method: 'POST' });
    await updateDraft(d.id, { ai });
    return { ai, reason: null };
  } catch (e) {
    const f = e as BgFailure;
    if (f.status === 503) return { ai: null, reason: 'unavailable' };
    if (f.code === 'not_signed_in') return { ai: null, reason: 'not-signed-in' };
    return { ai: null, reason: 'error' };
  }
}

async function bootstrapFor(workspaceId: string | null | undefined, refresh = false): Promise<ExtBootstrap | null> {
  const cached = await readLocal<{ at: number; data: ExtBootstrap }>(STORAGE.bootstrap.key);
  const sameWs = !workspaceId || cached?.data.activeWorkspaceId === workspaceId;
  if (cached && sameWs && !refresh && Date.now() - cached.at < 60_000) return cached.data;
  try {
    const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
    const data = await api<ExtBootstrap>(`/api/v1/ext/bootstrap${q}`);
    if (!workspaceId) await browser.storage.local.set({ [STORAGE.bootstrap.key]: { at: Date.now(), data } });
    return data;
  } catch {
    return cached?.data ?? null;
  }
}

export async function editorPrefs(patch?: Partial<EditorPrefs>): Promise<EditorPrefs> {
  const cur = { ...DEFAULT_EDITOR_PREFS, ...((await readLocal<EditorPrefs>(EDITOR_PREFS_KEY)) ?? {}) };
  if (!patch) return cur;
  const next = { ...cur, ...patch };
  await browser.storage.local.set({ [EDITOR_PREFS_KEY]: next });
  // the account keeps the same choices (J-081, J-083); best effort
  void api('/api/v1/me/settings', { method: 'PATCH', json: { editor: patch } }).catch(() => {});
  return next;
}

// ---------- editor in a tab ----------

async function sendToTab(tabId: number, cmd: ContentCommand) {
  await browser.tabs.sendMessage(tabId, cmd).catch(() => {});
}

/** Show the editor for a draft in a tab (fresh capture or reopen from the Drafts list). */
export async function openDraftInTab(tabId: number, draftId: string) {
  // after a restart the tab's old script is gone (J-218): give it a live one before asking
  await ensureContent(tabId).catch(() => false);
  await sendToTab(tabId, { type: 'ui.editor-open', draftId });
}

async function activeTabId(): Promise<number | undefined> {
  const [t] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  return t?.id;
}

// ---------- request handlers ----------

type Handler<K extends BgRequestType> = (req: { type: K } & BgRequestMap[K]['req'], sender: { tab?: { id?: number } }) => Promise<BgRequestMap[K]['res']>;
type Handlers = { [K in BgRequestType]?: Handler<K> };

export const draftHandlers: Handlers = {
  'draft.list': async () => ({ drafts: await syncSummaries() }),
  'draft.get': async ({ draftId }) => {
    const draft = await getDraft(draftId);
    if (!draft) throw new BgFailure('not_found', 'No such draft');
    return { draft, blobs: {} };
  },
  'draft.update': async ({ draftId, patch }) => ({ draft: await updateDraft(draftId, patch) }),
  'draft.create': async ({ draftId, finalize }) => createFromDraft({ draftId, finalize }),
  'draft.discard': async ({ draftId }, sender) => {
    const before = await getDraft(draftId);
    if (before) await bridge.discardData?.(before).catch((e: unknown) => console.warn('[toolbar] capture bridge discardData failed', e));
    const d = await deleteDraft(draftId);
    await closed(draftId, 'discarded');
    const tab = d?.tabId ?? sender.tab?.id;
    if (tab != null && tab >= 0 && sender.tab?.id == null) await sendToTab(tab, { type: 'ui.editor-close' });
    return {};
  },
  'draft.saveForLater': async ({ draftId }) => {
    await updateDraft(draftId, { status: 'saved' });
    await closed(draftId, 'saved');
    return {};
  },
  'draft.open': async ({ draftId, tabId }, sender) => {
    const tab = tabId ?? sender.tab?.id ?? (await activeTabId());
    if (tab == null) throw new BgFailure('not_found', 'No tab to open the draft in');
    const d = await updateDraft(draftId, { status: 'open', reopenedAt: Date.now(), tabId: tab });
    const opened = await bridge.draftOpened?.(d).catch(() => false);
    if (!opened) await openDraftInTab(tab, draftId);
    return {};
  },
  'editor.create': async (req) => createFromDraft(req),
  'editor.openCapture': async ({ recordingId, tabId, issueUrl }) => {
    const base = await serverUrl();
    // J-089: the extension setting "open the capture in a new tab"
    const openInNewTab = (await readLocal<{ openInNewTab?: boolean }>(STORAGE.settings.key))?.openInNewTab ?? true;
    if (openInNewTab) await openBesides(`${base}/c/${encodeURIComponent(recordingId)}`, tabId, false);
    if (issueUrl && /^https?:\/\//.test(issueUrl)) await openBesides(issueUrl, tabId, false).catch(() => {});
    return { opened: openInNewTab };
  },
  'editor.ai': async ({ draftId }) => aiFor(draftId),
  'editor.bootstrap': async ({ workspaceId, refresh }) => ({ bootstrap: await bootstrapFor(workspaceId, refresh) }),
  'editor.prefs': async ({ patch }) => ({ prefs: await editorPrefs(patch) }),
  'editor.trackerOptions': async ({ integrationId, repo }) => {
    const id = encodeURIComponent(integrationId);
    let recent: TrackerRecent | null = null;
    try {
      const s = await api<{ editor?: { recentFields?: Record<string, TrackerRecent> } }>('/api/v1/me/settings');
      recent = s.editor?.recentFields?.[integrationId] ?? null;
    } catch {
      /* remembered values are a convenience */
    }
    try {
      const q = repo ? `?repo=${encodeURIComponent(repo)}` : '';
      const options = await api<TrackerOptions>(`/api/v1/integrations/${id}/options${q}`);
      return { options, recent, error: null };
    } catch (e) {
      return { options: null, recent, error: (e as Error).message };
    }
  },
  'editor.openTab': async ({ url, tabId }, sender) => {
    const base = await serverUrl();
    if (!url.startsWith(base + '/')) throw new BgFailure('invalid', 'Only server pages open from the editor');
    await openBesides(url, tabId ?? sender.tab?.id, true);
    return {};
  },
};

/** One registration line in background.ts. */
export function registerDraftHandlers() {
  browser.runtime.onMessage.addListener((msg: { type?: string } | undefined, sender, reply) => {
    const h = msg?.type ? (draftHandlers as Record<string, Handler<BgRequestType> | undefined>)[msg.type] : undefined;
    if (!h) return false;
    h(msg as never, sender).then(
      (res) => reply({ ok: true, ...res } as BgResult<BgRequestType>),
      (e: unknown) => {
        const f = e instanceof BgFailure ? e : null;
        reply({ ok: false, error: f?.code ?? 'server', message: (e as Error)?.message ?? String(e) });
      },
    );
    return true;
  });
  if (TEST_HOOKS) {
    (globalThis as unknown as { __tbDrafts: unknown }).__tbDrafts = { saveDraft, getDraft, listDraftRows, openDraftInTab, putBlob, getBlob, deleteDraft, editorPrefs, syncSummaries, setCaptureBridge };
  }
}
