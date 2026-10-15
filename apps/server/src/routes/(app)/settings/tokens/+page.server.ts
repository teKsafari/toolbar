import { fail } from '@sveltejs/kit';
import { createTokenBodySchema, TOKEN_SCOPES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { createApiToken, listApiTokens, revokeApiToken, tokenInfo } from '#lib/server/tokens.ts';

/** J-148: personal tokens for MCP and the HTTP API (`cli:*` scopes); the secret shows once, after create. */
export const load = async ({ locals }) => ({ tokens: await listApiTokens(db, locals.user!.id, 'personal') });

export const actions = {
  create: async ({ request, locals }) => {
    const f = await request.formData();
    const days = String(f.get('expires') ?? '30');
    const cli = String(f.get('cli') ?? 'read');
    const mcp = String(f.get('mcp') ?? 'read');
    const scopes = [
      ...(cli === 'read' ? ['cli:read'] : cli === 'write' ? ['cli:write'] : []),
      ...(mcp === 'read' ? ['mcp:read'] : mcp === 'write' ? ['mcp:write'] : []),
    ].filter((s) => (TOKEN_SCOPES as readonly string[]).includes(s));
    const parsed = createTokenBodySchema.safeParse({
      name: String(f.get('name') ?? ''),
      expiresInDays: days === 'never' ? null : Number(days),
      scopes,
    });
    if (!parsed.success) return fail(400, { message: 'Give the token a name and at least one permission.' });
    const { secret, row } = await createApiToken(db, { userId: locals.user!.id, kind: 'personal', ...parsed.data });
    return { created: { token: tokenInfo(row), secret } };
  },
  revoke: async ({ request, locals }) => {
    const id = String((await request.formData()).get('id') ?? '');
    if (!(await revokeApiToken(db, locals.user!.id, id))) return fail(404, { message: 'That token is already revoked.' });
    return { revoked: id };
  },
};
