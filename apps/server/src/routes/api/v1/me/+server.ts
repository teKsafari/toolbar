import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint } from '#lib/server/auth/http.ts';
import { activeWorkspaceId } from '#lib/server/auth/workspaces.ts';
import { apiRoute } from '#lib/server/share/http.ts';
import { requireUserId } from '#lib/server/dashboard/core.ts';
import { deleteAccount, updateProfile } from '#lib/server/dashboard/workspace.ts';

// GET: auth area. PATCH and DELETE: dashboard area.
export const GET = endpoint(ROUTES['account.me'], async ({ user, event }) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  image: user.image ?? null,
  via: event.locals.apiToken?.kind ?? ('session' as const),
  activeWorkspaceId: await activeWorkspaceId(db, user.id),
}));

// J-175: name, avatar, role hint; the email stays locked.
export const PATCH = apiRoute(ROUTES['account.update'], async ({ event, body }) => {
  const u = await updateProfile(db, requireUserId(event), body);
  return { ...u, via: event.locals.apiToken?.kind ?? ('session' as const) };
});

// J-225: needs "DELETE" typed; solo workspaces are erased; blocked while sole admin of a shared one.
export const DELETE = apiRoute(ROUTES['account.delete'], async ({ event }) => {
  const userId = requireUserId(event);
  const deletedWorkspaces = await deleteAccount(db, userId);
  event.cookies.getAll().forEach((c) => {
    if (c.name.includes('better-auth')) event.cookies.delete(c.name, { path: '/' });
  });
  return { ok: true as const, deletedWorkspaces };
});
