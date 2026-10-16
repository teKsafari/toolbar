// Close-out of the rows that were partial after the merge, against a real server (SERVER_URL,
// e.g. the dev server or compose) with the extension's test build. GitHub and Slack are local
// stand-ins the workspace connects to with a token or webhook URL; mail goes to Mailpit.
//   J-011 heavy-page guard, J-012 blocked sites get no ring, J-089 open-in-new-tab off,
//   J-137 send to tracker at create, J-140 tracker field form, J-138 send from the capture page,
//   J-136 first-view mail through the capture page, J-177 report a problem, J-219 save for later
//   from the Drafts list, J-200 link recorder with a refused microphone.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type FrameLocator, type Page, type Worker } from '@playwright/test';
import { test, DISPLAY, EXT_ID, LAB_URL } from '../../fixtures/extension.ts';
import { ring, tabIdOf } from '../capture/helpers.ts';
import { openPopup } from '../ext-ui/helpers.ts';
import { openEditorInPage, seedDraft, getDraft } from '../editor/helpers.ts';
import { launch, json } from '../dashboard/helpers.ts';
import { hydrated, mailTo } from '../auth/helpers.ts';
import { SERVER, account, clipboard, connectGithub, connectSlack, expect, githubMock, setExtSettings, signInExtension, slackMock, type Account, type GitHubMock } from './helpers.ts';
import { featureOn, skipUnlessFeature } from '../../fixtures/features.ts';
import { browserEnv } from '../../fixtures/browser-env.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

const VIDEO = fs.readFileSync(path.resolve(import.meta.dirname, '../../../apps/server/fixtures/tab-video.webm')).toString('base64');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test.describe.configure({ mode: 'serial', timeout: 120_000 });

let browser: Browser;
let acct: Account;

test.beforeAll(async () => {
  browser = await launch();
  acct = await account(browser, 'rows');
});
test.afterAll(async () => {
  await browser?.close();
});

const heavyOf = (sw: Worker, tabId: number) =>
  sw.evaluate(async (id) => !!((await chrome.storage.session.get('tb:replay'))['tb:replay'] as { tabs?: Record<number, { heavy?: boolean }> } | undefined)?.tabs?.[id]?.heavy, tabId);

/** rrweb records the ring took for a tab in the last `ms`. */
const recentRrweb = async (sw: Worker, tabId: number, ms: number) => (await ring(sw, tabId, ms)).rrweb.length;

async function labTab(context: import('@playwright/test').BrowserContext, sw: Worker, p = '/') {
  const page = await context.newPage();
  await page.goto(LAB_URL + p);
  await page.locator('toolbar-root').waitFor({ state: 'attached' });
  return { page, tabId: await tabIdOf(sw, page) };
}

