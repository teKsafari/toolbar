// Design tokens for open-toolbar (D-018, D-019; teksafari.org language D-174, D-175). Source of
// truth; src/tokens.css is generated from this file with `pnpm --filter @toolbar/ui gen:tokens`,
// and a unit test fails if they drift.
//
// Light follows teksafari.org: a #fafafa canvas, white surfaces with 1 px cool-grey edges (the
// Tailwind gray scale), black as the one action colour. Dark is the site's isometric kit: hue-free
// near-blacks that get lighter as they rise, with the accent inverted to near-white. Status
// colours are AA-safe Tailwind steps and never follow the accent. The capture "marker" amber
// stays for capture areas and highlights. See docs/design/teksafari-language.md.

import { BASE_ACCENT, accentTokens, deriveAccent } from './accent.ts';

export const palette = {
  /** Tailwind gray: the light theme's neutrals (cool, a little blue). */
  gray: {
    0: '#ffffff',
    25: '#fafafa',
    50: '#f9fafb',
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
    900: '#111827',
  },
  /** Hue-free near-blacks of the isometric kit: the dark theme and the always-dark chrome. */
  neutral: {
    950: '#0b0b0b',
    900: '#131313',
    875: '#171717',
    850: '#1b1b1b',
    800: '#262626',
    750: '#2e2e2e',
    700: '#3e3e3e',
    600: '#6e6e6e',
    500: '#8a8a8f',
    400: '#a3a3a3',
    300: '#c2c2c2',
    200: '#e6e6e6',
    100: '#fafafa',
  },
  marker: { 300: '#ffd866', 400: '#ffc933', 500: '#f2b100', 600: '#c98f00' },
  red: { 300: '#fca5a5', 400: '#f87171', 600: '#dc2626', 700: '#b91c1c' },
  green: { 400: '#4ade80', 700: '#15803d' },
  amber: { 400: '#fbbf24', 700: '#b45309' },
  blue: { 400: '#60a5fa', 700: '#1d4ed8' },
} as const;

/** Annotation swatches (six, like the observed density of J-049's palette card; our own hues). */
export const annotationColors = ['#e0402f', '#f2b100', '#239a64', '#1d93d0', '#3446cf', '#1a1918'] as const;

export type ThemeName = 'light' | 'dark';

const g = palette.gray;
const n = palette.neutral;
const baseAccent = deriveAccent(BASE_ACCENT);
const tint = (hex: string, a: number) => {
  const v = parseInt(hex.slice(1), 16);
  return `rgb(${(v >> 16) & 255} ${(v >> 8) & 255} ${v & 255} / ${a})`;
};

/** Semantic color tokens. Components use only these. */
export const themes: Record<ThemeName, Record<string, string>> = {
  light: {
    bg: g[25],
    surface: g[0],
    'surface-2': g[50],
    'surface-sunken': g[100],
    'surface-raised': g[0],
    border: g[200],
    'border-strong': g[300],
    text: g[900],
    /** long-form paragraphs */
    'text-body': g[700],
    /** secondary text; AA on every surface, sunken and hover included */
    'text-muted': g[600],
    /** metadata, placeholders, timestamps; AA on surface and canvas, not on sunken fills */
    'text-faint': g[500],
    ...accentTokens(baseAccent.light, baseAccent.dark),
    'focus-ring': '0 0 0 3px color-mix(in srgb, var(--nb-focus) 25%, transparent)',
    'capture-tint': 'rgb(242 177 0 / 0.28)',
    danger: palette.red[600],
    'danger-hover': palette.red[700],
    'on-danger': '#ffffff',
    'danger-tint': tint(palette.red[600], 0.1),
    warning: palette.amber[700],
    'warning-tint': tint(palette.amber[700], 0.12),
    success: palette.green[700],
    'success-tint': tint(palette.green[700], 0.1),
    info: palette.blue[700],
    'info-tint': tint(palette.blue[700], 0.1),
    /** Dark chrome (recording bar, toolbar, tooltips) stays dark in both themes. */
    chrome: n[900],
    'chrome-2': n[800],
    'chrome-border': n[750],
    'on-chrome': n[100],
    'on-chrome-muted': n[400],
    overlay: 'rgb(17 24 39 / 0.4)',
    /** secondary and ghost buttons: hairline lift plus an inset top highlight */
    'shadow-sm': '0 1px 2px rgb(23 23 23 / 0.06), inset 0 1px 0 rgb(255 255 255 / 0.8)',
    /** primary and danger buttons */
    'shadow-primary': '0 1px 2px rgb(0 0 0 / 0.2), inset 0 1px 0 rgb(255 255 255 / 0.16)',
    /** small floating layers on the app's own pages (tooltips, the knob of a switch) */
    'shadow-md': '0 4px 12px rgb(23 23 23 / 0.08), 0 1px 2px rgb(23 23 23 / 0.06)',
    /** floating layers: popovers, menus, toasts, the in-page toolbar */
    'shadow-lg': '0 18px 40px rgb(23 23 23 / 0.12), 0 1px 3px rgb(23 23 23 / 0.06)',
  },
  dark: {
    bg: n[950],
    surface: n[900],
    'surface-2': n[875],
    /** the hover wash and sunken fills; in dark it is lighter than the surface, as surfaces rise */
    'surface-sunken': n[850],
    'surface-raised': n[850],
    border: n[800],
    'border-strong': n[700],
    text: n[200],
    'text-body': n[300],
    'text-muted': n[400],
    'text-faint': n[500],
    ...accentTokens(baseAccent.dark, baseAccent.dark),
    'focus-ring': '0 0 0 3px color-mix(in srgb, var(--nb-focus) 40%, transparent)',
    'capture-tint': 'rgb(255 201 51 / 0.24)',
    danger: palette.red[400],
    'danger-hover': palette.red[300],
    'on-danger': n[950],
    'danger-tint': tint(palette.red[400], 0.14),
    warning: palette.amber[400],
    'warning-tint': tint(palette.amber[400], 0.14),
    success: palette.green[400],
    'success-tint': tint(palette.green[400], 0.14),
    info: palette.blue[400],
    'info-tint': tint(palette.blue[400], 0.14),
    chrome: n[850],
    'chrome-2': n[800],
    'chrome-border': n[750],
    'on-chrome': n[100],
    'on-chrome-muted': n[400],
    overlay: 'rgb(0 0 0 / 0.6)',
    'shadow-sm': '0 1px 2px rgb(0 0 0 / 0.4), inset 0 1px 0 rgb(255 255 255 / 0.04)',
    'shadow-primary': '0 1px 2px rgb(0 0 0 / 0.4), inset 0 1px 0 rgb(255 255 255 / 0.5)',
    'shadow-md': '0 0 0 1px rgb(0 0 0 / 0.15), 0 2px 4px -1px rgb(0 0 0 / 0.3), 0 6px 12px -4px rgb(0 0 0 / 0.3)',
    /** the isometric kit's layered lift: borders do the separating in dark, shadows only lift */
    'shadow-lg':
      'inset 0 1px 0 rgb(255 255 255 / 0.04), 0 0 0 1px rgb(0 0 0 / 0.15), 0 1px 1px -0.5px rgb(0 0 0 / 0.08), 0 3px 3px -1.5px rgb(0 0 0 / 0.08), 0 6px 6px -3px rgb(0 0 0 / 0.08), 0 12px 12px -6px rgb(0 0 0 / 0.08), 0 24px 40px -12px rgb(0 0 0 / 0.5)',
  },
};

