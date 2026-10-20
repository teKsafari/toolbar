// Accent derivation (D-175). One function turns an accent colour into the accent tokens of both
// themes, with contrast checks, so the default tokens, the server's brand style (APP_ACCENT or
// Settings > Server) and the extension's brand all come from the same rules.
//
// teksafari.org's accent is black: the default is #000000 in light and an inverted near-white
// in dark. An admin accent replaces only the accent tokens; canvas, surfaces, borders, text and
// the status colours stay neutral (docs/design/teksafari-language.md, section 12).

import { contrast, hexToRgb } from './contrast.ts';

/** Default accent (light theme). Kept equal to DEFAULT_ACCENT in @toolbar/shared/api. */
export const BASE_ACCENT = '#000000';

const WHITE = '#ffffff';
const BLACK = '#000000';
/** Text colour on light accents; the dark canvas. */
export const ACCENT_INK = '#0b0b0b';

/** The darkest light surface (surface-sunken) and the lightest dark one (surface-raised). */
const LIGHT_FLOOR = '#f3f4f6';
const DARK_CEILING = '#1b1b1b';

export interface AccentSet {
  accent: string;
  hover: string;
  active: string;
  /** links and accent text; >= 4.5:1 on every surface of its theme */
  text: string;
  /** text on an accent fill; >= 4.5:1 */
  on: string;
  tint: string;
  /** focus ring colour; equals `text`, so it clears 3:1 on every surface */
  focus: string;
}

const toHex = (c: number[]) => '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');

/** Mix in sRGB: weight 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, weight: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return toHex(x.map((v, i) => v + (y[i]! - v) * weight));
}

/** White or ink text on the accent, whichever reads better; null when neither reaches 4.5:1. */
export function onAccentOf(accent: string): string | null {
  const w = contrast(accent, WHITE);
  const k = contrast(accent, ACCENT_INK);
  return Math.max(w, k) >= 4.5 ? (w >= k ? WHITE : ACCENT_INK) : null;
}

const rgba = (hex: string, a: number) => {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${r} ${g} ${b} / ${a})`;
};

/** Move `c` toward `to` in 5 % steps until it reaches `min`:1 against `bg` (or `to` itself). */
function until(c: string, to: string, bg: string, min: number): string {
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const m = mix(c, to, Math.min(1, w));
    if (contrast(m, bg) >= min) return m;
  }
  return to;
}

/**
 * Hover and pressed shades. They move away from the text colour (more contrast), unless the
 * accent already sits at that end: black cannot get darker, so it lightens, as the site's
 * primary does (#000, #1a1a1a, #333).
 */
function shades(base: string, on: string): [string, string] {
  const away = on === WHITE ? BLACK : WHITE;
  const roomy = contrast(base, away) > 1.25;
  const to = roomy ? away : on === WHITE ? WHITE : BLACK;
  const [h, a] = to === WHITE ? [0.1, 0.2] : [0.08, 0.15];
  const ok = (c: string) => (contrast(c, on) >= 4.5 ? c : base);
  return [ok(mix(base, to, h)), ok(mix(base, to, a))];
}

/** A grey accent (black, charcoal, slate) inverts for dark pages instead of lightening to a grey. */
function isNeutral(hex: string): boolean {
  const c = hexToRgb(hex);
  return Math.max(...c) - Math.min(...c) <= 24;
}

function lightSet(accent: string): AccentSet {
  const on = onAccentOf(accent) ?? WHITE;
  const [hover, active] = shades(accent, on);
  const text = until(accent, BLACK, LIGHT_FLOOR, 4.5);
  return { accent, hover, active, text, on, tint: rgba(accent, 0.08), focus: text };
}

function darkSet(accent: string): AccentSet {
  let base: string;
  if (isNeutral(accent)) {
    // black -> #fafafa, charcoal -> a light grey; the channel average flips across the range
    const avg = hexToRgb(accent).reduce((s, v) => s + v, 0) / 3;
    const v = 250 - (avg * (250 - 11)) / 255;
    base = toHex([v, v, v]);
  } else base = mix(accent, WHITE, 0.3);
  base = until(base, WHITE, DARK_CEILING, 4.5);
  const on = onAccentOf(base) ?? ACCENT_INK;
  const [hover, active] = shades(base, on);
  return { accent: base, hover, active, text: base, on, tint: rgba(base, 0.12), focus: base };
}

/** Accent tokens for both themes. `accent` is a lower-case #rrggbb. */
export function deriveAccent(accent: string): { light: AccentSet; dark: AccentSet } {
  const a = accent.trim().toLowerCase();
  return { light: lightSet(a), dark: darkSet(a) };
}

/** Token names (without --nb-) an accent sets. The chrome (always dark) takes the dark set. */
export function accentTokens(set: AccentSet, chrome: AccentSet): Record<string, string> {
  return {
    accent: set.accent,
    'accent-hover': set.hover,
    'accent-active': set.active,
    'accent-text': set.text,
    'on-accent': set.on,
    'accent-tint': set.tint,
    focus: set.focus,
    'chrome-accent': chrome.accent,
    'chrome-accent-hover': chrome.hover,
    'on-chrome-accent': chrome.on,
  };
}

/** The accent tokens of one theme, as CSS custom properties. */
export function accentVars(accent: string, theme: 'light' | 'dark'): Record<string, string> {
  const d = deriveAccent(accent);
  return Object.fromEntries(Object.entries(accentTokens(d[theme], d.dark)).map(([k, v]) => [`--nb-${k}`, v]));
}

const decl = (vars: Record<string, string>) =>
  Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(';');

/**
 * A style sheet that applies an accent to a document, following the OS theme and a
 * `data-theme` pin on <html> the way tokens.css does. Its selectors are one step more specific
 * than tokens.css, so the order of the two style sheets does not matter.
 */
export function accentCss(accent: string): string {
  const light = decl(accentVars(accent, 'light'));
  const dark = decl(accentVars(accent, 'dark'));
  return `html:root,html[data-theme="light"]{${light}}@media (prefers-color-scheme: dark){html:root:not([data-theme="light"]){${dark}}}html[data-theme="dark"]{${dark}}`;
}

// ---------- applying an accent to a live element ----------

const ACCENT_KEYS = Object.keys(accentVars(BASE_ACCENT, 'light'));
const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
const following = new WeakMap<HTMLElement, () => void>();

/**
 * Accent variables for an element (or the page root), cleared when the default applies. The
 * values come from the shared derivation (D-175), for the OS theme, and follow it when it
 * changes: the black default would vanish on the dark theme if one value served both. The
 * derivation picks the text colour of each theme itself.
 */
export function applyAccent(el: HTMLElement, accent: string | null): void {
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
