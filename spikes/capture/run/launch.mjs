// Shared launcher: Playwright 1.63.0 Chromium, headful on the private display :100.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const EXT_ID = 'kbadilafkmgcdhpkbkhkihmihjpemhpp'; // fixed by "key" in manifest.json
export const DISPLAY = ':100'; // never :99, the shared browser
const here = path.dirname(new URL(import.meta.url).pathname);
export const OUT = path.resolve(here, '../out');
fs.mkdirSync(OUT, { recursive: true });

export async function launch({ dpr = 1, args = [], openShadow = false } = {}) {
  let ext = path.resolve(here, '../ext');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-'));
  if (openShadow) {
    // Test build: same code, shadow root rendered open so Playwright selectors pierce it.
    const copy = path.join(tmp, 'ext');
    fs.cpSync(ext, copy, { recursive: true });
    fs.writeFileSync(path.join(copy, 'flags.js'), "globalThis.TB_FLAGS = { shadowMode: 'open' };\n");
    ext = copy;
  }
  const userDataDir = path.join(tmp, 'profile');
  // Pin the action so its icon sits in the toolbar instead of the puzzle-piece menu.
  fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'Default', 'Preferences'),
    JSON.stringify({ extensions: { pinned_extensions: [EXT_ID] } }),
  );
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    env: { ...process.env, DISPLAY },
    viewport: null, // use the real window size so screen coordinates match
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      '--window-position=0,0',
      '--window-size=1280,800',
      `--force-device-scale-factor=${dpr}`,
      ...args,
    ],
  });
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return { context, sw, userDataDir };
}

export const x = (...a) => execFileSync('xdotool', a, { env: { ...process.env, DISPLAY } }).toString().trim();
export function shot(name) {
  const file = path.join(OUT, name);
  execFileSync('import', ['-window', 'root', file], { env: { ...process.env, DISPLAY } });
  return file;
}
export async function saveFile(sw, name, as = name) {
  const b64 = await sw.evaluate((n) => globalThis.__spike.readFile(n), name);
  if (!b64) return null;
  const file = path.join(OUT, as);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}
export const ffprobe = (file) =>
  execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'format=format_name,duration,size:stream=codec_type,codec_name,width,height,nb_read_frames', '-of', 'compact', file]).toString().trim();
// MediaRecorder WebM has no duration in its header; the last video packet time is the real length.
export const lastPts = (file) =>
  execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file])
    .toString().trim().split('\n').pop();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const getLog = (sw) => sw.evaluate(() => globalThis.__spike.getLog());

// Polls the extension log until a line matches (the VM is loaded, so fixed sleeps are flaky).
export async function waitLog(sw, re, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const hit = (await getLog(sw)).find((l) => re.test(l));
    if (hit) return hit;
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${re}`);
}

// Finds the pinned action icon by its color (#E4572E) in the top 120 px of the screen.
export function findIcon() {
  const file = shot('find-icon.png');
  const txt = execFileSync('magick', [file, '-crop', '1440x120+0+0', 'txt:-'], { maxBuffer: 64 << 20 }).toString();
  const hits = txt.split('\n').filter((l) => /#E4572E/i.test(l)).map((l) => l.match(/^(\d+),(\d+)/).slice(1).map(Number));
  if (!hits.length) throw new Error('action icon not found');
  const xs = hits.map((h) => h[0]), ys = hits.map((h) => h[1]);
  return { x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2), y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) };
}
