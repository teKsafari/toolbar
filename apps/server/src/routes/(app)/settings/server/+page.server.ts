// Settings > Server (D-112): instance branding, for instance admins only; everyone else gets 404.
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { isInstanceAdmin } from '#lib/server/auth/instance.ts';
import { adminBranding } from '#lib/server/branding/index.ts';

export const load = async ({ locals }) => {
  if (!(await isInstanceAdmin(db, locals.user))) error(404, 'Not found');
  return { admin: await adminBranding(db) };
};
