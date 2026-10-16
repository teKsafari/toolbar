// Layout: no horizontal overflow in the sidebar or the page at desktop, laptop and phone widths,
// at 1x and 2x pixel ratios, with a long workspace name, long folder names and enough folders
// that the sidebar scrolls vertically. The owner saw the sidebar scroll sideways on a 1600 px
// laptop: the workspace button had a fixed 226 px width, wider than the sidebar's content box
// once its vertical scrollbar appeared, and the 260 px workspace menu stuck out past it.
import { test, expect, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, go, json, launch, me, newContext, signIn, uniqueEmail } from './helpers.ts';

test.describe.configure({ mode: 'serial' });

const WIDTHS = [1600, 1440, 1280, 1067, 900, 390];
const HEIGHT = { 1600: 900, 1440: 800, 1280: 720, 1067: 600, 900: 600, 390: 844 } as Record<number, number>;
const LONG_WS = 'Acme International Quality Assurance and Release Engineering Department';
const LONG_FOLDERS = ['Customer reported regressions from the enterprise checkout migration project', 'Supercalifragilisticexpialidociousfoldernamewithoutanyspacesatall'];

let browser: Browser;
let storage: Awaited<ReturnType<import('@playwright/test').BrowserContext['storageState']>>;
let folderShort = '';
let captureId = '';

test.beforeAll(async () => {
  browser = await launch();
  const page = await (await newContext(browser)).newPage();
  await signIn(page, uniqueEmail(undefined, 'overflow'));
  const { activeWorkspaceId: ws } = await me(page);
  await json(page, 'PATCH', `/api/v1/workspaces/${ws}`, { name: LONG_WS });
  for (const name of [...LONG_FOLDERS, ...Array.from({ length: 12 }, (_, i) => `Sprint ${i + 1} bugs`)]) {
    const f = await json<{ shortId: string }>(page, 'POST', `/api/v1/workspaces/${ws}/folders`, { name });
    if (name === LONG_FOLDERS[0]) folderShort = f.shortId;
  }
  captureId = await screenshotCapture(page, ws);
  storage = await page.context().storageState();
  await page.context().close();
});
test.afterAll(async () => browser.close());

/** A ready screenshot capture made through the upload API with the session. */
async function screenshotCapture(page: Page, workspaceId: string): Promise<string> {
  const png = fs.readFileSync(path.resolve(import.meta.dirname, '../../../apps/server/fixtures/screenshot.png'));
  const h = { origin: SERVER };
  const created = await json<{ id: string }>(page, 'POST', '/api/v1/recordings', {
    clientId: crypto.randomUUID(),
    kind: 'screenshot',
    workspaceId,
    page: { url: 'http://localhost:5173/', title: 'Lab' },
    startedAt: Date.now(),
  });
  const a = await page.request.post(`${SERVER}/api/v1/assets`, { headers: h, multipart: { kind: 'screenshot', recordingId: created.id, file: { name: 'shot.png', mimeType: 'image/png', buffer: png } } });
  expect(a.ok(), await a.text()).toBe(true);
  const asset = (await a.json()) as { id: string };
  await json(page, 'POST', `/api/v1/recordings/${created.id}/finalize`, { title: 'A capture with a rather long title to test wrapping in the header', screenshotAssetId: asset.id, annotations: [] });
  return created.id;
}

/** Horizontal overflow, in CSS px, of the sidebar (app shell or settings nav), html and body. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const over = (el: Element | null) => (el ? Math.max(0, el.scrollWidth - el.clientWidth) : 0);
    const side = document.querySelector('aside[aria-label=Sidebar]') ?? document.querySelector('nav[aria-label=Settings]');
    return { sidebar: over(side), html: over(document.documentElement), body: over(document.body) };
  });
}

const NONE = { sidebar: 0, html: 0, body: 0 };

for (const dpr of [1, 2]) {
  for (const width of WIDTHS) {
    const height = HEIGHT[width] ?? 800;
    test(`no horizontal overflow at ${width} px, DPR ${dpr}`, async () => {
      const ctx = await browser.newContext({ storageState: storage, viewport: { width, height }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      const paths = ['/', `/f/${folderShort}`, '/links', `/c/${captureId}`, '/settings/workspace', '/settings/members', '/settings/webhooks', '/settings/profile', '/settings/mcp'];
      for (const p of paths) {
        await go(page, p);
        expect(await overflow(page), `${p} at ${width}x${height} DPR ${dpr}`).toEqual(NONE);
      }
      // the workspace menu opens inside the sidebar (a drawer at phone width) and stays in it
      await go(page, '/');
      if (width <= 860) await page.getByTestId('menu-button').click();
      await page.getByTestId('workspace-menu').click();
      await expect(page.getByRole('dialog', { name: 'Workspace menu' })).toBeVisible();
      expect(await overflow(page), `workspace menu open at ${width} DPR ${dpr}`).toEqual(NONE);
      await ctx.close();
    });
  }
}

/**
 * The agent picker on Settings > MCP (owner report): every card of a row has the same height and
 * no label wraps or overflows its card. The owner saw "Add another agent" wrap to two lines at
 * 1600 px in the dark theme, which made its card taller than the others.
 */
async function cardRows(page: Page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll<HTMLElement>('[data-testid^="agent-card-"]')].filter((el) => el.tagName === 'BUTTON');
    const rows = new Map<number, number[]>();
    const labels: { text: string; lines: number; clipped: boolean; inside: boolean }[] = [];
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const top = Math.round(r.top);
      rows.set(top, [...(rows.get(top) ?? []), Math.round(r.height * 10) / 10]);
      const name = c.querySelector<HTMLElement>('[data-testid="agent-card-name"]')!;
      const nr = name.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(name).lineHeight) || nr.height;
      labels.push({ text: name.textContent ?? '', lines: Math.round(nr.height / lineHeight), clipped: name.scrollWidth > name.clientWidth, inside: nr.right <= r.right + 0.5 && nr.left >= r.left - 0.5 });
    }
    return { count: cards.length, rows: [...rows.values()], labels };
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [1600, 1440, 1280, 1024, 768, 390]) {
    test(`MCP agent cards: equal heights, one-line labels at ${width} px, ${colorScheme}`, async () => {
      const ctx = await browser.newContext({ storageState: storage, viewport: { width, height: 900 }, colorScheme });
      const page = await ctx.newPage();
      await go(page, '/settings/mcp');
      await expect(page.getByTestId('agent-card-other')).toBeVisible();
      const r = await cardRows(page);
      expect(r.count).toBe(5);
      for (const row of r.rows) expect(new Set(row).size, `card heights in one row at ${width} ${colorScheme}: ${row}`).toBe(1);
      for (const l of r.labels) {
        expect(l.lines, `"${l.text}" wraps at ${width} ${colorScheme}`).toBe(1);
        expect(l.inside, `"${l.text}" leaves its card at ${width} ${colorScheme}`).toBe(true);
        // at these widths every label fits; the ellipsis is for longer names
        expect(l.clipped, `"${l.text}" is cut at ${width} ${colorScheme}`).toBe(false);
      }
      expect(await overflow(page)).toEqual(NONE);
      await ctx.close();
    });
  }
}
