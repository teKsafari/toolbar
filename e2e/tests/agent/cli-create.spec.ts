// Captures made by agents through the CLI, against the lab app: J-244 annotated screenshot, J-245
// video with a Playwright trace, J-246 recording of a browser driven through the CDP proxy, and
// J-247 reads of the results to files. Needs the CLI build (pnpm --filter @toolbar/cli build),
// ffmpeg on PATH, the lab (LAB_URL) and a personal token with CLI write scope in TOOLBAR_E2E_TOKEN
// (the seed prints one). Skips what it cannot run.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, chromium } from '@playwright/test';
import { SERVER } from '../auth/helpers.ts';

const CLI = new URL('../../../packages/cli/dist/open-toolbar.mjs', import.meta.url).pathname;
const LAB = process.env.LAB_URL ?? 'http://localhost:5173';
const TOKEN = process.env.TOOLBAR_E2E_TOKEN ?? '';
const CDP_PORT = Number(process.env.TOOLBAR_E2E_CDP_PORT ?? 9317);
const dir = mkdtempSync(join(tmpdir(), 'tb-cli-e2e-'));
const env = { ...process.env, TOOLBAR_SERVER: SERVER, TOOLBAR_TOKEN: TOKEN, TOOLBAR_CONFIG: join(dir, 'none.json') };
const cli = (...args: string[]) => JSON.parse(execFileSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8', cwd: dir, timeout: 120_000 })) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const labUp = await fetch(LAB).then((r) => r.ok, () => false);

test.describe.configure({ mode: 'serial' });
// the J-245 run records its own trace
test.use({ trace: 'off' });
test.skip(!existsSync(CLI) || !TOKEN || !labUp, 'needs the CLI build, TOOLBAR_E2E_TOKEN and the lab app');

test('J-244 open-toolbar create --json: numbered marks drawn in, notes in the description', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(LAB);
  await page.screenshot({ path: join(dir, 'lab.png') });
  await browser.close();
  writeFileSync(
    join(dir, 'payload.json'),
    JSON.stringify({
      title: 'Agent proof',
      url: LAB,
      screen: { w: 1280, h: 720 },
      image: 'lab.png',
      marks: [
        { type: 'box', x: 30, y: 270, w: 300, h: 60, note: 'Buttons' },
        { type: 'arrow', x1: 700, y1: 500, x2: 560, y2: 310, note: 'The failing one' },
        { type: 'text', x: 700, y: 520, text: 'Hidden 500' },
        { type: 'redact', x: 0, y: 0, w: 120, h: 40 },
        { type: 'blur', x: 20, y: 140, w: 400, h: 40 },
      ],
    }),
  );
  const r = cli('create', '--json', join(dir, 'payload.json'));
  expect(r).toMatchObject({ kind: 'screenshot', marks: 5, numbered: 2 });
  expect(r.url).toMatch(new RegExp(`^${SERVER}/s/`));
  const d = cli('get', r.id, '--json');
  expect(d.description).toContain('1. Buttons\n2. The failing one');
  const shots = cli('screenshots', r.id, '--out', join(dir, 'shots'));
  expect(shots.files).toHaveLength(1);
});

test('J-245 open-toolbar create video --trace: console, network and typing synced, password masked', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: join(dir, 'video'), size: { width: 1280, height: 720 } } });
  await context.tracing.start({ snapshots: true });
  const page = await context.newPage();
  await page.goto(LAB);
  await page.getByTestId('hidden-500').click();
  await page.waitForTimeout(500);
  await page.goto(`${LAB}/form`);
  await page.fill('input[name="email"]', 'agent@toolbar.test');
  await page.fill('input[name="password"]', 'hunter2-secret');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForTimeout(500);
  await context.tracing.stop({ path: join(dir, 'trace.zip') });
  await context.close();
  await browser.close();
  const video = join(dir, 'video', readdirSync(join(dir, 'video'))[0]!);
  const r = cli('create', video, '--trace', join(dir, 'trace.zip'), '--title', 'E2E trace run');
  expect(r.trace.requests).toBeGreaterThan(0);
  await expect.poll(() => cli('get', r.id, '--json').status, { timeout: 60_000 }).toBe('ready');
  const net = cli('network', r.id, '--status', '5xx');
  expect(net.items[0].status).toBe(500);
  expect(net.items[0].responseBody).toBeTruthy();
  const acts = cli('actions', r.id, '--all');
  const pw = acts.items.find((a: { target?: { selector?: string } }) => a.target?.selector?.includes('password'));
  expect(pw).toMatchObject({ masked: true });
  expect(JSON.stringify(acts)).not.toContain('hunter2');
  const f = cli('frames', r.id, '--at', '1000', '--out', join(dir, 'frames'));
  expect(readFileSync(f.files[0]).subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
});

test('J-246 open-toolbar record --cdp around an agent run: video, console, errors, network, logged clicks', async () => {
  const chrome = chromium.executablePath();
  const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(dir, 'profile')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  try {
    await expect.poll(() => fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.ok, () => false), { timeout: 20_000 }).toBe(true);
    const agent = join(dir, 'agent.mjs');
    const pwPath = new URL(import.meta.resolve('@playwright/test')).pathname;
    writeFileSync(
      agent,
      `import { chromium } from ${JSON.stringify(pwPath)};
const b = await chromium.connectOverCDP(process.env.TOOLBAR_CDP_PROXY);
const page = b.contexts()[0].pages()[0] ?? (await b.contexts()[0].newPage());
await page.goto(${JSON.stringify(LAB)});
await page.getByTestId('hidden-500').click();
await page.waitForTimeout(500);
await page.getByTestId('throws').click();
await page.waitForTimeout(500);
await b.close().catch(() => {});`,
    );
    const r = cli('record', '--cdp', `http://127.0.0.1:${CDP_PORT}`, '--title', 'E2E agent run', '--', process.execPath, agent);
    expect(r.commandExitCode).toBe(0);
    expect(r.stats.clicks).toBeGreaterThanOrEqual(2);
    expect(r.stats.proxyInputs).toBeGreaterThanOrEqual(2);
    expect(r.stats.frames).toBeGreaterThan(0);
    await expect.poll(() => cli('get', r.id, '--json').status, { timeout: 60_000 }).toBe('ready');
    const s = cli('get', r.id, '--json').signals;
    expect(s.serverErrors).toBeGreaterThanOrEqual(1);
    expect(s.uncaughtErrors).toBeGreaterThanOrEqual(1);
    const clicks = cli('actions', r.id, '--type', 'click').items;
    expect(clicks.map((c: { target: { testId?: string } }) => c.target.testId)).toEqual(expect.arrayContaining(['hidden-500', 'throws']));
    const net = cli('network', r.id, '--status', '5xx');
    expect(Object.keys(net.items[0].requestHeaders ?? {}).length).toBeGreaterThan(0);
  } finally {
    proc.kill();
  }
});
