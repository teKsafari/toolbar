// OAuth consent for MCP clients (J-146): workspace picker, the client's registered name, the two
// scopes and one approve button. Signed-out visitors go through /login and come back here.
import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { MCP_SCOPE_LABELS } from '@toolbar/shared/areas/agent';
import { db } from '#lib/server/db/index.ts';
import { activeWorkspaceId, listWorkspaces } from '#lib/server/auth/workspaces.ts';
import { approve, checkAuthorize, issuer, OAuthError, redirectWith } from '#lib/server/mcp/oauth.ts';

const query = (url: URL) => Object.fromEntries(url.searchParams);

function requireSession(locals: App.Locals, url: URL) {
  if (!locals.user || locals.apiToken) redirect(303, `/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  return locals.user;
}

async function check(url: URL) {
  try {
    return await checkAuthorize(db, query(url));
  } catch (e) {
    if (e instanceof OAuthError) error(400, { message: e.description, code: e.code });
    throw e;
  }
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const u = requireSession(locals, url);
  const c = await check(url);
  if (c.error) redirect(303, redirectWith(c.redirectUri, { error: c.error.code, error_description: c.error.description, state: url.searchParams.get('state') ?? undefined }));
  const workspaces = await listWorkspaces(db, u.id);
  return {
    client: { name: c.client.name, uri: c.client.clientUri, redirectHost: new URL(c.redirectUri).host || c.redirectUri.split(':')[0] },
    scopes: c.scopes!.map((s) => ({ id: s, label: MCP_SCOPE_LABELS[s] })),
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, role: w.role })),
    activeId: await activeWorkspaceId(db, u.id, workspaces),
    user: { name: u.name, email: u.email },
  };
};

export const actions: Actions = {
  approve: async ({ locals, url, request }) => {
    const u = requireSession(locals, url);
    const c = await check(url);
    if (c.error || !c.query) return fail(400, { message: 'The request from the agent is incomplete.' });
    const form = await request.formData();
    const workspaceId = String(form.get('workspaceId') ?? '');
    const workspaces = await listWorkspaces(db, u.id);
    if (!workspaces.some((w) => w.id === workspaceId)) return fail(400, { message: 'Pick one of your workspaces.' });
    const code = await approve(db, {
      clientId: c.client.id,
      userId: u.id,
      organizationId: workspaceId,
      scopes: c.scopes!,
      redirectUri: c.redirectUri,
      codeChallenge: c.query.code_challenge,
    });
    redirect(303, redirectWith(c.redirectUri, { code, state: c.query.state, iss: issuer() }));
  },
  deny: async ({ locals, url }) => {
    requireSession(locals, url);
    const c = await check(url);
    redirect(303, redirectWith(c.redirectUri, { error: 'access_denied', error_description: 'The user did not allow access.', state: url.searchParams.get('state') ?? undefined }));
  },
};
