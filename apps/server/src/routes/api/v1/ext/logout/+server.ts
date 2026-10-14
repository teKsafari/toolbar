import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint, fail } from '#lib/server/auth/http.ts';
import { revokeApiToken } from '#lib/server/tokens.ts';

/** Revoke the device token this request came with (sign out in the extension). */
export const POST = endpoint(ROUTES['ext.logout'], async ({ event, user }) => {
  const t = event.locals.apiToken;
  if (t?.kind !== 'device') return fail('forbidden', 'Call this with the extension device token.');
  await revokeApiToken(db, user.id, t.id);
  return { ok: true as const };
});
