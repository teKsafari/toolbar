// Auth area units: route gate (X-06, J-124, J-148), route lookup, settings defaults, domains,
// token scopes, PKCE and the extension redirect allowlist (X-05).
import { describe, expect, it } from 'vitest';
import { ROUTES, ROUTE_LIST, type RouteDef } from '@toolbar/shared/api';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  extRedirectUri,
  extensionIdOfRedirect,
  joinableDomain,
  neededScope,
  pkceChallenge,
  pkcePair,
  tokenAllows,
} from '@toolbar/shared/areas/auth';
import { authorize, bodyWorkspaceId, findRoute } from '../src/lib/server/auth/http.ts';
import { readSettings } from '../src/lib/server/auth/workspaces.ts';
import { isAllowedRedirect, PINNED_EXTENSION_ID } from '../src/lib/server/auth/ext.ts';
import { isInvitationId } from '../src/lib/server/auth/invites.ts';

const WS = '019a0000-0000-7000-8000-0000000000a1';
const user = { id: 'u1', name: 'U', email: 'u@x.test' } as NonNullable<App.Locals['user']>;
const seats = (role: 'viewer' | 'creator' | 'admin' | null) => async () => role;
const h = (init: Record<string, string> = {}) => new Headers(init);

describe('findRoute', () => {
  it('prefers static segments over parameters', () => {
    expect(findRoute('POST', '/api/v1/recordings/bulk')?.route.name).toBe(
      (ROUTE_LIST as readonly RouteDef[]).find((r) => r.method === 'POST' && r.path === '/api/v1/recordings/bulk')?.name,
    );
    expect(findRoute('GET', `/api/v1/workspaces/${WS}/invites`)).toMatchObject({ route: { name: 'invites.list' }, params: { workspaceId: WS } });
    expect(findRoute('HEAD', '/api/v1/me')?.route.name).toBe('account.me');
    expect(findRoute('GET', '/api/v1/nope')).toBeNull();
  });
  it('finds every auth-area route by its own path', () => {
    for (const r of (ROUTE_LIST as readonly RouteDef[]).filter((x) => x.area === 'auth')) {
      const path = r.path.replace(/:([A-Za-z_]+)/g, (_, k) => (k === 'id' ? '019a0000-0000-7000-8000-00000000abcd' : WS));
      expect(findRoute(r.method, path)?.route.name, r.name).toBe(r.name);
    }
  });
});

describe('authorize', () => {
  it('X-06: 401 without a session on member, session, viewer and upload routes', async () => {
    const none = { user: null, apiToken: null };
    for (const name of ['account.me', 'tokens.list', 'workspaces.list'] as const)
      expect(await authorize(ROUTES[name], {}, none, h()), name).toMatchObject({ code: 'unauthorized' });
    expect(await authorize(ROUTES['invites.preview'], { id: 'x' }, none, h())).toBeNull();
  });
  it('lets a share token through viewer routes and an upload token through upload routes', async () => {
    const none = { user: null, apiToken: null };
    const viewerRoute = (ROUTE_LIST as readonly RouteDef[]).find((r) => r.auth === 'viewer')!;
    const uploadRoute = (ROUTE_LIST as readonly RouteDef[]).find((r) => r.auth === 'upload')!;
    expect(await authorize(viewerRoute, {}, none, h({ 'x-toolbar-share': 'tok' }))).toBeNull();
    expect(await authorize(viewerRoute, {}, none, h())).toMatchObject({ code: 'unauthorized' });
    expect(await authorize(uploadRoute, {}, none, h({ authorization: 'Bearer tb_upl_abc' }))).toBeNull();
    expect(await authorize(uploadRoute, {}, none, h({ authorization: 'Bearer tb_pat_abc' }))).toMatchObject({ code: 'unauthorized' });
  });
  it('session routes refuse API tokens', async () => {
    const r = await authorize(ROUTES['tokens.create'], {}, { user, apiToken: { id: 't', kind: 'device' } }, h());
    expect(r).toMatchObject({ code: 'forbidden' });
  });
  it('J-148: a read-only personal token reads but cannot write', async () => {
    const ro = { user, apiToken: { id: 't', kind: 'personal' as const, scopes: ['cli:read'] } };
    expect(await authorize(ROUTES['account.me'], {}, ro, h())).toBeNull();
    expect(await authorize(ROUTES['workspaces.create'], {}, ro, h())).toMatchObject({ code: 'forbidden' });
    expect(await authorize(ROUTES['account.setActiveWorkspace'], {}, ro, h())).toMatchObject({ code: 'forbidden' });
    const rw = { user, apiToken: { id: 't', kind: 'personal' as const, scopes: ['cli:write'] } };
    expect(await authorize(ROUTES['workspaces.create'], {}, rw, h())).toBeNull();
    const mcpOnly = { user, apiToken: { id: 't', kind: 'personal' as const, scopes: ['mcp:write'] } };
    expect(await authorize(ROUTES['account.me'], {}, mcpOnly, h())).toMatchObject({ code: 'forbidden' });
  });
  it('J-124: seat roles from the path workspace', async () => {
    const s = { user, apiToken: null };
    const p = { workspaceId: WS };
    expect(await authorize(ROUTES['invites.create'], p, s, h(), seats('viewer'))).toMatchObject({ code: 'forbidden' });
    expect(await authorize(ROUTES['invites.create'], p, s, h(), seats('creator'))).toBeNull();
    expect(await authorize(ROUTES['invites.resetLink'], p, s, h(), seats('creator'))).toMatchObject({ code: 'forbidden' });
    expect(await authorize(ROUTES['invites.resetLink'], p, s, h(), seats('admin'))).toBeNull();
    expect(await authorize(ROUTES['invites.list'], p, s, h(), seats(null))).toMatchObject({ code: 'not_found' });
  });
});

