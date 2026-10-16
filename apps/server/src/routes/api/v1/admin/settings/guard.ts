// Instance admins only (D-112, D-187): everyone else gets 401 or 403.
import type { RequestEvent } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { isInstanceAdmin } from '#lib/server/auth/instance.ts';
import { fail } from '#lib/server/share/http.ts';

export async function instanceAdmin(event: RequestEvent): Promise<string> {
  const u = event.locals.user;
  if (!u) fail('unauthorized', 'Sign in first.');
  // a personal API token never reaches instance settings: they change who may sign in
  if (event.locals.apiToken) fail('forbidden', 'Server settings need a browser session.');
  if (!(await isInstanceAdmin(db, u))) fail('forbidden', 'Only the instance admin can change server settings.');
  return u.id;
}
