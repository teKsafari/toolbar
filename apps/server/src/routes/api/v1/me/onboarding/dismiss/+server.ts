import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { requireUserId } from '#lib/server/dashboard/core.ts';
import { dismissOnboarding } from '#lib/server/dashboard/workspace.ts';

export const POST = apiRoute(ROUTES['dashboard.dismissOnboarding'], async ({ event }) => {
  await dismissOnboarding(db, requireUserId(event));
  return { ok: true as const };
});
