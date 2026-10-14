// Seeding drafts for the editor e2e through the test build's service worker hooks.
import type { Page, Worker, FrameLocator, Locator } from '@playwright/test';
import { EXT_ID } from '../../fixtures/extension.ts';

export const MOCK_PORT = 3204;

export interface DraftHooks {
  saveDraft(d: unknown, blobs?: { id: string; blob: Blob }[]): Promise<void>;
  getDraft(id: string): Promise<Record<string, unknown> | undefined>;
  listDraftRows(): Promise<Record<string, unknown>[]>;
  openDraftInTab(tabId: number, id: string): Promise<void>;
  deleteDraft(id: string): Promise<unknown>;
  setCaptureBridge(
    b: {
      uploadStreams?(d: Record<string, unknown>, recordingId: string): Promise<void>;
      draftClosed?(draftId: string, how: string): Promise<void>;
    } | null,
  ): unknown;
}
declare const __tbDrafts: DraftHooks;

export async function signIn(sw: Worker, serverUrl: string) {
  await sw.evaluate(async (serverUrl) => {
    await chrome.storage.local.set({
      'nib:auth': {
        serverUrl,
        token: 'tb_dev_e2e',
        tokenId: 't1',
        user: { id: '019a0000-0000-7000-8000-000000000001', name: 'Dana Reviewer', email: 'dana@nib.test', image: null },
        activeWorkspaceId: '019a0000-0000-7000-8000-0000000000a1',
        signedInAt: Date.now(),
      },
      'nib:bootstrap': null,
      'nib:editor-prefs': null,
    });
  }, serverUrl);
}

export interface SeedOptions {
  kind?: 'screenshot' | 'video' | 'replay';
  tabId?: number;
  crop?: { x: number; y: number; w: number; h: number } | null;
  videoBase64?: string;
  durationMs?: number;
  title?: string;
  description?: string;
  folderId?: string | null;
  workspaceId?: string | null;
  reopened?: boolean;
  recordingId?: string | null;
  status?: 'open' | 'saved';
  /** rrweb events for a replay draft, stored as NDJSON like the capture area does */
  rrweb?: unknown[];
  startedAt?: number;
  trim?: { startMs: number; endMs: number } | null;
}

/**
 * Store a draft. Screenshots are drawn in the worker: a white page with dark text rows and
 * colour blocks (1000 x 600), so blur and flatten checks have structure to look at.
 */