describe('settings and domains', () => {
  it('fills defaults and ignores junk', () => {
    expect(readSettings(null)).toEqual(DEFAULT_WORKSPACE_SETTINGS);
    expect(readSettings({ restrictInvites: true, autoDeleteDays: 'x' })).toMatchObject({ restrictInvites: true, autoApproveCreators: true });
    expect(readSettings({ domainJoin: { enabled: true, domain: 'acme.test' } }).domainJoin).toEqual({ enabled: true, domain: 'acme.test' });
  });
  it('J-125: only company domains can be joined', () => {
    expect(joinableDomain('Ann@Acme.Test')).toBe('acme.test');
    expect(joinableDomain('ann@gmail.com')).toBeNull();
    expect(joinableDomain('nope')).toBeNull();
  });
  it('tells invitation ids from link tokens', () => {
    expect(isInvitationId('019a0000-0000-7000-8000-0000000000a1')).toBe(true);
    expect(isInvitationId('H1RLMZgFsh2A1FspgDLZuw')).toBe(false);
  });
});

describe('token scopes', () => {
  it('derives the needed scope from the route or its method', () => {
    expect(neededScope({ method: 'GET' })).toBe('read');
    expect(neededScope({ method: 'POST' })).toBe('write');
    expect(neededScope({ method: 'POST', scope: 'read' })).toBe('read');
  });
  it('write implies read, per surface', () => {
    expect(tokenAllows(['cli:write'], 'cli', 'read')).toBe(true);
    expect(tokenAllows(['cli:read'], 'cli', 'write')).toBe(false);
    expect(tokenAllows(['cli:read'], 'mcp', 'read')).toBe(false);
  });
});

describe('PKCE and extension redirect (X-05)', () => {
  it('matches the RFC 7636 example', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('makes verifiers in the allowed length range', async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
    expect(challenge).toHaveLength(43);
  });
  it('accepts only https://<allowed id>.chromiumapp.org/cb', () => {
    expect(isAllowedRedirect(extRedirectUri(PINNED_EXTENSION_ID))).toBe(true);
    expect(isAllowedRedirect(extRedirectUri('a'.repeat(32)))).toBe(false);
    expect(isAllowedRedirect(`https://${PINNED_EXTENSION_ID}.chromiumapp.org/other`)).toBe(false);
    expect(isAllowedRedirect(`https://${PINNED_EXTENSION_ID}.chromiumapp.org.evil.test/cb`)).toBe(false);
    expect(extensionIdOfRedirect('http://x.chromiumapp.org/cb')).toBeNull();
  });
});

describe('bodyWorkspaceId (J-124: captures.create names its workspace in the body)', () => {
  const req = (method: string, body: string, type = 'application/json') =>
    new Request('http://x/api/v1/recordings', { method, body, headers: { 'content-type': type } });
  it('reads workspaceId from a JSON body and leaves the body readable', async () => {
    const r = req('POST', JSON.stringify({ workspaceId: 'w1', clientId: 'c' }));
    expect(await bodyWorkspaceId(r)).toBe('w1');
    expect(await r.json()).toMatchObject({ clientId: 'c' });
  });
  it('ignores other bodies and methods', async () => {
    expect(await bodyWorkspaceId(req('POST', 'not json'))).toBeNull();
    expect(await bodyWorkspaceId(req('POST', '{"workspaceId":1}'))).toBeNull();
    expect(await bodyWorkspaceId(req('POST', '{"workspaceId":"w"}', 'text/plain'))).toBeNull();
    expect(await bodyWorkspaceId(new Request('http://x/', { method: 'GET' }))).toBeNull();
  });
  it('a viewer seat is refused on create; a creator seat passes', async () => {
    const user = { id: 'u' } as never;
    const ws = '0190f0f0-0000-7000-8000-000000000001';
    const route = ROUTES['captures.create'];
    expect(await authorize(route, { workspaceId: ws }, { user, apiToken: null }, new Headers(), async () => 'viewer')).toMatchObject({ code: 'forbidden' });
    expect(await authorize(route, { workspaceId: ws }, { user, apiToken: null }, new Headers(), async () => 'creator')).toBeNull();
  });
});
