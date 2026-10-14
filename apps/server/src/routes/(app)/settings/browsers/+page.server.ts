import { fail } from '@sveltejs/kit';
import { db } from '#lib/server/db/index.ts';
import { listApiTokens, revokeApiToken } from '#lib/server/tokens.ts';

/** X-05: browsers signed in through the extension (device tokens), each with a disconnect button. */
export const load = async ({ locals }) => ({ devices: await listApiTokens(db, locals.user!.id, 'device') });

export const actions = {
  revoke: async ({ request, locals }) => {
    const id = String((await request.formData()).get('id') ?? '');
    if (!(await revokeApiToken(db, locals.user!.id, id))) return fail(404, { message: 'That browser is already disconnected.' });
    return { revoked: id };
  },
};
