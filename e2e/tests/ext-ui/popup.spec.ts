// Popup: J-001, J-193, J-212, J-019, J-199, J-176, J-089, J-190, J-184, J-012, J-011, J-215,
// J-015, J-232, J-016, J-035, J-218, J-182, J-183, J-177 (menu), X-05 (signed-out state), X-07.
import { expect, test } from '../../fixtures/extension.ts';
import { AUTH, freshState, labPage, mockServer, openPopup, session, stats } from './helpers.ts';

test.beforeEach(async ({ sw }) => {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  await freshState(sw);
});

test('J-001 J-193: the popup lists screenshot, record and recording link under a header with home and menu, painted under 1.7 s', async ({ context }) => {
  const { page, tabId } = await labPage(context);
  const t0 = Date.now();
  const popup = await openPopup(context, tabId);
  expect(Date.now() - t0).toBeLessThan(1700);
  expect(await popup.evaluate(() => (globalThis as { __nibPopupPaintMs?: number }).__nibPopupPaintMs)).toBeLessThan(1700);
  await expect(popup.locator('[data-row]')).toHaveCount(3);
  await expect(popup.locator('[data-row]').nth(0)).toHaveAttribute('data-row', 'screenshot');
  await expect(popup.locator('[data-row]').nth(1)).toHaveAttribute('data-row', 'record');
  await expect(popup.locator('[data-row]').nth(2)).toHaveAttribute('data-row', 'link');
  await expect(popup.locator('[data-home]')).toBeVisible();
  await expect(popup.locator('[data-menu-button]')).toBeVisible();
  // rows are about 370x40, 8 px apart
  const r0 = (await popup.locator('[data-row]').nth(0).boundingBox())!;
  const r1 = (await popup.locator('[data-row]').nth(1).boundingBox())!;
  expect(r0.width).toBe(370);
  expect(r0.height).toBe(40);
  expect(r1.y - (r0.y + r0.height)).toBe(8);
  await popup.close();
  await page.close();
});

test('J-001: with instant replay on, a replay row joins the menu; J-182 the replay chord opens the replay draft', async ({ context, sw }) => {
  await freshState(sw, { settings: { instantReplay: true } });
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await expect(popup.locator('[data-row]')).toHaveCount(4);
  await expect(popup.locator('[data-row]').nth(2)).toHaveAttribute('data-row', 'replay');
  await popup.close();
  await sw.evaluate((id) => __tbUi.command('instant-replay', id), tabId);
  await expect.poll(async () => (await session(sw)).state).toBe('draft');
  expect((await session(sw)).kind).toBe('replay');
  await page.close();
});

test('J-212: hovering a row for 2 s shows its chord in a dark pill', async ({ context }) => {
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await popup.locator('[data-row-main="screenshot"]').hover();
  const tip = popup.locator('[data-row="screenshot"] [data-row-tip]');
  await popup.waitForTimeout(1200);
  await expect(tip).toHaveCount(0);
  await expect(tip).toHaveText('Ctrl+Shift+S', { timeout: 3000 });
  const bg = await tip.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(26, 25, 24)');
  await popup.close();
  await page.close();
});

test('J-183: a recording-link command exists with no default key', async ({ sw }) => {
  const cmds = await sw.evaluate(() => chrome.commands.getAll());
  const link = cmds.find((c) => c.name === 'recording-link');
  expect(link).toBeTruthy();
  expect(link!.shortcut ?? '').toBe('');
  expect(cmds.find((c) => c.name === 'screenshot-mode')!.shortcut).toBe('Ctrl+Shift+S');
  expect(cmds.find((c) => c.name === 'record-tab')!.shortcut).toBe('Ctrl+Shift+Space');
  expect(cmds.find((c) => c.name === 'instant-replay')!.shortcut).toBe('Ctrl+Shift+X');
  expect(cmds.find((c) => c.name === '_execute_action')!.shortcut).toBe('Ctrl+Shift+Y');
});

test('J-199: on chrome://extensions the popup shows the restricted state and the chords do nothing', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  await page.bringToFront();
  // without the tabs permission Chrome hides chrome:// URLs from the extension; the active tab is it
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!);
  const popup = await openPopup(context, tabId);
  await expect(popup.locator('[data-screen="restricted"]')).toBeVisible();
  await expect(popup.locator('[data-row]')).toHaveCount(0);
  await sw.evaluate((id) => __tbUi.command('screenshot-mode', id), tabId);
  await sw.evaluate((id) => __tbUi.command('record-tab', id), tabId);
  expect((await session(sw)).state).toBe('idle');
  expect((await stats(sw)).errors).toEqual([]);
  await popup.close();
  await page.close();
});

