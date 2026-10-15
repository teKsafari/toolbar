import { error } from '@sveltejs/kit';
import { env } from '#lib/server/env.ts';
import { requireFeature } from '#lib/server/paused.ts';
import { db } from '#lib/server/db/index.ts';
import { getUserSettings } from '#lib/server/dashboard/core.ts';

export const load = async ({ locals }) => {
  requireFeature(env.features.email);
  if (!locals.user) error(401, 'Sign in');
  return { settings: await getUserSettings(db, locals.user.id) };
};
