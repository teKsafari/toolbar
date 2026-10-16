// Extension sign-in (X-05, architecture s9) as plain functions over injected dependencies, so
// the service worker wires real chrome APIs and unit tests wire fakes.
//
// 1. PKCE pair and state, kept in chrome.storage.session while the auth window is open.
// 2. launchWebAuthFlow on <server>/ext/connect. The window shares the profile's cookies, so a
//    user already signed in to the dashboard passes straight through.
// 3. The redirect to https://<id>.chromiumapp.org/cb (Firefox: https://<sha1 of the add-on id>.
//    extensions.allizom.org/cb) carries code and state.
// 4. POST /api/v1/ext/token with code + verifier gives a device token (tb_dev_), kept in
//    chrome.storage.local. Settings lists it under connected browsers.
import { API_PREFIX } from '@toolbar/shared/constants';
import { pkcePair, randomUrlToken } from '@toolbar/shared/areas/auth';
import type { ExtBootstrap } from '@toolbar/shared/api';
import type { AuthState, PendingAuth } from '@toolbar/shared/ext';

export interface AuthDeps {
  serverUrl: () => Promise<string>;
  /** chrome.identity.getRedirectURL('cb') */
  redirectUrl: () => string;
  /** chrome.identity.launchWebAuthFlow({ url, interactive: true }); resolves with the final URL */
  launch: (url: string) => Promise<string | undefined>;
  fetch: typeof fetch;
  getAuth: () => Promise<AuthState | null>;
  setAuth: (a: AuthState | null) => Promise<void>;
  setPending: (p: PendingAuth | null) => Promise<void>;
  setBootstrap: (b: { at: number; data: ExtBootstrap } | null) => Promise<void>;
  /** label for connected browsers, e.g. "Chromium on Linux" */
  deviceName: () => string;
  onChange?: (signedIn: boolean) => void;
}

export class AuthError extends Error {
  constructor(
    public code: 'not_signed_in' | 'canceled' | 'state_mismatch' | 'exchange_failed' | 'network',
    message: string,
  ) {
    super(message);
  }
}

const trim = (u: string) => u.replace(/\/+$/, '');

export function connectUrl(server: string, p: { redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
  });
  return `${trim(server)}/ext/connect?${q}`;
}

/** Code from the final redirect, after checking state. */
export function codeFromRedirect(finalUrl: string, expectedState: string): string {
  const u = new URL(finalUrl);
  const err = u.searchParams.get('error');
  if (err) throw new AuthError('exchange_failed', `The server refused the sign-in (${err}).`);
  if (u.searchParams.get('state') !== expectedState) throw new AuthError('state_mismatch', 'The sign-in answer did not match this request.');
  const code = u.searchParams.get('code');
  if (!code) throw new AuthError('exchange_failed', 'The sign-in answer had no code.');
  return code;
}

export function createAuthClient(d: AuthDeps) {
  async function signIn(): Promise<AuthState> {
    const server = trim(await d.serverUrl());
    const { verifier, challenge } = await pkcePair();
    const state = randomUrlToken(16);
    const redirectUri = d.redirectUrl();
    await d.setPending({ verifier, state, startedAt: Date.now() });
    let finalUrl: string | undefined;
    try {
      finalUrl = await d.launch(connectUrl(server, { redirectUri, state, challenge }));
    } catch (e) {
      await d.setPending(null);
      throw new AuthError('canceled', (e as Error)?.message || 'The sign-in window was closed.');
    }
    if (!finalUrl) {
      await d.setPending(null);
      throw new AuthError('canceled', 'The sign-in window was closed.');
    }
    const code = codeFromRedirect(finalUrl, state);
    let res: Response;
    try {
      res = await d.fetch(`${server}${API_PREFIX}/ext/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirectUri, device_name: d.deviceName() }),
      });
    } catch {
      throw new AuthError('network', `Could not reach ${server}.`);
    } finally {
      await d.setPending(null);
    }
    const body = (await res.json().catch(() => ({}))) as {
      token?: string; tokenId?: string; user?: AuthState['user']; activeWorkspaceId?: string | null; message?: string;
    };
    if (!res.ok || !body.token || !body.tokenId || !body.user)
      throw new AuthError('exchange_failed', body.message ?? `Sign-in failed (${res.status}).`);
    const auth: AuthState = {
      serverUrl: server,
      token: body.token,
      tokenId: body.tokenId,
      user: body.user,
      activeWorkspaceId: body.activeWorkspaceId ?? null,
      signedInAt: Date.now(),
    };
    await d.setAuth(auth);
    d.onChange?.(true);
    return auth;
  }

  /** Revoke the device token on the server (best effort) and forget it here. */
  async function signOut(): Promise<void> {
    const a = await d.getAuth();
    if (a) {
      await d
        .fetch(`${a.serverUrl}${API_PREFIX}/ext/logout`, { method: 'POST', headers: { authorization: `Bearer ${a.token}` } })
        .catch(() => undefined);
    }
    await d.setAuth(null);
    await d.setBootstrap(null);
    d.onChange?.(false);
  }

  /** fetch against the signed-in server with the device token. A 401 signs the extension out. */
  async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const a = await d.getAuth();
    if (!a) throw new AuthError('not_signed_in', 'Sign in first.');
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${a.token}`);
    let res: Response;
    try {
      res = await d.fetch(`${a.serverUrl}${path}`, { ...init, headers });
    } catch {
      throw new AuthError('network', `Could not reach ${a.serverUrl}.`);
    }
    if (res.status === 401) {
      await d.setAuth(null);
      await d.setBootstrap(null);
      d.onChange?.(false);
      throw new AuthError('not_signed_in', 'This browser was signed out. Sign in again.');
    }
    return res;
  }

  /** User, workspaces, folders, integrations, settings and limits in one call (J-001 budget). */
  async function bootstrap(workspaceId?: string): Promise<ExtBootstrap> {
    const q = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
    const res = await authFetch(`${API_PREFIX}/ext/bootstrap${q}`);
    if (!res.ok) throw new AuthError('network', `Bootstrap failed (${res.status}).`);
    const data = (await res.json()) as ExtBootstrap;
    await d.setBootstrap({ at: Date.now(), data });
    const a = await d.getAuth();
    if (a && a.activeWorkspaceId !== data.activeWorkspaceId) await d.setAuth({ ...a, user: data.user, activeWorkspaceId: data.activeWorkspaceId });
    return data;
  }

  return { signIn, signOut, authFetch, bootstrap };
}

export type AuthClient = ReturnType<typeof createAuthClient>;
