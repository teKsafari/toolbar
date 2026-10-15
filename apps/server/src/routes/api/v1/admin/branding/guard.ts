// Shared by the admin branding routes: instance admins only, and branding errors as API errors.
import { json, type RequestEvent } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { isInstanceAdmin } from '#lib/server/auth/instance.ts';
import { errorResponse } from '#lib/server/auth/http.ts';
import { adminBranding, BrandImageError, BrandInvalidError, BrandLockedError } from '#lib/server/branding/index.ts';

export async function asAdmin(event: RequestEvent, run: (userId: string) => Promise<void>): Promise<Response> {
  const u = event.locals.user;
  if (!u) return errorResponse('unauthorized', 'Sign in first.');
  if (!(await isInstanceAdmin(db, u))) return errorResponse('forbidden', 'Only the instance admin can change branding.');
  try {
    await run(u.id);
  } catch (e) {
    if (e instanceof BrandLockedError) return errorResponse('locked_by_env', `Set by ${e.field} on the server.`);
    if (e instanceof BrandImageError) return errorResponse(e.code, e.message);
    if (e instanceof BrandInvalidError) return errorResponse('invalid_body', e.message);
    throw e;
  }
  return json(await adminBranding(db), { headers: { 'Cache-Control': 'no-store' } });
}
