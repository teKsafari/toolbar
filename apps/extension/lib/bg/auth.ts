// Service-worker handlers for the auth requests in BgRequestMap: auth.state, auth.signIn,
// auth.signOut and bootstrap.get. background.ts registers them with one line.
import { browser } from 'wxt/browser';
import type { BgError, BgRequest, BgRequestMap, BgRequestOf, BgResult } from '@toolbar/shared/ext';
import { AuthError } from '../auth/client.ts';
import { authClient, readStore, serverUrl } from '../auth/chrome.ts';

type Handlers = { [K in keyof BgRequestMap]?: (req: BgRequestOf<K>) => Promise<BgRequestMap[K]['res']> };

/** Cached bootstrap is fresh for this long; the popup asks with refresh when it must be current. */
const BOOTSTRAP_TTL_MS = 60_000;

export const authHandlers: Handlers = {
  'auth.state': async () => {
    const a = await readStore('auth');
    return { signedIn: !!a, user: a?.user ?? null, serverUrl: a?.serverUrl ?? (await serverUrl()) };
  },
  'auth.signIn': async () => {
    const { user } = await authClient.signIn();
    // D-120: the project list decides where the extension may run; fetch it with the sign-in
    await authClient.bootstrap().catch(() => undefined);
    return { user };
  },
  'auth.signOut': async () => {
    await authClient.signOut();
    return {};
  },
  'bootstrap.get': async (req) => {
    const cached = await readStore('bootstrap');
    if (!req.refresh && !req.workspaceId && cached && Date.now() - cached.at < BOOTSTRAP_TTL_MS) return { bootstrap: cached.data };
    return { bootstrap: await authClient.bootstrap(req.workspaceId) };
  },
};

function errorOf(e: unknown): { error: BgError; message: string } {
  if (e instanceof AuthError) {
    const map: Record<AuthError['code'], BgError> = {
      not_signed_in: 'not_signed_in',
      canceled: 'permission_denied',
      state_mismatch: 'invalid',
      exchange_failed: 'server',
      network: 'network',
    };
    return { error: map[e.code], message: e.message };
  }
  return { error: 'server', message: (e as Error)?.message ?? String(e) };
}

/** onMessage listener for a handler table; answers only the types it knows. */
export function listen(handlers: Handlers) {
  return (msg: BgRequest, _sender: unknown, reply: (r: BgResult<keyof BgRequestMap>) => void): boolean => {
    const h = handlers[msg?.type as keyof BgRequestMap] as ((r: BgRequest) => Promise<object>) | undefined;
    if (!h) return false;
    h(msg).then(
      (res) => reply({ ok: true, ...res } as BgResult<keyof BgRequestMap>),
      (e: unknown) => reply({ ok: false, ...errorOf(e) }),
    );
    return true;
  };
}

/** One line in background.ts: registerAuth(). */
export function registerAuth() {
  browser.runtime.onMessage.addListener(listen(authHandlers) as Parameters<typeof browser.runtime.onMessage.addListener>[0]);
}
