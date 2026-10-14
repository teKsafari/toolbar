import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { changeSeat, removeMember } from '#lib/server/dashboard/workspace.ts';

// J-222: admins pick viewer, creator or admin.
export const PATCH = apiRoute(ROUTES['members.update'], async ({ event, params, body }) => {
  const { userId } = await workspaceFor(db, event, params.workspaceId, 'admin');
  return changeSeat(db, params.workspaceId, userId, params.userId, body.role);
});

// J-173, J-249: remove (admins) or leave (yourself); captures stay.
export const DELETE = apiRoute(ROUTES['members.remove'], async ({ event, params }) => {
  const { userId, seat } = await workspaceFor(db, event, params.workspaceId, 'viewer');
  await removeMember(db, params.workspaceId, userId, params.userId, seat);
  return { ok: true as const };
});
