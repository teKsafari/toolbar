// GET /api/v1/feedback/export: every matching capture as one streamed .tar.gz (D-183).
// `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "<server>/api/v1/feedback/export" | tar xz`
// writes .feedback/INDEX.md and one .feedback/<id>/ folder per capture. The page ends at `limit`
// captures or at EXPORT_MAX_MB; x-next-cursor carries the next page's cursor.
import { ROUTES } from '@toolbar/shared/api';
import { NEXT_CURSOR_HEADER } from '@toolbar/shared/areas/feedback-index';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { exportScope } from '#lib/server/handoff/http.ts';
import { feedbackArchive } from '#lib/server/handoff/export.ts';

export const GET = apiRoute(ROUTES['handoff.export'], async ({ event, query }) => {
  const a = await feedbackArchive(db, await exportScope(event, query.workspace), query);
  return new Response(a.body, {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="feedback-export${a.page.page > 1 ? `-${a.page.page}` : ''}.tar.gz"`,
      'cache-control': 'private, no-store',
      'x-export-captures': String(a.page.recs.length),
      'x-export-total': String(a.page.total),
      ...(a.page.nextCursor ? { [NEXT_CURSOR_HEADER]: a.page.nextCursor, 'x-export-stopped-by': a.page.stoppedBy ?? 'limit' } : {}),
    },
  });
});
