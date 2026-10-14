import { BOOT } from './boot.ts';
import { EXT_ID, LAB_URL, SERVER_URL, expect, test, type TbHooks } from '../fixtures/extension.ts';
import { UI_HOST_TAG } from '@toolbar/shared/constants';

declare const __tb: TbHooks;

test('extension loads with the pinned id and registers its capture scripts', async ({ sw }) => {
  expect(new URL(sw.url()).host).toBe(EXT_ID);
  const ids = await sw.evaluate(() => __tb.ready());
  expect(ids.sort()).toEqual(['capture', 'capture-main']);
});

test('content script hooks run on the lab app', async ({ context, sw }) => {
  await sw.evaluate(() => __tb.ready());
  const page = await context.newPage();
  await page.goto(LAB_URL);

  // MAIN world: the boot marker is set before any page script runs.
  const boot = await page.evaluate((key) => (window as unknown as Record<symbol, unknown>)[Symbol.for(key)], BOOT);
  expect(boot).toMatchObject({ ctx: 'top', readyState: 'loading', failed: [] });
  expect((boot as { hooks: string[] }).hooks).toEqual(
    expect.arrayContaining(['errors', 'console', 'network', 'websocket', 'eventsource', 'history']),
  );

  // ISOLATED world: the toolbar host is mounted; the test build renders its shadow root open.
  const host = page.locator(UI_HOST_TAG);
  await expect(host).toHaveCount(1);
  await expect(page.locator(`${UI_HOST_TAG} [data-nb-ui]`)).toHaveCount(1);
  const reset = await host.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { position: cs.position, zIndex: cs.zIndex };
  });
  expect(reset).toEqual({ position: 'fixed', zIndex: '2147483647' });

  // MAIN -> ISOLATED -> service worker: the boot nav event arrived.
  await expect
    .poll(async () => sw.evaluate(() => __tb.stats()), { timeout: 10_000 })
    .toMatchObject({ byKind: { nav: expect.any(Number) }, pages: expect.arrayContaining([expect.stringContaining(LAB_URL)]) });
  const navs = (await sw.evaluate(() => __tb.events())) as { kind: string; data: { url: string } }[];
  // other specs in the same worker may have loaded pages before: look for the lab's own nav
  expect(navs.some((e) => e.kind === 'nav' && e.data.url.includes(LAB_URL))).toBe(true);
  await page.close();
});

test('server health reports db and s3 ok', async ({ request }) => {
  const res = await request.get(`${SERVER_URL}/api/health`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, checks: { db: { ok: true }, s3: { ok: true } } });
});
