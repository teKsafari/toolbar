// J-018 with the real extension: on the server's pages the content script marks <html>, and the
// dashboard's new-capture button opens the extension popup (its capture menu).
// Needs the test build: pnpm --filter @toolbar/extension build:test.
import { EXT_ID, expect, test } from '../../fixtures/extension.ts';
import { SERVER, go, signIn, uniqueEmail } from './helpers.ts';

declare const chrome: { storage: { local: { set(v: Record<string, unknown>): Promise<void> } } };

test('J-018: new capture in the dashboard header opens the extension popup', async ({ context, sw }) => {
  // Point the extension at this area's server, whatever the build defaulted to.
  await sw.evaluate((url) => chrome.storage.local.set({ 'nib:server-url': url }), SERVER);
  const page = await context.newPage();
  await signIn(page, uniqueEmail(undefined, 'newcap'));
  await go(page, '/');
  await expect(page.locator('html')).toHaveAttribute('data-nib-extension', /.+/);

  // Other origins are left alone.
  const other = await context.newPage();
  await other.goto(`${SERVER.replace('localhost', '127.0.0.1')}/login`);
  expect(await other.locator('html').getAttribute('data-nib-extension')).toBeNull();
  await other.close();

  await page.bringToFront();
  const popup = context.waitForEvent('page', { predicate: (p) => p.url().startsWith(`chrome-extension://${EXT_ID}/popup.html`), timeout: 10_000 }).catch(() => null);
  await page.getByTestId('new-capture').first().click();
  await expect(page.getByTestId('new-capture-help')).toBeHidden();
  await expect
    .poll(() => sw.evaluate(() => (globalThis as unknown as { __tbDashboard: { newCaptures(): { opened: boolean; error: string | null }[] } }).__tbDashboard.newCaptures()), { timeout: 10_000 })
    .toEqual([expect.objectContaining({ opened: true, error: null })]);
  const p = await popup;
  if (p) await expect(p.locator('body')).not.toBeEmpty();
});
