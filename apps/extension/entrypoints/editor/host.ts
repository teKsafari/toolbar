// EditorHost for the extension: the draft and its blobs come straight from IndexedDB (this page
// shares the extension origin with the service worker); everything that talks to the server or
// to tabs goes through the worker.
import { browser } from 'wxt/browser';
import { EDITOR_FRAME_TAG, type BgRequestMap, type BgRequestOf, type BgRequestType, type BgResult, type EditorFrameMessage, type UploadRow } from '@toolbar/shared/ext';
import { parseNdjson, type AttachmentInfo, type DraftMarker, type EditorData, type EditorHost } from '@toolbar/ui/editor';
import { buildTimeMap, deriveConsole, deriveMarkers, deriveNetwork } from '@toolbar/shared/derive';
import type { CaptureEvent } from '@toolbar/shared';
import { fromNdjson } from '@toolbar/shared/events';
import { deleteBlob, getBlob, getDraft, openDb, putBlob, serverUrl } from '../../lib/bg/drafts';

async function send<K extends BgRequestType>(req: BgRequestOf<K>): Promise<BgRequestMap[K]['res']> {
  const r = (await browser.runtime.sendMessage(req)) as BgResult<K> | undefined;
  if (!r) throw new Error('The extension did not answer; try again');
  if (!r.ok) throw new Error(r.message || r.error);
  return r;
}

/** Rebuild a WebM from the upload chunks still in IndexedDB (before they are all acknowledged). */
async function videoFromChunks(recordingId: string): Promise<Blob | null> {
  const db = await openDb();
  const rows = await new Promise<UploadRow[]>((resolve, reject) => {
    const t = db.transaction('uploads', 'readonly');
    const r = t.objectStore('uploads').getAll(IDBKeyRange.bound([recordingId, 'video', 0], [recordingId, 'video', Number.MAX_SAFE_INTEGER]));
    r.onsuccess = () => resolve(r.result as UploadRow[]);
    r.onerror = () => reject(r.error);
  });
  if (!rows.length || rows[0]!.seq !== 0) return null;
  rows.sort((a, b) => a.seq - b.seq);
  return new Blob(
    rows.map((r) => r.body),
    { type: rows[0]!.contentType || 'video/webm' },
  );
}

type FrameMsg = EditorFrameMessage extends infer M ? (M extends unknown ? Omit<M, typeof EDITOR_FRAME_TAG> : never) : never;

function post(msg: FrameMsg) {
  if (window.parent !== window) window.parent.postMessage({ [EDITOR_FRAME_TAG]: true, ...msg }, '*');
}

async function copyText(text: string): Promise<boolean> {
  // the async clipboard API needs this document to hold focus
  window.focus();
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* no focus or no permission: fall back */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
    document.body.appendChild(ta);
    const prev = document.activeElement as HTMLElement | null;
    ta.focus();
    ta.select();
    // with no selection execCommand still answers true and copies nothing
    const ok = ta.selectionEnd - ta.selectionStart === text.length && document.execCommand('copy');
    ta.remove();
    prev?.focus?.();
    if (ok) return true;
  } catch {
    /* fall through */
  }
  try {
    await send({ type: 'clipboard.write', text });
    return true;
  } catch {
    return false;
  }
}

