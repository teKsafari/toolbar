import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { listProjects, projectDto } from '#lib/server/projects.ts';

// D-123: every member sees the workspace's projects; admins change them.
export const load = async ({ parent }) => {
  const { activeWorkspaceId, activeWorkspace } = await parent();
  if (!activeWorkspaceId) error(404, 'No workspace');
  return {
    projects: (await listProjects(db, activeWorkspaceId)).map(projectDto),
    workspaceId: activeWorkspaceId,
    admin: activeWorkspace?.role === 'admin',
  };
};
