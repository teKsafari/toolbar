// Zero integration (PLAN "Zero integration" and "Privacy", D-117 to D-121) in the test build:
// with `tb:test-scope` set to 'projects' the worker behaves as a release build does, so the
// capture scripts run on the project origins only, the popup explains the rest, captures there
// are refused, and the project's masking preset decides what leaves the page. The release
// build's permission prompt is covered by flow Q (e2e/flows/q-zero-integration.spec.ts).
import type { Page, Worker } from '@playwright/test';
import { test, expect, EXT_ID, LAB_URL } from '../../fixtures/extension.ts';
import { BOOT } from '../boot.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;
declare const __tb: { sync(): Promise<string[]>; registered(): Promise<{ id: string; matches: string[] }[]>; events(): { kind: string; data: Record<string, unknown> }[]; stats(): { pages: string[] } };

/** Same lab page on another origin: not a project origin. */
const OTHER = LAB_URL.replace('localhost', '127.0.0.1');

interface P {
  maskingPreset: 'staging' | 'production';
  bodyAllowlist?: string[];
  origins?: string[];
}

async function useProjects(sw: Worker, p: P | null) {
  return sw.evaluate(
    async ({ p, lab }) => {
      if (!p) await chrome.storage.local.remove(['tb:auth', 'tb:bootstrap']);
      else
        await chrome.storage.local.set({
          'tb:test-scope': 'projects',
          'tb:auth': { serverUrl: 'http://127.0.0.1:9', token: 'tb_dev_zero', tokenId: 't0', user: { id: 'u0', name: 'Zero', email: 'zero@zero.test', image: null }, activeWorkspaceId: 'w0', signedInAt: Date.now() },
          'tb:bootstrap': {
            at: Date.now(),
            data: {
              limits: { chunkBytes: 1048576, maxRecordingMs: null, aiAvailable: false },
              projects: [{ id: 'p0', workspaceId: 'w0', name: 'Lab', origins: p.origins ?? [lab], maskingPreset: p.maskingPreset, bodyAllowlist: p.bodyAllowlist ?? [] }],
            },
          },
        });
      return __tb.sync();
    },
    { p, lab: LAB_URL },
  );
}

const booted = (page: Page, boot: string) => page.evaluate((k) => !!(window as unknown as Record<symbol, unknown>)[Symbol.for(k)], boot);

async function tabIdOf(sw: Worker, url: string): Promise<number> {
  return sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t: { url?: string }) => t.url?.startsWith(u))?.id, url);
}

