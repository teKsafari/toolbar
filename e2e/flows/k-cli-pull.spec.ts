// CLI pull (flow J's terminal route): make a personal token in settings, sign the CLI in with
// it, and pull the capture into a folder with summary.md, as an agent's skill does. Paused with the
// CLI (FEATURE_CLI, docs/scope.md): skipped unless the server under test has the flag on.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, SERVER, expect, featureOn, hydrated, pausedReason, test } from './fixture.ts';
import { recordLabErrors } from './journeys.ts';

const CLI = path.join(ROOT, 'packages/cli/dist/open-toolbar.mjs');

test('CLI: token from settings, open-toolbar login, open-toolbar pull writes summary.md with the failing request', async ({ tb, context }) => {
  // the CLI is paused by owner scope (docs/scope.md): this flow runs only with FEATURE_CLI=1
  test.skip(!(await featureOn('cli', SERVER)), pausedReason('cli'));
  test.skip(!fs.existsSync(CLI), 'build the CLI first: pnpm --filter @toolbar/cli build');
  const video = await recordLabErrors(tb);
  const page = await context.newPage();
  await page.goto(`${SERVER}/settings/tokens`);
  await hydrated(page);
  await page.getByRole('button', { name: 'Create token' }).click();
  await page.getByLabel('Name').fill(`flows ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const secret = (await page.getByTestId('token-secret').locator('code').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^tb_pat_/);
  await page.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-cli-'));
  const env = { ...process.env, TOOLBAR_CONFIG: path.join(dir, 'config.json'), TOOLBAR_TOKEN: '', TOOLBAR_SERVER: '' };
  const login = execFileSync(process.execPath, [CLI, 'login', '--server', SERVER, '--token', secret], { env, encoding: 'utf8' });
  expect(JSON.parse(login)).toMatchObject({ signedIn: true, as: tb.email });
  const out = path.join(dir, 'pull');
  execFileSync(process.execPath, [CLI, 'pull', video.shareUrl, '--out', out], { env, encoding: 'utf8', timeout: 120_000 });
  const files = fs.readdirSync(out, { recursive: true }).map(String);
  console.log('CLI: pulled', files.join(', '));
  const summary = fs.readFileSync(path.join(out, 'summary.md'), 'utf8');
  expect(summary).toContain(video.title);
  expect(summary).toContain('/api/fail');
  fs.rmSync(dir, { recursive: true, force: true });
});
