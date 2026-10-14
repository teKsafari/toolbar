import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint, fail } from '#lib/server/auth/http.ts';
import { revokeApiToken } from '#lib/server/tokens.ts';

export const DELETE = endpoint(ROUTES['tokens.revoke'], async ({ user, params }) => {
  if (!(await revokeApiToken(db, user.id, params.id))) fail('not_found', 'No such token.');
  return { ok: true as const };
});
