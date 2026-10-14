// CLI pull (flow J's terminal route): make a personal token in settings, sign the CLI in with
// it, and pull the capture into a folder with summary.md, as an agent's skill does.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, SERVER, expect, hydrated, test } from './fixture.ts';
import { recordLabErrors } from './journeys.ts';

const CLI = path.join(ROOT, 'packages/cli/dist/nib.mjs');

test('CLI: token from settings, nib login, nib pull writes summary.md with the failing request', async ({ nib, context }) => {
  test.skip(!fs.existsSync(CLI), 'build the CLI first: pnpm --filter @toolbar/cli build');
  const video = await recordLabErrors(nib);
  const page = await context.newPage();
  await page.goto(`${SERVER}/settings/tokens`);
  await hydrated(page);
  await page.getByRole('button', { name: 'Create token' }).click();
  await page.getByLabel('Name').fill(`flows ${Date.now().toString(36)}`);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const secret = (await page.getByTestId('token-secret').locator('code').textContent())?.trim() ?? '';
  expect(secret).toMatch(/^tb_pat_/);
  await page.close();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nib-cli-'));
  const env = { ...process.env, NIB_CONFIG: path.join(dir, 'config.json'), NIB_TOKEN: '', NIB_SERVER: '' };
  const login = execFileSync(process.execPath, [CLI, 'login', '--server', SERVER, '--token', secret], { env, encoding: 'utf8' });
  expect(JSON.parse(login)).toMatchObject({ signedIn: true, as: nib.email });
  const out = path.join(dir, 'pull');
  execFileSync(process.execPath, [CLI, 'pull', video.shareUrl, '--out', out], { env, encoding: 'utf8', timeout: 120_000 });
  const files = fs.readdirSync(out, { recursive: true }).map(String);
  console.log('CLI: pulled', files.join(', '));
  const summary = fs.readFileSync(path.join(out, 'summary.md'), 'utf8');
  expect(summary).toContain(video.title);
  expect(summary).toContain('/api/fail');
  fs.rmSync(dir, { recursive: true, force: true });
});