test.describe('zero integration: project origins only', () => {
  test.afterAll(async ({ sw }) => {
    // back to the Part 1 scope for the other suites in this worker
    await sw.evaluate(async () => {
      await chrome.storage.local.remove(['tb:test-scope', 'tb:auth', 'tb:bootstrap']);
      return __tb.sync();
    });
  });

  test('capture scripts are registered for the granted project origins and run nowhere else', async ({ context, sw }) => {
    const patterns = await useProjects(sw, { maskingPreset: 'staging' });
    expect(patterns).toEqual([`${LAB_URL}/*`]);
    const reg = await sw.evaluate(() => __tb.registered());
    expect(reg.filter((r) => r.id.startsWith('capture')).map((r) => r.matches)).toEqual([[`${LAB_URL}/*`], [`${LAB_URL}/*`]]);

    const lab = await context.newPage();
    await lab.goto(LAB_URL);
    await expect.poll(() => booted(lab, BOOT)).toBe(true);
    const other = await context.newPage();
    await other.goto(OTHER);
    await other.getByTestId('works').click();
    await other.waitForTimeout(500);
    expect(await booted(other, BOOT)).toBe(false);
    const pages = (await sw.evaluate(() => __tb.stats())).pages;
    expect(pages.some((u) => u.startsWith(OTHER))).toBe(false);
    expect(pages.some((u) => u.startsWith(LAB_URL))).toBe(true);
    // nothing from the other origin reached the worker
    const events = await sw.evaluate(() => __tb.events());
    expect(JSON.stringify(events)).not.toContain('127.0.0.1:5173');

    // the popup over the other page explains, and a capture there is refused
    const otherTab = await tabIdOf(sw, OTHER);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html?tabId=${otherTab}`);
    await expect(popup.getByTestId('site-access')).toHaveAttribute('data-state', 'not-in-project');
    const refused = await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'capture', mode: 'screenshot', tabId }), otherTab);
    expect(refused).toMatchObject({ ok: false, error: 'permission_denied' });
    expect(await booted(other, BOOT)).toBe(false);

    // over the project page the capture rows are there, with the project and its preset
    await popup.goto(`chrome-extension://${EXT_ID}/popup.html?tabId=${await tabIdOf(sw, LAB_URL)}`);
    await expect(popup.getByTestId('site-project')).toContainText('Lab');
    await expect(popup.getByTestId('site-project')).toHaveAttribute('data-preset', 'staging');
    await expect(popup.getByTestId('site-access')).toHaveCount(0);
    await popup.close();
    await other.close();
    await lab.close();
  });

  test('production preset: masked text, no bodies outside the allowlist, preset in the env', async ({ context, sw }) => {
    await useProjects(sw, { maskingPreset: 'production', bodyAllowlist: [`${LAB_URL}/api/ok`] });
    const lab = await context.newPage();
    await lab.goto(LAB_URL);
    await expect.poll(() => booted(lab, BOOT)).toBe(true);
    await lab.getByTestId('works').click();
    await lab.getByTestId('hidden-500').click();
    await expect(lab.getByTestId('status')).toContainText('saved');

    type Ev = { kind: string; data: Record<string, unknown> };
    const find = async () => {
      const ev = (await sw.evaluate(() => __tb.events())) as Ev[];
      const req = (path: string) => ev.filter((e) => e.kind === 'net.req' && String(e.data.url).includes(path)).at(-1);
      const res = (rid: unknown) => ev.find((e) => e.kind === 'net.res' && e.data.rid === rid);
      return { ev, ok: req('/api/ok'), fail: req('/api/fail'), res };
    };
    await expect.poll(async () => {
      const f = await find();
      return !!(f.ok && f.fail && f.res(f.ok.data.rid) && f.res(f.fail.data.rid));
    }, { timeout: 15_000 }).toBe(true);
    const f = await find();
    expect(f.res(f.ok!.data.rid)!.data.body).toBeTruthy(); // allowlisted
    expect(f.res(f.fail!.data.rid)!.data.body).toBeUndefined();
    expect(f.res(f.fail!.data.rid)!.data.bodyOmitted).toBe('masking');
    const click = f.ev.filter((e) => e.kind === 'user' && (e.data as { type?: string }).type === 'click').at(-1)!;
    const target = (click.data as { target?: { text?: string; name?: string } }).target;
    expect(target?.text ?? '').toMatch(/^[*\s]*$/); // page text is masked; test ids and roles stay
    expect(target?.name ?? '').toMatch(/^[*\s]*$/);
    const env = f.ev.filter((e) => e.kind === 'env').at(-1);
    expect(env?.data.maskingPreset).toBe('production');
    await lab.close();
  });

  test('staging preset keeps the page origin’s bodies; signing out removes every capture script', async ({ context, sw }) => {
    await useProjects(sw, { maskingPreset: 'staging' });
    const lab = await context.newPage();
    await lab.goto(LAB_URL);
    await expect.poll(() => booted(lab, BOOT)).toBe(true);
    await lab.getByTestId('hidden-500').click();
    await expect.poll(async () => {
      const ev = (await sw.evaluate(() => __tb.events())) as { kind: string; data: Record<string, unknown> }[];
      const req = ev.filter((e) => e.kind === 'net.req' && String(e.data.url).includes('/api/fail')).at(-1);
      const res = req && ev.find((e) => e.kind === 'net.res' && e.data.rid === req.data.rid);
      return res ? (res.data.bodyOmitted ?? (res.data.body ? 'kept' : 'none')) : null;
    }, { timeout: 15_000 }).toBe('kept');
    await lab.close();

    expect(await useProjects(sw, null)).toEqual([]);
    const reg = await sw.evaluate(() => __tb.registered());
    expect(reg.filter((r) => r.id.startsWith('capture'))).toEqual([]);
    const after = await context.newPage();
    await after.goto(LAB_URL);
    await after.waitForTimeout(500);
    expect(await booted(after, BOOT)).toBe(false);
    await after.close();
  });
});
