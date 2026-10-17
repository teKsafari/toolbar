import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { projectDto } from '#lib/server/projects.ts';
import { addSite, canAddSites } from '#lib/server/projects/access.ts';

// D-205: a member adds the site they are on from the extension icon, to a project or a new one.
export const POST = apiRoute(ROUTES['sites.add'], async ({ event, params, body }) => {
  const { userId } = await workspaceFor(db, event, params.workspaceId, 'viewer');
  if (!(await canAddSites(db, userId, params.workspaceId))) fail('forbidden', 'Only workspace admins add sites here');
  const r = await addSite(db, params.workspaceId, userId, body);
  return { project: projectDto(r.project), created: r.created };
});
