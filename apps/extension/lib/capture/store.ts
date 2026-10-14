// Typed chrome.storage access for the keys in @toolbar/shared/ext STORAGE, plus the capture
// area's private keys. Service worker and extension pages only (not the offscreen document).
import { browser } from 'wxt/browser';
import { DEFAULT_SERVER_URL } from '@toolbar/shared/constants';
import { DEFAULT_USER_SETTINGS, type ExtensionSettings } from '@toolbar/shared/api';
import { STORAGE, type AuthState, type StorageName, type StorageValues } from '@toolbar/shared/ext';

const areaOf = (a: 'local' | 'session') => (a === 'local' ? browser.storage.local : browser.storage.session);

export async function getStore<N extends StorageName>(name: N): Promise<StorageValues[N] | undefined> {
  const { area, key } = STORAGE[name];
  const r = await areaOf(area).get(key);
  return r[key] as StorageValues[N] | undefined;
}

export async function setStore<N extends StorageName>(name: N, value: StorageValues[N]): Promise<void> {
  const { area, key } = STORAGE[name];
  await areaOf(area).set({ [key]: value });
}

/** Capture-private keys (not part of the shared contract). */
export const CAPTURE_KEYS = {
  /** local capture id or server id -> server id, for the background drainer */
  serverIds: 'nib:cap:server-ids',
  /** tab id -> end of the last capture, so a screenshot's pre-roll restarts after each capture (J-071) */
  lastCaptureEnd: 'nib:cap:last-end',
} as const;

export async function getPrivate<T>(key: string, fallback: T): Promise<T> {
  const r = await browser.storage.local.get(key);
  return (r[key] as T | undefined) ?? fallback;
}
export async function setPrivate<T>(key: string, value: T): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function getSettings(): Promise<ExtensionSettings> {
  return { ...DEFAULT_USER_SETTINGS.extension, ...((await getStore('settings')) ?? {}) };
}

export function defaultServerUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.WXT_SERVER_URL || DEFAULT_SERVER_URL;
}

export async function serverUrl(): Promise<string> {
  return (await getStore('serverUrl')) || (await getStore('auth'))?.serverUrl || defaultServerUrl();
}

/** Signed-in state, or null. The token is never logged. */
export async function getAuth(): Promise<AuthState | null> {
  return (await getStore('auth')) ?? null;
}
