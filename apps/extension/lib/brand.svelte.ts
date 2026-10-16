// The brand extension pages and the in-page UI show (D-112): the signed-in server's name, logo
// and accent from tb:branding, else this build's own name and the rectangle.
import { browser } from 'wxt/browser';
import { STORAGE, type AuthState, type BrandCache } from '@toolbar/shared/ext';
import { BUILD_NAME } from './flags';
import { BASE_ACCENT, accentVars } from '@toolbar/ui/accent';

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

const ACCENT_KEYS = Object.keys(accentVars(BASE_ACCENT, 'light'));
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const following = new WeakMap<HTMLElement, () => void>();

/**
 * Accent variables for an element (or the page root), cleared when the default applies. The
 * values come from the shared derivation (D-175), for the OS theme, and follow it when it
 * changes: the black default would vanish on the dark theme if one value served both.
 * `onAccent` is kept for callers; the derivation picks the text colour of each theme itself.
 */
export function applyAccent(el: HTMLElement, accent: string | null, _onAccent?: string | null): void {
  following.get(el)?.();
  following.delete(el);
  const custom = accent && /^#[0-9a-fA-F]{6}$/.test(accent) && accent.toLowerCase() !== BASE_ACCENT ? accent.toLowerCase() : null;
  const paint = () => {
    const vars = custom ? accentVars(custom, darkQuery?.matches ? 'dark' : 'light') : null;
    for (const k of ACCENT_KEYS) {
      const v = vars?.[k];
      if (v) el.style.setProperty(k, v);
      else el.style.removeProperty(k);
    }
  };
  paint();
  if (custom && darkQuery) {
    darkQuery.addEventListener('change', paint);
    following.set(el, () => darkQuery.removeEventListener('change', paint));
  }
}
