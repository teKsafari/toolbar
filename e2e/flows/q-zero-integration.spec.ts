// Flow Q: zero integration in the strict site access mode (PLAN "Zero integration", D-123 to
// D-127; SITE_ACCESS=projects, D-200, which the flow switches on for its run through the admin
// API and resets after), with the release build in a browser of its own. The extension installs
// with every site granted (D-202), yet in the strict mode it records on project origins only. A
// new reviewer signs in, sees that the lab is in no project, an admin adds it under Settings >
// Projects, and the popup over the lab then says the strict mode with no prompt. From then on the
// lab is captured and a second origin serving the same page is not, and a capture of the lab
// carries its project and masking preset.
import { LAB_URL, SERVER, api, captureOf, chord, connectExtension, createFromEditor, editorFrame, expect, hydrated, labPage, launchExtension, newEmail, openPopup, saveShot, setSiteAccess, test, withPrivateDisplay } from './fixture.ts';

/** The same lab page on an origin that no project lists. */
const OTHER = LAB_URL.replace('localhost', '127.0.0.1');
const BOOT = 'toolbar.capture.main';

test('Q: every site granted at install, the strict mode captures on the project origin only, with no prompt', async () => {
  test.setTimeout(240_000);
  await withPrivateDisplay(async (display) => {
    const b = await launchExtension({ display, cdpPort: Number(process.env.FLOWS_CDP_PORT ?? 9341) + 30 });
    // D-200: this is the strict mode, an admin setting; the default `all` mode is flow S
    const strict = await setSiteAccess(b.context, 'projects');
    try {
      test.skip(!strict, 'needs the strict site access mode: an instance admin (seeded dana@toolbar.test with AUTH_DEV_PASSWORD=1) to switch it, and SITE_ACCESS unset');
      const sw = await b.sw();
      // installed: the build's server and every site (D-202), nothing asked
      const perms = () => sw.evaluate(() => (globalThis as unknown as { chrome: { permissions: { getAll(): Promise<{ origins: string[] }> } } }).chrome.permissions.getAll());
      expect((await perms()).origins.sort()).toEqual([`${new URL(SERVER).origin}/*`, '<all_urls>'].sort());
      const registered = () =>
        sw.evaluate(async () =>
          (await (globalThis as unknown as { chrome: { scripting: { getRegisteredContentScripts(): Promise<{ id: string; matches?: string[] }[]> } } }).chrome.scripting.getRegisteredContentScripts())
            .filter((r) => r.id.startsWith('capture'))
            .map((r) => r.matches ?? []),
        );

      // a domain of its own: the admin step needs this account to own its workspace (D-169)
      const { lab, popup } = await connectExtension(b.context, newEmail('zero', 'zero'), { allowLab: false });
      await expect(popup.getByTestId('site-access')).toHaveAttribute('data-state', 'not-in-project');
      await popup.close();
      const booted = (p: typeof lab) => p.evaluate((k) => !!(window as unknown as Record<symbol, unknown>)[Symbol.for(k)], BOOT);
      expect(await booted(lab)).toBe(false);

      // the admin (a new account owns its workspace) adds the lab under Settings > Projects
      const web = await b.context.newPage();
      await web.goto(`${SERVER}/settings/projects`);
      await web.bringToFront(); // a background tab gets no animation frames, and clicks wait for them
      await hydrated(web);
      await expect(web.getByTestId('projects-empty')).toBeVisible();
      await expect(web.getByTestId('add-project'), 'the new account is the admin of its own workspace').toBeVisible();
      await web.getByTestId('add-project').click();
      await web.getByTestId('project-name').fill('Lab');
      await web.getByTestId('project-origins-input').fill(`${LAB_URL}/some/page`);
      await web.getByTestId('project-save').click();
      await expect(web.getByTestId('project-row')).toHaveCount(1);
      await expect(web.getByTestId('project-origins')).toHaveText(LAB_URL); // the path is dropped
      // the trace step window is a project setting (D-166): 10 s unless the admin raises it
      await expect(web.getByTestId('project-trace-open')).toHaveCount(0);
      await web.getByTestId('project-edit').click();
      await expect(web.getByTestId('project-trace-open-input')).toHaveValue('10');
      await web.getByTestId('project-trace-open-input').fill('30');
      await web.getByTestId('project-save').click();
      await expect(web.getByTestId('project-trace-open')).toContainText('30 s');
      await web.screenshot({ path: saveShot('q-projects') });
      await web.close();

      // the popup over the lab: no prompt, it names the strict mode; the scripts cover the lab only
      await lab.bringToFront();
      const ask = await openPopup(b.context, lab);
      await expect(ask.getByTestId('site-strict')).toBeVisible({ timeout: 20_000 });
      await expect(ask.getByTestId('site-access')).toHaveCount(0);
      await ask.screenshot({ path: saveShot('q-strict-project') });
      if (!ask.isClosed()) await ask.close();
      await expect.poll(registered, { timeout: 15_000 }).toEqual([[`${LAB_URL}/*`], [`${LAB_URL}/*`]]);

      // the open lab tab gets the capture scripts at once; a page on another origin never does
      await expect.poll(() => booted(lab), { timeout: 15_000 }).toBe(true);
      const other = await b.context.newPage();
      await other.goto(OTHER);
      await other.getByTestId('works').click();
      await other.waitForTimeout(800);
      expect(await booted(other)).toBe(false);
      const otherPopup = await openPopup(b.context, other);
      await expect(otherPopup.getByTestId('site-access')).toHaveAttribute('data-state', 'not-in-project');
      await expect(otherPopup.getByTestId('site-strict-note')).toBeVisible();
      await otherPopup.close();
      await other.close();

      // a screenshot of the lab records its project and preset
      const page = await labPage(b.context);
      await expect.poll(() => booted(page)).toBe(true);
      await chord(page, 'ctrl+shift+s');
      await page.waitForTimeout(300);
      const works = (await page.getByTestId('works').boundingBox())!;
      await page.mouse.click(works.x + 10, works.y + 8);
      const f = await editorFrame(page);
      const link = await createFromEditor(page, f, `Flow Q ${Date.now().toString(36)}`);
      const rec = await captureOf(b.context, link);
      const detail = await api<{ project: { name: string; traceOpenMs?: number } | null; maskingPreset: string | null }>(b.context, 'GET', `/api/v1/recordings/${rec.id}`);
      expect(detail.body.project?.name).toBe('Lab');
      expect(detail.body.project?.traceOpenMs).toBe(30_000);
      expect(detail.body.maskingPreset).toBe('staging');

      // the server refuses a capture from an origin outside the workspace's projects
      const ws = await api<{ activeId: string }>(b.context, 'GET', '/api/v1/workspaces');
      const refused = await api<{ error: string }>(b.context, 'POST', '/api/v1/recordings', {
        clientId: crypto.randomUUID(),
        kind: 'screenshot',
        workspaceId: ws.body.activeId,
        page: { url: `${OTHER}/`, title: 'other' },
        startedAt: Date.now(),
      });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe('origin_not_allowed');
      await page.close();
      await lab.close();
    } finally {
      if (strict) await setSiteAccess(b.context, null);
      await b.close();
    }
  });
});
