// Screenshots, pre-capture logs, custom metadata, and the uploader against the contract
// (mock server): nothing leaves before create, create uploads everything, retries, discard.
import { LAB_URL, blobImageSize, draftWithBlobs, expect, session, sleep, svc, tabIdOf, test } from './helpers.ts';

interface DraftLike {
  id: string;
  kind: string;
  screenshotBlobId: string | null;
  fullBlobId: string | null;
  crop: unknown;
  keepFull: boolean;
  pageUrl: string;
  metadata: Record<string, unknown> | null;
  env: Record<string, unknown> | null;
  clientId: string;
}

test('viewport screenshot: 1x CSS pixels, draft in under 1.3 s, logs from before the shot (J-002, J-071, J-194)', async ({ context, sw, mock }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.getByTestId('hidden-500').click();
  await page.getByTestId('throws').click();
  await sleep(3000); // the check waits 20 s; the ring keeps 2 minutes
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const t0 = Date.now();
  const draft = await svc<DraftLike>(sw, 'takeScreenshot', null, { tabId, openEditor: false });
  const ms = Date.now() - t0;
  expect(ms).toBeLessThan(1300);
  expect(draft).toMatchObject({ kind: 'screenshot', crop: null, fullBlobId: null, pageUrl: `${LAB_URL}/` });
  expect(await blobImageSize(sw, draft.screenshotBlobId!)).toEqual(vp);
  const { events } = await draftWithBlobs(sw, draft.id);
  const ev = events as { kind: string; data: Record<string, unknown> }[];
  expect(ev.some((e) => e.kind === 'net.res' && e.data.status === 500)).toBe(true);
  expect(ev.some((e) => e.kind === 'error' && e.data.name === 'TypeError')).toBe(true);
  expect(ev.at(-1)).toMatchObject({ kind: 'marker', data: { type: 'screenshot' } });
  expect(draft.env).toMatchObject({ browser: { name: 'Chrome' }, incognito: false, extVersion: expect.any(String) });
  expect(await session(sw)).toMatchObject({ state: 'draft', draftId: draft.id });
  // J-189: nothing reached the server
  expect(mock.log).toEqual([]);
  await svc(sw, 'discardDraft', draft.id);
  expect(await session(sw)).toMatchObject({ state: 'idle' });
  // the pre-capture buffer restarts after each capture (J-071, as observed)
  const second = await svc<DraftLike>(sw, 'takeScreenshot', null, { tabId, openEditor: false });
  const ev2 = (await draftWithBlobs(sw, second.id)).events as { kind: string; data: Record<string, unknown> }[];
  expect(ev2.some((e) => e.kind === 'net.res' && e.data.status === 500)).toBe(false);
  await svc(sw, 'discardDraft', second.id);
  await page.close();
});

test('area screenshot keeps the full viewport; crop follows the spike rules (J-003 data, J-004)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  const r = await page.getByTestId('hidden-500').boundingBox();
  const rect = { x: r!.x, y: r!.y, w: r!.width, h: r!.height };
  const draft = await svc<DraftLike>(sw, 'takeScreenshot', rect, { tabId, openEditor: false });
  expect(draft.crop).toEqual(rect);
  expect(draft.keepFull).toBe(true);
  const crop = await blobImageSize(sw, draft.screenshotBlobId!);
  expect(crop.w).toBeGreaterThanOrEqual(Math.floor(rect.w));
  expect(crop.w).toBeLessThanOrEqual(Math.ceil(rect.w) + 1);
  expect(crop.h).toBeGreaterThanOrEqual(Math.floor(rect.h));
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  expect(await blobImageSize(sw, draft.fullBlobId!)).toEqual(vp);
  await svc(sw, 'discardDraft', draft.id);
  await page.close();
});

