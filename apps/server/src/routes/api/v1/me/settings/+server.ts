import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { getUserSettings, patchRawSettings, requireUserId } from '#lib/server/dashboard/core.ts';

// J-136, J-176, J-215: every per-user setting, defaults filled in; toggles save at once.
export const GET = apiRoute(ROUTES['account.getSettings'], async ({ event }) => getUserSettings(db, requireUserId(event)));

export const PATCH = apiRoute(ROUTES['account.updateSettings'], async ({ event, body }) => {
  const userId = requireUserId(event);
  await patchRawSettings(db, userId, body as Record<string, unknown>);
  return getUserSettings(db, userId);
});