export async function seedDraft(sw: Worker, o: SeedOptions = {}): Promise<string> {
  return sw.evaluate(async (o) => {
    const id = `d-${crypto.randomUUID()}`;
    const kind = o.kind ?? 'screenshot';
    const blobs: { id: string; blob: Blob }[] = [];
    const draw = (w: number, h: number, label: string) => {
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#111111';
      g.font = 'bold 22px sans-serif';
      for (let y = 40; y < h; y += 44) g.fillText(`${label} row ${y} SECRET 4242 4242 lorem ipsum`, 20, y);
      g.fillStyle = '#16a34a';
      g.fillRect(w - 160, 20, 120, 60);
      return c.convertToBlob({ type: 'image/png' });
    };
    let screenshotBlobId: string | null = null;
    let fullBlobId: string | null = null;
    let videoBlobId: string | null = null;
    if (kind === 'screenshot') {
      if (o.crop) {
        fullBlobId = `${id}-full`;
        blobs.push({ id: fullBlobId, blob: await draw(1200, 750, 'Full') });
        screenshotBlobId = `${id}-shot`;
        const full = await createImageBitmap(blobs[0]!.blob);
        const c = new OffscreenCanvas(o.crop.w, o.crop.h);
        c.getContext('2d')!.drawImage(full, o.crop.x, o.crop.y, o.crop.w, o.crop.h, 0, 0, o.crop.w, o.crop.h);
        blobs.push({ id: screenshotBlobId, blob: await c.convertToBlob({ type: 'image/png' }) });
      } else {
        screenshotBlobId = `${id}-shot`;
        blobs.push({ id: screenshotBlobId, blob: await draw(1000, 600, 'Shot') });
      }
    } else if (o.rrweb) {
      blobs.push({ id: `${id}-rrweb`, blob: new Blob([o.rrweb.map((e) => JSON.stringify(e)).join('\n') + '\n'], { type: 'application/x-ndjson' }) });
    } else if (o.videoBase64) {
      videoBlobId = `${id}-video`;
      const bin = Uint8Array.from(atob(o.videoBase64), (ch) => ch.charCodeAt(0));
      blobs.push({ id: videoBlobId, blob: new Blob([bin], { type: 'video/webm' }) });
    }
    const now = Date.now();
    const draft = {
      id,
      kind,
      createdAt: now,
      updatedAt: now,
      host: 'localhost:5173',
      pageUrl: 'http://localhost:5173/',
      pageTitle: 'Lab',
      title: o.title ?? '',
      durationMs: o.durationMs ?? null,
      thumbBlobId: null,
      recordingId: o.recordingId !== undefined ? o.recordingId : kind === 'screenshot' ? null : crypto.randomUUID(),
      status: o.status ?? 'open',
      clientId: crypto.randomUUID(),
      tabId: o.tabId ?? -1,
      mode: kind === 'screenshot' ? null : 'tab',
      workspaceId: o.workspaceId ?? null,
      folderId: o.folderId ?? null,
      description: o.description ?? '',
      screenshotBlobId,
      fullBlobId,
      crop: o.crop ?? null,
      keepFull: true,
      annotations: [],
      trim: o.trim ?? null,
      destination: { type: 'link' },
      attachmentBlobIds: [],
      aiAccepted: false,
      error: null,
      videoBlobId,
      ai: null,
      reopenedAt: o.reopened ? now : null,
      ...(o.rrweb ? { rrwebBlobId: `${id}-rrweb`, startedAt: o.startedAt ?? now } : {}),
    };
    await __tbDrafts.saveDraft(draft, blobs);
    return id;
  }, o);
}

export const getDraft = (sw: Worker, id: string) => sw.evaluate((id) => __tbDrafts.getDraft(id), id);
export const draftCount = (sw: Worker) => sw.evaluate(async () => (await __tbDrafts.listDraftRows()).length);

/** The editor page as a tab of its own. */
export async function openEditorTab(page: Page, draftId: string) {
  await page.goto(`chrome-extension://${EXT_ID}/editor.html?draft=${encodeURIComponent(draftId)}`);
  await page.getByTestId('editor').waitFor();
  await page.getByTestId('field').waitFor();
  await settled(page.getByTestId('annotator'));
  return page;
}

/** Wait until a box (if it exists) keeps its place for 300 ms, so mapped coordinates hold. */
export async function settled(loc: Locator) {
  if (!(await loc.count())) return;
  let prev = await loc.boundingBox();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const cur = await loc.boundingBox();
    if (prev && cur && prev.x === cur.x && prev.y === cur.y && prev.width === cur.width && prev.height === cur.height) return;
    prev = cur;
  }
}

/** Tab id of a page, from the worker. */
export async function tabIdOf(sw: Worker, page: Page): Promise<number> {
  const url = page.url();
  return sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const t = tabs.find((x) => x.url === url);
    if (!t?.id) throw new Error('no tab for ' + url);
    return t.id;
  }, url);
}

/** The in-page editor iframe over a lab page. */
export async function openEditorInPage(sw: Worker, page: Page, draftId: string): Promise<FrameLocator> {
  const tabId = await tabIdOf(sw, page);
  await sw.evaluate(({ tabId, draftId }) => __tbDrafts.openDraftInTab(tabId, draftId), { tabId, draftId });
  await page.locator('iframe[data-nb-editor]').waitFor();
  const frame = page.frameLocator('iframe[data-nb-editor]');
  await frame.getByTestId('editor').waitFor();
  // the draft is loaded once its form field is there
  await frame.getByTestId('field').waitFor();
  await settled(frame.getByTestId('annotator'));
  return frame;
}