test('J-011: on /list over the lab threshold the ring pauses, the popup badge opens the warning, continue runs replay for this page load only', async ({ context, sw }) => {
  await signInExtension(sw, acct);
  await sw.evaluate(() => chrome.storage.local.set({ 'tb:heavy-thresholds': { nodes: 1000 } }));
  await setExtSettings(sw, { instantReplay: true, replayBlockedSites: [] });
  try {
    const { page, tabId } = await labTab(context, sw, '/list');
    await expect.poll(() => heavyOf(sw, tabId), { timeout: 10_000 }).toBe(true);
    await sleep(1500);
    expect(await recentRrweb(sw, tabId, 1200)).toBe(0);

    const popup = await openPopup(context, tabId);
    await expect(popup.locator('[data-replay-badge="heavy"]')).toBeVisible();
    await popup.locator('[data-row-main="replay"]').click();
    await expect(popup.locator('[data-screen="heavy"]')).toBeVisible();
    await popup.locator('[data-heavy-continue]').click();
    await expect(popup.locator('[data-screen="main"]')).toBeVisible();
    await expect(popup.locator('[data-replay-badge="heavy"]')).toHaveCount(0);
    await popup.close();

    // the ring runs again: a full snapshot, then changes as the person clicks
    await expect.poll(() => recentRrweb(sw, tabId, 10_000), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Item 3', exact: true }).click();
    // later weight reports on the same load leave it on
    await sleep(6500);
    expect(await heavyOf(sw, tabId)).toBe(false);
    expect(await recentRrweb(sw, tabId, 3000)).toBeGreaterThan(0);

    // a reload is a new page load: paused again
    await page.reload();
    await expect.poll(() => heavyOf(sw, tabId), { timeout: 10_000 }).toBe(true);

    // a light page in the same tab keeps its ring
    await page.goto(LAB_URL);
    await sleep(3000);
    expect(await heavyOf(sw, tabId)).toBe(false);
    expect(await recentRrweb(sw, tabId, 3000)).toBeGreaterThan(0);
    await page.close();
  } finally {
    await sw.evaluate(() => chrome.storage.local.remove('tb:heavy-thresholds'));
    await setExtSettings(sw, { instantReplay: false });
  }
});

test('J-012: a blocked domain gets no ring buffer, and unblocking it starts the ring on the open page', async ({ context, sw }) => {
  await signInExtension(sw, acct);
  await setExtSettings(sw, { instantReplay: true, replayBlockedSites: ['localhost'] });
  try {
    const { page, tabId } = await labTab(context, sw);
    await page.getByTestId('throws').click();
    await sleep(2500);
    expect(await recentRrweb(sw, tabId, 3000)).toBe(0);
    const popup = await openPopup(context, tabId);
    await expect(popup.locator('[data-replay-badge="blocked"]')).toBeVisible();
    await popup.close();

    await setExtSettings(sw, { replayBlockedSites: [] });
    await expect.poll(() => recentRrweb(sw, tabId, 5000), { timeout: 8000 }).toBeGreaterThan(0);
    // blocking it again stops the ring on the open page
    await setExtSettings(sw, { replayBlockedSites: ['example.org', 'localhost'] });
    await sleep(1500);
    await page.getByTestId('throws').click();
    await sleep(1500);
    expect(await recentRrweb(sw, tabId, 1200)).toBe(0);
    await page.close();
  } finally {
    await setExtSettings(sw, { instantReplay: false, replayBlockedSites: [] });
  }
});

/** Tabs other than the extension's own pages, from the worker. */
/**
 * The editor has its workspaces, folders and integrations (the workspace button enables then).
 * A click on the destination menu while they arrive could land on a re-render and leave it shut.
 */
const booted = (f: FrameLocator) => expect(f.getByTestId('workspace')).toBeEnabled({ timeout: 15_000 });
const webTabs = (sw: Worker) => sw.evaluate(async () => ((await chrome.tabs.query({})) as { id: number; url?: string; pendingUrl?: string }[]).map((t) => ({ id: t.id, url: t.url || t.pendingUrl || '' })));

test('J-089: with open-in-new-tab off, create copies the link and opens no tab; on, the capture opens beside the source tab', async ({ context, sw }) => {
  await signInExtension(sw, acct);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(LAB_URL).origin });
  await setExtSettings(sw, { openInNewTab: false });
  try {
    const { page, tabId } = await labTab(context, sw);
    const id = await seedDraft(sw, { tabId, workspaceId: acct.workspaceId });
    const f = await openEditorInPage(sw, page, id);
    await f.getByTestId('field').click();
    await page.keyboard.type('No new tab please');
    const before = (await webTabs(sw)).map((t) => t.id);
    await f.getByTestId('create').click();
    await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('toolbar-root').getByText('Link copied')).toBeVisible();
    await page.bringToFront();
    await page.mouse.click(5, 5);
    await expect.poll(() => clipboard(page), { timeout: 5000 }).toMatch(new RegExp(`^${SERVER}/s/`));
    await sleep(1500);
    expect((await webTabs(sw)).filter((t) => !before.includes(t.id))).toEqual([]);
    expect(await getDraft(sw, id)).toBeUndefined();

    // switched back on: the capture page opens right of the source tab
    await setExtSettings(sw, { openInNewTab: true });
    const id2 = await seedDraft(sw, { tabId, workspaceId: acct.workspaceId });
    const f2 = await openEditorInPage(sw, page, id2);
    await f2.getByTestId('field').click();
    await page.keyboard.type('New tab this time');
    await f2.getByTestId('create').click();
    await expect.poll(async () => (await webTabs(sw)).filter((t) => !before.includes(t.id)).map((t) => t.url), { timeout: 15_000 }).toEqual([expect.stringMatching(new RegExp(`^${SERVER}/(c/|login\\?next=%2Fc%2F)`))]);
    for (const t of (await webTabs(sw)).filter((t) => !before.includes(t.id))) await sw.evaluate((id) => chrome.tabs.remove(id), t.id);
    await page.close();
  } finally {
    await setExtSettings(sw, { openInNewTab: true });
  }
});

