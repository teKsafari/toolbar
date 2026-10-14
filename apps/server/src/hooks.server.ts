import { sequence, type Handle, type ServerInit } from '@sveltejs/kit/hooks';
import { building } from '$app/env';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { runMigrations } from '#lib/server/db/migrate.ts';
import { env, assertSafeSecrets } from '#lib/server/env.ts';
import { startWorker } from '#lib/server/jobs/worker.ts';
import { bearerFrom, resolveApiToken } from '#lib/server/tokens.ts';
import { apiGate } from '#lib/server/auth/http.ts';
import { registerDashboard } from '#lib/server/dashboard/register.ts';
import { markdownUrlOf, shareMarkdownResponse, wantsMarkdown } from '#lib/server/mcp/markdown.ts';
import { restIdentityOfMcpToken } from '#lib/server/mcp/oauth.ts';
import { MCP_TOKEN_PREFIX } from '@toolbar/shared/areas/agent';

export const init: ServerInit = async () => {
  const unsafe = assertSafeSecrets();
  if (unsafe.length) throw new Error(`Refusing to start on ${env.publicUrl} with dev default secrets: ${unsafe.join(', ')}`);
  if (env.migrateOnStart) {
    await runMigrations(db);
    console.log('[server] migrations applied');
  }
  if (env.worker) {
    const w = startWorker(db);
    const stop = () => void w.stop();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    console.log('[server] job worker started');
  }
  registerDashboard();
};

const securityHeaders: Handle = async ({ event, resolve }) => {
  const res = await resolve(event);
  res.headers.set('X-Content-Type-Options', 'nosniff');
  if (!res.headers.has('Referrer-Policy')) res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (event.url.pathname.startsWith('/s/')) {
    res.headers.set('Referrer-Policy', 'no-referrer');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (res.headers.get('content-type')?.startsWith('text/html')) res.headers.set('Cache-Control', 'private, no-store');
  }
  // agent area (J-153): the share page names its markdown alternate
  const share = SHARE_PAGE.exec(event.url.pathname);
  if (share && res.headers.get('content-type')?.startsWith('text/html')) {
    res.headers.append('Link', `<${markdownUrlOf(share[1]!)}>; rel="alternate"; type="text/markdown"`);
    res.headers.append('Vary', 'Accept');
  }
  return res;
};

/** /s/<token> with nothing after it (the share page). */
const SHARE_PAGE = /^\/s\/([A-Za-z0-9_-]{16,64})\/?$/;

/** agent area (J-153): `Accept: text/markdown` on a share URL gets the markdown summary. */
const shareMarkdown: Handle = async ({ event, resolve }) => {
  const m = event.request.method === 'GET' ? SHARE_PAGE.exec(event.url.pathname) : null;
  if (m && wantsMarkdown(event.request.headers.get('accept'))) return shareMarkdownResponse(m[1]!, event.locals.user?.id ?? null);
  return resolve(event);
};

const resolveMcpAccess = (token: string) => restIdentityOfMcpToken(db, token);

const authenticate: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  event.locals.session = null;
  event.locals.apiToken = null;
  if (event.url.pathname === '/api/health') return resolve(event);

  const bearer = bearerFrom(event.request.headers.get('authorization'));
  const mcpBearer = /^Bearer\s+(\S+)$/i.exec(event.request.headers.get('authorization') ?? '')?.[1];
  if (!bearer && mcpBearer?.startsWith(MCP_TOKEN_PREFIX.access)) {
    // agent area: an OAuth access token (MCP agents, the CLI's browser login) also works on the
    // REST API, with the CLI scopes its grant maps to.
    const r = await resolveMcpAccess(mcpBearer);
    if (r) {
      event.locals.user = r.user as App.Locals['user'];
      event.locals.apiToken = { id: r.grantId, kind: 'personal', scopes: r.scopes };
    }
  } else if (bearer) {
    const row = await resolveApiToken(db, bearer);
    if (row) {
      event.locals.user = row.user as App.Locals['user'];
      event.locals.apiToken = { id: row.tokenId, kind: row.kind, scopes: row.scopes };
    }
  } else if (!building) {
    const s = await auth.api.getSession({ headers: event.request.headers });
    if (s) {
      event.locals.user = s.user;
      event.locals.session = s.session;
    }
  }
  return svelteKitHandler({ event, resolve, auth, building });
};

export const handle = sequence(securityHeaders, authenticate, apiGate, shareMarkdown);
