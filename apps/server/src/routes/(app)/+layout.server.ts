import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { member, organization } from '#lib/server/db/schema/index.ts';
import { activeWorkspaceId, listWorkspaces } from '#lib/server/auth/workspaces.ts';

export const load = async ({ locals, url }) => {
  if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  const workspaces = await db
    .select({ id: organization.id, name: organization.name, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, locals.user.id));
  // auth area: the workspace menu (J-168, J-221) and the invite dialog (J-123) use these.
  const myWorkspaces = await listWorkspaces(db, locals.user.id);
  const activeId = await activeWorkspaceId(db, locals.user.id, myWorkspaces);
  return {
    myWorkspaces,
    activeWorkspaceId: activeId,
    activeWorkspace: myWorkspaces.find((w) => w.id === activeId) ?? null,
    user: { id: locals.user.id, name: locals.user.name, email: locals.user.email, image: locals.user.image ?? null },
    workspaces,
  };
};
