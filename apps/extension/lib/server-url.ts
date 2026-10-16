// The server this extension talks to, resolved in one place for the worker, the popup, the
// options page and the content scripts: an admin's managed policy (D-202), else the options-page
// override, else the build's WXT_SERVER_URL, else DEFAULT_SERVER_URL. Before this, each module had its own fallback and the
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

/**
 * Managed policy, then the override, then the build's server, then the default. Invalid values
 * fall through to the next.
 */
export function resolveServerUrl(override?: unknown, built: unknown = BUILT_SERVER_URL, managed: unknown = null): string {
  return clean(managed) ?? clean(override) ?? clean(built) ?? DEFAULT_SERVER_URL;
}

/**
 * What an admin set through policy (D-202): Chrome's ExtensionSettings / Admin console "Policy for
 * extensions", read from chrome.storage.managed (schema: public/managed-schema.json). Firefox reads
 * the same keys from its enterprise policies (3rdparty.Extensions).
 */
export interface ManagedPolicy {
  /** the server, when the policy sets a valid http(s) URL */
  serverUrl: string | null;
  /** hide "Use another server" and keep the options page read-only */
  lockServerUrl: boolean;
}

export const NO_POLICY: ManagedPolicy = { serverUrl: null, lockServerUrl: false };

/** Reads the managed policy; no policy, or no managed storage in this context, gives NO_POLICY. */
export async function managedPolicy(): Promise<ManagedPolicy> {
  try {
    const area = browser.storage.managed;
    if (!area) return NO_POLICY;
    const got = (await area.get(['serverUrl', 'lockServerUrl'])) as Record<string, unknown>;
    return { serverUrl: clean(got.serverUrl), lockServerUrl: got.lockServerUrl === true };
  } catch {
    // Chrome without a policy answers {}; Firefox without one throws, as do content scripts
    return NO_POLICY;
  }
}

/** The configured server: the managed policy, else the options-page override in storage, else the build's. */
export async function serverUrl(): Promise<string> {
  let override: unknown = null;
  const [policy] = await Promise.all([
    managedPolicy(),
    browser.storage.local
      .get(SERVER_URL_KEY)
      .then((r) => (override = r[SERVER_URL_KEY]))
      .catch(() => undefined), // storage unavailable (some content-script contexts): the build's server
  ]);
  return resolveServerUrl(override, BUILT_SERVER_URL, policy.serverUrl);
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
