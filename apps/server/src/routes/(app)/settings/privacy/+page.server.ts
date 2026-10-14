import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { getUserSettings } from '#lib/server/dashboard/core.ts';
import { workspaceDetail } from '#lib/server/dashboard/workspace.ts';

export const load = async ({ parent, locals }) => {
  const { activeWorkspaceId } = await parent();
  if (!activeWorkspaceId || !locals.user) error(404, 'No workspace');
  return {
    ws: await workspaceDetail(db, activeWorkspaceId, locals.user.id),
    settings: await getUserSettings(db, locals.user.id),
  };
};
