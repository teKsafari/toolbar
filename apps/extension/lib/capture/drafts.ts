// Draft records written by the capture producer (screenshot, recording stop, instant replay).
// The editor area reads and changes them (draft.get, draft.update, draft.create); these helpers
// only create them and keep the summary list in chrome.storage in step.
import type { CaptureEvent, EnvInfo, RecordingKind, Rect } from '@toolbar/shared';
import { uuidv7 } from '@toolbar/shared/ids';
import type { Draft, DraftSummary } from '@toolbar/shared/ext';
import { idbPut, putBlob } from '../idb';
import { getStore, setStore } from './store';

export function toNdjson(items: readonly unknown[]): string {
  return items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : '');
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

export async function saveDraft(d: Draft): Promise<void> {
  await idbPut('drafts', d);
  const list = (await getStore('drafts')) ?? [];
  const next = [summaryOf(d), ...list.filter((x) => x.id !== d.id)].slice(0, 200);
  await setStore('drafts', next);
}

export interface NewDraftInput {
  kind: RecordingKind;
  tabId: number;
  pageUrl: string;
  pageTitle: string;
  startedAt: number;
  durationMs: number | null;
  clientId?: string;
  recordingId?: string | null;
  mode?: Draft['mode'];
  workspaceId: string | null;
  events: CaptureEvent[];
  rrweb?: unknown[];
  screenshot?: Blob | null;
  full?: Blob | null;
  crop?: Rect | null;
  env?: EnvInfo | null;
  metadata?: Record<string, unknown> | null;
  extra?: Partial<Draft>;
}

/** Writes blobs and the draft record; returns the draft. */
export async function createDraft(input: NewDraftInput): Promise<Draft> {
  const id = uuidv7();
  const now = Date.now();
  const clientId = input.clientId ?? uuidv7();
  let host = '';
  try {
    host = new URL(input.pageUrl).host;
  } catch {
    /* file: or about: */
  }
  const eventsBlobId = await putBlob(`events-${id}`, new Blob([toNdjson(input.events)], { type: 'application/x-ndjson' }));
  const rrwebBlobId = input.rrweb?.length ? await putBlob(`rrweb-${id}`, new Blob([toNdjson(input.rrweb)], { type: 'application/x-ndjson' })) : null;
  const screenshotBlobId = input.screenshot ? await putBlob(`shot-${id}`, input.screenshot) : null;
  const fullBlobId = input.full ? await putBlob(`full-${id}`, input.full) : null;
  const draft: Draft = {
    id,
    kind: input.kind,
    createdAt: now,
    updatedAt: now,
    host,
    pageUrl: input.pageUrl,
    pageTitle: input.pageTitle,
    title: '',
    durationMs: input.durationMs,
    thumbBlobId: screenshotBlobId,
    recordingId: input.recordingId ?? null,
    status: 'open',
    clientId,
    tabId: input.tabId,
    mode: input.mode ?? null,
    workspaceId: input.workspaceId,
    folderId: null,
    description: '',
    screenshotBlobId,
    fullBlobId,
    crop: input.crop ?? null,
    keepFull: !!input.crop && !!fullBlobId,
    annotations: [],
    trim: null,
    destination: { type: 'link' },
    attachmentBlobIds: [],
    aiAccepted: false,
    error: null,
    startedAt: input.startedAt,
    uploadKey: input.recordingId ?? clientId,
    eventsBlobId,
    rrwebBlobId,
    env: input.env ?? null,
    metadata: input.metadata ?? null,
    ...input.extra,
  };
  await saveDraft(draft);
  return draft;
}
