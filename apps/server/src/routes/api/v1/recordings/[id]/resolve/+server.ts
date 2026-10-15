// /api/v1/recordings/:id/resolve: whether the feedback is resolved (GET), resolve it (POST, with a
// note and a commit; fires feedback.resolved), open it again (DELETE).
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { captureAccess } from '#lib/server/share/access.ts';
import { reopenFeedback, resolutionOf, resolveFeedback } from '#lib/server/handoff/resolve.ts';

export const GET = apiRoute(ROUTES['handoff.resolution'], async ({ event, params }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'member' });
  return resolutionOf(db, a.rec.id);
});

export const POST = apiRoute(ROUTES['handoff.resolve'], async ({ event, params, body }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'member', role: 'creator' });
  return resolveFeedback(db, a.rec, a.userId!, body, event.locals.apiToken ? 'API' : 'browser');
});

export const DELETE = apiRoute(ROUTES['handoff.reopen'], async ({ event, params }) => {
  const a = await captureAccess(db, event, params.id, { mode: 'member', role: 'creator' });
  await reopenFeedback(db, a.rec.id);
  return { ok: true as const };
});
