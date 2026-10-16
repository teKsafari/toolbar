// The server this extension talks to, resolved in one place for the worker, the popup, the
// options page and the content scripts: the options-page override, else the build's
// WXT_SERVER_URL, else DEFAULT_SERVER_URL. Before this, each module had its own fallback and the
// popup started from the localhost constant, so a release build's home button opened localhost
// whenever the popup's load stopped early.
import { browser } from 'wxt/browser';
import { DEFAULT_SERVER_URL } from '@toolbar/shared/constants';
// Type-only: a value import would bundle zod into content scripts and the popup.
import type { AuthState, STORAGE } from '@toolbar/shared/ext';

export const SERVER_URL_KEY: (typeof STORAGE)['serverUrl']['key'] = 'tb:server-url';
const AUTH_KEY: (typeof STORAGE)['auth']['key'] = 'tb:auth';

/** The server this build was made for (WXT_SERVER_URL at build time), if any. */
export const BUILT_SERVER_URL: string | undefined = (import.meta.env as Record<string, string | undefined>).WXT_SERVER_URL || undefined;

/** An http(s) URL without its trailing slashes, or null for anything else. */
function clean(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return (u.origin + u.pathname).replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Override, else the build's server, else the default. Invalid values fall through. */
export function resolveServerUrl(override?: unknown, built: unknown = BUILT_SERVER_URL): string {
  return clean(override) ?? clean(built) ?? DEFAULT_SERVER_URL;
}

/** The configured server: reads the options-page override from storage. */
export async function serverUrl(): Promise<string> {
  let override: unknown = null;
  try {
    override = (await browser.storage.local.get(SERVER_URL_KEY))[SERVER_URL_KEY];
  } catch {
    /* storage unavailable (some content-script contexts): the build's server */
  }
  return resolveServerUrl(override);
}

/** The server holding the sign-in (its token works there only), else the configured server. */
export async function accountServerUrl(auth?: Pick<AuthState, 'serverUrl'> | null): Promise<string> {
  let a = auth;
  if (a === undefined) {
    try {
      a = ((await browser.storage.local.get(AUTH_KEY))[AUTH_KEY] as AuthState | undefined) ?? null;
    } catch {
      a = null;
    }
  }
  return clean(a?.serverUrl) ?? (await serverUrl());
}
