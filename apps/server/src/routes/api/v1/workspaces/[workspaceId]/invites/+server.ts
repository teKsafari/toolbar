import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint, fail, requireSeat } from '#lib/server/auth/http.ts';
import { createInvites, listInvites } from '#lib/server/auth/invites.ts';
import { getSettings } from '#lib/server/auth/workspaces.ts';

export const GET = endpoint(ROUTES['invites.list'], async ({ params }) => ({ items: await listInvites(db, params.workspaceId) }));

/** J-123: creators and admins invite; with restrictInvites on, admins only (J-173). */
export const POST = endpoint(ROUTES['invites.create'], async ({ event, params, body, user }) => {
  const s = await getSettings(db, params.workspaceId);
  if (s?.restrictInvites) await requireSeat(event, params.workspaceId, 'admin');
  const items = await createInvites(db, {
    workspaceId: params.workspaceId,
    inviter: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
    emails: body.emails,
    role: body.role,
  });
  if (!items.length && body.emails.length) fail('conflict', 'Everyone on the list is already a member.');
  return { items };
});
