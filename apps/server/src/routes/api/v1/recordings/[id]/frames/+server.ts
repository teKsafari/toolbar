import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { frameAt, overview } from '#lib/server/mcp/frames.ts';

// One JPEG at ?at= (player ms), or the 4x3 overview grid without it (J-149, J-247).
export const GET = apiRoute(ROUTES['captures.videoFrame'], async ({ event, params, query }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'viewer' });
  if (query.at !== undefined) {
    const f = await frameAt(db, a.rec, query.at, query.size);
    return new Response(new Uint8Array(f.jpeg), { headers: { 'content-type': 'image/jpeg', 'x-toolbar-frame-ms': String(f.atMs), 'cache-control': 'private, max-age=300' } });
  }
  const o = await overview(db, a.rec, query.size);
  return new Response(new Uint8Array(o.jpeg), { headers: { 'content-type': 'image/jpeg', 'x-toolbar-frame-times': o.times.join(','), 'cache-control': 'private, max-age=300' } });
});
