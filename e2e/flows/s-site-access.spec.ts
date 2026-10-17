// Flow S: site access (D-202, D-203, D-205) with the release build in a browser of its own. A
// fresh install holds every site as a required host permission, so there is no prompt, yet in the
// default project sites mode it runs nowhere a project does not list: no launcher on the lab after
// sign-in. A click on the extension icon there shows one row (the host, a project picker, Add);
// Add with "New project" makes a project named after the host and the toolbar appears on the open
// tab without a reload. The pill's X closes the toolbar on that origin, across a reload, until the
// icon is clicked there again. A second unknown origin stays clean, and its add row preselects the
// project just used. S2 keeps the all sites mode (an admin's opt-in, D-200): a project per
// captured origin, then a merge.
import type { CDPSession, Page } from '@playwright/test';
import { LAB_URL, SERVER, api, captureOf, chord, connectExtension, createFromEditor, editorFrame, expect, hydrated, launchExtension, newEmail, openPopup, saveShot, setSiteAccess, test, waitReady } from './fixture.ts';

const LOOPBACK = LAB_URL.replace('localhost', '127.0.0.1');
const BOOT = 'toolbar.capture.main';
const host = (u: string) => new URL(u).host;

interface Project {
  id: string;
  name: string;
  origins: string[];
}

type DomNode = { nodeId: number; attributes?: string[]; children?: DomNode[]; shadowRoots?: DomNode[]; contentDocument?: DomNode };

/**
 * The box of an element with `data-testid` inside the release build's closed shadow root, through
 * CDP (which pierces closed roots); null when it is not in the page or not rendered.
 */
async function closedBox(page: Page, testid: string): Promise<{ x: number; y: number; w: number; h: number } | null> {
  const cdp: CDPSession = await page.context().newCDPSession(page);
  try {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as { root: DomNode };
    const find = (n: DomNode): DomNode | null => {
      const a = n.attributes ?? [];
      for (let i = 0; i < a.length; i += 2) if (a[i] === 'data-testid' && a[i + 1] === testid) return n;
      for (const c of [...(n.shadowRoots ?? []), ...(n.children ?? [])]) {
        const hit = find(c);
        if (hit) return hit;
      }
      return null;
    };
    const node = find(root);
    if (!node) return null;
    try {
      const { model } = (await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId })) as { model: { border: number[]; width: number; height: number } };
      return { x: model.border[0]!, y: model.border[1]!, w: model.width, h: model.height };
    } catch {
      return null; // not rendered
    }
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

async function clickClosed(page: Page, testid: string) {
  let b: Awaited<ReturnType<typeof closedBox>> = null;
  await expect.poll(async () => (b = await closedBox(page, testid)), { timeout: 15_000, message: `${testid} on the page` }).not.toBeNull();
  await page.mouse.click(b!.x + b!.w / 2, b!.y + b!.h / 2);
}

