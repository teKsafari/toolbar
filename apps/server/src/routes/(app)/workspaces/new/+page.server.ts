import { fail, redirect } from '@sveltejs/kit';
import { and, eq, gt, sql } from 'drizzle-orm';
import { joinableDomain } from '@toolbar/shared/areas/auth';
import { db } from '#lib/server/db/index.ts';
import { invitation, organization } from '#lib/server/db/schema/index.ts';
import { createWorkspace } from '#lib/server/auth/workspaces.ts';

/** J-221: create a workspace, or join one you were invited to. */
export const load = async ({ locals, url }) => {
  // the page resets to the root layout (+page@.svelte), so it checks the session itself
  if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
  const u = locals.user;
  const invites = await db
    .select({ id: invitation.id, workspace: organization.name, role: invitation.role })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .where(and(sql`lower(${invitation.email}) = ${u.email.toLowerCase()}`, eq(invitation.status, 'pending'), gt(invitation.expiresAt, new Date())));
  return { domain: joinableDomain(u.email), invites };
};

export const actions = {
  default: async ({ request, locals }) => {
    const u = locals.user;
    if (!u) redirect(303, '/login');
    const f = await request.formData();
    const name = String(f.get('name') ?? '').trim();
    if (!name || name.length > 100) return fail(400, { name, message: 'Give the workspace a name of up to 100 characters.' });
    await createWorkspace(db, { userId: u.id, email: u.email, name, domainJoin: f.get('domainJoin') === 'on' });
    redirect(303, '/?created=1');
  },
};
