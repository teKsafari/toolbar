// `nib create`: captures made by an agent.
// - `--json payload.json`: an annotated screenshot (J-244). The marks are drawn into the image
//   (boxes and arrows numbered in payload order, redactions opaque, blurs blurred) and kept as
//   annotation shapes; notes on numbered marks become the description's numbered lines.
// - `<video> [--trace trace.zip]`: a video capture (J-245); a Playwright trace adds console,
//   network and typing, synced to the video, with secret fields masked.
import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { CliError, connect } from './client.ts';
import { drawMarks, type Mark } from './draw.ts';
import { decodePng, encodePng, isPng } from './png.ts';
import { parseTrace } from './trace.ts';
import { createCapture, finalize, uploadAsset, uploadEvents, uploadStream, workspaceOf } from './upload.ts';

export interface ScreenshotPayload {
  title?: string;
  description?: string;
  /** page the screenshot shows */
  url?: string;
  pageTitle?: string;
  screen?: { w: number; h: number };
  /** a PNG file path or a data:image/png;base64 URL */
  image: string;
  marks?: Mark[];
  folderId?: string;
  workspaceId?: string;
}

async function loadImage(src: string, baseDir: string): Promise<Buffer> {
  if (src.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(src);
    if (!m) throw new CliError('image is not a valid data URL');
    return m[2] ? Buffer.from(m[3]!, 'base64') : Buffer.from(decodeURIComponent(m[3]!));
  }
  const p = src.startsWith('/') ? src : join(baseDir, src);
  return readFile(p).catch(() => {
    throw new CliError(`Cannot read image ${p}`);
  });
}

function validMarks(raw: unknown): Mark[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new CliError('marks must be an array');
  return raw.map((m, i) => {
    const k = (m as { type?: string }).type;
    const nums = (keys: string[]) => keys.every((x) => typeof (m as Record<string, unknown>)[x] === 'number');
    if ((k === 'box' || k === 'redact' || k === 'blur') && nums(['x', 'y', 'w', 'h'])) return m as Mark;
    if (k === 'arrow' && nums(['x1', 'y1', 'x2', 'y2'])) return m as Mark;
    if (k === 'text' && nums(['x', 'y']) && typeof (m as { text?: unknown }).text === 'string') return m as Mark;
    throw new CliError(`marks[${i}] is not a valid ${k ?? 'mark'}: boxes, redactions and blurs need x, y, w, h; arrows x1, y1, x2, y2; text x, y, text`);
  });
}

export async function createScreenshot(payload: ScreenshotPayload, baseDir: string) {
  const raw = await loadImage(payload.image, baseDir);
  if (!isPng(raw)) throw new CliError('The image must be a PNG (an 8-bit PNG file or data:image/png URL).');
  let img;
  try {
    img = decodePng(raw);
  } catch (e) {
    throw new CliError((e as Error).message);
  }
  const marks = validMarks(payload.marks);
  const numbers = drawMarks(img, marks);
  const png = encodePng(img);
  const notes = marks.map((m, i) => ({ n: numbers[i], note: (m as { note?: string }).note })).filter((x) => x.n !== null && x.note);
  const description = [payload.description?.trim(), notes.length ? notes.map((x) => `${x.n}. ${x.note}`).join('\n') : ''].filter(Boolean).join('\n\n');

  const c = await connect();
  const workspaceId = await workspaceOf(c, payload.workspaceId);
  const startedAt = Date.now();
  const rec = await createCapture(c, {
    kind: 'screenshot',
    workspaceId,
    folderId: payload.folderId,
    page: { url: payload.url ?? 'about:blank', title: payload.pageTitle },
    startedAt,
    env: {
      ua: `${'nib'} CLI`,
      viewport: { w: payload.screen?.w ?? img.width, h: payload.screen?.h ?? img.height },
      dpr: payload.screen?.w ? Math.round((img.width / payload.screen.w) * 100) / 100 : 1,
      ...(payload.url ? { url: payload.url } : {}),
    },
  });
  const asset = await uploadAsset(c, rec.id, 'screenshot', png, 'image/png', { width: img.width, height: img.height });
  const fin = await finalize(c, rec.id, {
    title: payload.title ?? 'Screenshot from an agent',
    description,
    annotations: marks.length ? [{ shapes: marks.map((m, i) => ({ ...m, number: numbers[i] })) }] : [],
    screenshotAssetId: asset.id,
    ...(payload.folderId ? { folderId: payload.folderId } : {}),
  });
  return { id: fin.id, url: fin.shareUrl, kind: 'screenshot', width: img.width, height: img.height, marks: marks.length, numbered: numbers.filter((n) => n !== null).length };
}

