// The auth client wired to chrome APIs, for the service worker and extension pages.
import { browser } from 'wxt/browser';
import { DEFAULT_SERVER_URL } from '@toolbar/shared/constants';
import { STORAGE, type StorageValues } from '@toolbar/shared/ext';
import { createAuthClient } from './client.ts';
import { migrateStorage } from '../migrate.ts';

type Key = keyof typeof STORAGE;

export async function readStore<K extends Key>(k: K): Promise<StorageValues[K] | null> {
  await migrateStorage();
  const { area, key } = STORAGE[k];
  const r = await browser.storage[area].get(key);
  return (r[key] as StorageValues[K] | undefined) ?? null;
}

export async function writeStore<K extends Key>(k: K, v: StorageValues[K] | null): Promise<void> {
  const { area, key } = STORAGE[k];
  if (v === null) await browser.storage[area].remove(key);
  else await browser.storage[area].set({ [key]: v });
}

/** Options-page override, else the build's WXT_SERVER_URL, else the default. */
export async function serverUrl(): Promise<string> {
  const override = await readStore('serverUrl');
  const built = (import.meta.env as Record<string, string | undefined>).WXT_SERVER_URL;
  return (override || built || DEFAULT_SERVER_URL).replace(/\/+$/, '');
}

function deviceName(): string {
  const uad = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; platform?: string } }).userAgentData;
  const brand = uad?.brands?.map((b) => b.brand).find((b) => !/not.?a.?brand|chromium/i.test(b)) ?? 'Chromium';
  const platform = uad?.platform || (/Mac/.test(navigator.userAgent) ? 'macOS' : /Win/.test(navigator.userAgent) ? 'Windows' : 'Linux');
  return `${brand} on ${platform}`;
}

export const authClient = createAuthClient({
  serverUrl,
  redirectUrl: () => browser.identity.getRedirectURL('cb'),
  launch: (url) => browser.identity.launchWebAuthFlow({ url, interactive: true }),
  fetch: (...a) => fetch(...a),
  getAuth: () => readStore('auth'),
  setAuth: (a) => writeStore('auth', a),
  setPending: (p) => writeStore('pendingAuth', p),
  setBootstrap: (b) => writeStore('bootstrap', b),
  deviceName,
  onChange: (signedIn) => void browser.runtime.sendMessage({ type: 'auth.changed', signedIn }).catch(() => undefined),
});
