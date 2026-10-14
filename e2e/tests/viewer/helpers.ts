// Helpers for the viewer suite: seed data, sign-in, share tokens. The suite runs headless against
// the area server (SERVER_URL, docs/parallel.md) and needs no extension build.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';

export const SERVER = process.env.SERVER_URL ?? 'http://localhost:3000';
const ROOT = path.resolve(import.meta.dirname, '../../..');

const u = (n: number) => `019a0000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
export const IDS = {
  video: u(0xc1),
  screenshot: u(0xc2),
  commented: u(0xc3),
  empty: u(0xd1),
  link: u(0xd2),
  desktop: u(0xd3),
  replay: u(0xd4),
  folder: u(0xf1),
  thread: u(0xb1),
  dana: u(0x1),
  sam: u(0x2),
};

/** Same derivation as scripts/seed.ts, so links stay stable across runs. */
export function shareToken(id: string): string {
  return createHash('sha256').update(`nib-seed:share:${id}`).digest().subarray(0, 16).toString('base64url');
}
export const shareUrl = (id: string) => `${SERVER}/s/${shareToken(id)}`;
export const captureUrl = (id: string) => `${SERVER}/c/${id}`;

/** Reset the seed rows (media stays in S3) and the extra captures. */
export function reseed() {
  const env = { ...process.env };
  execFileSync('node', ['apps/server/scripts/seed.ts', '--no-media'], { cwd: ROOT, env, stdio: 'pipe' });
  execFileSync('node', ['e2e/tests/viewer/fixtures/extra.ts'], { cwd: ROOT, env, stdio: 'pipe' });
}

export async function signIn(context: BrowserContext, who: 'dana' | 'sam' = 'dana') {
  const r = await context.request.post(`${SERVER}/api/auth/sign-in/email`, {
    data: { email: `${who}@nib.test`, password: 'nib-dev-password' },
    headers: { origin: SERVER },
  });
  if (!r.ok()) throw new Error(`sign-in failed: ${r.status()}`);
}

export async function allowClipboard(context: BrowserContext) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SERVER });
}
export const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/** Wait until the events file has loaded and the panels are filled. */
export async function ready(page: Page) {
  await page.waitForFunction(() => !document.querySelector('[data-testid="console-list"] .vp-note') || !/Loading/.test(document.querySelector('[data-testid="console-list"] .vp-note')?.textContent ?? ''));
}

export const videoTime = (page: Page) => page.locator('[data-testid="video"]').evaluate((v: HTMLVideoElement) => v.currentTime);

/** Mailpit messages to an address (dev inbox on :8025). */
export async function mailsTo(address: string): Promise<{ Subject: string; Snippet: string }[]> {
  const r = await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  const j = (await r.json()) as { messages: { Subject: string; Snippet: string }[] };
  return j.messages ?? [];
}

/** Open a capture page and wait until it is interactive (hydrated). */
export async function open(page: Page, url: string) {
  await page.goto(url);
  await page.locator('[data-hydrated]').waitFor();
}
