// CORS for the embed (D-211). The embed calls the server from the site's own origin: the key's
// routes, then the capture's upload routes with its `tb_upl_` bearer. No cookie is ever involved,
// so credentials are never allowed; the key's routes check the origin themselves (403 with the
// header still echoed, so the page can read the error).
import type { Handle } from '@sveltejs/kit/hooks';
import { HEADERS } from '@toolbar/shared';
import { REQUEST_ORIGIN_HEADER, UPLOAD_TOKEN_PREFIX } from '@toolbar/shared/api';

const EMBED_API = /^\/api\/v1\/embed\//;
/**
 * Routes the upload token reaches: a capture's chunks, complete, finalize and feedback, assets,
 * and DELETE of the capture itself while it is a draft (a discarded trace session, D-214).
 */
const UPLOAD_API = /^\/api\/v1\/(recordings\/[^/]+(\/.+)?|assets\/?)$/;

const ALLOW_HEADERS = ['authorization', 'content-type', 'content-encoding', HEADERS.sha256, HEADERS.t0, HEADERS.t1].join(', ');

/** The browser's Origin, from server.js's copy when it rewrote Origin for a Bearer request. */
function originOf(headers: Headers): string | null {
  return headers.get(REQUEST_ORIGIN_HEADER) ?? headers.get('origin');
}

function echo(h: Headers, origin: string) {
  h.set('Access-Control-Allow-Origin', origin);
  h.append('Vary', 'Origin');
}

export const embedCors: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;
  const embed = EMBED_API.test(path);
  if (!embed && !UPLOAD_API.test(path)) return resolve(event);
  const origin = originOf(event.request.headers);
  if (event.request.method === 'OPTIONS') {
    const h = new Headers({ 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': ALLOW_HEADERS, 'Access-Control-Max-Age': '600' });
    if (origin) echo(h, origin);
    return new Response(null, { status: 204, headers: h });
  }
  const res = await resolve(event);
  if (!origin) return res;
  const upload = (event.request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').startsWith(UPLOAD_TOKEN_PREFIX);
  if (embed || upload) echo(res.headers, origin);
  return res;
};
