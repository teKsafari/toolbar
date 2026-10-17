// Part 2 reviewer toolbar (PLAN "What the reviewer can do"), one test per action on the lab app:
// comment on an element (hover label, click blocked from the app, inline composer, 60 s context),
// highlight text and comment, rectangle, arrow and freehand on the live page, element
// screenshot, voice notes (on a comment and on their own), pins that survive a reload with the
// compact list, Start and Stop trace from the pill, and submit to the server.
// Runs against a real server (SERVER_URL) with the mock OIDC provider: the test signs in, makes a
// personal token and gives it to the extension, then reads what the server stored.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page, Worker } from '@playwright/test';
import type { LocatorPacket } from '@toolbar/shared/locator';
import { EXT_ID, LAB_URL, SERVER_URL, expect, test } from '../../fixtures/extension.ts';
import { signInOidc } from '../../fixtures/oidc.ts';

/** The vite dev server of the lab (`npx vite dev --port 5184` in lab/), for __svelte_meta. */
const LAB_DEV_URL = process.env.LAB_DEV_URL ?? 'http://localhost:5184';
const LAB_SRC = path.resolve(import.meta.dirname, '../../../lab/src/routes');
const lineOf = (file: string, needle: string) => fs.readFileSync(path.join(LAB_SRC, file), 'utf8').split('\n').findIndex((l) => l.includes(needle)) + 1;

