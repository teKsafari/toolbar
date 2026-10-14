import { error } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { deletionPlan, me } from '#lib/server/dashboard/workspace.ts';

export const load = async ({ locals }) => {
  if (!locals.user) error(401, 'Sign in');
  return { me: await me(db, locals.user.id, 'session'), plan: await deletionPlan(db, locals.user.id) };
};
