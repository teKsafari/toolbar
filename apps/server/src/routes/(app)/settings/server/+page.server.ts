// Settings > Server (D-112, D-194): instance branding and the instance settings, for instance
// admins only; everyone else gets 404.
import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { isInstanceAdmin } from '#lib/server/auth/instance.ts';
import { adminBranding } from '#lib/server/branding/index.ts';
import { adminView, refreshSettings } from '#lib/server/settings/index.ts';

export const load = async ({ locals }) => {
  if (!(await isInstanceAdmin(db, locals.user))) error(404, 'Not found');
  await refreshSettings(db, true);
  return { admin: await adminBranding(db), settings: adminView() };
};