/** The capture's feedback folder, unpacked: path -> text of each annotations/*.json file. */
async function folderJson(page: Page, recordingId: string): Promise<Record<string, unknown>> {
  const r = await page.request.get(`${SERVER_URL}/api/v1/recordings/${recordingId}/folder`);
  expect(r.status(), await r.text().catch(() => '')).toBe(200);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-folder-'));
  fs.writeFileSync(path.join(dir, 'f.tgz'), await r.body());
  execFileSync('tar', ['xzf', 'f.tgz'], { cwd: dir });
  const out: Record<string, unknown> = {};
  const root = path.join(dir, '.feedback', recordingId);
  for (const f of fs.readdirSync(path.join(root, 'annotations'))) if (f.endsWith('.json')) out[`annotations/${f}`] = JSON.parse(fs.readFileSync(path.join(root, 'annotations', f), 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

async function up(url: string): Promise<boolean> {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

test.describe.configure({ timeout: 180_000 });

interface Item {
  id: string;
  n: number;
  kind: string;
  comment: string;
  quote?: string;
  target?: { testId?: string; tag: string; name?: string; selector: string };
  locator?: LocatorPacket;
  shapes: { type: string; points: number[][] }[];
  cropUrl: string | null;
  cropRect?: { w: number; h: number };
  voiceUrl: string | null;
  voiceDurationMs?: number;
  transcript: { status: string; text: string | null } | null;
  context?: { errors: { text: string }[]; failedRequests: { text: string; status?: number }[] };
  author: { email: string | null; issuer: string | null; subject: string | null };
  page: { url: string };
}
interface Submit {
  recordingId: string;
  url: string;
  count: number;
  trace: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let signedIn: { email: string } | null = null;

/** A person signs in on the server, makes a personal token and gives it to the extension. */
async function signIn(page: Page, sw: Worker) {
  await sw.evaluate(() => (globalThis as unknown as { __tb: { ready(): Promise<unknown> } }).__tb.ready());
  if (signedIn) return signedIn;
  const email = `reviewer-${Date.now()}@toolbar.test`;
  await signInOidc(page, SERVER_URL, email, { name: 'Rae Viewer' });
  const me = await (await page.request.get(`${SERVER_URL}/api/v1/me`)).json();
  expect(me.activeWorkspaceId, 'a first sign-in gets a workspace').toBeTruthy();
  const res = await page.request.post(`${SERVER_URL}/api/v1/tokens`, { data: { name: 'reviewer e2e', scopes: ['cli:read', 'cli:write'], expiresInDays: 7 } });
  expect(res.status()).toBe(201);
  const { secret } = await res.json();
  await sw.evaluate(
    async ({ serverUrl, token, ws, email }) => {
      await chrome.storage.local.set({
        'tb:auth': { serverUrl, token, tokenId: 'tok-reviewer', user: { id: 'u', name: 'Rae Viewer', email, image: null }, activeWorkspaceId: ws, signedInAt: Date.now() },
        'tb:server-url': serverUrl,
      });
    },
    { serverUrl: SERVER_URL, token: secret as string, ws: me.activeWorkspaceId as string, email },
  );
  signedIn = { email };
  return signedIn;
}

const ui = (page: Page, id: string): Locator => page.getByTestId(id);

async function openLab(page: Page, path = '/', base = LAB_URL) {
  await page.goto(base + path);
  await page.bringToFront();
  await expect(ui(page, 'review-launcher').or(ui(page, 'review-pill'))).toBeVisible({ timeout: 15_000 });
}

async function wake(page: Page) {
  if (await ui(page, 'review-pill').isVisible()) return;
  await ui(page, 'review-launcher').click();
  await expect(ui(page, 'review-pill')).toBeVisible();
}

async function submits(sw: Worker): Promise<Submit[]> {
  return sw.evaluate(() => (globalThis as unknown as { __tbReview: { submits(): Submit[] } }).__tbReview.submits());
}

/** Send from the pill and return what the worker reported. */
async function send(page: Page, sw: Worker): Promise<Submit> {
  const before = (await submits(sw)).length;
  await ui(page, 'review-send').click();
  await expect.poll(async () => (await submits(sw)).length, { timeout: 30_000 }).toBe(before + 1);
  return (await submits(sw))[before]!;
}

async function items(page: Page, recordingId: string): Promise<Item[]> {
  const r = await page.request.get(`${SERVER_URL}/api/v1/recordings/${recordingId}/feedback`);
  expect(r.status()).toBe(200);
  return (await r.json()).items as Item[];
}

/** Drag on the page with the mouse, through the given points. */
async function drag(page: Page, pts: [number, number][]) {
  await page.mouse.move(pts[0]![0], pts[0]![1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
}

test.afterEach(async ({ sw }) => {
  // nothing of one test may show up in the next: drop every tab's unsent notes
  await sw.evaluate(() => chrome.storage.session.remove('tb:review')).catch(() => undefined);
  // and no dock position a test dragged to (kept per origin, D-199)
  await sw.evaluate(() => chrome.storage.local.remove('tb:review-pos')).catch(() => undefined);
});

test('comment on an element: hover label, the click never reaches the app, the last minute of errors goes with it', async ({ context, sw }) => {
  const page = await context.newPage();
  const { email } = await signIn(page, sw);
  await openLab(page);

  // things go wrong before the comment, with no trace running
  await page.getByTestId('hidden-500').click();
  await page.getByTestId('throws').click();
  await sleep(600);
  const statusBefore = await page.getByTestId('status').textContent();

  await wake(page);
  await page.keyboard.press('c');
  await expect(ui(page, 'review-tool-comment')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('works').hover();
  await expect(ui(page, 'review-hover-label')).toContainText('Save');
  await page.getByTestId('works').click();

  const composer = ui(page, 'review-composer');
  await expect(composer).toBeVisible();
  await expect(composer).toHaveAttribute('data-kind', 'element');
  await expect(ui(page, 'review-composer-label')).toContainText('Save');
  await expect(ui(page, 'review-context')).toContainText(/1 error and \d+ failed requests?/);
  // blocked from the app: the Save handler did not run
  expect(await page.getByTestId('status').textContent()).toBe(statusBefore);

  await ui(page, 'review-comment').fill('Save gives no feedback at all');
  await page.keyboard.press('Enter');
  await expect(composer).toBeHidden();
  await expect(ui(page, 'review-pin')).toHaveCount(1);
  await expect(ui(page, 'review-pin').first()).toHaveAttribute('data-n', '1');
  await expect(ui(page, 'review-count')).toHaveText('1');

  const res = await send(page, sw);
  expect(res).toMatchObject({ count: 1, trace: false });
  await expect(ui(page, 'review-pin')).toHaveCount(0);

  const [it] = await items(page, res.recordingId);
  expect(it).toMatchObject({ n: 1, kind: 'element', comment: 'Save gives no feedback at all', target: { testId: 'works' } });
  expect(it!.author.email).toBe(email);
  expect(it!.author.issuer).toContain('oidc.localhost');
  expect(it!.context!.errors.length).toBeGreaterThanOrEqual(1);
  expect(it!.context!.failedRequests.some((r) => r.status === 500)).toBe(true);
  // the locator packet (D-164): route file from the lab's route table, the element, the error of the last minute
  expect(it!.locator).toMatchObject({ kind: 'element', testId: 'works', tag: 'button', framework: { name: 'sveltekit', routeId: '/' } });
  expect(it!.locator!.routeFiles[0]).toMatchObject({ file: 'src/routes/+page.svelte', source: 'manifest' });
  expect(it!.locator!.errors?.some((e) => e.kind === 'error' && /TypeError/.test(e.message))).toBe(true);

  // the capture holds the attached console and network rows, and the capture page lists the note
  await expect
    .poll(async () => (await (await page.request.get(`${SERVER_URL}/api/v1/recordings/${res.recordingId}`)).json()).status, { timeout: 30_000 })
    .toBe('ready');
  const detail = await (await page.request.get(`${SERVER_URL}/api/v1/recordings/${res.recordingId}`)).json();
  expect(detail.kind).toBe('feedback');
  expect(detail.index.errors).toBeGreaterThanOrEqual(1);
  expect(detail.index.network.failed).toBeGreaterThanOrEqual(1);
  const viewer = await context.newPage();
  await viewer.goto(`${SERVER_URL}/c/${res.recordingId}`);
  await expect(viewer.getByTestId('feedback-item')).toHaveCount(1);
  await expect(viewer.getByTestId('feedback-comment')).toHaveText('Save gives no feedback at all');
  await expect(viewer.getByTestId('feedback-context')).toBeVisible();

  // the agent's folder carries that packet as annotations/a01.locator.json, with the crop's file
  const folder = await folderJson(page, res.recordingId);
  const packet = folder['annotations/a01.locator.json'] as LocatorPacket & { note?: string };
  expect(packet.note).toBeUndefined();
  expect(packet.routeFiles[0]!.file).toBe('src/routes/+page.svelte');
  expect(packet.testId).toBe('works');
  expect(packet.crop?.file).toBe('a01.png');
});

test('on the vite dev server a comment names the Svelte file and line, and the error maps to its source line', async ({ context, sw }) => {
  test.skip(!(await up(LAB_DEV_URL)), `lab dev server not running at ${LAB_DEV_URL} (cd lab && npx vite dev --port 5184)`);
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page, '/', LAB_DEV_URL);
  // vite dev hydrates late: the button has no handler before that
  await page.waitForLoadState('networkidle');
  await page.getByTestId('throws').click();
  await sleep(600);
  await wake(page);
  await page.keyboard.press('c');
  await page.getByTestId('works').click();
  await expect(ui(page, 'review-composer')).toBeVisible();
  await ui(page, 'review-comment').fill('Where is this button written?');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-pin')).toHaveCount(1);
  const res = await send(page, sw);
  const [it] = await items(page, res.recordingId);
  expect(it!.locator!.source).toMatchObject({ file: 'src/routes/+page.svelte', line: lineOf('+page.svelte', 'data-testid="works"'), via: 'svelte-meta' });
  expect(it!.locator!.framework).toMatchObject({ name: 'sveltekit', dev: true });
  expect(it!.locator!.routeFiles[0]).toMatchObject({ file: 'src/routes/+page.svelte', source: 'svelte-meta' });
  const err = it!.locator!.errors?.find((e) => e.kind === 'error' && /TypeError/.test(e.message));
  expect(err?.mapped).toBe(true);
  expect(err?.frames?.[0]).toMatchObject({ file: 'src/routes/+page.svelte', srcLine: lineOf('+page.svelte', 'return user.profile.name') });
  const folder = await folderJson(page, res.recordingId);
  expect((folder['annotations/a01.locator.json'] as LocatorPacket).source?.line).toBe(lineOf('+page.svelte', 'data-testid="works"'));
});

test('highlight text and comment: the chip opens a composer with the quote, the highlight stays', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  // select the page heading the way a mouse would
  const h1 = page.locator('h1').first();
  const box = (await h1.boundingBox())!;
  await page.mouse.move(box.x + 1, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(ui(page, 'review-text-chip')).toBeVisible();
  await ui(page, 'review-text-chip').click();
  await expect(ui(page, 'review-composer')).toHaveAttribute('data-kind', 'text');
  await expect(ui(page, 'review-composer-quote')).toContainText('Buttons');
  await ui(page, 'review-comment').fill('This heading should say what the page is for');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-mark').first()).toBeAttached();
  await expect(ui(page, 'review-pin')).toHaveCount(1);

  const res = await send(page, sw);
  const [it] = await items(page, res.recordingId);
  expect(it).toMatchObject({ kind: 'text', quote: 'Buttons', target: { tag: 'h1' } });
  expect(it!.locator).toMatchObject({ kind: 'text', tag: 'h1', selection: 'Buttons' });
  expect(it!.locator!.routeFiles[0]!.file).toBe('src/routes/+page.svelte');
});

test('draw a rectangle, an arrow and a freehand line on the live page, each with a flattened crop', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  const status = await page.getByTestId('status').textContent();

  await page.keyboard.press('r');
  await drag(page, [
    [200, 200],
    [360, 280],
  ]);
  await expect(ui(page, 'review-composer')).toHaveAttribute('data-kind', 'draw');
  await expect(ui(page, 'review-crop')).toBeVisible();
  await ui(page, 'review-comment').fill('Too much space here');
  await page.keyboard.press('Enter');

  await page.keyboard.press('a');
  await drag(page, [
    [500, 320],
    [420, 240],
  ]);
  await expect(ui(page, 'review-composer')).toBeVisible();
  await ui(page, 'review-comment').fill('This points at the wrong thing');
  await page.keyboard.press('Enter');

  await page.keyboard.press('f');
  await drag(page, [
    [300, 400],
    [330, 420],
    [360, 405],
    [400, 430],
    [440, 410],
  ]);
  await expect(ui(page, 'review-composer')).toBeVisible();
  await page.keyboard.press('Enter'); // a drawing needs no words
  await expect(ui(page, 'review-pin')).toHaveCount(3);
  await expect(page.getByTestId('review-layer').locator('[data-shape]')).toHaveCount(3);
  expect(await page.getByTestId('status').textContent(), 'drawing never clicks the app').toBe(status);
  await page.keyboard.press('Escape'); // tool off

  const res = await send(page, sw);
  const list = await items(page, res.recordingId);
  expect(list.map((i) => i.shapes[0]!.type)).toEqual(['rect', 'arrow', 'freehand']);
  expect(list.every((i) => i.kind === 'draw' && i.cropUrl)).toBe(true);
  expect(list[2]!.shapes[0]!.points.length).toBeGreaterThan(4);
  // the rectangle's crop is the drawing plus 16 px around it, at 1x CSS pixels
  const crop = await page.request.get(SERVER_URL + new URL(list[0]!.cropUrl!, SERVER_URL).pathname);
  expect(crop.headers()['content-type']).toContain('image/png');
  const png = await crop.body();
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([160 + 32, 80 + 32]);
});

test('screenshot of one element: the crop is the element at 1x CSS pixels, with a comment', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  await page.keyboard.press('s');
  const target = page.getByTestId('hangs');
  await target.hover();
  await expect(ui(page, 'review-hover-label')).toContainText('Screenshot');
  const box = (await target.boundingBox())!;
  await target.click();
  await expect(ui(page, 'review-composer')).toHaveAttribute('data-kind', 'shot');
  await expect(ui(page, 'review-crop')).toBeVisible();
  await ui(page, 'review-comment').fill('Sync spins forever');
  await ui(page, 'review-add').click();
  await expect(ui(page, 'review-pin')).toHaveCount(1);

  const res = await send(page, sw);
  const [it] = await items(page, res.recordingId);
  expect(it).toMatchObject({ kind: 'shot', comment: 'Sync spins forever', target: { testId: 'hangs' } });
  const png = await (await page.request.get(SERVER_URL + new URL(it!.cropUrl!, SERVER_URL).pathname)).body();
  expect(Math.abs(png.readUInt32BE(16) - box.width)).toBeLessThanOrEqual(2);
  expect(Math.abs(png.readUInt32BE(20) - box.height)).toBeLessThanOrEqual(2);
});

test('voice notes: one on a comment, one on its own; the server transcribes both', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);

  await page.keyboard.press('c');
  await page.getByTestId('dead').click();
  await expect(ui(page, 'review-composer')).toBeVisible();
  await ui(page, 'review-comment').fill('Export does nothing, listen');
  await ui(page, 'review-composer-voice-toggle').click();
  await expect(ui(page, 'review-composer-recording')).toBeVisible();
  await sleep(1800);
  await ui(page, 'review-composer-voice-toggle').click();
  await expect(ui(page, 'review-composer-voice')).toBeVisible();
  await ui(page, 'review-add').click();
  await page.keyboard.press('Escape'); // comment tool off

  // a voice note on its own (the whole page or trace), from the pill
  await page.keyboard.press('v');
  await expect(ui(page, 'review-voice-time')).toBeVisible();
  await sleep(1800);
  await page.keyboard.press('v');
  await expect(ui(page, 'review-composer')).toHaveAttribute('data-kind', 'voice');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-count')).toHaveText('2');

  const res = await send(page, sw);
  const list = await items(page, res.recordingId);
  expect(list.map((i) => i.kind)).toEqual(['element', 'voice']);
  for (const it of list) {
    expect(it.voiceUrl).toBeTruthy();
    expect(it.voiceDurationMs).toBeGreaterThan(1000);
    const audio = await page.request.get(SERVER_URL + new URL(it.voiceUrl!, SERVER_URL).pathname);
    expect(audio.headers()['content-type']).toContain('audio/webm');
    expect((await audio.body()).length).toBeGreaterThan(1000);
  }
  // the fake microphone plays a tone, so the transcript is done and may be empty
  await expect
    .poll(async () => (await items(page, res.recordingId)).map((i) => i.transcript?.status), { timeout: 90_000, intervals: [2000] })
    .toEqual(['done', 'done']);
});

test('pins stay on the page after a reload; the list shows the notes, opens and deletes them; Esc backs out', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  await page.keyboard.press('c');
  await page.getByTestId('works').click();
  await ui(page, 'review-comment').fill('First note');
  await page.keyboard.press('Enter');
  await page.getByTestId('dead').click();
  await ui(page, 'review-comment').fill('Second note');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-pin')).toHaveCount(2);

  await page.reload();
  // a tab with unsent notes wakes by itself, and the pins come back where they were
  await expect(ui(page, 'review-pill')).toBeVisible({ timeout: 15_000 });
  await expect(ui(page, 'review-pin')).toHaveCount(2);
  const pin = await ui(page, 'review-pin').first().boundingBox();
  const btn = await page.getByTestId('works').boundingBox();
  expect(pin!.x + pin!.width / 2).toBeGreaterThanOrEqual(btn!.x - 1);
  expect(pin!.x + pin!.width / 2).toBeLessThanOrEqual(btn!.x + btn!.width + 1);

  await page.keyboard.press('h');
  await expect(ui(page, 'review-pin')).toHaveCount(0);
  await page.keyboard.press('h');
  await expect(ui(page, 'review-pin')).toHaveCount(2);

  await page.keyboard.press('l');
  await expect(ui(page, 'review-list-item')).toHaveCount(2);
  await ui(page, 'review-list-item').first().locator('button').first().click();
  await expect(ui(page, 'review-comment')).toHaveValue('First note');
  await ui(page, 'review-comment').fill('First note, edited');
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-list-item').first()).toContainText('First note, edited');
  await ui(page, 'review-list-item').nth(1).getByRole('button', { name: /Delete note 2/ }).click();
  await expect(ui(page, 'review-list-item')).toHaveCount(1);

  // Esc: list, then the toolbar
  await page.keyboard.press('Escape');
  await expect(ui(page, 'review-list')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(ui(page, 'review-launcher')).toBeVisible();
  await expect(ui(page, 'review-badge')).toHaveText('1');
  // the chord wakes it again from anywhere
  await page.keyboard.press('Control+Shift+Period');
  await expect(ui(page, 'review-pill')).toBeVisible();
});

test('Start trace and Stop trace from the pill: notes made during the trace go onto it', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  const start = ui(page, 'review-trace-start');
  test.skip(await start.isDisabled(), 'needs the trace work package (p4/trace): this build has no trace.start');

  await start.click();
  await expect(ui(page, 'review-trace-time')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('works').click(); // the app works normally while tracing
  await sleep(700);
  await page.keyboard.press('c');
  await page.getByTestId('dead').click();
  await ui(page, 'review-comment').fill('Export is dead during the trace');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  const before = (await submits(sw)).length;
  await ui(page, 'review-trace-stop').click();
  await expect.poll(async () => (await submits(sw)).length, { timeout: 30_000 }).toBe(before + 1);
  const res = (await submits(sw))[before]!;
  expect(res).toMatchObject({ count: 1, trace: true });
  await expect(ui(page, 'review-trace-start')).toBeVisible({ timeout: 30_000 });
  const [it] = await items(page, res.recordingId);
  expect(it).toMatchObject({ kind: 'element', comment: 'Export is dead during the trace', target: { testId: 'dead' } });
  const detail = await (await page.request.get(`${SERVER_URL}/api/v1/recordings/${res.recordingId}`)).json();
  expect(detail.kind).toBe('trace');
  // the note is an action of the trace: its span engine got an annotation event
  await expect
    .poll(async () => {
      const r = await page.request.get(`${SERVER_URL}/api/v1/recordings/${res.recordingId}/spans`);
      return r.ok() ? ((await r.json()).items as { action: { type: string } }[]).filter((s) => s.action.type === 'annotation').length : -1;
    }, { timeout: 30_000 })
    .toBe(1);
});

test('the X closes the toolbar on this site, across reloads and tabs, until the extension icon is clicked; a running trace asks first (D-205)', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  const url = `${LAB_URL}/?close-site=${Date.now()}`;
  const gone = async (p: Page) => {
    await p.waitForTimeout(800);
    await expect(ui(p, 'review-launcher')).toHaveCount(0);
    await expect(ui(p, 'review-pill')).toHaveCount(0);
  };
  try {
    await page.goto(url);
    await page.bringToFront();
    await expect(ui(page, 'review-launcher').or(ui(page, 'review-pill'))).toBeVisible({ timeout: 15_000 });
    await wake(page);
    // Esc and the chevron only collapse it to the launcher
    await ui(page, 'review-close').click();
    await expect(ui(page, 'review-launcher')).toBeVisible();
    await wake(page);

    const start = ui(page, 'review-trace-start');
    const tracing = !(await start.isDisabled());
    if (tracing) {
      await start.click();
      await expect(ui(page, 'review-trace-time')).toBeVisible({ timeout: 20_000 });
      // never stopped silently: the X asks inline, and nothing closes until an answer
      await ui(page, 'review-close-site').click();
      await expect(ui(page, 'review-close-confirm')).toContainText('Stop trace?');
      await expect(ui(page, 'review-pill')).toBeVisible();
      await ui(page, 'review-close-keep').click();
    } else {
      await ui(page, 'review-close-site').click();
    }
    await gone(page);
    expect(await sw.evaluate(async (o) => Object.keys((await chrome.storage.local.get('tb:toolbar-closed'))['tb:toolbar-closed'] ?? {}).includes(o), new URL(LAB_URL).origin)).toBe(true);
    // closed after a reload and in another tab of the origin; captures keep working there
    await page.reload();
    await gone(page);
    const second = await context.newPage();
    await second.goto(`${LAB_URL}/form`);
    await gone(second);
    await second.close();

    // the extension icon on this site (the popup over this tab) shows it again
    const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t: { url?: string }) => t.url === u)?.id, url);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html?tabId=${tabId}`);
    await expect(popup.locator('[data-popup][data-loading="false"]')).toBeVisible();
    await page.bringToFront();
    await expect(ui(page, 'review-launcher').or(ui(page, 'review-pill'))).toBeVisible({ timeout: 15_000 });
    await popup.close();
    if (tracing) {
      // Keep left the trace running; the X's Stop ends it and closes the toolbar
      await wake(page);
      await expect(ui(page, 'review-trace-time')).toBeVisible();
      await ui(page, 'review-close-site').click();
      await ui(page, 'review-close-stop').click();
      await gone(page);
      const tab = await context.newPage();
      await tab.goto(`chrome-extension://${EXT_ID}/popup.html?tabId=${tabId}`);
      await page.bringToFront();
      await wake(page);
      await expect(ui(page, 'review-trace-start')).toBeVisible({ timeout: 30_000 });
      await tab.close();
    }
  } finally {
    await sw.evaluate(() => chrome.storage.local.remove('tb:toolbar-closed'));
    await page.close();
  }
});

