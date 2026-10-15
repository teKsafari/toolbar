// GET /api/v1/recordings/:id/folder/file?path=annotations/a01.png: one file of the feedback folder.
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { folderOf } from '#lib/server/handoff/folder.ts';
import { folderCapture } from '#lib/server/handoff/http.ts';

export const GET = apiRoute(ROUTES['handoff.folderFile'], async ({ event, params, query }) => {
  const rec = await folderCapture(event, params.id);
  const { folder } = await folderOf(db, rec);
  const want = query.path.replace(/^\.\//, '').replace(new RegExp(`^${folder.dir.replace('.', '\\.')}/`), '');
  const f = folder.files.find((x) => x.path === want);
  if (!f) fail('not_found', `No file ${want} in the folder. List them with GET /api/v1/recordings/${rec.id}/folder/files.`);
  const body = typeof f!.data === 'string' ? f!.data : (f!.data as BodyInit);
  const textual = /^(text|application\/(json|x-ndjson))/.test(f!.contentType);
  return new Response(body, { headers: { 'content-type': textual ? `${f!.contentType}; charset=utf-8` : f!.contentType, 'cache-control': 'private, no-store' } });
});
