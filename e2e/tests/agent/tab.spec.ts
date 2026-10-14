// J-152: the agent tab the viewer area mounts from lib/components/agent/AgentTab.svelte: presets with
// the capture URL once an agent is connected, copy buttons, copy for AI, and the setup prompt for
// link viewers. Skips until the viewer's capture page (with its agent tab) is merged in.
import { expect, test, chromium } from '@playwright/test';
import { SERVER, hydrated, signInWithPassword } from '../auth/helpers.ts';

test('J-152 agent tab: presets with the capture URL when connected; setup prompt for link viewers', async () => {
  const browser = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY: process.env.E2E_DISPLAY ?? ':117' } });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await signInWithPassword(page, 'dana@nib.test', 'nib-dev-password');
  const id = '019a0000-0000-7000-8000-0000000000c1';
  await page.goto(`${SERVER}/c/${id}`);
  await hydrated(page);
  if (!(await page.getByTestId('tab-agent').count())) {
    await browser.close();
    test.skip(true, 'the viewer area capture page is not merged yet');
  }
  await page.getByTestId('tab-agent').click();
  await expect(page.getByTestId('agent-tab')).toBeVisible();
  // presets show once this user has a connected agent (the CLI login test leaves one)
  await expect(page.getByTestId('preset-fix')).toBeVisible();
  for (const p of ['fix', 'summarize', 'e2e']) {
    await page.getByTestId(`preset-${p}`).click();
    await expect(page.getByTestId('agent-prompt')).toContainText(`${SERVER}/c/${id}`);
  }
  await page.getByTestId('preset-fix').click();
  await page.getByTestId('copy-prompt').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('leave a comment on the capture');
  await page.getByTestId('copy-for-ai').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('## Failed requests');

  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p2 = await anon.newPage();
  await p2.goto(`${SERVER}/s/BvD6xlMIN86tb1zMiJWuDw`);
  await hydrated(p2);
  await p2.getByTestId('tab-agent').click();
  await expect(p2.getByTestId('agent-setup-prompt')).toContainText(`${SERVER}/mcp`);
  await expect(p2.getByTestId('agent-setup-prompt')).toContainText(`${SERVER}/s/BvD6xlMIN86tb1zMiJWuDw`);
  await browser.close();
});
