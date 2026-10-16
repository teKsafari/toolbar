import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { listProjects, projectDefaults, projectDto } from '#lib/server/projects.ts';
import { siteAccessMode } from '#lib/server/projects/access.ts';

// D-123: every member sees the workspace's projects; admins change them and merge them (D-200).
export const load = async ({ parent }) => {
  const { activeWorkspaceId, activeWorkspace } = await parent();
  if (!activeWorkspaceId) error(404, 'No workspace');
  return {
    projects: (await listProjects(db, activeWorkspaceId)).map(projectDto),
    workspaceId: activeWorkspaceId,
    /** what a new project starts with (D-194) */
    defaults: await projectDefaults(db, activeWorkspaceId),
    admin: activeWorkspace?.role === 'admin',
    /** D-200: all sites with a project per origin, or the strict project-origins mode */
    siteAccess: siteAccessMode(),
  };
};
