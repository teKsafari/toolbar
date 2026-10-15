// GET /api/v1/recordings/:id/folder: the feedback folder as .tar.gz (PLAN "Hand-off to the agent").
// `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" <url> | tar xz` writes .feedback/<id>/.
// Members only: a share link reaches the summary, never the folder.
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { folderTarGz } from '#lib/server/handoff/folder.ts';
import { folderCapture } from '#lib/server/handoff/http.ts';

export const GET = apiRoute(ROUTES['handoff.folder'], async ({ event, params }) => {
  const rec = await folderCapture(event, params.id);
  const { tgz } = await folderTarGz(db, rec);
  return new Response(tgz as BodyInit, {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="feedback-${rec.id}.tar.gz"`,
      'cache-control': 'private, no-store',
      'content-length': String(tgz.byteLength),
    },
  });
});