test('the reviewer toolbar steps aside while screenshot mode owns the page, and comes back after', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  const tabId = await sw.evaluate(async (url) => {
    const tabs = (await chrome.tabs.query({})) as { id: number; url?: string }[];
    return Math.max(...tabs.filter((t) => t.url?.startsWith(url)).map((t) => t.id));
  }, LAB_URL);
  type Hooks = { command(n: string, t: number): Promise<void>; session(): Promise<{ state: string }> };
  await sw.evaluate((id) => (globalThis as unknown as { __tbUi: Hooks }).__tbUi.command('screenshot-mode', id), tabId);
  await expect.poll(() => sw.evaluate(() => (globalThis as unknown as { __tbUi: Hooks }).__tbUi.session().then((s) => s.state))).toBe('arming-screenshot');
  await expect(ui(page, 'review-pill')).toBeHidden();
  await expect(ui(page, 'review-launcher')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect.poll(() => sw.evaluate(() => (globalThis as unknown as { __tbUi: Hooks }).__tbUi.session().then((s) => s.state))).toBe('idle');
  await expect(ui(page, 'review-launcher')).toBeVisible();
});

test('keyboard focus shows on every control of the composer and the pill (D-181)', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  await page.keyboard.press('c');
  await page.getByTestId('works').click();
  await expect(ui(page, 'review-composer')).toBeVisible();
  // a voice note on the comment, so its remove button is in the walk too
  await ui(page, 'review-composer-voice-toggle').click();
  await expect(ui(page, 'review-composer-recording')).toBeVisible();
  await sleep(1200);
  await ui(page, 'review-composer-voice-toggle').click();
  await expect(ui(page, 'review-composer-voice')).toBeVisible();
  await ui(page, 'review-comment').focus();
  // Tab through the toolbar's shadow root and keep each stop; then compare it focused and blurred
  await page.evaluate(() => ((window as unknown as { __stops: Element[] }).__stops = []));
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    await sleep(60);
    const done = await page.evaluate(() => {
      const root = document.querySelector('toolbar-root')!.shadowRoot!;
      const el = root.activeElement;
      const stops = (window as unknown as { __stops: Element[] }).__stops;
      if (!el) return stops.length > 0; // left the toolbar
      if (stops.includes(el)) return true;
      const cs = getComputedStyle(el);
      el.setAttribute('data-focused-style', JSON.stringify([cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor, cs.backgroundColor]));
      stops.push(el);
      return false;
    });
    if (done) break;
  }
  const report = await page.evaluate(() => {
    const stops = (window as unknown as { __stops: HTMLElement[] }).__stops;
    (document.querySelector('toolbar-root')!.shadowRoot!.activeElement as HTMLElement | null)?.blur();
    return stops.map((el) => {
      const cs = getComputedStyle(el);
      const idle = [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor, cs.backgroundColor];
      const focused = JSON.parse(el.getAttribute('data-focused-style')!) as string[];
      const ring = focused[0] !== 'none' && parseFloat(focused[1]!) >= 2;
      const changed = ring || focused.slice(3).some((v, i) => v !== idle[i + 3]);
      return { name: el.getAttribute('aria-label') ?? el.getAttribute('data-testid') ?? el.tagName.toLowerCase(), changed };
    });
  });
  console.log(`reviewer focus walk: ${report.map((r) => `${r.name}${r.changed ? '' : ' (NO CHANGE)'}`).join(', ')}`);
  expect(report.length, 'the walk reached the composer controls').toBeGreaterThan(4);
  expect(report.filter((r) => !r.changed).map((r) => r.name)).toEqual([]);
});

