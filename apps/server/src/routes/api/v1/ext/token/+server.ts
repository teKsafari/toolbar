import { ROUTES } from '@toolbar/shared/api';
import { db } from '#lib/server/db/index.ts';
import { user as userTable } from '#lib/server/db/schema/index.ts';
import { endpoint, fail } from '#lib/server/auth/http.ts';
import { exchangeCode } from '#lib/server/auth/ext.ts';
import { activeWorkspaceId, listWorkspaces } from '#lib/server/auth/workspaces.ts';
import { eq } from 'drizzle-orm';

/** X-05: code + PKCE verifier for a device token (tb_dev_). */
export const POST = endpoint(ROUTES['ext.token'], async ({ body }) => {
  const r = await exchangeCode(db, body);
  if (!r.ok) return fail(r.code, r.code === 'expired' ? 'The sign-in code expired. Try again.' : 'The sign-in code is not valid.');
  const [u] = await db.select().from(userTable).where(eq(userTable.id, r.userId));
  const workspaces = await listWorkspaces(db, r.userId);
  return {
    token: r.token,
    tokenId: r.tokenId,
    user: { id: u!.id, name: u!.name, email: u!.email, image: u!.image ?? null },
    workspaces,
    activeWorkspaceId: await activeWorkspaceId(db, r.userId, workspaces),
  };
});
