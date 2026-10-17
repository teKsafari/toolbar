import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { requireUserId } from '#lib/server/dashboard/core.ts';
import { projectDto } from '#lib/server/projects.ts';
import { removeSite } from '#lib/server/projects/access.ts';

// D-205: "Remove this site" in the extension popup: workspace admins, or whoever added it.
export const DELETE = apiRoute(ROUTES['sites.remove'], async ({ event, params, query }) => {
  const r = await removeSite(db, params.id, requireUserId(event), query.origin);
  return { project: r ? projectDto(r) : null };
});
