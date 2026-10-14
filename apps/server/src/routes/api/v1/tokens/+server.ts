import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint } from '#lib/server/auth/http.ts';
import { createApiToken, listApiTokens, tokenInfo } from '#lib/server/tokens.ts';

export const GET = endpoint(ROUTES['tokens.list'], async ({ user, query }) => ({ items: await listApiTokens(db, user.id, query.kind) }));

/** J-148: the secret is in this response only. */
export const POST = endpoint(ROUTES['tokens.create'], async ({ user, body }) => {
  const { secret, row } = await createApiToken(db, {
    userId: user.id,
    kind: 'personal',
    name: body.name,
    scopes: body.scopes,
    expiresInDays: body.expiresInDays,
  });
  return { token: tokenInfo(row), secret };
});
