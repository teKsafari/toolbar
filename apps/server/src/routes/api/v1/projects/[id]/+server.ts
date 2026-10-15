import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { deleteProject, projectById, projectDto, updateProject } from '#lib/server/projects.ts';

export const PATCH = apiRoute(ROUTES['projects.update'], async ({ event, params, body }) => {
  const p = await projectById(db, params.id);
  await workspaceFor(db, event, p.organizationId, 'admin');
  return projectDto(await updateProject(db, p.id, body));
});

export const DELETE = apiRoute(ROUTES['projects.delete'], async ({ event, params }) => {
  const p = await projectById(db, params.id);
  await workspaceFor(db, event, p.organizationId, 'admin');
  await deleteProject(db, p.id);
  return { ok: true as const };
});
