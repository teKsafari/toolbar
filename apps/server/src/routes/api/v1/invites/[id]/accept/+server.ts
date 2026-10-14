import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint, fail } from '#lib/server/auth/http.ts';
import { acceptInvite } from '#lib/server/auth/invites.ts';

export const POST = endpoint(ROUTES['invites.accept'], async ({ params, user }) => {
  const r = await acceptInvite(db, params.id, user);
  if (!r.ok) return fail(r.code, r.message);
  return { workspaceId: r.workspaceId, role: r.role };
});
