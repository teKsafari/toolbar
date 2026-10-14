import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { folderGuests, listMembers, workspaceDetail } from '#lib/server/dashboard/workspace.ts';
import { getInviteLink, listInvites } from '#lib/server/auth/invites.ts';

export const load = async ({ parent, locals }) => {
  const { activeWorkspaceId } = await parent();
  if (!activeWorkspaceId || !locals.user) error(404, 'No workspace');
  const ws = await workspaceDetail(db, activeWorkspaceId, locals.user.id);
  const canInvite = ws.role === 'admin' || (ws.role === 'creator' && !ws.settings.restrictInvites);
  const [members, guests] = await Promise.all([listMembers(db, activeWorkspaceId), folderGuests(db, activeWorkspaceId)]);
  const link = canInvite ? await getInviteLink(db, activeWorkspaceId, locals.user.id) : null;
  const pending = ws.role !== 'viewer' ? (await listInvites(db, activeWorkspaceId)).filter((i) => i.status === 'pending') : [];
  return { ws, members, guests, link, pending, canInvite, me: locals.user.id };
};
