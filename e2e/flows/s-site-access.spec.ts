// Flow S: site access (D-198, D-200, D-202) with the release build in a browser of its own. A
// fresh install holds every site as a required host permission, so there is no prompt at all: in
// the default `all` mode the extension captures on two origins of the lab (localhost:5173 and
// 127.0.0.1:5173) right after sign-in, and each origin becomes a project by itself. The admin
// merges the two in Settings > Projects, and the project's page lists both captures. Then the
// strict mode (an admin setting) refuses an origin no project lists, in the extension and on the
// server, makes no project for it, and registers the capture scripts on the project origins only,
// though the browser grants every site.
import type { Page } from '@playwright/test';
import { LAB_URL, SERVER, api, captureOf, chord, connectExtension, createFromEditor, editorFrame, expect, hydrated, launchExtension, newEmail, openPopup, saveShot, setSiteAccess, test, waitReady } from './fixture.ts';

const LOOPBACK = LAB_URL.replace('localhost', '127.0.0.1');
/** The lab again, on a host name no project lists (Chromium resolves *.localhost to loopback). */
const UNLISTED = LAB_URL.replace('localhost', 'strict.localhost');
const BOOT = 'toolbar.capture.main';

interface Project {
  id: string;
  name: string;
  origins: string[];
}

test('S: all sites from install with no prompt, a project per origin, merge, and the strict mode refuses an unlisted origin', async () => {
  test.setTimeout(300_000);
  const b = await launchExtension({ cdpPort: Number(process.env.FLOWS_CDP_PORT ?? 9341) + 31 });
  let changed = false;
  try {
    const sw = await b.sw();
    const perms = () => sw.evaluate(() => (globalThis as unknown as { chrome: { permissions: { getAll(): Promise<{ origins: string[] }> } } }).chrome.permissions.getAll());
    // D-202: installed with every site, nothing asked
    expect((await perms()).origins.sort()).toEqual([`${new URL(SERVER).origin}/*`, '<all_urls>'].sort());
    // the default; stored explicitly so an earlier flow's leftover cannot change it
    changed = await setSiteAccess(b.context, 'all');

    // a domain of its own: the account owns its workspace and can merge projects (D-169)
    const { lab, popup } = await connectExtension(b.context, newEmail('site', 'site'), { allowLab: false });
    // when the flow could not set the mode, SITE_ACCESS may hold the server in the strict mode
    if (!changed) {
      await popup.waitForTimeout(1500);
      test.skip((await popup.getByTestId('site-access').count()) > 0, 'the server is in the strict mode (SITE_ACCESS=projects)');
    }
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
    const host = (u: string) => new URL(u).host;
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

    // the strict mode: an admin switches it on; the extension picks it up at a popup open once its
    // copy of the bootstrap is a minute old (lib/bg/auth.ts)
    test.skip(!(await setSiteAccess(b.context, 'projects')), 'needs an instance admin to switch to the strict mode (seeded dana@toolbar.test with AUTH_DEV_PASSWORD=1)');
    changed = true;
    await web.reload();
    await hydrated(web);
    await web.goto(`${SERVER}/settings/projects`);
    await hydrated(web);
    await expect(web.getByTestId('projects-lead')).toHaveAttribute('data-mode', 'projects');
    await web.close();
    await lab.waitForTimeout(61_000);
    const unlisted = await b.context.newPage();
    await unlisted.goto(`${UNLISTED}/`);
    const strict = await openPopup(b.context, unlisted);
    await expect(strict.getByTestId('site-access')).toHaveAttribute('data-state', 'not-in-project', { timeout: 20_000 });
    await expect(strict.getByTestId('site-strict-note')).toBeVisible();
    await strict.screenshot({ path: saveShot('s-strict-unlisted') });
    await strict.close();
    await unlisted.reload();
    await unlisted.waitForTimeout(800);
    expect(await booted(unlisted)).toBe(false);
    // D-202: the browser still grants every site, yet the scripts are registered for the merged
    // project's two origins only
    expect((await perms()).origins).toContain('<all_urls>');
    const registered = () =>
      sw.evaluate(async () =>
        (await (globalThis as unknown as { chrome: { scripting: { getRegisteredContentScripts(): Promise<{ id: string; matches?: string[] }[]> } } }).chrome.scripting.getRegisteredContentScripts())
          .filter((r) => r.id.startsWith('capture'))
          .map((r) => [...(r.matches ?? [])].sort()),
      );
    await expect.poll(registered, { timeout: 15_000 }).toEqual([[`${LAB_URL}/*`, `${LOOPBACK}/*`].sort(), [`${LAB_URL}/*`, `${LOOPBACK}/*`].sort()]);
    // the merged project's origins still capture, and the popup there names the strict mode
    const listed = await b.context.newPage();
    await listed.goto(`${LOOPBACK}/`);
    await expect.poll(() => booted(listed), { timeout: 15_000 }).toBe(true);
    const strictListed = await openPopup(b.context, listed);
    await expect(strictListed.getByTestId('site-strict')).toBeVisible({ timeout: 15_000 });
    await strictListed.close();

    // the server refuses the unlisted origin and makes no project for it
    const before = (await list()).length;
    const refused = await api<{ error: string }>(b.context, 'POST', '/api/v1/recordings', {
      clientId: crypto.randomUUID(),
      kind: 'screenshot',
      workspaceId: ws.body.activeId,
      page: { url: `${UNLISTED}/`, title: 'unlisted' },
      startedAt: Date.now(),
    });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe('origin_not_allowed');
    expect((await list()).length).toBe(before);
    await listed.close();
    await unlisted.close();
    await other.close();
    await lab.close();
  } finally {
    if (changed) await setSiteAccess(b.context, null);
    await b.close();
  }
});
