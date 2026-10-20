// The brand extension pages and the in-page UI show (D-112): the signed-in server's name, logo
// and accent from tb:branding, else this build's own name and the rectangle. applyAccent paints it
// (@toolbar/ui/accent).
import { browser } from 'wxt/browser';
import { STORAGE, type AuthState, type BrandCache } from '@toolbar/shared/ext';
import { BUILD_NAME } from './flags';

export const brand = $state({
  name: BUILD_NAME,
  /** data URL of the server's logo; null shows the rectangle */
  logo: null as string | null,
  accent: null as string | null,
  onAccent: null as string | null,
  version: null as string | null,
});

function set(b: BrandCache | null, signedIn: boolean) {
  const on = !!b && signedIn;
  brand.name = on ? b!.name : BUILD_NAME;
  brand.logo = on && !b!.defaultLogo ? b!.logo : null;
  brand.accent = on ? b!.accent : null;
  brand.onAccent = on ? b!.onAccent : null;
  brand.version = on ? b!.version : null;
}

let started = false;

/** Read the stored brand once and follow its changes. Safe to call from every entry point. */
export function loadBrand(): void {
  if (started) return;
  started = true;
  const keys = [STORAGE.branding.key, STORAGE.auth.key];
  const refresh = () =>
    browser.storage.local
      .get(keys)
      .then((got) => set((got[STORAGE.branding.key] as BrandCache | undefined) ?? null, !!(got[STORAGE.auth.key] as AuthState | undefined)?.token))
      .catch(() => undefined);
  void refresh();
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && keys.some((k) => k in changes)) void refresh();
  });
}
