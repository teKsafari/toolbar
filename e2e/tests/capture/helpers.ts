// Shared helpers for the capture area's e2e suite: a mock upload server (until server-core
// lands), signed-in state in extension storage, and access to the worker's capture service.
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test as extTest, LAB_URL, DISPLAY, EXT_DIR, EXT_ID } from '../../fixtures/extension.ts';
import { MOCK_TOKEN, startMockServer, type MockServer } from '../../fixtures/mock-upload-server.ts';

/** The extension API inside sw.evaluate() callbacks (they run in the service worker). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

export { LAB_URL };
export const LAB_ORIGIN_2 = LAB_URL.replace(':5173', ':5174');
export const MOCK_PORT = Number(new URL(process.env.SERVER_URL ?? 'http://localhost:3102').port || 3102);
export const WORKSPACE_ID = '019a0000-0000-7000-8000-0000000000a1';

export interface RingSlice {
  events: { kind: string; t: number; ctx: string; tab?: number; data: Record<string, unknown> }[];
  rrweb: { type: number; timestamp: number }[];
}

/**
 * A second browser without --use-fake-device-for-media-stream: with that flag Chromium answers
 * tab-capture getUserMedia with "Requested device not found", so tab recordings run here.
 * Screen, desktop and microphone tests use the main fixture's fake devices.
 */
export interface TabBrowser {
  context: BrowserContext;
  sw: Worker;
}

export const test = extTest.extend<{ mock: MockServer; tab: TabBrowser }, { mockServer: MockServer; tabBrowser: TabBrowser }>({
  tabBrowser: [
    async ({}, use) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-e2e-tab-'));
      fs.mkdirSync(path.join(dir, 'Default'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'Default', 'Preferences'), JSON.stringify({ extensions: { pinned_extensions: [EXT_ID] } }));
      const context = await chromium.launchPersistentContext(dir, {
        headless: false,
        env: { ...process.env, DISPLAY },
        viewport: null,
        args: [`--disable-extensions-except=${EXT_DIR}`, `--load-extension=${EXT_DIR}`, `--allowlisted-extension-id=${EXT_ID}`, '--window-position=0,0', '--window-size=1280,800', '--force-device-scale-factor=1'],
      });
      const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await use({ context, sw });
      await context.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  tab: async ({ tabBrowser, mockServer }, use) => {
    await tabBrowser.sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
    mockServer.reset();
    await signIn(tabBrowser.sw, mockServer.url);
    await resetSession(tabBrowser.sw);
    await use(tabBrowser);
  },
  mockServer: [
    async ({}, use) => {
      const m = await startMockServer(MOCK_PORT);
      await use(m);
      await m.close();
    },
    { scope: 'worker' },
  ],
  mock: async ({ mockServer, sw }, use) => {
    // content scripts are registered at runtime by the worker; pages opened before that have no hooks
    await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
    mockServer.reset();
    await signIn(sw, mockServer.url);
    await resetSession(sw);
    await use(mockServer);
  },
});
export const expect = test.expect;

/** Writes a signed-in AuthState and default settings into extension storage. */
export async function signIn(sw: Worker, serverUrl: string) {
  await sw.evaluate(
    async ({ serverUrl, token, ws }) => {
      await chrome.storage.local.set({
        'nib:auth': { serverUrl, token, tokenId: 'tok-e2e', user: { id: 'u1', name: 'Dana Reviewer', email: 'dana@nib.test', image: null }, activeWorkspaceId: ws, signedInAt: Date.now() },
        'nib:server-url': serverUrl,
      });
    },
    { serverUrl, token: MOCK_TOKEN, ws: WORKSPACE_ID },
  );
}

/** Puts the capture session back to idle (a failed test may leave it in error or draft). */
export async function resetSession(sw: Worker) {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { capture: { apply(e: unknown): Promise<unknown> } } }).__tb.capture.apply({ type: 'RESET' }));
}

export async function setSettings(sw: Worker, patch: Record<string, unknown>) {
  await sw.evaluate(async (patch) => {
    const cur = (await chrome.storage.local.get('nib:settings'))['nib:settings'] ?? {};
    await chrome.storage.local.set({ 'nib:settings': { ...cur, ...patch } });
  }, patch);
  await new Promise((r) => setTimeout(r, 150)); // storage.onChanged reaches the service
}

/** Tab id of a Playwright page: the newest tab showing its URL (tests close their pages). */
export async function tabIdOf(sw: Worker, page: Page): Promise<number> {
  const url = page.url();
  return sw.evaluate(async (url) => {
    for (let i = 0; i < 40; i++) {
      const tabs = ((await chrome.tabs.query({})) as { id?: number; url?: string; pendingUrl?: string }[]).filter((t) => t.url === url || t.pendingUrl === url);
      if (tabs.length) return Math.max(...tabs.map((t) => t.id ?? -1));
      await new Promise((r) => setTimeout(r, 100));
    }
    return -1;
  }, url);
}

