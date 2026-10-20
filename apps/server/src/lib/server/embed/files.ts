// The embed's built files (D-210): /embed.js and /embed/<file> (fonts, lazy chunks, the npm package
// tarball) from packages/embed/dist. Looked up at runtime, without a variable: the repo checkout
// (dev, cwd apps/server or the repo root), or ./embed next to server.js (the image). A server with no
// build answers 404. Public: the files are the same for every site, and sites load them cross-origin.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const candidates = () => [resolve(process.cwd(), '../../packages/embed/dist'), resolve(process.cwd(), 'embed'), resolve(process.cwd(), 'packages/embed/dist')];

/** One flat file name: no folders, no dot files. */
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.tgz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
};

async function locate(name: string): Promise<string | null> {
  if (!FILE_RE.test(name) || !TYPES[extname(name)]) return null;
  for (const dir of candidates()) {
    const p = join(dir, name);
    if ((await stat(p).catch(() => null))?.isFile()) return p;
  }
  return null;
}

/** The file as a response, 304 when the browser's copy is current, or null when there is none. */
export async function embedFileResponse(name: string, request: Request): Promise<Response | null> {
  const p = await locate(name);
  if (!p) return null;
  const body = await readFile(p);
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 22)}"`;
  const headers = new Headers({
    'content-type': TYPES[extname(name)]!,
    'cache-control': 'no-cache',
    etag,
    // fonts and chunks are fetched in CORS mode from the site's origin
    'access-control-allow-origin': '*',
    'cross-origin-resource-policy': 'cross-origin',
  });
  if (name.endsWith('.tgz')) headers.set('content-disposition', `attachment; filename="${name}"`);
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), { headers });
}
