import { error } from '@sveltejs/kit';

export const load = async ({ parent }) => {
  const { activeWorkspaceId, activeWorkspace } = await parent();
  if (!activeWorkspaceId) error(404, 'No workspace');
  if (activeWorkspace?.role !== 'admin') error(403, 'Only workspace admins see the audit log');
  return { workspaceId: activeWorkspaceId };
};