test('J-019: on our own server pages the record row offers full-screen recording instead of the tab', async ({ context, sw }) => {
  const server = await mockServer({ 'GET /': () => ({ ok: true }) });
  await freshState(sw, { auth: { serverUrl: server.url } });
  const page = await context.newPage();
  await page.goto(server.url);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: `${u}/*` }))[0]!.id!, server.url);
  const popup = await openPopup(context, tabId);
  await expect(popup.locator('[data-row-main="record"]')).toHaveText(/Record full screen/);
  await popup.close();
  const { page: lab, tabId: labTab } = await labPage(context);
  const popup2 = await openPopup(context, labTab);
  await expect(popup2.locator('[data-row-main="record"]')).toHaveText(/Record this tab/);
  await popup2.close();
  await lab.close();
  await page.close();
  await server.close();
});

test('X-05: signed out, the popup shows sign in instead of the capture rows', async ({ context, sw }) => {
  await freshState(sw, { auth: null });
  await sw.evaluate(() => __tbUi.stub('auth.signIn', { ok: false, error: 'not_implemented' }));
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await expect(popup.locator('[data-screen="signed-out"]')).toBeVisible();
  await expect(popup.locator('[data-row]')).toHaveCount(0);
  await expect(popup.locator('[data-sign-in]')).toBeVisible();
  await popup.close();
  await page.close();
});

test('J-176 J-089 J-190 J-184: settings replace the body, scroll inside the popup, toggles save at once, shortcuts open Chrome\'s editor', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await popup.locator('[data-menu-button]').click();
  await expect(popup.locator('[data-menu-item]')).toHaveCount(6);
  await popup.locator('[data-menu-item="settings"]').click();
  await expect(popup.locator('[data-screen="settings"]')).toBeVisible();
  await expect(popup.locator('[data-row]')).toHaveCount(0);
  for (const label of ['Open captures in a new tab', 'Capture clicks and typing', 'Instant replay', 'Send error reports'])
    await expect(popup.getByRole('switch', { name: label })).toBeVisible();
  await expect(popup.locator('[data-open-shortcuts]')).toBeVisible();
  await expect(popup.locator('[data-reset]')).toBeVisible();
  const read = () => sw.evaluate(async () => (await chrome.storage.local.get('nib:settings'))['nib:settings'] as Record<string, unknown>);

  await popup.getByRole('switch', { name: 'Open captures in a new tab' }).click();
  await expect.poll(async () => (await read()).openInNewTab).toBe(false);
  await popup.getByRole('switch', { name: 'Capture clicks and typing' }).click();
  await expect.poll(async () => (await read()).captureUserEvents).toBe(false);
  await popup.getByRole('switch', { name: 'Send error reports' }).click();
  await expect.poll(async () => (await read()).sendErrorLogs).toBe(false);

  const tabP = context.waitForEvent('page');
  await popup.locator('[data-open-shortcuts]').click();
  const shortcuts = await tabP;
  await expect.poll(() => shortcuts.url()).toContain('chrome://extensions/shortcuts');
  await shortcuts.close();

  // reset needs a second click on the same button
  await popup.locator('[data-reset]').click();
  await expect(popup.locator('[data-reset]')).toHaveText('Confirm reset');
  await popup.locator('[data-reset]').click();
  await expect.poll(async () => (await read()).openInNewTab).toBe(true);
  await popup.close();
  await page.close();
});

test('J-012: with replay on, the blocked-sites list ships with defaults, adds a domain and deletes one by its trash icon', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await popup.locator('[data-menu-button]').click();
  await popup.locator('[data-menu-item="settings"]').click();
  await expect(popup.locator('[data-open-sites]')).toHaveCount(0);
  await popup.getByRole('switch', { name: 'Instant replay' }).click();
  await popup.locator('[data-open-sites]').click();
  const rows = popup.locator('[data-site]');
  expect(await rows.count()).toBeGreaterThan(50);
  await expect(popup.locator('[data-site="paypal.com"]')).toBeVisible();
  await popup.locator('[data-site-input]').fill('https://www.Example-Bank.com/login');
  await popup.locator('[data-site-add]').click();
  await expect(popup.locator('[data-site="example-bank.com"]')).toBeVisible();
  await popup.locator('[data-site-remove="paypal.com"]').click();
  await expect(popup.locator('[data-site="paypal.com"]')).toHaveCount(0);
  const saved = await sw.evaluate(async () => ((await chrome.storage.local.get('nib:settings'))['nib:settings'] as { replayBlockedSites: string[] }).replayBlockedSites);
  expect(saved).toContain('example-bank.com');
  expect(saved).not.toContain('paypal.com');
  await popup.close();
  await page.close();
});