test('custom metadata from window.toolbar.setMetadata; over 10 KB is rejected (J-073)', async ({ context, sw, mock: _ }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.evaluate(() => (window as unknown as { toolbar: { setMetadata(f: () => unknown): void } }).toolbar.setMetadata(() => ({ plan: 'x', userId: 7 })));
  const d1 = await svc<DraftLike>(sw, 'takeScreenshot', null, { tabId, openEditor: false });
  expect(d1.metadata).toEqual({ plan: 'x', userId: 7 });
  await svc(sw, 'discardDraft', d1.id);
  await page.evaluate(() => (window as unknown as { nib: { setMetadata(f: () => unknown): void } }).nib.setMetadata(() => ({ blob: 'x'.repeat(11_000) })));
  const d2 = await svc<DraftLike>(sw, 'takeScreenshot', null, { tabId, openEditor: false });
  expect(d2.metadata).toBeNull();
  const ev = (await draftWithBlobs(sw, d2.id)).events as { kind: string; data: { args?: unknown[] } }[];
  expect(ev.some((e) => e.kind === 'console' && String(e.data.args?.[0]).includes('too_large'))).toBe(true);
  await svc(sw, 'discardDraft', d2.id);
  await page.close();
});

test('create uploads assets, gzip NDJSON events and finalizes; chunk PUTs retry (J-086 data path, J-087, J-189, X-01 client)', async ({ context, sw, mock }) => {
  const page = await context.newPage();
  await page.goto(LAB_URL);
  const tabId = await tabIdOf(sw, page);
  await page.evaluate(async () => {
    document.cookie = 'lab_session=cookie-secret-value; path=/';
    await fetch('/api/ok?q=before-shot', { headers: { authorization: 'Bearer header-secret-value' } });
  });
  await page.getByTestId('hidden-500').click();
  await sleep(300);
  const r = await page.getByTestId('works').boundingBox();
  const draft = await svc<DraftLike>(sw, 'takeScreenshot', { x: r!.x, y: r!.y, w: r!.width, h: r!.height }, { tabId, openEditor: false });
  await page.evaluate(() => (window as unknown as { toolbar: { setMetadata(f: () => unknown): void } }).toolbar.setMetadata(() => ({ plan: 'pro' })));
  expect(mock.log).toEqual([]); // J-189: nothing before create
  mock.failNextPuts(2); // two 503s: the queue retries with backoff
  const res = await svc<{ recordingId: string; shareUrl: string; status: string }>(sw, 'createFromDraft', draft.id, { title: 'Hidden 500 on submit', description: 'Order looks saved but the API failed.' });
  expect(res.shareUrl).toContain(res.recordingId);
  const cap = mock.captures.get(res.recordingId)!;
  expect(cap.body).toMatchObject({ clientId: draft.clientId, kind: 'screenshot', page: { url: `${LAB_URL}/` }, source: 'extension' });
  expect(cap.finalized).toMatchObject({ title: 'Hidden 500 on submit', screenshotAssetId: expect.any(String), fullScreenshotAssetId: expect.any(String) });
  expect(mock.assets.get(String(cap.finalized!.screenshotAssetId))).toMatchObject({ kind: 'crop', recordingId: res.recordingId });
  expect(mock.assets.get(String(cap.finalized!.fullScreenshotAssetId))).toMatchObject({ kind: 'screenshot' });
  expect(cap.completed.events).toMatchObject({ lastSeq: 0 });
  const events = mock.ndjson(res.recordingId, 'events') as { kind: string; data: Record<string, unknown> }[];
  expect(events.some((e) => e.kind === 'net.res' && e.data.status === 500)).toBe(true);
  const raw = JSON.stringify(events);
  expect(raw).not.toContain('cookie-secret-value');
  expect(raw).not.toContain('header-secret-value');
  const order = mock.log.map((l) => `${l.route}:${l.status}`);
  expect(order[0]).toBe('captures.create:201');
  expect(order.filter((o) => o.startsWith('captures.putChunk:503'))).toHaveLength(2);
  expect(order.at(-1)).toBe('captures.finalize:200');
  expect(mock.log.every((l) => l.auth === 'Bearer tb_dev_e2e_capture')).toBe(true);
  // the upload queue is empty afterwards
  expect(await sw.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res) => {
      const r = indexedDB.open('nib');
      r.onsuccess = () => res(r.result);
    });
    const n = await new Promise<number>((res) => {
      const r = db.transaction('uploads').objectStore('uploads').count();
      r.onsuccess = () => res(r.result);
    });
    db.close();
    return n;
  })).toBe(0);
  await page.close();
});