test('a standalone voice note keeps what is typed while it is saved: the comment and Enter (D-181)', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  await page.keyboard.press('v');
  await expect(ui(page, 'review-voice-time')).toBeVisible();
  await sleep(1500);
  const before = (await ui(page, 'review-count').count()) ? Number(await ui(page, 'review-count').textContent()) : 0;
  // stop and type at once, without waiting for the composer
  await page.keyboard.press('v');
  await page.keyboard.type('Listen to this', { delay: 5 });
  await page.keyboard.press('Enter');
  await expect(ui(page, 'review-count')).toHaveText(String(before + 1));
  await expect(ui(page, 'review-composer')).toBeHidden();
  const state = await sw.evaluate(() => (globalThis as unknown as { __tbReview: { state(): Promise<Record<string, { items: { kind: string; comment: string }[] }>> } }).__tbReview.state());
  const voice = Object.values(state).flatMap((t) => t.items).filter((i) => i.kind === 'voice');
  expect(voice.at(-1)?.comment).toBe('Listen to this');
});

test('at 390 px the pill wraps onto two rows: Send and Close stay on screen and work (D-185)', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  await page.keyboard.press('c');
  await page.getByTestId('works').click();
  await ui(page, 'review-comment').fill('Narrow screen note');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const pill = (await ui(page, 'review-pill').boundingBox())!;
  expect(pill.x).toBeGreaterThanOrEqual(0);
  expect(pill.x + pill.width).toBeLessThanOrEqual(390);
  expect(pill.height, 'two rows').toBeGreaterThan(60);
  for (const id of ['review-send', 'review-close', 'review-hide-pins']) {
    const b = (await ui(page, id).boundingBox())!;
    expect(b.x, id).toBeGreaterThanOrEqual(pill.x);
    expect(b.x + b.width, id).toBeLessThanOrEqual(pill.x + pill.width + 0.5);
  }
  const sent = await send(page, sw);
  expect(sent.count).toBe(1);
});

