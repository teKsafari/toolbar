import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { listHooks } from '#lib/server/webhooks/index.ts';

export const load = async ({ parent }) => {
  const { activeWorkspaceId, activeWorkspace } = await parent();
  if (!activeWorkspaceId) error(404, 'No workspace');
  if (activeWorkspace?.role !== 'admin') error(403, 'Only workspace admins manage webhooks');
  return { hooks: await listHooks(db, activeWorkspaceId), workspaceId: activeWorkspaceId };
};
