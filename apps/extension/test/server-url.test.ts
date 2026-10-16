// lib/server-url.ts: the one resolution of the server the extension talks to
// (options-page override, else the build's WXT_SERVER_URL, else DEFAULT_SERVER_URL).
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SERVER_URL } from '@toolbar/shared/constants';
import { STORAGE } from '@toolbar/shared/ext';
import { SERVER_URL_KEY, accountServerUrl, resolveServerUrl, serverUrl } from '../lib/server-url';

describe('resolveServerUrl', () => {
  it('takes the override over the build server', () => {
    expect(resolveServerUrl('https://override.example', 'https://built.example')).toBe('https://override.example');
  });

  it('takes the build server when there is no override', () => {
    expect(resolveServerUrl(null, 'https://toolbar.teksafari.com')).toBe('https://toolbar.teksafari.com');
    expect(resolveServerUrl(undefined, 'https://toolbar.teksafari.com/')).toBe('https://toolbar.teksafari.com');
    expect(resolveServerUrl('', 'https://toolbar.teksafari.com')).toBe('https://toolbar.teksafari.com');
  });

  it('falls back to the default only when neither is set', () => {
    expect(resolveServerUrl(null, undefined)).toBe(DEFAULT_SERVER_URL);
    expect(resolveServerUrl(null, '')).toBe(DEFAULT_SERVER_URL);
  });

  it('skips values that are not http(s) URLs', () => {
    expect(resolveServerUrl('not a url', 'https://built.example')).toBe('https://built.example');
    expect(resolveServerUrl('javascript:alert(1)', 'https://built.example')).toBe('https://built.example');
    expect(resolveServerUrl(42, 'nope')).toBe(DEFAULT_SERVER_URL);
  });

  it('trims trailing slashes and keeps a path prefix', () => {
    expect(resolveServerUrl('https://host.example/toolbar///', undefined)).toBe('https://host.example/toolbar');
  });

  it('uses the build-time WXT_SERVER_URL when no build value is passed', () => {
    const built = (import.meta.env as Record<string, string | undefined>).WXT_SERVER_URL;
    expect(resolveServerUrl(null)).toBe(built ? resolveServerUrl(null, built) : DEFAULT_SERVER_URL);
  });
});

describe('serverUrl and accountServerUrl', () => {
  beforeEach(() => fakeBrowser.reset());

  it('reads the override from storage', async () => {
    expect(SERVER_URL_KEY).toBe(STORAGE.serverUrl.key);
    await fakeBrowser.storage.local.set({ [SERVER_URL_KEY]: 'https://self.example/' });
    expect(await serverUrl()).toBe('https://self.example');
  });

  it('without an override is the build server, never localhost from a stale sign-in', async () => {
    await fakeBrowser.storage.local.set({ [STORAGE.auth.key]: { serverUrl: 'http://localhost:3000', token: 't' } });
    expect(await serverUrl()).toBe(resolveServerUrl(null));
  });

  it('accountServerUrl prefers the signed-in server, else the configured one', async () => {
    expect(await accountServerUrl(null)).toBe(resolveServerUrl(null));
    expect(await accountServerUrl({ serverUrl: 'https://acct.example/' })).toBe('https://acct.example');
    await fakeBrowser.storage.local.set({ [STORAGE.auth.key]: { serverUrl: 'https://stored.example', token: 't' } });
    expect(await accountServerUrl()).toBe('https://stored.example');
  });
});
