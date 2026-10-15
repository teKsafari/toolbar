// OCR of canvas regions for the folder's text/ (PLAN: "OCR of canvas regions, labeled as OCR").
// Canvas pixels are not in the DOM recording, so a terminal or editor drawn on a canvas reaches
// the agent only as pixels; tesseract turns them into text. The server image installs it
// (apps/server/Dockerfile); OCR_BIN=off, or a machine without it, leaves text/ out.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '../env.ts';
import { run } from '../media/ffmpeg.ts';

let available: Promise<boolean> | null = null;

export function ocrAvailable(): Promise<boolean> {
  const bin = env.handoff.ocrBin;
  if (!bin || bin === 'off' || bin === '0') return Promise.resolve(false);
  available ??= run(bin, ['--version'], { timeoutMs: 10_000 }).then(
    () => true,
    () => false,
  );
  return available;
}

/** Text of a PNG, trimmed; null when OCR is off, failed or found nothing. */
export async function ocrPng(png: Uint8Array): Promise<string | null> {
  if (!(await ocrAvailable())) return null;
  const dir = await mkdtemp(join(tmpdir(), 'tb-ocr-'));
  try {
    const file = join(dir, 'in.png');
    await writeFile(file, png);
    // psm 6: one uniform block of text (terminals, editors); 3 would split columns into blocks
    const { stdout } = await run(env.handoff.ocrBin, [file, 'stdout', '-l', env.handoff.ocrLangs, '--psm', '6'], { timeoutMs: 30_000 });
    const text = stdout.replace(/\f/g, '').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
    return text || null;
  } catch (e) {
    console.warn('[handoff] OCR failed:', (e as Error).message);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
