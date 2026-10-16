// The signed-in server's brand in the browser (D-112). After sign-in and on each bootstrap
// refresh the worker fetches the server's icons once per brand version, keeps them in
// storage (tb:branding) and sets the toolbar icon and title. Sign-out restores the build's own
// icon and name. setIcon is not kept across browser restarts, so the worker applies it again at
// start. Extension pages read the same storage (lib/brand.svelte.ts).
import { browser } from 'wxt/browser';
import type { Branding } from '@toolbar/shared/api';
import { STORAGE, type AuthState, type BrandCache, type StorageValues } from '@toolbar/shared/ext';
import { BUILD_NAME } from '../flags';

const PACKAGED = { 16: '/icon/16.png', 32: '/icon/32.png', 48: '/icon/48.png', 128: '/icon/128.png' };
const SIZES = ['16', '32', '48', '128'] as const;
const MAX_LOGO_BYTES = 512 * 1024;

/** While the recording icon shows, brand changes wait for it to end (ui.ts calls setIconBusy). */
let busy = false;
export const brandState = { applied: 'packaged' as 'packaged' | 'branded', title: BUILD_NAME };

async function read(): Promise<BrandCache | null> {
  const { key } = STORAGE.branding;
  return ((await browser.storage.local.get(key))[key] as BrandCache | undefined) ?? null;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function dataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (type !== 'image/png' && type !== 'image/svg+xml') return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_LOGO_BYTES) return null;
    return `data:${type};base64,${toBase64(buf)}`;
  } catch {
    return null;
  }
}

async function imageData(src: string, n: number): Promise<ImageData> {
  const blob = await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(n, n);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0, n, n);
  return g.getImageData(0, 0, n, n);
}

/** Set the toolbar icon and title from the stored brand, or the packaged ones without it. */
export async function applyBrandIcon(): Promise<void> {
  if (busy) return;
  const b = await read();
  const signedIn = !!((await browser.storage.local.get(STORAGE.auth.key))[STORAGE.auth.key] as AuthState | undefined)?.token;
  try {
    if (b && signedIn && b.icons['16'] && b.icons['32']) {
      await browser.action.setIcon({ imageData: { 16: await imageData(b.icons['16'], 16), 32: await imageData(b.icons['32'], 32) } as never });
      await browser.action.setTitle({ title: b.name });
      brandState.applied = 'branded';
      brandState.title = b.name;
      return;
    }
  } catch (e) {
    console.debug('[toolbar] brand icon', e);
  }
  await browser.action.setIcon({ path: PACKAGED });
  await browser.action.setTitle({ title: browser.runtime.getManifest().name });
  brandState.applied = 'packaged';
  brandState.title = browser.runtime.getManifest().name;
}

export function setIconBusy(v: boolean) {
  busy = v;
}

/** Store the server's brand when its version changed, then apply it. */
export async function syncBrand(branding: Branding | undefined, serverUrl: string): Promise<void> {
  if (!branding) return;
  const cur = await read();
  if (cur && cur.version === branding.version && cur.serverUrl === serverUrl) return void (await applyBrandIcon());
  const icons: BrandCache['icons'] = {};
  for (const n of SIZES) {
    const u = branding.logo.icons[n];
    const d = u ? await dataUrl(u) : null;
    if (d) icons[n] = d;
  }
  const next: BrandCache = {
    version: branding.version,
    serverUrl,
    name: branding.name,
    accent: branding.accent,
    onAccent: branding.onAccent,
    defaultLogo: branding.defaultLogo,
    logo: branding.defaultLogo ? null : await dataUrl(branding.logo.light),
    icons,
  };
  await browser.storage.local.set({ [STORAGE.branding.key]: next });
  await applyBrandIcon();
}

export async function clearBrand(): Promise<void> {
  await browser.storage.local.remove(STORAGE.branding.key);
  await applyBrandIcon();
}

/** Worker wiring: apply at start, follow bootstrap refreshes and sign-out. */
export function registerBrand() {
  void applyBrandIcon();
  browser.runtime.onStartup.addListener(() => void applyBrandIcon());
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const auth = changes[STORAGE.auth.key];
    if (auth && !(auth.newValue as AuthState | undefined)?.token) {
      void clearBrand();
      return;
    }
    const boot = changes[STORAGE.bootstrap.key];
    const data = (boot?.newValue as StorageValues['bootstrap'] | undefined)?.data;
    if (data?.branding) {
      void browser.storage.local.get(STORAGE.auth.key).then((got) => {
        const a = got[STORAGE.auth.key] as AuthState | undefined;
        if (a?.token) void syncBrand(data.branding, a.serverUrl);
      });
    }
  });
}
