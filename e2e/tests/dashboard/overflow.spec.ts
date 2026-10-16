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

/**
 * The help menu (owner report, dark theme): the 240 px menu sat in the sidebar's scroll container
 * (a 250 px column, 12 px padding each side), so it stuck out past the content box. The sidebar
 * scrolled sideways, its right edge clipped the shortcut keys and the theme switch, and
 * "Capture menu (extension)" squeezed its kbd onto two lines. The menu now opens in the top
 * layer, anchored to the button and clamped to the viewport. A short viewport makes the sidebar
 * scroll vertically, which takes its scrollbar out of the content box as on the owner's screen.
 */
async function helpMenu(page: Page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const menu = document.querySelector<HTMLElement>('[data-testid="help-menu"]')!;
    const m = menu.getBoundingClientRect();
    /** Lines the element's text takes (icons left out). */
    const lines = (el: Element) => {
      const tops = new Set<number>();
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
      }
      return tops.size;
    };
    /** Inside the viewport, and the element itself paints at both ends (no ancestor clips it). */
    const shown = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const inside = r.left >= -0.5 && r.top >= -0.5 && r.right <= vw + 0.5 && r.bottom <= vh + 0.5;
      // the left and right ends at mid-height: inside a pill's rounded corners
      const pts: [number, number][] = [
        [r.left + 2, r.top + r.height / 2],
        [r.right - 2, r.top + r.height / 2],
      ];
      const painted = pts.every(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !!hit && (hit === el || el.contains(hit));
      });
      const round = (n: number) => Math.round(n * 10) / 10;
      return { left: round(r.left), right: round(r.right), height: round(r.height), inside, painted };
    };
    const kbds = [...menu.querySelectorAll<HTMLElement>('kbd')].map((k) => ({ text: k.textContent ?? '', lines: lines(k), ...shown(k) }));
    const theme = [...menu.querySelectorAll<HTMLElement>('[data-theme-choice]')].map((b) => ({ text: b.textContent ?? '', lines: lines(b), ...shown(b) }));
    return { vw, vh, menu: { left: m.left, right: m.right, top: m.top, bottom: m.bottom, width: m.width }, kbds, theme };
  });
}

for (const colorScheme of ['light', 'dark'] as const) {
  for (const width of [1600, 1440, 1280, 1024, 768, 390]) {
    const height = width <= 390 ? 844 : 480;
    test(`help menu fits at ${width}x${height}, ${colorScheme}`, async () => {
      const ctx = await browser.newContext({ storageState: storage, viewport: { width, height }, colorScheme });
      const page = await ctx.newPage();
      await go(page, '/');
      if (width <= 860) await page.getByTestId('menu-button').click();
      await page.getByTestId('help-button').click();
      await expect(page.getByTestId('help-menu')).toBeVisible();
      await expect(page.locator('[data-testid="help-menu"] kbd')).toHaveCount(3);
      // measure after the open animation (a 0.97 scale) ends
      await page.getByTestId('help-menu').evaluate((el) => Promise.all(el.parentElement!.getAnimations().map((a) => a.finished)));
      const h = await helpMenu(page);
      const over = await overflow(page);
      console.log(`[help] ${width}x${height} ${colorScheme}`, JSON.stringify({ overflow: over, ...h }));      expect(over, `help menu open at ${width} ${colorScheme}`).toEqual(NONE);
      expect(h.menu.left).toBeGreaterThanOrEqual(0);
      expect(h.menu.right).toBeLessThanOrEqual(h.vw);
      expect(h.menu.top).toBeGreaterThanOrEqual(0);
      expect(h.menu.bottom).toBeLessThanOrEqual(h.vh);
      for (const k of [...h.kbds, ...h.theme]) {
        expect(k.lines, `"${k.text}" wraps at ${width} ${colorScheme}`).toBe(1);
        expect(k.inside, `"${k.text}" leaves the viewport at ${width} ${colorScheme}: ${k.left}..${k.right}`).toBe(true);
        expect(k.painted, `"${k.text}" is covered or clipped at ${width} ${colorScheme}`).toBe(true);
      }
      // one line each, so every kbd has the same height
      expect(new Set(h.kbds.map((k) => k.height)).size, `kbd heights at ${width} ${colorScheme}: ${h.kbds.map((k) => k.height)}`).toBe(1);
      // the theme switch works from the top layer, and Escape closes the menu
      await page.locator('[data-theme-choice="dark"]').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('help-menu')).toBeHidden();
      await ctx.close();
    });
  }
}
