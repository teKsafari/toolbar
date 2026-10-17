// Flow R: the reviewer toolbar in the release build, whose shadow root is closed (spikes S4):
// typing in the composer must stay in the composer, even though a page-level key listener cannot
// see inside a closed root. Runs in the flows browser, where the signed-in reviewer allowed the
// lab as a project origin (D-126), so the release build has its capture scripts on the lab.
import type { Page } from '@playwright/test';
import { EXT_ID, SERVER, api, expect, labPage, test } from './fixture.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const chrome: any;

interface DomNode {
  nodeId: number;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
}

/**
 * The centre of the first visible element in the closed shadow root whose attributes pass `match`,
 * read through the DevTools protocol's pierce mode (measurement only; the click is the page's mouse).
 */
async function shadowPoint(page: Page, match: (attrs: Record<string, string>) => boolean): Promise<{ x: number; y: number } | null> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
    const hits: number[] = [];
    const walk = (n: DomNode) => {
      const a = n.attributes ?? [];
      const attrs: Record<string, string> = {};
      for (let i = 0; i < a.length; i += 2) attrs[a[i]!] = a[i + 1]!;
      if (a.length && match(attrs)) hits.push(n.nodeId);
      for (const c of n.shadowRoots ?? []) walk(c);
      for (const c of n.children ?? []) walk(c);
    };
    walk(root);
    for (const nodeId of hits) {
      const box = await cdp.send('DOM.getBoxModel', { nodeId }).catch(() => null);
      const q = box?.model.border;
      if (!q) continue;
      const x = (q[0]! + q[2]! + q[4]! + q[6]!) / 4;
      const y = (q[1]! + q[3]! + q[5]! + q[7]!) / 4;
      if (box.model.width > 0 && box.model.height > 0) return { x, y };
    }
    return null;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

async function clickShadow(page: Page, what: string, match: (attrs: Record<string, string>) => boolean) {
  let p: { x: number; y: number } | null = null;
  await expect.poll(async () => (p = await shadowPoint(page, match)) !== null, { message: what, timeout: 15_000 }).toBe(true);
  await page.mouse.click(p!.x, p!.y);
}

test('R: release build, keys typed in the reviewer composer stay there', async ({ tb }) => {
  const sw = await tb.sw();
  expect(sw.url()).toContain(EXT_ID);
  await expect.poll(() => sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length), { timeout: 15_000 }).toBeGreaterThan(0);
  const page = await labPage(tb.context);
  await page.bringToFront();
  const closed = await page.locator('toolbar-root').evaluate((h) => h.shadowRoot === null, undefined, { timeout: 15_000 });
  expect(closed, 'the release build mounts a closed shadow root').toBe(true);
  await page.waitForTimeout(500);

  const comments = () =>
    sw.evaluate(async () => Object.values(((await chrome.storage.session.get('tb:review'))['tb:review'] ?? {}) as Record<string, { items: { comment: string }[] }>).flatMap((t) => t.items.map((i) => i.comment)));
  const before = await comments();
  await page.keyboard.press('Control+Shift+Period'); // wake
  await page.keyboard.press('c');
  await page.getByTestId('works').hover();
  await page.getByTestId('works').click();
  await page.waitForTimeout(300);
  // letters that are tools (a, s, l, h, r, f, v, x) and spaces that would press the page's button
  await page.keyboard.type('a shaky save, really slow');
  await page.keyboard.press('Enter');
  await expect.poll(comments).toEqual([...before, 'a shaky save, really slow']);
  await expect(page.getByTestId('status')).toContainText('idle');
  await page.close();
});

test('R: release build, Send asks for a title, and the toast\'s Open opens the capture next to the tab', async ({ tb }) => {
  const sw = await tb.sw();
  const page = await labPage(tb.context);
  await page.bringToFront();
  await page.waitForTimeout(500);
  const submitted = () => sw.evaluate(async () => Object.values(((await chrome.storage.session.get('tb:review'))['tb:review'] ?? {}) as Record<string, { items: unknown[] }>).reduce((a, t) => a + t.items.length, 0));
  await page.keyboard.press('Control+Shift+Period'); // wake
  await page.keyboard.press('c');
  await page.getByTestId('works').hover();
  await page.getByTestId('works').click();
  await page.waitForTimeout(300);
  await page.keyboard.type('Save shows nothing');
  await page.keyboard.press('Enter');
  await expect.poll(submitted).toBe(1);

  // Send opens the title row with its field focused; the comment tool stays on
  await clickShadow(page, 'Send', (a) => a['data-testid'] === 'review-send');
  await expect.poll(async () => (await shadowPoint(page, (a) => a['data-testid'] === 'review-title')) !== null).toBe(true);
  await page.keyboard.type('Release build title');
  await page.keyboard.press('Enter');
  await expect.poll(submitted, { timeout: 30_000 }).toBe(0);

  // the success toast's Open: a click on it (with the comment tool still picking) opens the capture page
  const before = tb.context.pages().length;
  const opened = tb.context.waitForEvent('page', { timeout: 20_000 });
  await clickShadow(page, 'the toast\'s Open', (a) => (a.class ?? '').split(/\s+/).includes('nb-act'));
  const capture = await opened;
  await capture.waitForLoadState();
  expect(tb.context.pages().length).toBe(before + 1);
  const id = capture.url().match(/\/c\/([0-9a-f-]{36})/)?.[1];
  expect(capture.url().startsWith(`${SERVER}/c/`), capture.url()).toBe(true);
  // the composer did not open: the click went to the toast, not to the picker
  expect(await shadowPoint(page, (a) => a['data-testid'] === 'review-composer')).toBeNull();
  await expect.poll(async () => (await api<{ title: string; status: string }>(tb.context, 'GET', `/api/v1/recordings/${id}`)).body?.title, { timeout: 30_000 }).toBe('Release build title');
  await capture.close();
  await page.close();
});
