import { error, fail, redirect } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { acceptInvite, resolveInvite } from '#lib/server/auth/invites.ts';
import { memberRow } from '#lib/server/auth/workspaces.ts';

/** Join page for an email invitation or the workspace invite link (J-123, J-234). */
export const load = async ({ params, locals, url }) => {
  const inv = await resolveInvite(db, params.id);
  if (!inv) error(404, { message: 'This invitation does not exist or the link was reset.' });
  const already = locals.user ? !!(await memberRow(db, locals.user.id, inv.workspaceId)) : false;
  return {
    invite: { workspaceName: inv.workspaceName, inviterName: inv.inviterName, role: inv.role, email: inv.email, status: inv.status, kind: inv.kind },
    me: locals.user ? { email: locals.user.email, name: locals.user.name } : null,
    already,
    loginUrl: `/login?next=${encodeURIComponent(url.pathname)}`,
  };
};

export const actions = {
  default: async ({ params, locals }) => {
    if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(`/invite/${params.id}`)}`);
    const r = await acceptInvite(db, params.id, locals.user);
    if (!r.ok) return fail(400, { message: r.message });
    redirect(303, '/?joined=1');
  },
};
