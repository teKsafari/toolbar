import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint, fail, requireSeat } from '#lib/server/auth/http.ts';
import { cancelInvite, invitationWorkspace, resolveInvite } from '#lib/server/auth/invites.ts';

/** Public: what the join page shows (J-123, J-234). */
export const GET = endpoint(ROUTES['invites.preview'], async ({ params }) => {
  const inv = await resolveInvite(db, params.id);
  if (!inv) return fail('not_found', 'No such invitation.');
  return { workspaceName: inv.workspaceName, inviterName: inv.inviterName, role: inv.role, email: inv.email, status: inv.status };
});

export const DELETE = endpoint(ROUTES['invites.cancel'], async ({ event, params }) => {
  const ws = await invitationWorkspace(db, params.id);
  if (!ws) return fail('not_found', 'No such invitation.');
  await requireSeat(event, ws, 'creator');
  if (!(await cancelInvite(db, params.id))) fail('not_found', 'The invitation is no longer pending.');
  return { ok: true as const };
});
