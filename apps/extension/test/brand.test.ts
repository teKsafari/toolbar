// The server's brand on the toolbar icon (D-112): sync after sign-in, re-apply, restore at sign-out.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { browser } from 'wxt/browser';
import type { Branding } from '@toolbar/shared/api';
import { applyBrandIcon, brandState, clearBrand, setIconBusy, syncBrand } from '../lib/bg/brand';

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const server = 'https://review.acme.test';
const branding = (version: string): Branding => ({
  name: 'Acme Review',
  accent: '#0b7a5c',
  onAccent: '#ffffff',
  version,
  defaultLogo: false,
  logo: {
    light: `${server}/brand/logo.png?v=${version}`,
    dark: null,
    icons: Object.fromEntries(['16', '32', '48', '128', '180', '512'].map((n) => [n, `${server}/brand/icon-${n}.png?v=${version}`])),
    email: `${server}/brand/email.png?v=${version}`,
  },
});

const setIcon = vi.fn(async (_d: unknown) => {});
const setTitle = vi.fn(async (_d: unknown) => {});
const realFetch = globalThis.fetch;
let fetched: string[] = [];

beforeEach(async () => {
  fakeBrowser.reset();
  setIcon.mockClear();
  setTitle.mockClear();
  fetched = [];
  Object.assign(browser, { action: { setIcon, setTitle } });
  browser.runtime.getManifest = (() => ({ name: 'open-toolbar', version: '0.0.1', manifest_version: 3 })) as never;
  globalThis.fetch = vi.fn(async (u: string | URL | Request) => {
    const url = String(u);
    if (url.startsWith('data:')) return realFetch(url);
    fetched.push(url);
    return new Response(PNG, { headers: { 'content-type': 'image/png' } });
  }) as never;
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({})));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { drawImage: () => {}, getImageData: (_x: number, _y: number, w: number) => ({ width: w, branded: true }) };
      }
    },
  );
  setIconBusy(false);
  await browser.storage.local.set({ 'tb:auth': { serverUrl: server, token: 't', tokenId: 'i', user: { id: null, name: 'A', email: null, image: null }, activeWorkspaceId: null, signedInAt: 1 } });
});

describe('extension branding', () => {
  it('fetches the icons once per version and sets the icon and title', async () => {
    await syncBrand(branding('v1'), server);
    expect(fetched.filter((u) => u.includes('/icon-')).sort()).toEqual(['16', '128', '32', '48'].map((n) => `${server}/brand/icon-${n}.png?v=v1`).sort());
    const last = setIcon.mock.calls.at(-1)![0] as { imageData: Record<number, { width: number }> };
    expect(last.imageData[16]!.width).toBe(16);
    expect(last.imageData[32]!.width).toBe(32);
    expect(setTitle).toHaveBeenLastCalledWith({ title: 'Acme Review' });
    expect(brandState).toMatchObject({ applied: 'branded', title: 'Acme Review' });
    const stored = (await browser.storage.local.get('tb:branding'))['tb:branding'] as { logo: string; icons: Record<string, string> };
    expect(stored.logo).toMatch(/^data:image\/png;base64,/);
    fetched = [];
    await syncBrand(branding('v1'), server);
    expect(fetched).toEqual([]);
  });

  it('waits while the recording icon shows, then restores the brand, not the packaged icon', async () => {
    await syncBrand(branding('v2'), server);
    setIcon.mockClear();
    setIconBusy(true);
    await applyBrandIcon();
    expect(setIcon).not.toHaveBeenCalled();
    setIconBusy(false);
    await applyBrandIcon();
    expect(setTitle).toHaveBeenLastCalledWith({ title: 'Acme Review' });
  });

  it('sign-out restores the packaged icon and the build name', async () => {
    await syncBrand(branding('v3'), server);
    await clearBrand();
    expect(setIcon).toHaveBeenLastCalledWith({ path: { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 128: '/icon/128.png' } });
    expect(setTitle).toHaveBeenLastCalledWith({ title: 'open-toolbar' });
    expect(brandState.applied).toBe('packaged');
  });

  it('shows nothing of the server before sign-in', async () => {
    await syncBrand(branding('v4'), server);
    await browser.storage.local.remove('tb:auth');
    await applyBrandIcon();
    expect(setTitle).toHaveBeenLastCalledWith({ title: 'open-toolbar' });
  });
});