test('S: project sites by default: add the site from the icon, the toolbar starts without a reload, close and reopen it, other origins stay clean', async () => {
  test.setTimeout(240_000);
  const b = await launchExtension({ cdpPort: Number(process.env.FLOWS_CDP_PORT ?? 9341) + 31 });
  // the default (D-203); reset so an earlier flow's leftover cannot change it
  const reset = await setSiteAccess(b.context, null);
  try {
    const sw = await b.sw();
    const perms = () => sw.evaluate(() => (globalThis as unknown as { chrome: { permissions: { getAll(): Promise<{ origins: string[] }> } } }).chrome.permissions.getAll());
    // D-202: installed with every site, nothing asked
    expect((await perms()).origins.sort()).toEqual([`${new URL(SERVER).origin}/*`, '<all_urls>'].sort());
    const registered = () =>
      sw.evaluate(async () =>
        (await (globalThis as unknown as { chrome: { scripting: { getRegisteredContentScripts(): Promise<{ id: string; matches?: string[] }[]> } } }).chrome.scripting.getRegisteredContentScripts())
          .filter((r) => r.id.startsWith('capture'))
          .map((r) => r.matches ?? []),
      );
    const booted = (p: Page) => p.evaluate((k) => !!(window as unknown as Record<symbol, unknown>)[Symbol.for(k)], BOOT);

    // a domain of its own: a new account owns its workspace
    const { lab, popup } = await connectExtension(b.context, newEmail('site', 'site'), { allowLab: false });
    // fresh install, unknown site: no capture scripts, no launcher; the icon shows the add row
    await expect(popup.getByTestId('site-access')).toHaveAttribute('data-state', 'not-in-project', { timeout: 15_000 });
    await expect(popup.getByTestId('site-add-host')).toHaveText(host(LAB_URL), { timeout: 15_000 });
    await expect(popup.getByTestId('site-add-project')).toHaveValue(''); // "New project": no project yet
    expect(await registered()).toEqual([]);
    expect(await booted(lab)).toBe(false);
    await expect(lab.locator('toolbar-root')).toHaveCount(0);
    await popup.screenshot({ path: saveShot('s-add-row') });

    // Add with a new project: the toolbar appears on the open tab, no reload
    await popup.getByTestId('site-add').click();
    await expect(popup.getByTestId('site-project')).toContainText(host(LAB_URL), { timeout: 20_000 });
    await expect(popup.getByTestId('site-access')).toHaveCount(0);
    await popup.screenshot({ path: saveShot('s-added') });
    if (!popup.isClosed()) await popup.close();
    await expect.poll(() => booted(lab), { timeout: 15_000 }).toBe(true);
    await expect(lab.locator('toolbar-root')).toHaveCount(1);
    await expect.poll(() => closedBox(lab, 'review-launcher'), { timeout: 15_000 }).not.toBeNull();
    await expect.poll(registered, { timeout: 15_000 }).toEqual([[`${LAB_URL}/*`], [`${LAB_URL}/*`]]);
    const ws = await api<{ activeId: string }>(b.context, 'GET', '/api/v1/workspaces');
    const list = async () => (await api<{ items: Project[] }>(b.context, 'GET', `/api/v1/workspaces/${ws.body.activeId}/projects`)).body.items;
    const projects = await list();
    expect(projects.map((p) => [p.name, p.origins])).toEqual([[host(LAB_URL), [LAB_URL]]]);

    // the pill's X closes the toolbar and the launcher on this origin
    await lab.bringToFront();
    await lab.keyboard.press('Control+Shift+Period');
    await clickClosed(lab, 'review-close-site');
    await expect.poll(() => closedBox(lab, 'review-pill'), { timeout: 10_000 }).toBeNull();
    await expect.poll(() => closedBox(lab, 'review-launcher'), { timeout: 10_000 }).toBeNull();
    await lab.screenshot({ path: saveShot('s-closed') });
    // across a reload: the scripts still run (captures work), the toolbar stays closed
    await lab.reload();
    await expect.poll(() => booted(lab), { timeout: 15_000 }).toBe(true);
    await lab.waitForTimeout(1000);
    expect(await closedBox(lab, 'review-launcher')).toBeNull();

    // a click on the extension icon there shows it again
    const again = await openPopup(b.context, lab);
    await expect(again.getByTestId('site-project')).toContainText(host(LAB_URL), { timeout: 15_000 });
    await expect.poll(() => closedBox(lab, 'review-launcher'), { timeout: 15_000 }).not.toBeNull();
    if (!again.isClosed()) await again.close();

    // a second unknown origin stays clean; its add row preselects the project just used
    const other = await b.context.newPage();
    await other.goto(`${LOOPBACK}/`);
    await other.getByTestId('works').click();
    await other.waitForTimeout(1000);
    expect(await booted(other)).toBe(false);
    await expect(other.locator('toolbar-root')).toHaveCount(0);
    const otherPopup = await openPopup(b.context, other);
    await expect(otherPopup.getByTestId('site-add-host')).toHaveText(host(LOOPBACK), { timeout: 15_000 });
    await expect(otherPopup.getByTestId('site-add-project')).toHaveValue(projects[0]!.id);
    await otherPopup.screenshot({ path: saveShot('s-second-origin') });
    await otherPopup.close();
    expect(await booted(other)).toBe(false);
    expect(await registered()).toEqual([[`${LAB_URL}/*`], [`${LAB_URL}/*`]]);
    // the server refuses a capture there and makes no project
    const refused = await api<{ error: string }>(b.context, 'POST', '/api/v1/recordings', {
      clientId: crypto.randomUUID(),
      kind: 'screenshot',
      workspaceId: ws.body.activeId,
      page: { url: `${LOOPBACK}/`, title: 'other' },
      startedAt: Date.now(),
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('origin_not_allowed');
    expect((await list()).length).toBe(1);
    await other.close();
    await lab.close();
  } finally {
    if (reset) await setSiteAccess(b.context, null);
    await b.close();
  }
});

test('S2: the all sites mode (an admin opt-in): a project per origin with no prompt, and merge', async () => {
  test.setTimeout(300_000);
  const b = await launchExtension({ cdpPort: Number(process.env.FLOWS_CDP_PORT ?? 9341) + 32 });
  let changed = false;
  try {
    const sw = await b.sw();
    const perms = () => sw.evaluate(() => (globalThis as unknown as { chrome: { permissions: { getAll(): Promise<{ origins: string[] }> } } }).chrome.permissions.getAll());
    // D-202: installed with every site, nothing asked
    expect((await perms()).origins.sort()).toEqual([`${new URL(SERVER).origin}/*`, '<all_urls>'].sort());
    // D-203: an admin's opt-in; the flow cannot run without switching it on
    changed = await setSiteAccess(b.context, 'all');
    test.skip(!changed, 'needs an instance admin to switch to all sites (seeded dana@toolbar.test with AUTH_DEV_PASSWORD=1, SITE_ACCESS unset)');

    // a domain of its own: the account owns its workspace and can merge projects (D-169)
    const { lab, popup } = await connectExtension(b.context, newEmail('site', 'site'), { allowLab: false });
    // right after sign-in: no screen asking for access, a status line instead
    await expect(popup.getByTestId('site-all-sites')).toBeVisible({ timeout: 15_000 });
    await expect(popup.getByTestId('site-access')).toHaveCount(0);
    await popup.screenshot({ path: saveShot('s-all-sites-at-sign-in') });
    if (!popup.isClosed()) await popup.close();

    const booted = (p: Page) => p.evaluate((k) => !!(window as unknown as Record<symbol, unknown>)[Symbol.for(k)], BOOT);
    // the tab that was open gets the scripts at sign-in
    await expect.poll(() => booted(lab), { timeout: 15_000 }).toBe(true);

    // a second origin: still no prompt, the popup says it records on every site
    const other = await b.context.newPage();
    await other.goto(`${LOOPBACK}/`);
    await expect.poll(() => booted(other), { timeout: 15_000 }).toBe(true);
    const again = await openPopup(b.context, other);
    await expect(again.getByTestId('site-all-sites')).toBeVisible({ timeout: 15_000 });
    await expect(again.getByTestId('site-access')).toHaveCount(0);
    await again.screenshot({ path: saveShot('s-all-sites') });
    await again.close();

    async function screenshotOf(page: Page, title: string) {
      await page.bringToFront();
      await chord(page, 'ctrl+shift+s');
      await page.waitForTimeout(300);
      const works = (await page.getByTestId('works').boundingBox())!;
      await page.mouse.click(works.x + 10, works.y + 8);
      const f = await editorFrame(page);
      const rec = await captureOf(b.context, await createFromEditor(page, f, title));
      await waitReady(b.context, rec.id);
      return (await api<{ project: { id: string; name: string } | null }>(b.context, 'GET', `/api/v1/recordings/${rec.id}`)).body;
    }
    const one = await screenshotOf(lab, `Flow S localhost ${Date.now().toString(36)}`);
    const two = await screenshotOf(other, `Flow S loopback ${Date.now().toString(36)}`);
    expect(one.project?.name).toBe(host(LAB_URL));
    expect(two.project?.name).toBe(host(LOOPBACK));

    const ws = await api<{ activeId: string }>(b.context, 'GET', '/api/v1/workspaces');
    const list = async () => (await api<{ items: Project[] }>(b.context, 'GET', `/api/v1/workspaces/${ws.body.activeId}/projects`)).body.items;
    expect((await list()).map((p) => [p.name, p.origins]).sort()).toEqual(
      [
        [host(LAB_URL), [LAB_URL]],
        [host(LOOPBACK), [LOOPBACK]],
      ].sort(),
    );

    // the admin merges the loopback project into the localhost one in Settings > Projects
    const web = await b.context.newPage();
    await web.goto(`${SERVER}/settings/projects`);
    await web.bringToFront();
    await hydrated(web);
    await expect(web.getByTestId('projects-lead')).toHaveAttribute('data-mode', 'all');
    const row = web.getByTestId('project-row').filter({ hasText: host(LAB_URL) }).filter({ hasNotText: host(LOOPBACK) });
    const dialog = web.getByTestId('merge-dialog');
    // a click before the page hydrates (a cold dev server) opens nothing: click until it does
    await expect(async () => {
      await row.getByTestId('project-merge-row').click();
      await expect(dialog.getByTestId('merge-from')).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await dialog.getByTestId('merge-from').selectOption(two.project!.id, { timeout: 10_000 });
    await expect(dialog.getByTestId('merge-summary')).toContainText(LOOPBACK);
    await web.screenshot({ path: saveShot('s-merge') });
    await dialog.getByTestId('merge-confirm').click();
    await expect(web.getByTestId('project-row')).toHaveCount(1);
    await expect(web.getByTestId('project-origins')).toContainText(LAB_URL);
    await expect(web.getByTestId('project-origins')).toContainText(LOOPBACK);
    expect((await list()).map((p) => p.id)).toEqual([one.project!.id]);

    // the project's page groups both captures; the sidebar lists the project with its count
    await web.goto(`${SERVER}/p/${one.project!.id}`);
    await hydrated(web);
    await expect(web.getByTestId('project-title')).toContainText(host(LAB_URL));
    await expect(web.getByTestId('project-total')).toHaveText('2');
    await expect(web.getByTestId('project-link').filter({ hasText: host(LAB_URL) }).getByTestId('project-count')).toHaveText('2');
    await web.screenshot({ path: saveShot('s-project-page') });
    await web.close();
    await other.close();
    await lab.close();
  } finally {
    if (changed) await setSiteAccess(b.context, null);
    await b.close();
  }
});

