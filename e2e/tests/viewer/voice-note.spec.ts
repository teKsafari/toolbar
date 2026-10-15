// Voice note on a comment (D-087): record with the microphone button of the comment composer
// (Chromium's fake microphone plays a FLEURS clip), send, and the comment shows the audio and,
// once the server's transcribe job ran, its transcript. Works with any TRANSCRIBE_PROVIDER: with
// a provider the text arrives; with none the comment says why there is no transcript.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { IDS, SERVER, captureUrl, open, reseed, signIn } from './helpers.ts';

const clip = path.resolve(import.meta.dirname, '../../../apps/server/fixtures/transcribe/fleurs-sw_ke-1999.webm');
// Chromium's fake capture device reads WAV only
const wav = path.join(mkdtempSync(path.join(tmpdir(), 'tb-voice-')), 'sw.wav');
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', clip, '-ar', '48000', '-ac', '1', wav]);

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`] },
  permissions: ['microphone'],
});

test.beforeAll(() => reseed());

test('a voice note on a comment plays back and gets a transcript', async ({ page, context }) => {
  test.setTimeout(150_000);
  await signIn(context);
  await open(page, captureUrl(IDS.commented));
  const mic = page.getByTestId('voice-note');
  await mic.click();
  await expect(mic).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(6000);
  await mic.click();
  await expect(page.getByTestId('composer-voice').locator('audio')).toBeVisible();
  await expect(page.getByTestId('send')).toBeEnabled({ timeout: 15_000 });
  const created = page.waitForResponse((r) => r.url().endsWith(`/api/v1/recordings/${IDS.commented}/comments`) && r.request().method() === 'POST');
  await page.getByTestId('send').click();
  const comment = (await (await created).json()) as { id: string; voice: { assetId: string; url: string } | null };
  expect(comment.voice).not.toBeNull();

  const item = page.locator(`[data-comment-id="${comment.id}"]`);
  await expect(item.getByTestId('comment-voice').locator('audio')).toHaveAttribute('src', /\/media\//);
  // the job runs on the server; the live comment stream brings the result
  const tr = item.getByTestId('voice-transcript');
  await expect(tr).not.toHaveText(/Transcribing/, { timeout: 120_000 });
  const text = (await tr.textContent())?.trim() ?? '';
  test.info().annotations.push({ type: 'transcript', description: text });

  const api = await context.request.get(`${SERVER}/api/v1/recordings/${IDS.commented}/transcript?asset=${comment.voice!.assetId}`);
  const body = (await api.json()) as { status: string; vtt: string | null; cues: { startMs: number; endMs: number }[]; reason: string | null };
  expect(['done', 'skipped']).toContain(body.status);
  if (body.status === 'done') {
    expect(text).not.toMatch(/^No transcript/);
    expect(body.vtt).toMatch(/^WEBVTT/);
    // the note lasted about six seconds; every cue sits inside it
    for (const c of body.cues) expect(c.endMs).toBeLessThanOrEqual(8000);
    const vtt = await context.request.get(`${SERVER}/api/v1/recordings/${IDS.commented}/media/transcript-${comment.voice!.assetId}`);
    expect(vtt.headers()['content-type']).toMatch(/text\/vtt/);
  } else {
    expect(text).toMatch(/^No transcript/);
  }
});
