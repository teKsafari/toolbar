import { fail } from '@sveltejs/kit';
import { agentSetups } from '@toolbar/shared/areas/agent';
import { db } from '#lib/server/db/index.ts';
import { listGrants, revokeGrant } from '#lib/server/mcp/oauth.ts';
import { mcpUrl } from '#lib/server/mcp/data.ts';

/** J-145 setup cards and J-147 connected agents. */
export const load = async ({ locals }) => ({
  serverUrl: mcpUrl(),
  setups: agentSetups(mcpUrl()),
  clients: await listGrants(db, locals.user!.id),
});

export const actions = {
  remove: async ({ request, locals }) => {
    const id = String((await request.formData()).get('id') ?? '');
    if (!(await revokeGrant(db, locals.user!.id, id))) return fail(404, { message: 'That agent is already removed.' });
    return { removed: id };
  },
};