/** The box of a test id, once it has settled (the dock is re-fitted on the next frame). */
async function settled(page: Page, id: string) {
  let last = '';
  await expect
    .poll(async () => {
      const b = await ui(page, id).boundingBox();
      const now = JSON.stringify(b && [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]);
      const same = now === last;
      last = now;
      return same && !!b;
    })
    .toBe(true);
  return (await ui(page, id).boundingBox())!;
}

/** Fully inside the viewport. */
function onScreen(b: { x: number; y: number; width: number; height: number }, vw: number, vh: number, what: string) {
  expect(b.x, `${what} left`).toBeGreaterThanOrEqual(0);
  expect(b.y, `${what} top`).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width, `${what} right`).toBeLessThanOrEqual(vw);
  expect(b.y + b.height, `${what} bottom`).toBeLessThanOrEqual(vh);
}

test('Add while a voice note records: one click stops it, attaches the audio and adds the note (D-199)', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  await page.keyboard.press('c');
  await page.getByTestId('dead').click();
  await expect(ui(page, 'review-composer')).toBeVisible();
  await ui(page, 'review-comment').fill('Listen while I click Add');
  await ui(page, 'review-composer-voice-toggle').click();
  await expect(ui(page, 'review-composer-recording')).toBeVisible();
  await sleep(1800);
  // Add while it records, and a second click before the clip is saved (a person who sees nothing
  // happen clicks again): one note, with its clip. Both clicks land in one task, so the second
  // always comes while the first still waits for the microphone to stop.
  await ui(page, 'review-add').evaluate((b: HTMLElement) => {
    b.click();
    b.click();
  });
  await expect(ui(page, 'review-composer')).toBeHidden();
  await expect(ui(page, 'review-count')).toHaveText('1');
  await page.waitForTimeout(500);
  await expect(ui(page, 'review-count')).toHaveText('1');
  await page.keyboard.press('Escape');

  const res = await send(page, sw);
  const [it, ...rest] = await items(page, res.recordingId);
  expect(rest).toEqual([]);
  expect(it).toMatchObject({ kind: 'element', comment: 'Listen while I click Add' });
  expect(it!.voiceUrl, 'the clip went with the note').toBeTruthy();
  expect(it!.voiceDurationMs).toBeGreaterThan(1000);
  const audio = await page.request.get(SERVER_URL + new URL(it!.voiceUrl!, SERVER_URL).pathname);
  expect(audio.headers()['content-type']).toContain('audio/webm');
  expect((await audio.body()).length).toBeGreaterThan(1000);
});

