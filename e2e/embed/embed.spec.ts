// The embed (D-211, D-212) on the lab app, in a plain headless Chromium with no extension. The lab
// puts the script tag first in <head> on request (lab/server.js, `?tb-embed=<key>`); the site
// owner is a fresh account with a project for the lab's origin and its embed key.
//
// 1. On a project origin the toolbar mounts. An element comment, an element screenshot, a text
//    highlight and a voice note, then Send: one capture of source embed in the owner's workspace,
//    visible to the workspace only, with the four notes, their crops and clip, and the name the
//    reviewer typed as the author.
// 2. Start and Stop trace from the pill make a trace capture.
// 3. On the lab's second origin (not a project origin) no UI, one console line, and the server's 403.
// 4. A rotated or turned-off key: no UI.
// 5. The X closes the toolbar on the site, across reloads; `?open-toolbar` brings it back.
// 6. Behind a strict CSP (scripts from the page and the server, no inline styles) it renders styled.
import { expect, test, type Page } from '@playwright/test';
import { LAB, OTHER, SERVER, embedCaptures, ensureProject, labUrl, nextCapture, rotateKey, signInOwner, sleep, toolbarShown, turnOff, ui, wake, watchConsole, type Owner } from './helpers.ts';

interface Item {
  n: number;
  kind: string;
  comment: string;
  quote?: string;
  target?: { testId?: string; tag: string };
  cropUrl: string | null;
  voiceUrl: string | null;
  voiceDurationMs?: number;
  transcript: { status: string } | null;
  context?: { errors: unknown[]; failedRequests: { status?: number }[] };
  author: { userId: string | null; name: string | null; email: string | null; issuer: string | null; subject: string | null };
}

test.describe.configure({ mode: 'serial' });

let owner: Owner;
let projectId: string;
let key: string;

test.beforeAll(async ({ browser }) => {
  const health = await fetch(`${SERVER}/api/health`).catch(() => null);
  expect(health?.ok, `server not answering on ${SERVER}`).toBe(true);
  owner = await signInOwner(browser);
  projectId = await ensureProject(owner, LAB);
  key = await rotateKey(owner, projectId);
});

test.afterAll(async () => {
  await owner?.close();
});

/** Send from the pill with a title typed in the title row; waits for the success toast. */
async function send(page: Page, title: string, count: number) {
  await ui(page, 'review-send').click();
  await expect(ui(page, 'review-title')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('toolbar-root [role=status]', { hasText: `Sent ${count} ${count === 1 ? 'note' : 'notes'}` })).toBeVisible({ timeout: 30_000 });
}

async function items(id: string): Promise<Item[]> {
  const r = await owner.api.get(`${SERVER}/api/v1/recordings/${id}/feedback`);
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { items: Item[] }).items;
}

const pathOf = (u: string) => new URL(u, SERVER).pathname + new URL(u, SERVER).search;

