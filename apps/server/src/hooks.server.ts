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
import { getBrand } from '#lib/server/branding/index.ts';
import { brandHead } from '#lib/server/branding/head.ts';
import { domainAllowed } from '#lib/server/auth/allowlist.ts';
import { bootstrapGateClosed } from '#lib/server/auth/instance.ts';
import { refreshSettings } from '#lib/server/settings/index.ts';

export const init: ServerInit = async () => {
  const unsafe = assertSafeSecrets();
  if (unsafe.length) throw new Error(`Refusing to start on ${env.publicUrl} with dev default secrets: ${unsafe.join(', ')}`);
  if (env.migrateOnStart) {
    await runMigrations(db);
    console.log('[server] migrations applied');
  }
  await refreshSettings(db, true);
  if (env.worker) {
    const w = startWorker(db);
    const stop = () => void w.stop();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    console.log('[server] job worker started');
  }
  registerDashboard();
  if (await bootstrapGateClosed(db))
    console.warn(
      env.adminEmails.length
        ? '[server] No allowed email domains and no admin yet: only ADMIN_EMAILS can sign in until an admin does (docs/configuration.md, "Who gets in").'
        : '[server] No allowed email domains and ADMIN_EMAILS is empty on a public URL: sign-in is refused until you set ADMIN_EMAILS (docs/configuration.md, "Who gets in").',
    );
  else if (!env.adminEmails.length && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(env.publicUrl))
    console.warn('[server] ADMIN_EMAILS is empty: the first account on this server is the instance admin (Settings > Server). Set ADMIN_EMAILS.');
  if (!env.auth.oidc && !env.auth.emailPassword)
    console.warn('[server] No sign-in method: set OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET (docs/configuration.md, "Sign-in").');
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

/**
 * agent area (J-153): `Accept: text/markdown` on a share URL gets the markdown summary. HEAD gets
 * the same status and headers as GET (content-type text/markdown) with no body.
 */
const shareMarkdown: Handle = async ({ event, resolve }) => {
  const method = event.request.method;
  const m = method === 'GET' || method === 'HEAD' ? SHARE_PAGE.exec(event.url.pathname) : null;
  if (m && wantsMarkdown(event.request.headers.get('accept'))) {
    const res = await shareMarkdownResponse(m[1]!, event.locals.user?.id ?? null);
    return method === 'HEAD' ? new Response(null, { status: res.status, headers: res.headers }) : res;
  }
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
    // a session of an address the allowlist no longer admits counts as signed out (D-114)
    if (s && domainAllowed(s.user.email)) {
      event.locals.user = s.user;
      event.locals.session = s.session;
    }
  }
  const res = await svelteKitHandler({ event, resolve, auth, building });
  // A provider callback refused by the allowlist (D-114: unverified address, foreign `hd`) ends in
  // a bare 403 from Better Auth; send the person back to the sign-in page, which names the reason.
  // While the bootstrap gate is closed (D-194) the refusal is that one: no admin yet.
  if (res.status === 403 && event.url.pathname.startsWith('/api/auth/callback/')) {
    const code = (await bootstrapGateClosed(db).catch(() => false)) ? 'no_admin' : 'FORBIDDEN';
    return new Response(null, { status: 303, headers: { location: `${env.publicUrl}/login?error=${code}` } });
  }
  return res;
};

/**
 * Instance branding (D-112): the resolved brand on locals, and the favicons, site name and accent
 * written into app.html's `%brand.head%`, so the first paint is already branded.
 */
const brand: Handle = async ({ event, resolve }) => {
  if (event.url.pathname === '/api/health') return resolve(event);
  // instance settings (D-194): re-read at most every 15 s, so a change on another replica arrives
  await refreshSettings(db);
  const b = await getBrand(db);
  event.locals.brand = b;
  const head = brandHead(b);
  return resolve(event, { transformPageChunk: ({ html }) => html.replace('%brand.head%', head) });
};

export const handle = sequence(securityHeaders, brand, authenticate, apiGate, shareMarkdown);