const fallbackSans = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif";

/**
 * Three faces, three roles (fonts.css self-hosts them; nothing loads from Google). The tb-*
 * family names keep the bundled files apart from a host page's own Inter or Nunito.
 */
export const font = {
  /** Inter: everything you read or click */
  sans: `'tb-inter', 'Inter Variable', Inter, ${fallbackSans}`,
  /** Nunito: page titles, empty-state headings, big numbers; never below 16 px */
  display: `'tb-nunito', 'Nunito Variable', Nunito, ${fallbackSans}`,
  /** Geist Mono: code, IDs, timings, uppercase eyebrows and column headers */
  mono: "'tb-geist-mono', 'Geist Mono', ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

/** Sizes in px. Tool density (language section 10): 13 to 14 body, 12 mono panels, 20 to 30 titles. */
export const scale = {
  'text-xs': '11px',
  'text-sm': '12px',
  'text-md': '13px',
  'text-base': '14px',
  'text-lg': '16px',
  'text-xl': '18px',
  'text-2xl': '20px',
  'text-3xl': '24px',
  'text-4xl': '30px',
  'leading-tight': '1.25',
  'leading-normal': '1.5',
  'leading-relaxed': '1.625',
  'weight-normal': '400',
  'weight-medium': '500',
  'weight-semibold': '600',
  /** Nunito titles */
  'tracking-tight': '-0.025em',
  /** buttons */
  'tracking-ui': '-0.01em',
  /** mono uppercase eyebrows and column headers */
  'tracking-label': '0.08em',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-8': '32px',
  'space-10': '40px',
  'space-12': '48px',
  'radius-sm': '6px',
  'radius-md': '8px',
  'radius-lg': '12px',
  'radius-xl': '16px',
  'radius-pill': '999px',
  'control-sm': '28px',
  'control-md': '32px',
  'control-lg': '36px',
  /** touch targets and the popup's main actions */
  'control-touch': '40px',
  'row-dense': '22px',
  row: '32px',
  'icon-stroke': '2',
  /** Tailwind's default curve, the site's for every transition */
  'ease-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** hover, press, colour */
  'dur-fast': '150ms',
  /** menus, popovers, accordions */
  'dur-med': '200ms',
  'dur-slow': '300ms',
  'z-overlay': '2147483000',
} as const;

/** CSS custom property name for a token: --nb-<name>. */
export const cssVar = (name: string) => `--nb-${name}`;

function block(sel: string, vars: Record<string, string>) {
  return `${sel} {\n${Object.entries(vars)
    .map(([k, v]) => `  ${cssVar(k)}: ${v};`)
    .join('\n')}\n}`;
}

/**
 * The stylesheet. `:root` for pages, `:host` for shadow roots. Light by default; dark when
 * the OS prefers it, unless `data-theme` pins a theme on an ancestor or the host.
 */
export function tokensCss(): string {
  const base = { ...scale, 'font-sans': font.sans, 'font-display': font.display, 'font-mono': font.mono };
  return [
    '/* Generated from tokens.ts by `pnpm --filter @toolbar/ui gen:tokens`. Do not edit. */',
    block(':root, :host', { ...base, ...themes.light }),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"]), :host(:not([data-theme="light"]))', themes.dark).replace(/^/gm, '  ')}\n}`,
    block('[data-theme="dark"], :host([data-theme="dark"])', themes.dark),
    block('[data-theme="light"], :host([data-theme="light"])', themes.light),
    '',
  ].join('\n\n');
}

export { contrast, hexToRgb } from './contrast.ts';
