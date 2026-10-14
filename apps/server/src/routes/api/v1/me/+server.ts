import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint } from '#lib/server/auth/http.ts';
import { activeWorkspaceId } from '#lib/server/auth/workspaces.ts';

// GET only; PATCH and DELETE belong to the dashboard area.
export const GET = endpoint(ROUTES['account.me'], async ({ user, event }) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image ?? null,
  via: event.locals.apiToken?.kind ?? ('session' as const),
  activeWorkspaceId: await activeWorkspaceId(db, user.id),
}));
