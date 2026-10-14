import { json } from '@sveltejs/kit';
import { LIMITS } from '@toolbar/shared';
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { putChunk } from '#lib/server/upload/service.ts';

export const PUT = apiRoute(ROUTES['captures.putChunk'], async ({ event, params }) => {
  const len = Number(event.request.headers.get('content-length') ?? 0);
  if (len > LIMITS.chunkBytes) fail('too_large', `Chunks are at most ${LIMITS.chunkBytes} bytes`);
  const a = await captureAccess(db, event, params.id, { mode: 'upload', role: 'creator', own: true });
  const body = new Uint8Array(await event.request.arrayBuffer());
  const r = await putChunk(db, a.rec, params.stream, params.seq, body, event.request.headers);
  return json({ seq: params.seq, stored: r.stored }, { status: r.status });
});
