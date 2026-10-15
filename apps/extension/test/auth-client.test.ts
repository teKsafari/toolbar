// X-05: the extension auth client with fake chrome APIs and a fake server.
import { describe, expect, it } from 'vitest';
import type { AuthState, PendingAuth } from '@toolbar/shared/ext';
import { pkceChallenge } from '@toolbar/shared/areas/auth';
import { AuthError, codeFromRedirect, connectUrl, createAuthClient } from '../lib/auth/client.ts';

const REDIRECT = 'https://fmongfmimgdafigcahdpofnmmhljpnei.chromiumapp.org/cb';

function setup(opts: { launch?: (url: string) => Promise<string | undefined>; tokenStatus?: number } = {}) {
  let auth: AuthState | null = null;
  let pending: PendingAuth | null = null;
  const calls: { url: string; init?: RequestInit }[] = [];
  const changes: boolean[] = [];
  let seenChallenge = '';
  const client = createAuthClient({
    serverUrl: async () => 'http://toolbar.test/',
    redirectUrl: () => REDIRECT,
    launch:
      opts.launch ??
      (async (url) => {
        const u = new URL(url);
        seenChallenge = u.searchParams.get('code_challenge')!;
        expect(pending?.state).toBe(u.searchParams.get('state'));
        return `${REDIRECT}?code=the-code-0123456789&state=${u.searchParams.get('state')}`;
      }),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/ext/token')) {
        const body = JSON.parse(String(init!.body));
        expect(await pkceChallenge(body.code_verifier)).toBe(seenChallenge);
        expect(body).toMatchObject({ code: 'the-code-0123456789', redirect_uri: REDIRECT, device_name: 'Chromium on Linux' });
        return new Response(
          JSON.stringify({ token: 'tb_dev_x', tokenId: 't1', user: { id: 'u', name: 'U', email: 'u@x.test', image: null }, workspaces: [], activeWorkspaceId: 'w1' }),
          { status: opts.tokenStatus ?? 200 },
        );
      }
      if (url.includes('/ext/bootstrap')) return new Response('{}', { status: 401 });
      return new Response('{"ok":true}');
    }) as typeof fetch,
    getAuth: async () => auth,
    setAuth: async (a) => void (auth = a),
    setPending: async (p) => void (pending = p),
    setBootstrap: async () => {},
    deviceName: () => 'Chromium on Linux',
    onChange: (s) => changes.push(s),
  });
  return { client, calls, changes, get auth() { return auth; }, get pending() { return pending; } };
}

describe('extension auth client', () => {
  it('builds the connect URL and reads the code back', () => {
    const u = new URL(connectUrl('http://toolbar.test/', { redirectUri: REDIRECT, state: 's1234567', challenge: 'c'.repeat(43) }));
    expect(u.origin + u.pathname).toBe('http://toolbar.test/ext/connect');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(codeFromRedirect(`${REDIRECT}?code=abc&state=s1`, 's1')).toBe('abc');
    expect(() => codeFromRedirect(`${REDIRECT}?code=abc&state=other`, 's1')).toThrow(AuthError);
  });

  it('signs in with PKCE, stores the device token and clears the pending pair', async () => {
    const s = setup();
    const a = await s.client.signIn();
    expect(a).toMatchObject({ serverUrl: 'http://toolbar.test', token: 'tb_dev_x', activeWorkspaceId: 'w1' });
    expect(s.auth?.token).toBe('tb_dev_x');
    expect(s.pending).toBeNull();
    expect(s.changes).toEqual([true]);
  });

  it('a closed window is a cancel and leaves no state', async () => {
    const s = setup({ launch: async () => { throw new Error('The user did not approve access.'); } });
    await expect(s.client.signIn()).rejects.toMatchObject({ code: 'canceled' });
    expect(s.auth).toBeNull();
    expect(s.pending).toBeNull();
  });

  it('a refused exchange is an error', async () => {
    const s = setup({ tokenStatus: 400 });
    await expect(s.client.signIn()).rejects.toMatchObject({ code: 'exchange_failed' });
    expect(s.auth).toBeNull();
  });

  it('a 401 on any call signs the extension out; sign-out revokes on the server', async () => {
    const s = setup();
    await s.client.signIn();
    await expect(s.client.bootstrap()).rejects.toMatchObject({ code: 'not_signed_in' });
    expect(s.auth).toBeNull();
    await s.client.signIn();
    await s.client.signOut();
    const logout = s.calls.find((c) => c.url.endsWith('/api/v1/ext/logout'))!;
    expect(new Headers(logout.init!.headers).get('authorization')).toBe('Bearer tb_dev_x');
    expect(s.auth).toBeNull();
  });
});
