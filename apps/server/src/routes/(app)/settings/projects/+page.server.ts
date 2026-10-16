import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { env } from '#lib/server/env.ts';
import { listProjects, projectDefaults, projectDto } from '#lib/server/projects.ts';
import { injectorEnabled, injectorOriginListed, reviewLink } from '#lib/server/review/index.ts';
import { normalizeOrigin } from '#lib/server/review/cookie.ts';

// D-123: every member sees the workspace's projects; admins change them.
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
    /**
     * Review links (D-200), with the injector on: one per exact origin of each project (a `*.`
     * origin names no single site). Origins outside INJECTOR_ORIGINS get none.
     */
    reviewLinks: injectorEnabled()
      ? Object.fromEntries(
          projects.map((p) => [
            p.id,
            p.origins
              .filter((o) => !o.includes('*'))
              .map((o) => normalizeOrigin(o))
              .filter((o): o is string => !!o && injectorOriginListed(o))
              .map((o) => ({ origin: o, host: new URL(o).host, href: reviewLink(env.publicUrl, p.id, o, p.origins) })),
          ]),
        )
      : null,
  };
};
