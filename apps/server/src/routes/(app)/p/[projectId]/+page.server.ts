import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { listProjects, projectById, projectDto } from '#lib/server/projects.ts';
import { seatOf } from '#lib/server/share/access.ts';
import { ApiError } from '#lib/server/share/http.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// D-200: a project's page, its origins and captures; admins edit the origins and merge projects.
export const load = async ({ params, locals }) => {
  if (!locals.user) error(401, 'Sign in');
  const missing = () => error(404, 'This project does not exist, or it is in a workspace you are not in.');
  if (!UUID.test(params.projectId)) missing();
  let p;
  try {
    p = await projectById(db, params.projectId);
  } catch (e) {
    if (e instanceof ApiError) missing();
    throw e;
  }
  const seat = await seatOf(db, locals.user.id, p!.organizationId);
  if (!seat) missing();
  const others = (await listProjects(db, p!.organizationId)).filter((x) => x.id !== p!.id).map((x) => ({ id: x.id, name: x.name, origins: x.origins }));
  return { project: projectDto(p!), others, seat: seat!, admin: seat === 'admin' };
};