test('on a project origin: comment, screenshot, highlight and voice note, sent as one embed capture in the workspace', async ({ page }) => {
  const log = watchConsole(page);
  const before = (await embedCaptures(owner)).map((c) => c.id);
  const configRes = page.waitForResponse((r) => r.url().includes(`/api/v1/embed/${key}/config`));
  await page.goto(labUrl(key));
  expect((await configRes).status()).toBe(200);
  await toolbarShown(page);
  // the script tag is the first thing in <head>, from the server
  expect(await page.evaluate(() => (document.head.firstElementChild as HTMLScriptElement | null)?.src)).toBe(`${SERVER}/embed.js`);
  expect(log.embed, 'no console line when it starts').toEqual([]);

  // things go wrong before the comment
  await page.getByTestId('hidden-500').click();
  await page.getByTestId('throws').click();
  await sleep(600);
  const statusBefore = await page.getByTestId('status').textContent();

  // 1. element comment; the first composer asks for the reviewer's name
  await wake(page);
  await page.keyboard.press('c');
  await expect(ui(page, 'review-tool-comment')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('works').hover();
  await expect(ui(page, 'review-hover-label')).toContainText('Save');
  await page.getByTestId('works').click();
  await expect(ui(page, 'review-composer')).toHaveAttribute('data-kind', 'element');
  await expect(ui(page, 'review-context')).toContainText(/1 error/);
  expect(await page.getByTestId('status').textContent(), 'the click never reached the app').toBe(statusBefore);
  await ui(page, 'review-comment').fill('Save gives no feedback at all');
  await expect(ui(page, 'review-name')).toBeVisible();
  await ui(page, 'review-name').fill('Rita Reviewer');
  await ui(page, 'review-add').click();
  await expect(ui(page, 'review-composer')).toBeHidden();
  await expect(ui(page, 'review-pin')).toHaveCount(1);
  await page.keyboard.press('Escape');

  // 2. element screenshot through the DOM rasteriser; the name is asked once
  await page.keyboard.press('s');
  const target = page.getByTestId('hangs');
  const box = (await target.boundingBox())!;
  await target.click();
  await expect(ui(page, 'review-composer')).toHaveAttribute('data-kind', 'shot');
  await expect(ui(page, 'review-crop')).toBeVisible({ timeout: 20_000 });
  await expect(ui(page, 'review-name')).toHaveCount(0);
  await ui(page, 'review-comment').fill('Sync spins forever');
  await ui(page, 'review-add').click();
  await expect(ui(page, 'review-pin')).toHaveCount(2);
  await page.keyboard.press('Escape');

  // 3. text highlight
  const h1 = page.locator('h1').first();
  const hb = (await h1.boundingBox())!;
  await page.mouse.move(hb.x + 1, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width - 1, hb.y + hb.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(ui(page, 'review-text-chip')).toBeVisible();
  await ui(page, 'review-text-chip').click();
  await expect(ui(page, 'review-composer')).toHaveAttribute('data-kind', 'text');
  await ui(page, 'review-comment').fill('This heading should say what the page is for');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-pin')).toHaveCount(3);

  // 4. voice note on its own, from Chromium's fake microphone
  await page.keyboard.press('v');
  await expect(ui(page, 'review-voice-time')).toBeVisible();
  await sleep(1800);
  await page.keyboard.press('v');
  await expect(ui(page, 'review-composer')).toHaveAttribute('data-kind', 'voice');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-count')).toHaveText('4');

  await send(page, 'Checkout review from the embed', 4);
  await expect(ui(page, 'review-pin')).toHaveCount(0);
  // the reviewer cannot open the dashboard: the toast has no Open link
  await expect(page.locator('toolbar-root [role=status] a')).toHaveCount(0);

  const cap = await nextCapture(owner, before, 'feedback');
  expect(cap.title).toBe('Checkout review from the embed');
  const detail = (await (await owner.api.get(`${SERVER}/api/v1/recordings/${cap.id}`)).json()) as {
    source: string;
    kind: string;
    access: string;
    workspaceId: string;
    authorSnapshot: Item['author'];
    index: { errors: number; network: { failed: number } };
  };
  expect(detail).toMatchObject({ source: 'embed', kind: 'feedback', access: 'workspace', workspaceId: owner.workspaceId });
  expect(detail.authorSnapshot).toMatchObject({ userId: null, name: 'Rita Reviewer', issuer: 'embed' });
  expect(detail.authorSnapshot.subject).toMatch(/^r_[0-9a-f]{32}$/);
  expect(detail.index.errors).toBeGreaterThanOrEqual(1);
  expect(detail.index.network.failed).toBeGreaterThanOrEqual(1);

  const list = await items(cap.id);
  expect(list.map((i) => i.kind)).toEqual(['element', 'shot', 'text', 'voice']);
  for (const it of list) expect(it.author).toMatchObject({ userId: null, name: 'Rita Reviewer', issuer: 'embed', subject: detail.authorSnapshot.subject });
  expect(list[0]).toMatchObject({ comment: 'Save gives no feedback at all', target: { testId: 'works' } });
  expect(list[0]!.context!.errors.length).toBeGreaterThanOrEqual(1);
  expect(list[0]!.context!.failedRequests.some((r) => r.status === 500)).toBe(true);
  expect(list[1]).toMatchObject({ comment: 'Sync spins forever', target: { testId: 'hangs' } });
  expect(list[2]).toMatchObject({ quote: 'Buttons', target: { tag: 'h1' } });

  // the element screenshot: a PNG of the element at 1x CSS pixels
  const crop = await owner.api.get(SERVER + pathOf(list[1]!.cropUrl!));
  expect(crop.headers()['content-type']).toContain('image/png');
  const png = await crop.body();
  expect(Math.abs(png.readUInt32BE(16) - box.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(png.readUInt32BE(20) - box.height)).toBeLessThanOrEqual(2);
  // the voice note: a clip of more than a second, transcribed by the server
  expect(list[3]!.voiceUrl).toBeTruthy();
  expect(list[3]!.voiceDurationMs).toBeGreaterThan(1000);
  const audio = await owner.api.get(SERVER + pathOf(list[3]!.voiceUrl!));
  expect(audio.headers()['content-type']).toMatch(/audio\/(webm|ogg|mp4)/);
  expect((await audio.body()).length).toBeGreaterThan(1000);
  await expect
    .poll(async () => (await items(cap.id))[3]!.transcript?.status, { timeout: 90_000, intervals: [2000] })
    .toBe('done');

  // workspace only: no share link, nothing for a visitor without a session
  const anon = await fetch(`${SERVER}/api/v1/recordings/${cap.id}`);
  expect([401, 403, 404]).toContain(anon.status);
  // and the reviewer's own uploads stay out of the page's network log
  const net = (await (await owner.api.get(`${SERVER}/api/v1/recordings/${cap.id}/network`)).json()) as { items: { url: string }[] };
  expect(net.items.some((n) => n.url.startsWith(SERVER))).toBe(false);
});

test('Start and Stop trace from the pill make a trace capture with the note made during it, by the reviewer the site named', async ({ page }) => {
  watchConsole(page);
  const before = (await embedCaptures(owner)).map((c) => c.id);
  // the site names its signed-in person (data-name): the composer does not ask
  await page.goto(labUrl(key, '/', LAB, '&tb-name=Sam%20Site'));
  await toolbarShown(page);
  await wake(page);
  await ui(page, 'review-trace-start').click();
  await expect(ui(page, 'review-trace-time')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('works').click();
  await sleep(2500);
  await page.keyboard.press('c');
  await page.getByTestId('dead').click();
  await expect(ui(page, 'review-composer')).toBeVisible();
  await expect(ui(page, 'review-name')).toHaveCount(0);
  await ui(page, 'review-comment').fill('Export is dead during the trace');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-pin')).toHaveCount(1);
  await page.keyboard.press('Escape');
  // Stop sends the notes onto the trace (it has its own title) and ends it
  await ui(page, 'review-trace-stop').click();
  await expect(page.locator('toolbar-root [role=status]', { hasText: 'Trace sent' })).toBeVisible({ timeout: 30_000 });
  await expect(ui(page, 'review-trace-start')).toBeVisible({ timeout: 30_000 });

  const cap = await nextCapture(owner, before, 'trace');
  const detail = (await (await owner.api.get(`${SERVER}/api/v1/recordings/${cap.id}`)).json()) as { source: string; kind: string; access: string; authorSnapshot: Item['author'] };
  expect(detail).toMatchObject({ source: 'embed', kind: 'trace', access: 'workspace' });
  expect(detail.authorSnapshot).toMatchObject({ userId: null, name: 'Sam Site', issuer: 'embed' });
  const list = await items(cap.id);
  expect(list).toHaveLength(1);
  expect(list[0]!.author).toMatchObject({ userId: null, name: 'Sam Site', issuer: 'embed' });
  expect(list[0]).toMatchObject({ kind: 'element', comment: 'Export is dead during the trace', target: { testId: 'dead' } });
  const net = (await (await owner.api.get(`${SERVER}/api/v1/recordings/${cap.id}/network`)).json()) as { items: { url: string }[] };
  expect(net.items.some((n) => n.url.includes('/api/ok'))).toBe(true);
  // the note is an action of the trace: the server's span engine got its annotation event
  await expect
    .poll(async () => {
      const r = await owner.api.get(`${SERVER}/api/v1/recordings/${cap.id}/spans`);
      return r.ok() ? ((await r.json()) as { items: { action: { type: string } }[] }).items.filter((s) => s.action.type === 'annotation').length : -1;
    }, { timeout: 30_000 })
    .toBe(1);
});

test('on an origin that is not one of the project: no UI, one console line, the server answers 403', async ({ page }) => {
  const log = watchConsole(page);
  const configRes = page.waitForResponse((r) => r.url().includes(`/api/v1/embed/${key}/config`));
  await page.goto(labUrl(key, '/', OTHER));
  const res = await configRes;
  expect(res.status()).toBe(403);
  // the 403 carries the CORS echo, so the page can read why
  expect(res.headers()['access-control-allow-origin']).toBe(OTHER);
  await expect.poll(() => log.embed.length).toBe(1);
  await sleep(1500);
  expect(log.embed).toEqual([{ type: 'info', text: '[open-toolbar] not started: this origin is not one of the project' }]);
  await expect(page.locator('toolbar-root')).toHaveCount(0);
  expect(log.errors).toEqual([]);
});

test('a rotated key stops at once and a turned-off key shows nothing', async ({ page }) => {
  const log = watchConsole(page);
  const old = key;
  key = await rotateKey(owner, projectId);
  expect(key).not.toBe(old);

  await page.goto(labUrl(old));
  await expect.poll(() => log.embed.length).toBe(1);
  expect(log.embed[0]!.text).toBe('[open-toolbar] not started: the key is unknown or turned off');
  await expect(page.locator('toolbar-root')).toHaveCount(0);

  await page.goto(labUrl(key));
  await toolbarShown(page);

  await turnOff(owner, projectId);
  log.embed.length = 0;
  await page.goto(labUrl(key));
  await expect.poll(() => log.embed.length).toBe(1);
  expect(log.embed[0]!.text).toBe('[open-toolbar] not started: the key is unknown or turned off');
  await expect(page.locator('toolbar-root')).toHaveCount(0);
  // the lab still works without it
  await page.getByTestId('works').click();
  await expect(page.getByTestId('status')).not.toBeEmpty();

  key = await rotateKey(owner, projectId);
});

test('the X closes the toolbar on this site across reloads; ?open-toolbar brings it back', async ({ page }) => {
  watchConsole(page);
  await page.goto(labUrl(key));
  await toolbarShown(page);
  await wake(page);
  await ui(page, 'review-close-site').click();
  await expect(ui(page, 'review-pill')).toBeHidden();
  await expect(ui(page, 'review-launcher')).toBeHidden();

  await page.goto(labUrl(key, '/form'));
  await expect(page.locator('toolbar-root')).toHaveCount(1);
  await sleep(1500);
  await expect(ui(page, 'review-launcher').or(ui(page, 'review-pill'))).toBeHidden();

  await page.goto(labUrl(key, '/', LAB, '&open-toolbar'));
  await toolbarShown(page);
  // shown again for good: a plain reload keeps it
  await page.goto(labUrl(key));
  await toolbarShown(page);

  // the page's own API does the same
  await page.evaluate(() => window.openToolbar!.hide());
  await expect(ui(page, 'review-launcher').or(ui(page, 'review-pill'))).toBeHidden();
  await page.evaluate(() => window.openToolbar!.show());
  await toolbarShown(page);
});

test('behind a strict CSP (scripts from the page and the server, no inline styles) it renders styled and sends', async ({ page }) => {
  const log = watchConsole(page);
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const before = (await embedCaptures(owner)).map((c) => c.id);
  const res = await page.goto(labUrl(key, '/__embed/csp'));
  expect(res!.headers()['content-security-policy']).toContain("style-src 'self'");
  await toolbarShown(page);
  await wake(page);
  // styled through constructed style sheets: a rounded, filled pill
  const pill = ui(page, 'review-pill');
  const style = await pill.evaluate((el) => {
    const s = getComputedStyle(el);
    return { radius: parseFloat(s.borderTopLeftRadius), bg: s.backgroundColor, display: s.display };
  });
  expect(style.radius).toBeGreaterThan(8);
  expect(style.bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.display).toBe('flex');
  // the dock is fixed to the viewport, as on any other page
  expect(await ui(page, 'review-dock').evaluate((el) => getComputedStyle(el).position)).toBe('fixed');

  await page.keyboard.press('c');
  await page.getByTestId('embed-button').click();
  await expect(ui(page, 'review-composer')).toBeVisible();
  await ui(page, 'review-comment').fill('Behind a strict CSP');
  await page.keyboard.press('Enter');
  await send(page, 'CSP page', 1);
  const cap = await nextCapture(owner, before, 'feedback');
  expect(cap.title).toBe('CSP page');
  expect(violations).toEqual([]);
  expect(log.errors).toEqual([]);
});

declare global {
  interface Window {
    openToolbar?: { show(): void; hide(): void };
  }
}
