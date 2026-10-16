// Typed chrome.storage access for the keys in @toolbar/shared/ext STORAGE, plus the capture
// area's private keys. Service worker and extension pages only (not the offscreen document).
import { browser } from 'wxt/browser';
import { DEFAULT_USER_SETTINGS, type ExtensionSettings } from '@toolbar/shared/api';
import { STORAGE, type AuthState, type StorageName, type StorageValues } from '@toolbar/shared/ext';
import { migrateStorage } from '../migrate';
import { BUILT_SERVER_URL, accountServerUrl, resolveServerUrl } from '../server-url';

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
  serverIds: 'tb:cap:server-ids',
  /** tab id -> end of the last capture, so a screenshot's pre-roll restarts after each capture (J-071) */
  lastCaptureEnd: 'tb:cap:last-end',
  /** driver mode: the session's recording id -> the media and upload id (server id when known) */
  mediaIds: 'tb:cap:media-ids',
} as const;

export async function getPrivate<T>(key: string, fallback: T): Promise<T> {
  await migrateStorage();
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
  return resolveServerUrl(null, BUILT_SERVER_URL);
}

/** The configured server (override, else the build's), or the signed-in server's when they differ. */
export async function serverUrl(): Promise<string> {
  const override = await getStore('serverUrl');
  return override ? resolveServerUrl(override) : accountServerUrl();
}

/** Signed-in state, or null. The token is never logged. */
export async function getAuth(): Promise<AuthState | null> {
  return (await getStore('auth')) ?? null;
}
