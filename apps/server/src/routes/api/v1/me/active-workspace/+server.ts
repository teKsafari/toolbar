import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint, fail } from '#lib/server/auth/http.ts';
import { setActiveWorkspace } from '#lib/server/auth/workspaces.ts';

export const PUT = endpoint(ROUTES['account.setActiveWorkspace'], async ({ user, body }) => {
  if (!(await setActiveWorkspace(db, user.id, body.workspaceId))) fail('not_found', 'You are not a member of that workspace.');
  return { ok: true as const };
});
