import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { listProjects, projectDefaults, projectDto } from '#lib/server/projects.ts';
import { siteAccessMode } from '#lib/server/projects/access.ts';
import { getSettings } from '#lib/server/auth/workspaces.ts';

// D-123: every member sees the workspace's projects; admins change them and merge them (D-200).
export const load = async ({ parent }) => {
  const { activeWorkspaceId, activeWorkspace } = await parent();
  if (!activeWorkspaceId) error(404, 'No workspace');
  const projects = (await listProjects(db, activeWorkspaceId)).map(projectDto);
  return {
    projects,
    workspaceId: activeWorkspaceId,
    /** what a new project starts with (D-194) */
    defaults: await projectDefaults(db, activeWorkspaceId),
    admin: activeWorkspace?.role === 'admin',
    /** D-200, D-203: project sites only (default), or all sites with a project per origin */
    siteAccess: siteAccessMode(),
    /** D-205: only admins add sites from the extension */
    restrictSiteAdds: (await getSettings(db, activeWorkspaceId))?.restrictSiteAdds ?? false,
  };
};