test('J-012: on a blocked site the replay row is off', async ({ context, sw }) => {
  await freshState(sw, { settings: { instantReplay: true, replayBlockedSites: ['localhost'] } });
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await expect(popup.locator('[data-row="replay"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(popup.locator('[data-replay-badge="blocked"]')).toBeVisible();
  await popup.close();
  await page.close();
});

test('J-011: on a heavy page the replay row shows a badge; clicking opens a warning; continue enables replay for this load', async ({ context, sw }) => {
  await freshState(sw, { settings: { instantReplay: true } });
  const { page, tabId } = await labPage(context, '/list');
  await sw.evaluate(async (id) => {
    await chrome.storage.session.set({ 'nib:replay': { enabled: true, minutes: 2, tabs: { [id]: { since: Date.now(), video: false, heavy: true } } } });
    __tbUi.stub('replay.set', { ok: true, replay: { enabled: true, minutes: 2, tabs: {} } });
  }, tabId);
  const popup = await openPopup(context, tabId);
  await expect(popup.locator('[data-replay-badge="heavy"]')).toBeVisible();
  await popup.locator('[data-row-main="replay"]').click();
  await expect(popup.locator('[data-screen="heavy"]')).toBeVisible();
  await popup.locator('[data-heavy-continue]').click();
  await expect(popup.locator('[data-screen="main"]')).toBeVisible();
  await expect(popup.locator('[data-replay-badge="heavy"]')).toHaveCount(0);
  await popup.close();
  await page.close();
});

test('J-215: on popup open the account replay setting is pulled from the server', async ({ context, sw }) => {
  const server = await mockServer({
    'GET /api/v1/me/settings': () => ({
      notifications: {},
      extension: { instantReplay: true, replayMinutes: 3, replayVideo: false, replayBlockedSites: [], openInNewTab: true, captureUserEvents: true, sendErrorLogs: true, screenshotDelaySec: 0, recordMode: 'tab', mic: false, micDeviceId: null },
      editor: {},
      viewer: {},
    }),
    'PATCH /api/v1/me/settings': (b) => b,
  });
  await freshState(sw, { auth: { serverUrl: server.url } });
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await expect(popup.locator('[data-row="replay"]')).toBeVisible();
  const local = await sw.evaluate(async () => (await chrome.storage.local.get('nib:settings'))['nib:settings'] as { instantReplay: boolean; replayMinutes: number });
  expect(local.instantReplay).toBe(true);
  expect(local.replayMinutes).toBe(3);
  const get = server.hits.find((h) => h.method === 'GET');
  expect(get?.auth).toBe(`Bearer ${AUTH.token}`);

  // a toggle in this browser goes to the account
  await popup.locator('[data-menu-button]').click();
  await popup.locator('[data-menu-item="settings"]').click();
  await popup.getByRole('switch', { name: 'Instant replay' }).click();
  await expect.poll(() => server.hits.filter((h) => h.method === 'PATCH').map((h) => h.body)).toContainEqual({ extension: { instantReplay: false } });
  await popup.close();
  await page.close();
  await server.close();
});

test('J-015 J-232: the recording-link form shows the domain with a red dot and a ticked menu, picks a folder, creates and copies the link', async ({ context, sw }) => {
  const ws = AUTH.activeWorkspaceId;
  const link = { id: '019a0000-0000-7000-8000-00000000e2f0', workspaceId: ws, name: 'Checkout reports', url: 'http://localhost:3103/rl/abcDEF123', folder: null, recorderDomain: null, ref: null, createdBy: null, createdAt: new Date().toISOString(), uses: 0, lastUsedAt: null, status: 'active', thumbs: [] };
  const server = await mockServer({
    [`GET /api/v1/workspaces/${ws}/folders`]: () => ({ items: [{ id: '019a0000-0000-7000-8000-0000000000f1', name: 'Checkout bugs' }] }),
    [`POST /api/v1/workspaces/${ws}/recording-links`]: (b) => ({ ...link, ...(b as object) }),
  });
  await freshState(sw, { auth: { serverUrl: server.url } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await popup.locator('[data-row-main="link"]').click();
  await expect(popup.locator('[data-screen="link"]')).toBeVisible();
  await expect(popup.locator('[data-link-name]')).toBeFocused();
  await expect(popup.locator('[data-link-domain]')).toContainText(new URL(server.url).host);
  const dot = popup.locator('[data-domain-status="default"]');
  expect(await dot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(194, 46, 31)');
  await popup.locator('[data-link-domain]').click();
  await expect(popup.locator('[data-domain-menu] [aria-checked="true"]')).toContainText(new URL(server.url).host);
  await popup.locator('[data-domain-menu] [aria-checked="true"]').click();
  await popup.locator('[data-link-name]').fill('Checkout reports');
  await popup.locator('[data-link-folder]').selectOption({ label: 'Checkout bugs' });
  await popup.locator('[data-link-create]').click();
  await expect(popup.locator('[data-link-url]')).toHaveValue(link.url);
  const post = server.hits.find((h) => h.method === 'POST')!;
  expect(post.body).toMatchObject({ name: 'Checkout reports', folderId: '019a0000-0000-7000-8000-0000000000f1' });
  expect(await popup.evaluate(() => navigator.clipboard.readText())).toBe(link.url);
  await expect(popup.locator('[data-link-copy]')).toHaveText(/Copied/);
  await popup.close();
  await page.close();
  await server.close();
});

test('J-016: the help icon on the link row opens a three-card carousel paged with next', async ({ context }) => {
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await popup.locator('[data-link-help]').click();
  await expect(popup.locator('[data-help-card="1"]')).toBeVisible();
  await popup.locator('[data-help-next]').click();
  await expect(popup.locator('[data-help-card="2"]')).toBeVisible();
  await popup.locator('[data-help-next]').click();
  await expect(popup.locator('[data-help-card="3"]')).toBeVisible();
  await expect(popup.locator('[data-help-next]')).toHaveCount(0);
  await popup.locator('[data-help-done]').click();
  await expect(popup.locator('[data-screen="link"]')).toBeVisible();
  await popup.close();
  await page.close();
});

const drafts = (now: number) => [
  { id: 'd-video', kind: 'video', createdAt: now - 120_000, updatedAt: now - 120_000, host: 'localhost:5173', pageUrl: 'http://localhost:5173/', pageTitle: 'Lab', title: '', durationMs: 8000, thumbBlobId: null, recordingId: 'r1', status: 'saved' },
  { id: 'd-shot', kind: 'screenshot', createdAt: now - 3 * 3600_000, updatedAt: now - 3 * 3600_000, host: 'example.com', pageUrl: 'https://example.com/', pageTitle: 'Example', title: '', durationMs: null, thumbBlobId: null, recordingId: null, status: 'saved' },
];

test('J-035: with a draft open, the header pill counts drafts and only the link row is live; after save-for-later the rows return and the pill opens Drafts', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await sw.evaluate(
    async ({ list, tabId }) => {
      await chrome.storage.local.set({ 'nib:drafts': list });
      await __tbUi.dispatch({ type: 'DRAFT_READY', draftId: 'd-video', kind: 'video', recordingId: 'r1', tabId });
    },
    { list: drafts(Date.now()), tabId },
  );
  const popup = await openPopup(context, tabId);
  const pill = popup.locator('[data-drafts-pill]');
  await expect(pill).toHaveText('2');
  await expect(pill).toBeDisabled();
  await expect(popup.locator('[data-row="screenshot"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(popup.locator('[data-row="record"]')).toHaveAttribute('aria-disabled', 'true');
  await expect(popup.locator('[data-row="link"]')).toHaveAttribute('aria-disabled', 'false');

  await sw.evaluate(() => __tbUi.dispatch({ type: 'SAVE_FOR_LATER' }));
  await expect(popup.locator('[data-row="screenshot"]')).toHaveAttribute('aria-disabled', 'false');
  await expect(pill).toBeEnabled();
  await pill.click();
  await expect(popup.locator('[data-screen="drafts"]')).toBeVisible();
  await popup.close();
  await page.close();
});

test('J-218: Drafts lists thumbnail, host and age with view and trash; trash turns into confirm and a second click deletes', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await sw.evaluate(
    async (list) => {
      await chrome.storage.local.set({ 'nib:drafts': list });
      __tbUi.stub('draft.discard', { ok: true });
      __tbUi.stub('draft.open', { ok: true });
    },
    drafts(Date.now()),
  );
  const popup = await openPopup(context, tabId);
  await popup.locator('[data-drafts-pill]').click();
  const rows = popup.locator('[data-draft]');
  await expect(rows).toHaveCount(2);
  const first = rows.first();
  await expect(first).toContainText('localhost:5173');
  await expect(first).toContainText('2 min ago');
  await expect(rows.nth(1)).toContainText('3 h ago');
  const box = (await first.boundingBox())!;
  expect(box.height).toBe(70);
  const thumb = (await first.locator('.thumb').boundingBox())!;
  expect([thumb.width, thumb.height]).toEqual([66, 50]);
  await expect(first.locator('[data-draft-view]')).toBeVisible();

  const trash = popup.locator('[data-draft-trash="d-shot"]');
  await trash.click();
  await expect(trash).toHaveText('Delete');
  expect(await trash.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(194, 46, 31)');
  await trash.click();
  await expect(rows).toHaveCount(1);
  await popup.locator('[data-draft-view="d-video"]').click().catch(() => undefined);
  await page.close();
});

test('J-014: the mic pill in the record row turns the microphone on and off', async ({ context, sw }) => {
  await sw.evaluate(() => __tbUi.stub('mic.request', { ok: true, granted: true }));
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  const pill = popup.locator('[data-mic-pill]');
  await expect(pill).toHaveAttribute('data-mic-pill', 'off');
  const pb = (await pill.boundingBox())!;
  expect(pb.height).toBe(22);
  await pill.click();
  await expect(pill).toHaveAttribute('data-mic-pill', 'on');
  await pill.click();
  await expect(pill).toHaveAttribute('data-mic-pill', 'off');
  await popup.close();
  await page.close();
});

test('J-007 groundwork: the record chevron switches to desktop and the choice sticks for the next popup', async ({ context }) => {
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await popup.locator('[data-row-chevron="record"]').click();
  await popup.locator('[data-row-options="record"] [data-value="desktop"]').click();
  await expect(popup.locator('[data-row-main="record"]')).toHaveText(/Record full screen/);
  await popup.close();
  const again = await openPopup(context, tabId);
  await expect(again.locator('[data-row-main="record"]')).toHaveText(/Record full screen/);
  await expect(again.locator('[data-row-options="record"]')).toHaveCount(0);
  await again.close();
  await page.close();
});

test('X-07: the popup renders with the shared tokens in light and dark', async ({ context }) => {
  const { page, tabId } = await labPage(context);
  const popup = await openPopup(context, tabId);
  await popup.emulateMedia({ colorScheme: 'light' });
  expect(await popup.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
  await popup.emulateMedia({ colorScheme: 'dark' });
  expect(await popup.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(26, 25, 24)');
  await popup.screenshot({ path: 'test-results/popup-dark.png' });
  await popup.emulateMedia({ colorScheme: 'light' });
  await popup.screenshot({ path: 'test-results/popup-light.png' });
  await popup.close();
  await page.close();
});

test('empty and error states: no drafts, and a link create with the server down', async ({ context, sw }) => {
  const { page, tabId } = await labPage(context);
  await sw.evaluate(() => chrome.storage.local.set({ 'nib:drafts': [{ id: 'gone', kind: 'screenshot', createdAt: 0, updatedAt: 0, host: 'a.com', pageUrl: '', pageTitle: '', title: '', durationMs: null, thumbBlobId: null, recordingId: null, status: 'saved' }] }));
  await sw.evaluate(() => __tbUi.stub('draft.discard', { ok: true }));
  const popup = await openPopup(context, tabId);
  await popup.locator('[data-drafts-pill]').click();
  await popup.locator('[data-draft-trash="gone"]').click();
  await popup.locator('[data-draft-trash="gone"]').click();
  await expect(popup.locator('[data-drafts-empty]')).toBeVisible();
  await popup.locator('[data-back]').click();
  await popup.locator('[data-row-main="link"]').click();
  await popup.locator('[data-link-create]').click();
  await expect(popup.locator('[data-link-error]')).toHaveText('The server did not answer');
  await popup.close();
  await page.close();
});
