// Part 2 reviewer toolbar (PLAN "What the reviewer can do"), one test per action on the lab app:
// comment on an element (hover label, click blocked from the app, inline composer, 60 s context),
// highlight text and comment, rectangle, arrow and freehand on the live page, element
// screenshot, voice notes (on a comment and on their own), pins that survive a reload with the
// compact list, Start and Stop trace from the pill, and submit to the server.
// Runs against a real server (SERVER_URL) with the mock OIDC provider: the test signs in, makes a
// personal token and gives it to the extension, then reads what the server stored.
import type { Locator, Page, Worker } from '@playwright/test';
import { LAB_URL, SERVER_URL, expect, test } from '../../fixtures/extension.ts';
import { signInOidc } from '../../fixtures/oidc.ts';

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

async function openLab(page: Page, path = '/') {
  await page.goto(LAB_URL + path);
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
