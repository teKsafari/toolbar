// Instance brand resolution (D-112), pure: env value (locked) > stored value > default, per field.
// No I/O here, so the precedence rules are unit tested on their own.
import { createHash } from 'node:crypto';
import { PRODUCT_NAME } from '@toolbar/shared';
import { DEFAULT_ACCENT, BRAND_NAME_RE, type BrandingStored, type BrandLocks, type LogoRef } from '@toolbar/shared/api';

export const DEFAULT_NAME = PRODUCT_NAME;
const INK = '#121211';
const WHITE = '#ffffff';

export interface Brand {
  name: string;
  /** light-theme accent and the colour of the default logo */
  accent: string;
  onAccent: string;
  /** dark-theme pair, derived from the accent */
  accentDark: string;
  onAccentDark: string;
  logo: { light: LogoRef | null; dark: LogoRef | null };
  /** short hash of everything above; the `?v=` of brand URLs */
  version: string;
  locked: BrandLocks;
  /** env inputs that failed validation, for a start-up warning */
  warnings: string[];
}

export interface BrandInputs {
  env: { name?: string; accent?: string };
  /** logos the server fetched from APP_LOGO_URL / APP_LOGO_DARK_URL (null when unset or failed) */
  envLogo: { light: LogoRef | null; dark: LogoRef | null; lightSet: boolean; darkSet: boolean };
  stored: BrandingStored | null;
}

// ---------------------------------------------------------------- colour

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG contrast ratio of two hex colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Mix in sRGB: weight 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, weight: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * weight));
}

/** White or ink text on the accent, whichever reads better; null when neither reaches 4.5:1. */
export function onAccentOf(accent: string): string | null {
  const w = contrast(accent, WHITE);
  const k = contrast(accent, INK);
  const best = w >= k ? WHITE : INK;
  return Math.max(w, k) >= 4.5 ? best : null;
}

export function isHexColour(s: string | undefined | null): s is string {
  return !!s && /^#[0-9a-fA-F]{6}$/.test(s.trim());
}

/** Accent usable as a button fill with readable text on it. */
export function validAccent(s: string | undefined | null): string | null {
  if (!isHexColour(s)) return null;
  const a = s.trim().toLowerCase();
  return onAccentOf(a) ? a : null;
}

/** The dark theme lightens the accent toward white, as the palette's own ink 400 does. */
export function darkPair(accent: string): { accentDark: string; onAccentDark: string } {
  if (accent === DEFAULT_ACCENT) return { accentDark: '#6d7deb', onAccentDark: INK };
  const accentDark = mix(accent, WHITE, 0.3);
  return { accentDark, onAccentDark: onAccentOf(accentDark) ?? INK };
}

// ---------------------------------------------------------------- name

export function cleanName(s: string | undefined | null): string | null {
  const v = (s ?? '').trim().replace(/\s+/g, ' ');
  return BRAND_NAME_RE.test(v) ? v : null;
}

// ---------------------------------------------------------------- resolve

export function resolveBrand({ env, envLogo, stored }: BrandInputs): Brand {
  const warnings: string[] = [];
  const envName = env.name ? cleanName(env.name) : null;
  if (env.name && !envName) warnings.push('APP_NAME is not 1 to 40 letters, digits, spaces or . , \' & ( ) + _ -; using the default');
  const envAccent = env.accent ? validAccent(env.accent) : null;
  if (env.accent && !envAccent) warnings.push('APP_ACCENT is not a #rrggbb colour with readable text on it; using the default');

  const name = envName ?? cleanName(stored?.name) ?? DEFAULT_NAME;
  const accent = envAccent ?? validAccent(stored?.accent) ?? DEFAULT_ACCENT;
  const light = envLogo.lightSet ? envLogo.light : (stored?.logo?.light ?? null);
  const dark = envLogo.darkSet ? envLogo.dark : (stored?.logo?.dark ?? null);
  const locked: BrandLocks = { name: !!envName, accent: !!envAccent, logo: envLogo.lightSet, logoDark: envLogo.darkSet };
  const version = createHash('sha256')
    .update(JSON.stringify([name, accent, light?.hash ?? null, dark?.hash ?? null]))
    .digest('hex')
    .slice(0, 10);
  return { name, accent, onAccent: onAccentOf(accent) ?? WHITE, ...darkPair(accent), logo: { light, dark }, version, locked, warnings };
}

/** The built-in logo: a filled rectangle in the accent colour (D-083). */
export function defaultLogoSvg(fill: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><rect x="2" y="7" width="20" height="10" fill="${fill}"/></svg>`;
}
