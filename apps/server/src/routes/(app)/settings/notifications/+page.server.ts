import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { getUserSettings } from '#lib/server/dashboard/core.ts';

export const load = async ({ locals }) => {
  if (!locals.user) error(401, 'Sign in');
  return { settings: await getUserSettings(db, locals.user.id) };
};
