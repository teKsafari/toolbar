import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { endpoint } from '#lib/server/auth/http.ts';
import { activeWorkspaceId, createWorkspace, listWorkspaces } from '#lib/server/auth/workspaces.ts';

export const GET = endpoint(ROUTES['workspaces.list'], async ({ user }) => {
  const items = await listWorkspaces(db, user.id);
  return { items, activeId: await activeWorkspaceId(db, user.id, items) };
});

/** J-221: the caller becomes owner and the new workspace becomes active. */
export const POST = endpoint(ROUTES['workspaces.create'], ({ user, body }) =>
  createWorkspace(db, { userId: user.id, email: user.email, name: body.name, domainJoin: body.domainJoin }),
);