test('the composer\'s Add is the flat accent in both themes, with hover, press and focus states, and fits at 390 px (D-199)', async ({ context, sw }) => {
  const page = await context.newPage();
  await signIn(page, sw);
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    await openLab(page);
    await wake(page);
    await page.keyboard.press('c');
    await page.getByTestId('works').click();
    await expect(ui(page, 'review-composer')).toBeVisible();
    const add = ui(page, 'review-add');
    const style = () => add.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, color: cs.color, shadow: cs.boxShadow, card: getComputedStyle(el.closest('[data-testid="review-composer"]')!).backgroundColor };
    });
    const idle = await style();
    // dark: near-white on the near-black card with near-black text; light: black with white text
    if (scheme === 'dark') {
      expect(idle.bg).toBe('rgb(250, 250, 250)');
      expect(idle.color).toBe('rgb(11, 11, 11)');
      expect(idle.card).toBe('rgb(19, 19, 19)');
    } else {
      expect(idle.bg).toBe('rgb(0, 0, 0)');
      expect(idle.color).toBe('rgb(255, 255, 255)');
    }
    expect(idle.shadow, 'no lift shadow on a card button').toBe('none');
    await add.hover();
    await expect.poll(async () => (await style()).bg).not.toBe(idle.bg);
    await page.mouse.move(5, 5);
    await add.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect.poll(async () => (await style()).shadow, 'focus ring').not.toBe('none');
    // at phone width the card and its whole footer stay on screen
    await page.setViewportSize({ width: 390, height: 844 });
    const card = await settled(page, 'review-composer');
    onScreen(card, 390, 844, 'composer');
    for (const id of ['review-add', 'review-cancel', 'review-intent', 'review-severity', 'review-composer-voice-toggle']) {
      const b = (await ui(page, id).boundingBox())!;
      expect(b.x, id).toBeGreaterThanOrEqual(card.x);
      expect(b.x + b.width, id).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
    // one footer line: the tags are not cut, Add sits level with the microphone
    const mic = (await ui(page, 'review-composer-voice-toggle').boundingBox())!;
    const addBox = (await add.boundingBox())!;
    expect(Math.abs(addBox.y + addBox.height / 2 - (mic.y + mic.height / 2))).toBeLessThanOrEqual(1);
    expect(await ui(page, 'review-severity').evaluate((el: HTMLSelectElement) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`composer-${scheme}-390.png`) });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }
  await page.emulateMedia({ colorScheme: null });
});