function hasFfmpeg(): boolean {
  return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
}

/** WebM bytes for the upload: WebM as is, other formats converted with a local ffmpeg. */
async function webmOf(path: string): Promise<{ bytes: Buffer; durationMs: number | null }> {
  const ext = extname(path).toLowerCase();
  let file = path;
  if (ext !== '.webm') {
    if (!hasFfmpeg()) throw new CliError(`${basename(path)} is not WebM. Install ffmpeg so nib can convert it, or record WebM (Playwright videos are WebM).`);
    file = join(tmpdir(), `nib-${process.pid}-${Date.now()}.webm`);
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', file], { stdio: 'inherit' });
    if (r.status !== 0) throw new CliError('ffmpeg could not convert the video.');
  }
  let durationMs: number | null = null;
  const p = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  if (p.status === 0 && Number(p.stdout.trim()) > 0) durationMs = Math.round(Number(p.stdout.trim()) * 1000);
  return { bytes: await readFile(file), durationMs };
}

export async function createVideo(path: string, opts: { trace?: string; title?: string; description?: string; folderId?: string; workspaceId?: string; url?: string; poster?: string }, log: (s: string) => void) {
  await stat(path).catch(() => {
    throw new CliError(`Cannot read ${path}`);
  });
  const { bytes, durationMs } = await webmOf(path);
  const trace = opts.trace ? parseTrace(await readFile(opts.trace)) : null;
  if (trace) log(`Trace: ${trace.stats.actions} actions, ${trace.stats.console} console messages, ${trace.stats.errors} errors, ${trace.stats.requests} requests`);
  const c = await connect();
  const workspaceId = await workspaceOf(c, opts.workspaceId);
  const startedAt = trace?.startedAt ?? Date.now() - (durationMs ?? 0);
  const rec = await createCapture(c, {
    kind: 'video',
    workspaceId,
    folderId: opts.folderId,
    page: { url: opts.url ?? trace?.firstUrl ?? 'about:blank', title: trace?.title ?? undefined },
    startedAt,
    env: trace?.env,
    durationMs: durationMs ?? undefined,
  });
  await uploadStream(c, rec.id, 'video', bytes, 'video/webm');
  if (trace) await uploadEvents(c, rec.id, trace.events);
  if (opts.poster) {
    const img = await readFile(opts.poster);
    await uploadAsset(c, rec.id, 'thumb', img, isPng(img) ? 'image/png' : 'image/jpeg').catch((e: Error) => log(`Poster skipped: ${e.message}`));
  }
  const fin = await finalize(c, rec.id, {
    title: opts.title ?? (trace ? 'Test run from an agent' : 'Video from an agent'),
    description: opts.description ?? '',
    ...(durationMs ? { durationMs } : {}),
    ...(opts.folderId ? { folderId: opts.folderId } : {}),
  });
  return { id: fin.id, url: fin.shareUrl, kind: 'video', durationMs, trace: trace?.stats ?? null };
}

export async function createCommand(argv: string[], io: { log: (s: string) => void }) {
  const { values: v, positionals: pos } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: 'string' },
      trace: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      folder: { type: 'string' },
      workspace: { type: 'string' },
      url: { type: 'string' },
      poster: { type: 'string' },
    },
  });
  if (v.json) {
    const text = v.json === '-' ? await new Response(process.stdin as unknown as ReadableStream).text() : await readFile(v.json, 'utf8');
    let payload: ScreenshotPayload;
    try {
      payload = JSON.parse(text) as ScreenshotPayload;
    } catch {
      throw new CliError('The payload is not valid JSON.');
    }
    if (!payload.image) throw new CliError('The payload needs an "image" (PNG path or data URL).');
    if (v.title) payload.title = v.title;
    if (v.folder) payload.folderId = v.folder;
    if (v.workspace) payload.workspaceId = v.workspace;
    return createScreenshot(payload, v.json === '-' ? process.cwd() : join(v.json, '..'));
  }
  const file = pos[0];
  if (!file) throw new CliError('Use: nib create --json payload.json, or nib create <video> [--trace trace.zip]');
  if (/\.(png)$/i.test(file)) return createScreenshot({ image: file, title: v.title, description: v.description, url: v.url, folderId: v.folder, workspaceId: v.workspace }, process.cwd());
  return createVideo(file, { trace: v.trace, title: v.title, description: v.description, folderId: v.folder, workspaceId: v.workspace, url: v.url, poster: v.poster }, io.log);
}