test.describe('trackers', () => {
  let gh: GitHubMock;
  let ghId: string;
  test.beforeAll(async () => {
    // issue trackers, send to app and linked issues are paused (docs/scope.md)
    await skipUnlessFeature(test, 'trackers');
    gh = await githubMock();
    ghId = await connectGithub(acct, gh, 'acme/shop');
  });
  test.afterAll(async () => {
    await gh?.close();
  });

  test('J-137, J-140: GitHub in the draft destination loads repo, labels, assignee and milestone from the API, files the issue at create and opens it; the next draft remembers the values', async ({ context, sw }) => {
    await signInExtension(sw, acct);
    const { page, tabId } = await labTab(context, sw);
    const id = await seedDraft(sw, { tabId, workspaceId: acct.workspaceId });
    let f = await openEditorInPage(sw, page, id);
    await f.getByTestId('field').click();
    await page.keyboard.type('Total is wrong at checkout');
    await booted(f);
    await f.getByTestId('destination').click();
    await f.getByTestId(`dest-github`).click();
    await expect(f.getByTestId('dest-fields')).toBeVisible();
    await expect(f.getByTestId('dest-repo')).toHaveValue('acme/shop');
    await expect(f.locator('[data-label="bug"]')).toBeVisible();
    await f.locator('[data-label="bug"]').click();
    await f.locator('[data-label="checkout"]').click();
    await f.getByTestId('dest-assignee').selectOption('sam-gh');
    await f.getByTestId('dest-milestone').selectOption('3');
    const before = (await webTabs(sw)).map((t) => t.id);
    await f.getByTestId('create').click();
    await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0, { timeout: 20_000 });
    await expect.poll(() => gh.issues.length, { timeout: 10_000 }).toBe(1);
    expect(gh.issues[0]).toMatchObject({ repo: 'acme/shop', title: 'Total is wrong at checkout', labels: ['bug', 'checkout'], assignees: ['sam-gh'], milestone: 3 });
    expect(gh.issues[0]!.body).toContain(`${SERVER}/c/`);
    // the issue opens in a new tab (the capture page too, with open-in-new-tab on)
    const fresh = async () => (await webTabs(sw)).filter((t) => !before.includes(t.id)).map((t) => t.url);
    await expect.poll(fresh, { timeout: 15_000 }).toContain(`${gh.url}/acme/shop/issues/42`);
    // the capture page (this browser is not signed in on the web, so it lands on the login page for it)
    expect((await fresh()).some((u) => /\/c\/|next=%2Fc%2F/.test(u))).toBe(true);
    for (const t of (await webTabs(sw)).filter((t) => !before.includes(t.id))) await sw.evaluate((id) => chrome.tabs.remove(id), t.id);

    // recents: the next draft that picks GitHub starts from the values filed last
    const id2 = await seedDraft(sw, { tabId, workspaceId: acct.workspaceId });
    f = await openEditorInPage(sw, page, id2);
    await booted(f);
    await f.getByTestId('destination').click();
    await f.getByTestId('dest-github').click();
    await expect(f.locator('[data-label="bug"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(f.locator('[data-label="checkout"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(f.getByTestId('dest-assignee')).toHaveValue('sam-gh');
    await expect(f.getByTestId('dest-milestone')).toHaveValue('3');
    // another repo reloads its labels and clears the old picks
    await f.getByTestId('dest-repo').fill('acme/api');
    await f.getByTestId('dest-repo').press('Tab');
    await expect(f.locator('[data-label="bug"]')).toHaveAttribute('aria-pressed', 'false');
    await f.getByTestId('close').click();
    await page.close();
  });

  test('J-140: with GitHub unreachable the form says so and create still saves the capture, with a notice', async ({ context, sw }) => {
    await signInExtension(sw, acct);
    await setExtSettings(sw, { openInNewTab: false });
    gh.down = true;
    try {
      const { page, tabId } = await labTab(context, sw);
      const id = await seedDraft(sw, { tabId, workspaceId: acct.workspaceId });
      const f = await openEditorInPage(sw, page, id);
      await f.getByTestId('field').click();
      await page.keyboard.type('Filed while GitHub is down');
      await booted(f);
      await f.getByTestId('destination').click();
      await f.getByTestId('dest-github').click();
      await expect(f.getByTestId('dest-error')).toContainText('did not answer');
      await f.getByTestId('create').click();
      await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0, { timeout: 20_000 });
      await expect(page.locator('toolbar-root').getByText(/filing the issue failed/)).toBeVisible();
      // the capture exists on the server
      const list = await json<{ items: { title: string }[] }>(acct.page, 'GET', `/api/v1/recordings?workspaceId=${acct.workspaceId}`);
      expect(list.items.map((c) => c.title)).toContain('Filed while GitHub is down');
      await page.close();
    } finally {
      gh.down = false;
      await setExtSettings(sw, { openInNewTab: true });
    }
  });

  test('J-137: the Slack destination posts to the incoming webhook at create', async ({ context, sw }) => {
    await skipUnlessFeature(test, 'slack');
    const sl = await slackMock();
    try {
      await connectSlack(acct, sl.url);
      await signInExtension(sw, acct);
      await setExtSettings(sw, { openInNewTab: false });
      const { page, tabId } = await labTab(context, sw);
      const id = await seedDraft(sw, { tabId, workspaceId: acct.workspaceId });
      const f = await openEditorInPage(sw, page, id);
      await f.getByTestId('field').click();
      await page.keyboard.type('Slack this one');
      await booted(f);
      await f.getByTestId('destination').click();
      await f.getByTestId('dest-slack').click();
      await f.getByTestId('dest-fields').getByRole('textbox').fill('please look today');
      await f.getByTestId('create').click();
      await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0, { timeout: 20_000 });
      await expect.poll(() => sl.posts.length, { timeout: 10_000 }).toBe(1);
      expect(sl.posts[0]!.text).toContain('please look today');
      expect(sl.posts[0]!.text).toContain('Slack this one');
      await page.close();
    } finally {
      await sl.close();
      await setExtSettings(sw, { openInNewTab: true });
    }
  });

  test('J-138, J-140: the capture page sends to a connected app through the field form; a workspace with none offers connect items; signed out it is hidden', async () => {
    await skipUnlessFeature(test, 'slack');
    // a capture of this account, made through the upload API
    const page = acct.page;
    const TITLE = 'Coupon field rejects valid codes';
    const cap = { id: await seedCaptureViaApi(acct, TITLE) };
    const filed = gh.issues.length;
    const sl = await slackMock();
    await connectSlack(acct, sl.url, 'Slack ops');
    await page.goto(`${SERVER}/c/${cap.id}`);
    await hydrated(page);
    await page.getByTestId('send-caret').click();
    await expect(page.getByRole('menuitem', { name: 'GitHub acme' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Slack ops' })).toBeVisible();
    await sl.close();
    await page.getByRole('menuitem', { name: 'GitHub acme' }).click();
    const dlg = page.getByTestId('send-dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('issue-title')).toHaveValue(TITLE);
    await expect(dlg.getByTestId('issue-repo')).toHaveValue('acme/shop');
    // labels come from the API; values filed last are preselected (J-140), so set the chip on
    const chip = dlg.locator('[data-label="checkout"]');
    await expect(chip).toBeVisible();
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await dlg.getByTestId('issue-assignee').selectOption('kim-gh');
    const popupP = page.context().waitForEvent('page');
    await dlg.getByTestId('send-submit').click();
    const issueTab = await popupP;
    await expect.poll(() => gh.issues.length, { timeout: 10_000 }).toBe(filed + 1);
    expect(gh.issues.at(-1)).toMatchObject({ repo: 'acme/shop', title: TITLE, assignees: ['kim-gh'] });
    expect(gh.issues.at(-1)!.labels).toContain('checkout');
    await expect.poll(() => issueTab.url()).toMatch(new RegExp(`^${gh.url}/acme/shop/issues/\\d+$`));
    await issueTab.close();
    // the main button now opens the form for the app used last
    await page.reload();
    await hydrated(page);
    await expect(page.getByTestId('send-main')).toHaveText(/Send to GitHub acme/);

    // a fresh workspace without apps: connect items for GitHub, GitLab, Slack and webhooks
    const other = await account(browser, 'rows-empty');
    const shot = await seedCaptureViaApi(other);
    await other.page.goto(`${SERVER}/c/${shot}`);
    await hydrated(other.page);
    await other.page.getByTestId('send-caret').click();
    for (const name of ['Connect GitHub', 'Connect GitLab', 'Connect Slack', 'Set up a webhook']) await expect(other.page.getByRole('menuitem', { name })).toBeVisible();
    await other.page.keyboard.press('Escape');

    // signed out, through a share link: no send button; the author hears about this first view (J-136)
    const share = await json<{ url: string }>(page, 'POST', `/api/v1/recordings/${cap.id}/share-links`, {});
    const anon = await browser.newContext();
    const ap = await anon.newPage();
    await ap.goto(share.url);
    await hydrated(ap);
    await expect(ap.getByTestId('viewer-header')).toBeVisible();
    await expect(ap.getByTestId('send-split')).toHaveCount(0);
    await anon.close();
    if (await featureOn('email')) {
      const mail = await mailTo(page.request, acct.email, new RegExp(`viewed "${TITLE}"`));
      expect(mail.text).toContain(`/c/${cap.id}`);
    }
    await other.page.context().close();
  });
});

/** A ready screenshot capture made through the upload API with the account's token. */
async function seedCaptureViaApi(a: Account, title = 'Empty workspace shot'): Promise<string> {
  const png = fs.readFileSync(path.resolve(import.meta.dirname, '../../../apps/server/fixtures/screenshot.png'));
  const h = { authorization: `Bearer ${a.token}` };
  const r = a.page.request;
  const res = await r.post(`${SERVER}/api/v1/recordings`, { headers: h, data: { clientId: crypto.randomUUID(), kind: 'screenshot', workspaceId: a.workspaceId, page: { url: 'http://localhost:5173/', title: 'Lab' }, startedAt: Date.now() } });
  expect(res.ok(), await res.text()).toBe(true);
  const created = (await res.json()) as { id: string };
  const asset = await (
    await r.post(`${SERVER}/api/v1/assets`, { headers: h, multipart: { kind: 'screenshot', recordingId: created.id, file: { name: 'shot.png', mimeType: 'image/png', buffer: png } } })
  ).json();
  const fin = await r.post(`${SERVER}/api/v1/recordings/${created.id}/finalize`, { headers: h, data: { title, screenshotAssetId: asset.id, annotations: [] } });
  expect(fin.ok(), await fin.text()).toBe(true);
  return created.id;
}

test('J-177: report a problem opens a recording link to the server admin', async ({ context, sw }) => {
  await signInExtension(sw, acct);
  const { page, tabId } = await labTab(context, sw);
  const boot = await json<{ supportRecordingLink: string | null }>(acct.page, 'GET', '/api/v1/ext/bootstrap');
  expect(boot.supportRecordingLink).toMatch(new RegExp(`^${SERVER}/rl/`));
  const popup = await openPopup(context, tabId);
  const opened = context.waitForEvent('page');
  await popup.locator('[data-menu-button]').click();
  await popup.locator('[data-menu-item="report"]').click();
  const rl = await opened;
  await rl.waitForLoadState();
  expect(rl.url()).toBe(boot.supportRecordingLink);
  await expect(rl.getByTestId('recorder')).toBeVisible();
  await expect(rl.getByTestId('choose-screen')).toBeVisible();
  await rl.close();
  await popup.close().catch(() => undefined);
  await page.close();
});

test('J-219: a video draft reopened from Drafts saves for later; the popup shows the drafts pill with the capture rows live', async ({ context, sw }) => {
  // pages earlier suites left open in this worker's browser keep their capture scripts and
  // replay rings busy, which slowed the worker's draft saves past the waits below
  // (the first page stays: the browser quits with its last window)
  for (const p of context.pages().slice(1)) await p.close().catch(() => undefined);
  await signInExtension(sw, acct);
  const { page, tabId } = await labTab(context, sw);
  const id = await seedDraft(sw, { kind: 'video', videoBase64: VIDEO, durationMs: 8000, tabId, workspaceId: acct.workspaceId, status: 'saved' });
  // a draft reopens into the session only from idle; earlier tests in this worker may still be
  // winding theirs down
  const state = () => sw.evaluate(async () => ((await chrome.storage.session.get('tb:session'))['tb:session'] as { state: string } | undefined)?.state ?? 'idle');
  await expect.poll(state, { timeout: 20_000 }).toBe('idle');
  let popup = await openPopup(context, tabId);
  await popup.locator('[data-drafts-pill]').click();
  await sw.evaluate(() => {
    const g = globalThis as unknown as { __j219?: string[] };
    g.__j219 = [];
    chrome.storage.session.onChanged.addListener((c: Record<string, { newValue?: { state: string } }>) => {
      if (c['tb:session']) g.__j219!.push(c['tb:session'].newValue?.state ?? 'none');
    });
  });
  await popup.locator(`[data-draft-view="${id}"]`).click();
  // the editor holds the session while it is open
  const f = page.frameLocator('iframe[data-nb-editor]');
  await expect(f.getByTestId('close')).toHaveText(/Save for later/, { timeout: 15_000 });
  // the session's changes since the click, for the failure message
  const seen = await sw.evaluate(() => (globalThis as unknown as { __j219?: string[] }).__j219 ?? []);
  await expect.poll(state, { message: `session after View: ${seen.join(' > ')}` }).toBe('draft');
  await popup.close().catch(() => undefined);
  await f.getByTestId('close').click();
  await expect(page.locator('iframe[data-nb-editor]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('toolbar-root').getByText('Saved to your drafts')).toBeVisible();
  await expect(page.locator('toolbar-root').getByRole('button', { name: 'View' })).toBeVisible();
  await expect.poll(() => sw.evaluate(async () => ((await chrome.storage.session.get('tb:session'))['tb:session'] as { state: string }).state)).toBe('idle');
  popup = await openPopup(context, tabId);
  await expect(popup.locator('[data-drafts-pill]')).toBeEnabled();
  await expect(popup.locator('[data-drafts-pill]')).toHaveText(/\d+/);
  for (const row of ['screenshot', 'record', 'link']) await expect(popup.locator(`[data-row="${row}"]`)).toHaveAttribute('aria-disabled', 'false');
  await popup.locator('[data-drafts-pill]').click();
  await expect(popup.locator(`[data-draft="${id}"]`)).toBeVisible();
  expect((await getDraft(sw, id))?.status).toBe('saved');
  await popup.close();
  await sw.evaluate((id) => (globalThis as unknown as { __tbDrafts: { deleteDraft(id: string): Promise<unknown> } }).__tbDrafts.deleteDraft(id), id);
  await page.close();
});

test('J-200: on the link recorder a refused microphone shows how to allow it and records without voice', async () => {
  const link = await json<{ url: string }>(acct.page, 'POST', `/api/v1/workspaces/${acct.workspaceId}/recording-links`, { name: 'Mic test' });
  // no --use-fake-ui-for-media-stream here: that flag grants every media prompt, so the refusal
  // below would not reach getUserMedia; the screen picker still answers itself
  const own = await chromium.launch({
    headless: false,
    env: browserEnv(DISPLAY),
    args: ['--use-fake-device-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--no-first-run'],
  });
  const ctx = await own.newContext({ viewport: { width: 1280, height: 860 } });
  // the browser's own answer for this site: microphone blocked
  const page: Page = await ctx.newPage();
  const marker = `about:blank#mic-${Date.now()}`;
  await page.goto(marker);
  const cdp = await own.newBrowserCDPSession();
  const { targetInfos } = (await cdp.send('Target.getTargets')) as { targetInfos: { url: string; browserContextId?: string }[] };
  const browserContextId = targetInfos.find((t) => t.url === marker)?.browserContextId;
  expect(browserContextId).toBeTruthy();
  await cdp.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin: new URL(SERVER).origin, browserContextId });
  await page.goto(link.url);
  await hydrated(page);
  await page.getByTestId('choose-voice').click();
  const help = page.getByTestId('mic-help');
  await expect(help).toBeVisible();
  await expect(help).toHaveAttribute('data-reason', 'denied');
  await expect(help).toContainText('Set Microphone to Allow');
  // trying with voice again asks the browser, which refuses: no recording starts, the help stays
  await expect(page.getByTestId('recorder-start')).toHaveText('Try again with voice');
  await page.getByTestId('recorder-start').click();
  await expect(page.getByTestId('recorder')).toHaveAttribute('data-phase', 'choose');
  await expect(help).toBeVisible();
  await page.getByTestId('record-without-voice').click();
  await expect(page.getByTestId('recorder-live')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('recorder-live')).not.toContainText('and voice');
  await sleep(1500);
  await page.getByTestId('recorder-stop').click();
  await expect(page.getByTestId('recorder-preview')).toBeVisible();
  await cdp.detach();
  await ctx.close();
  await own.close();
});

void EXT_ID;