test('a dragged toolbar stays fully on screen when the window shrinks to 700 and 390 px, and goes back when it grows (D-199)', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, sw);
  await openLab(page);
  await wake(page);
  // by default it sits bottom right, away from the page's header
  const first = await settled(page, 'review-dock');
  await expect(ui(page, 'review-dock')).toHaveAttribute('data-corner', 'br');
  expect(first.x + first.width).toBeGreaterThan(1440 - 40);
  expect(first.y + first.height).toBeGreaterThan(900 - 40);

  // drag it by its grip to the upper left part of the page
  const g = (await ui(page, 'review-grip').boundingBox())!;
  await drag(page, [
    [g.x + g.width / 2, g.y + g.height / 2],
    [g.x - 100, g.y - 100],
    [420, 300],
  ]);
  await expect(ui(page, 'review-dock')).toHaveAttribute('data-corner', 'tl');
  const home = await settled(page, 'review-dock');
  expect(Math.abs(home.y - (300 - (g.y + g.height / 2 - first.y)))).toBeLessThanOrEqual(3);

  for (const [w, h] of [
    [700, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    onScreen(await settled(page, 'review-dock'), w, h, `pill at ${w}`);
    // the notes list opens beside it, on screen too
    await page.keyboard.press('l');
    onScreen(await settled(page, 'review-list'), w, h, `list at ${w}`);
    await page.keyboard.press('l');
    // a composer opened here, then a narrower window: still on screen
    await page.keyboard.press('c');
    await page.getByTestId('works').click();
    onScreen(await settled(page, 'review-composer'), w, h, `composer at ${w}`);
    await page.setViewportSize({ width: w - 60, height: h - 100 });
    onScreen(await settled(page, 'review-composer'), w - 60, h - 100, `composer at ${w - 60}`);
    onScreen(await settled(page, 'review-dock'), w - 60, h - 100, `pill at ${w - 60}`);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  }

  // a wide window again: back at the spot it was dragged to
  await page.setViewportSize({ width: 1440, height: 900 });
  const back = await settled(page, 'review-dock');
  expect(Math.abs(back.x - home.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(back.y - home.y)).toBeLessThanOrEqual(2);

  // a press that ends in pointercancel (a DevTools dock change) leaves the toolbar where it was
  const grip = ui(page, 'review-grip');
  const gb = (await grip.boundingBox())!;
  await page.mouse.move(gb.x + 8, gb.y + 16);
  await page.mouse.down();
  await page.mouse.move(gb.x + 60, gb.y + 80, { steps: 3 });
  await grip.dispatchEvent('pointercancel', { pointerId: 1, isPrimary: true });
  await page.mouse.up();
  const after = await settled(page, 'review-dock');
  expect(Math.abs(after.x - home.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - home.y)).toBeLessThanOrEqual(2);
  await expect(ui(page, 'review-dock')).not.toHaveClass(/dragging/);
});

test('the collapsed launcher drags past a small threshold, keeps its spot per origin after a reload, and a click still opens the toolbar (D-199)', async ({ context, sw }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, sw);
  await openLab(page);
  const launcher = ui(page, 'review-launcher');
  await expect(launcher).toBeVisible();
  const l0 = await settled(page, 'review-launcher');
  // bottom right, 20 px in (plus the page's scrollbar)
  expect(l0.x + l0.width).toBeGreaterThan(1440 - 40);
  expect(l0.y + l0.height).toBeGreaterThan(900 - 40);

  // a press that moves 2 px is still a click: the toolbar opens, fully on screen
  await page.mouse.move(l0.x + 22, l0.y + 22);
  await page.mouse.down();
  await page.mouse.move(l0.x + 24, l0.y + 22);
  await page.mouse.up();
  await expect(ui(page, 'review-pill')).toBeVisible();
  onScreen(await settled(page, 'review-dock'), 1440, 900, 'pill');
  await ui(page, 'review-close').click();
  await expect(launcher).toBeVisible();

  // a real drag moves it and does not open the toolbar
  await drag(page, [
    [l0.x + 22, l0.y + 22],
    [l0.x - 40, l0.y - 20],
    [200, 520],
  ]);
  await expect(ui(page, 'review-pill')).toBeHidden();
  const l1 = await settled(page, 'review-launcher');
  expect(Math.abs(l1.x + 22 - 200)).toBeLessThanOrEqual(3);
  expect(Math.abs(l1.y + 22 - 520)).toBeLessThanOrEqual(3);
  await expect(ui(page, 'review-dock')).toHaveAttribute('data-corner', 'bl');

  // the arrow keys move it too
  await launcher.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => Math.round((await launcher.boundingBox())!.y)).toBe(Math.round(l1.y) - 10);
  const l2 = (await launcher.boundingBox())!;

  // a reload keeps the spot for this origin
  await page.reload();
  await expect(launcher).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => Math.round((await launcher.boundingBox())!.x)).toBe(Math.round(l2.x));
  await expect.poll(async () => Math.round((await launcher.boundingBox())!.y)).toBe(Math.round(l2.y));
  onScreen((await launcher.boundingBox())!, 1440, 900, 'launcher after reload');

  // another origin keeps its own spot: the default, bottom right
  await openLab(page, '/', LAB_URL.replace('localhost', '127.0.0.1'));
  const other = await settled(page, 'review-launcher');
  expect(other.x + other.width).toBeGreaterThan(1440 - 40);

  // a narrow window keeps the moved launcher on screen; a click opens the pill on screen
  await openLab(page);
  await page.setViewportSize({ width: 390, height: 844 });
  onScreen(await settled(page, 'review-launcher'), 390, 844, 'launcher at 390');
  await launcher.click();
  await expect(ui(page, 'review-pill')).toBeVisible();
  onScreen(await settled(page, 'review-dock'), 390, 844, 'pill at 390');
});