export async function createHost(draftId: string): Promise<EditorHost> {
  const base = await serverUrl();
  const urls: string[] = [];
  const url = (b: Blob) => {
    const u = URL.createObjectURL(b);
    urls.push(u);
    return u;
  };
  addEventListener('pagehide', () => urls.forEach((u) => URL.revokeObjectURL(u)));

  return {
    async load() {
      const draft = await getDraft(draftId);
      if (!draft) throw new Error('this draft no longer exists');
      const blobUrl = async (id: string | null | undefined) => {
        if (!id) return null;
        const b = await getBlob(id);
        return b ? url(b.blob) : null;
      };
      let videoUrl = await blobUrl(draft.videoBlobId);
      if (!videoUrl && draft.kind !== 'screenshot' && draft.recordingId) {
        const v = await videoFromChunks(draft.recordingId).catch(() => null);
        if (v) videoUrl = url(v);
      }
      // Instant replay without video: the capture area keeps the rrweb slice as NDJSON in `blobs`.
      const extra = draft as typeof draft & { rrwebBlobId?: string | null; startedAt?: number };
      let replayEvents: EditorData['replayEvents'] = null;
      if (!videoUrl && draft.kind === 'replay' && extra.rrwebBlobId) {
        const b = await getBlob(extra.rrwebBlobId);
        if (b) replayEvents = parseNdjson(await b.blob.text());
      }
      // Markers for the trim track (J-009, J-085): the same errors, failed requests and pen marks
      // the capture page's seek bar will show, on the draft's clock.
      let markers: DraftMarker[] = [];
      const eventsBlobId = (draft as typeof draft & { eventsBlobId?: string | null }).eventsBlobId;
      if (draft.kind !== 'screenshot' && eventsBlobId) {
        try {
          const b = await getBlob(eventsBlobId);
          const events = b ? (fromNdjson(await b.blob.text()) as CaptureEvent[]) : [];
          const map = buildTimeMap(events, extra.startedAt ?? null, !!videoUrl);
          const network = deriveNetwork(events, map);
          markers = deriveMarkers(deriveConsole(events, map, network), network, events, map)
            .filter((m) => m.kind !== 'pause' && m.kind !== 'resume')
            .map((m) => ({ ms: Math.max(0, m.at), kind: m.kind as DraftMarker['kind'], label: m.label, status: m.status, count: m.count }));
        } catch {
          markers = [];
        }
      }
      const attachments: AttachmentInfo[] = [];
      for (const id of draft.attachmentBlobIds ?? []) {
        const b = await getBlob(id);
        if (b) attachments.push({ id, name: b.blob instanceof File ? b.blob.name : id, type: b.type, size: b.blob.size });
      }
      return {
        draft,
        screenshotUrl: await blobUrl(draft.screenshotBlobId),
        fullUrl: draft.crop ? await blobUrl(draft.fullBlobId) : null,
        videoUrl,
        replayEvents,
        startedAt: extra.startedAt ?? null,
        markers,
        attachments,
      };
    },
    bootstrap: async (workspaceId) => (await send({ type: 'editor.bootstrap', workspaceId })).bootstrap,
    prefs: async () => (await send({ type: 'editor.prefs' })).prefs,
    savePrefs: async (patch) => void (await send({ type: 'editor.prefs', patch })),
    update: async (patch) => void (await send({ type: 'draft.update', draftId, patch })),
    putBlob: (blob) => putBlob(blob),
    deleteBlob: async (id) => void (await deleteBlob(id)),
    async create(req) {
      // the editor opens the capture tab itself once the link is copied (openCapture)
      const r = await send({ type: 'editor.create', draftId, finalize: req.finalize, flatBlobId: req.flatBlobId, flatFullBlobId: req.flatFullBlobId, openTab: false });
      return { recordingId: r.recordingId, shareUrl: r.shareUrl, issueError: r.issueError, issueUrl: r.issue?.url ?? null };
    },
    // first feedback at the keypress (J-086): in the in-page frame the page shows the one progress
    // toast and turns it into the done toast after the frame closes; a tab of its own keeps the
    // editor's toast
    progress: window.parent !== window ? { start: () => post({ type: 'creating' }), fail: () => post({ type: 'create-failed' }) } : undefined,
    discard: async () => void (await send({ type: 'draft.discard', draftId })),
    saveForLater: async () => void (await send({ type: 'draft.saveForLater', draftId })),
    ai: async () => {
      const r = await send({ type: 'editor.ai', draftId });
      return { ai: r.ai, reason: r.reason };
    },
    copy: copyText,
    close(reason, info) {
      document.documentElement.dataset.closed = reason;
      if (window.parent !== window) post({ type: 'close', reason, copied: info?.copied, opened: info?.opened, issueError: info?.issueError ?? null });
      else if (reason !== 'created') setTimeout(() => window.close(), 300);
    },
    openCapture: async (res, tabId) => ({ opened: (await send({ type: 'editor.openCapture', recordingId: res.recordingId, tabId, issueUrl: res.issueUrl })).opened }),
    trackerOptions: async (integrationId, repo) => {
      const r = await send({ type: 'editor.trackerOptions', integrationId, repo });
      return { options: r.options, recent: r.recent, error: r.error };
    },
    openUrl: (u) => void send({ type: 'editor.openTab', url: u }).catch(() => window.open(u, '_blank')),
    serverUrl: () => base,
  };
}
