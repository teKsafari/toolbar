// GET /api/v1/feedback: the captures the bulk export would hold, as JSON (D-183), with each one's
// folder URL and pull command, and the next-page cursor.
import { ROUTES } from '@toolbar/shared/api';
import { NEXT_CURSOR_HEADER } from '@toolbar/shared/areas/feedback-index';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { exportScope } from '#lib/server/handoff/http.ts';
import { feedbackList } from '#lib/server/handoff/export.ts';

export const GET = apiRoute(ROUTES['handoff.list'], async ({ event, query }) => {
  const out = await feedbackList(db, await exportScope(event, query.workspace), query);
  return json(out, { headers: { 'cache-control': 'private, no-store', ...(out.nextCursor ? { [NEXT_CURSOR_HEADER]: out.nextCursor } : {}) } });
});
