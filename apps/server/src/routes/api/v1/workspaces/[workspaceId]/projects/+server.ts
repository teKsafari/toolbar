import { ROUTES } from '@toolbar/shared/api';
import { json } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { workspaceFor } from '#lib/server/dashboard/core.ts';
import { createProject, listProjects, projectDefaults, projectDto } from '#lib/server/projects.ts';

// Projects (D-123): every member reads them, admins change them.
export const GET = apiRoute(ROUTES['projects.list'], async ({ event, params }) => {
  await workspaceFor(db, event, params.workspaceId, 'viewer');
  return { items: (await listProjects(db, params.workspaceId)).map(projectDto) };
});

export const POST = apiRoute(ROUTES['projects.create'], async ({ event, params, body }) => {
  const { userId } = await workspaceFor(db, event, params.workspaceId, 'admin');
  // preset and step window left out: the workspace's defaults, else the instance's (D-194)
  const d = await projectDefaults(db, params.workspaceId);
  const r = await createProject(db, params.workspaceId, userId, {
    ...body,
    maskingPreset: body.maskingPreset ?? d.maskingPreset,
    traceOpenMs: body.traceOpenMs ?? d.traceOpenMs,
    bodyAllowlist: body.bodyAllowlist ?? [],
  });
  return json(projectDto(r), { status: 201 });
});