/** Events and rrweb in the worker's ring for a tab (last `sinceMs`). Flushes the page first. */
export async function ring(sw: Worker, tabId: number, sinceMs = 120_000): Promise<RingSlice> {
  return (await sw.evaluate(
    async ({ tabId, sinceMs }) => {
      const svc = (globalThis as unknown as { __tb: { capture: { flushTabs(t: number[]): Promise<void>; ringInfo(t: number, s: number, f: boolean): Promise<{ slice: unknown }> } } }).__tb.capture;
      await svc.flushTabs([tabId]);
      return (await svc.ringInfo(tabId, sinceMs, true)).slice;
    },
    { tabId, sinceMs },
  )) as RingSlice;
}

export function byKind(slice: RingSlice, kind: string) {
  return slice.events.filter((e) => e.kind === kind);
}

/** Runs a method of the worker's CaptureService and returns its JSON-safe result. */
/**
 * Calls the capture service in the worker. Since the merge, the session belongs to ext-ui's
 * store (lib/bg/ui.ts): the session-changing methods go through `__tb.flow`, which runs ext-ui's
 * request handlers (and the editor's draft handlers) over the capture driver, as the product
 * does. Media-only methods (setReplay, prune, requestMic, drainAll) call the service directly.
 */
export async function svc<T = unknown>(sw: Worker, method: string, ...args: unknown[]): Promise<T> {
  return (await sw.evaluate(
    async ({ method, args }) => {
      type Fns = Record<string, (...a: unknown[]) => Promise<unknown>>;
      const tb = (globalThis as unknown as { __tb: { capture: Fns; flow: Fns } }).__tb;
      const s = method in tb.flow ? tb.flow : tb.capture;
      const r = await s[method]!.apply(s, args);
      return JSON.parse(JSON.stringify(r ?? null));
    },
    { method, args },
  )) as T;
}

/** The capture session as the product sees it (ext-ui's store). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function session(sw: Worker): Promise<{ state: string; [k: string]: any }> {
  return sw.evaluate(() => (globalThis as unknown as { __tb: { flow: { session(): Promise<{ state: string }> } } }).__tb.flow.session()) as never;
}

/** Reads a draft and the text of one of its blobs from IndexedDB in the worker. */
export async function draftWithBlobs(sw: Worker, draftId: string): Promise<{ draft: Record<string, unknown>; events: unknown[]; rrweb: unknown[]; blobSizes: Record<string, number> }> {
  return sw.evaluate(async (draftId) => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('nib');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const get = (store: string, key: IDBValidKey) =>
      new Promise<any>((res, rej) => {
        const r = db.transaction(store).objectStore(store).get(key);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const draft = await get('drafts', draftId);
    const text = async (id: string | null | undefined) => (id ? await ((await get('blobs', id))?.blob as Blob | undefined)?.text() : '') ?? '';
    const lines = (t: string) => t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const blobSizes: Record<string, number> = {};
    for (const k of ['screenshotBlobId', 'fullBlobId', 'videoBlobId', 'voiceBlobId', 'eventsBlobId', 'rrwebBlobId']) {
      const id = draft?.[k];
      if (id) blobSizes[k] = ((await get('blobs', id))?.blob as Blob | undefined)?.size ?? 0;
    }
    const events = lines(await text(draft?.eventsBlobId));
    const rrweb = lines(await text(draft?.rrwebBlobId));
    db.close();
    return { draft, events, rrweb, blobSizes };
  }, draftId);
}

/** PNG dimensions of a blob in the worker. */
export async function blobImageSize(sw: Worker, blobId: string): Promise<{ w: number; h: number }> {
  return sw.evaluate(async (id) => {
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open('nib');
      r.onsuccess = () => res(r.result);
    });
    const row: { blob: Blob } = await new Promise((res) => {
      const r = db.transaction('blobs').objectStore('blobs').get(id);
      r.onsuccess = () => res(r.result);
    });
    db.close();
    const bmp = await createImageBitmap(row.blob);
    return { w: bmp.width, h: bmp.height };
  }, blobId);
}

/** Saves a blob from the worker's IndexedDB to a local file (for ffprobe). */
export async function saveBlob(sw: Worker, blobId: string, file: string) {
  const b64 = await sw.evaluate(async (id) => {
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open('nib');
      r.onsuccess = () => res(r.result);
    });
    const row: { blob: Blob } = await new Promise((res) => {
      const r = db.transaction('blobs').objectStore('blobs').get(id);
      r.onsuccess = () => res(r.result);
    });
    db.close();
    const bytes = new Uint8Array(await row.blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, blobId);
  const fs = await import('node:fs');
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
