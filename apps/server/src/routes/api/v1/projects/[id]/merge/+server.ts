import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { projectById, projectDto } from '#lib/server/projects.ts';
import { mergeProjects } from '#lib/server/projects/access.ts';

// D-200: an admin merges another project of the workspace into this one.
export const POST = apiRoute(ROUTES['projects.merge'], async ({ event, params, body }) => {
  const p = await projectById(db, params.id);
  await workspaceFor(db, event, p.organizationId, 'admin');
  const r = await mergeProjects(db, p.id, body.from);
  return { project: projectDto(r.project), movedCaptures: r.movedCaptures };
});
