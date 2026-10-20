import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { projectById, projectDto } from '#lib/server/projects.ts';
import { deleteEmbedKey, rotateEmbedKey } from '#lib/server/embed/index.ts';

// D-211: workspace admins turn a project's embed on, replace its key, or turn it off.
export const POST = apiRoute(ROUTES['embed.rotateKey'], async ({ event, params }) => {
  const p = await projectById(db, params.id);
  await workspaceFor(db, event, p.organizationId, 'admin');
  return projectDto(await rotateEmbedKey(db, p.id));
});

export const DELETE = apiRoute(ROUTES['embed.deleteKey'], async ({ event, params }) => {
  const p = await projectById(db, params.id);
  await workspaceFor(db, event, p.organizationId, 'admin');
  return projectDto(await deleteEmbedKey(db, p.id));
});
