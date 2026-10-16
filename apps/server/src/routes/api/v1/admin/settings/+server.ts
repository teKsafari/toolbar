// GET and PATCH /api/v1/admin/settings (instance admins, D-187): effective server settings with
// their locks and defaults; a partial update stores fields (null resets one) and applies at once.
import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute, fail } from '#lib/server/share/http.ts';
import { adminView, SettingsError, updateSettings } from '#lib/server/settings/index.ts';
import { instanceAdmin } from './guard.ts';

export const GET = apiRoute(ROUTES['instanceSettings.get'], async ({ event }) => {
  await instanceAdmin(event);
  return adminView();
});

export const PATCH = apiRoute(ROUTES['instanceSettings.update'], async ({ event, body }) => {
  const userId = await instanceAdmin(event);
  try {
    return await updateSettings(db, userId, body);
  } catch (e) {
    if (e instanceof SettingsError) fail(e.code, e.message, e.key ? [{ path: [e.key], message: e.message }] : undefined);
    throw e;
  }
});
