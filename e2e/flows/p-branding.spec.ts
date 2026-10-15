// Instance branding (D-112, D-113): the server writes its brand into the first HTML, the signed-in
// extension keeps the server's brand and shows its name on the toolbar icon and in the popup,
// and Settings > Server is hidden from people who are not the instance admin.
import { SERVER, api, expect, labPage, openPopup, test } from './fixture.ts';

test('P: branded first paint, the extension follows the server brand, Server settings admin only', async ({ tb, context }) => {
  // server HTML before any script: favicons and the site name
  const html = await (await fetch(`${SERVER}/login`)).text(); // signed out
  const brand = (await api<{ name: string; version: string; logo: { icons: Record<string, string> } }>(context, 'GET', '/api/v1/branding')).body;
  expect(html).toContain(`<link rel="icon" href="/brand/icon-32.png?v=${brand.version}"`);
  expect(html).toContain(`<title>Sign in · ${brand.name}</title>`);
  const icon = await context.request.get(brand.logo.icons['32']!);
  expect(icon.headers()['content-type']).toBe('image/png');

  // the extension stored this version of the brand at sign-in and titled its icon with it
  const sw = await tb.sw();
  await expect
    .poll(() => sw.evaluate(async () => ((await chrome.storage.local.get('tb:branding'))['tb:branding'] as { version?: string } | undefined)?.version ?? null), { timeout: 15_000 })
    .toBe(brand.version);
  const stored = await sw.evaluate(async () => (await chrome.storage.local.get('tb:branding'))['tb:branding'] as { name: string; icons: Record<string, string> });
  expect(stored.name).toBe(brand.name);
  expect(stored.icons['16']).toMatch(/^data:image\/png;base64,/);
  expect(await sw.evaluate(() => chrome.action.getTitle({}))).toBe(brand.name);

  const lab = await labPage(context);
  const popup = await openPopup(context, lab);
  await expect(popup.locator('[data-brand-name]')).toHaveText(brand.name);
  await popup.close();
  await lab.close();

  // this account is not the server's first account and not in ADMIN_EMAILS
  const web = await context.newPage();
  const res = await web.goto(`${SERVER}/settings/server`);
  expect(res?.status()).toBe(404);
  await web.goto(`${SERVER}/settings/profile`);
  await expect(web.getByTestId('settings-nav-server')).toHaveCount(0);
  await web.close();
});
