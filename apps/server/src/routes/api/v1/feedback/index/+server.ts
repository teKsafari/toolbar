// GET /api/v1/feedback/index: INDEX.md of one export page without the folders (D-182).
import { ROUTES } from '@toolbar/shared/api';
import { NEXT_CURSOR_HEADER } from '@toolbar/shared/areas/feedback-index';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { exportScope } from '#lib/server/handoff/http.ts';
import { feedbackIndex } from '#lib/server/handoff/export.ts';

export const GET = apiRoute(ROUTES['handoff.index'], async ({ event, query }) => {
  const ix = await feedbackIndex(db, await exportScope(event, query.workspace), query);
  return new Response(ix.markdown, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'private, no-store',
      ...(ix.page.nextCursor ? { [NEXT_CURSOR_HEADER]: ix.page.nextCursor } : {}),
    },
  });
});
