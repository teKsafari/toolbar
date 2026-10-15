import { error } from '@sveltejs/kit';
import { env } from '#lib/server/env.ts';
import { requireFeature } from '#lib/server/paused.ts';

export const load = async ({ parent }) => {
  requireFeature(env.features.adminExtras);
  const { activeWorkspaceId, activeWorkspace } = await parent();
  if (!activeWorkspaceId) error(404, 'No workspace');
  if (activeWorkspace?.role !== 'admin') error(403, 'Only workspace admins see the audit log');
  return { workspaceId: activeWorkspaceId };
};
