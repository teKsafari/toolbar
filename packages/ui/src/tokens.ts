// Design tokens for open-toolbar (D-018, D-019). Source of truth; src/tokens.css is generated from
// this file with `pnpm --filter @toolbar/ui gen:tokens`, and a unit test fails if they drift.
//
// The palette is our own: "ink" (a cobalt blue-violet) for the accent on warm "paper"
// neutrals, with "marker" amber for capture areas and highlights. Red is kept for errors,
// stop and destructive actions.

export const palette = {
  ink: {
    50: '#eef0fd',
    100: '#dde2fb',
    200: '#bcc5f7',
    300: '#94a1f1',
    400: '#6d7deb',
    500: '#4b5ce3',
    600: '#3446cf',
    700: '#2938ab',
    800: '#232f86',
    900: '#1f2968',
  },
  paper: {
    0: '#ffffff',
    25: '#fcfbf8',
    50: '#f7f6f2',
    100: '#efede7',
    200: '#e3e0d8',
    300: '#cfcbc0',
    400: '#a9a499',
    500: '#7d786e',
    600: '#5f5b53',
    700: '#45423c',
    800: '#2c2a27',
    850: '#232220',
    900: '#1a1918',
    950: '#121211',
  },
  marker: { 300: '#ffd866', 400: '#ffc933', 500: '#f2b100', 600: '#c98f00' },
  red: { 400: '#f0675a', 500: '#e0402f', 600: '#c22e1f', 700: '#9c2418' },
  green: { 400: '#4cc28a', 500: '#239a64', 600: '#1b7d51' },
  amber: { 400: '#f5a524', 500: '#d88a0b', 600: '#b06d00' },
  sky: { 400: '#4fb3e8', 500: '#1d93d0', 600: '#1676a8' },
} as const;

/** Annotation swatches (six, like the observed density of J-049's palette card; our own hues). */
export const annotationColors = ['#e0402f', '#f2b100', '#239a64', '#1d93d0', '#3446cf', '#1a1918'] as const;

export type ThemeName = 'light' | 'dark';

/** Semantic color tokens. Components use only these. */
export const themes: Record<ThemeName, Record<string, string>> = {
  light: {
    bg: palette.paper[50],
    surface: palette.paper[0],
    'surface-2': palette.paper[25],
    'surface-sunken': palette.paper[100],
    border: palette.paper[200],
    'border-strong': palette.paper[300],
    text: palette.paper[900],
    'text-muted': palette.paper[600],
    'text-faint': palette.paper[500],
    accent: palette.ink[600],
    'accent-hover': palette.ink[700],
    'accent-text': palette.ink[700],
    'on-accent': '#ffffff',
    'accent-tint': 'rgb(52 70 207 / 0.12)',
    'capture-tint': 'rgb(242 177 0 / 0.28)',
    focus: palette.ink[500],
    danger: palette.red[600],
    'danger-hover': palette.red[700],
    'on-danger': '#ffffff',
    'danger-tint': 'rgb(224 64 47 / 0.10)',
    warning: palette.amber[600],
    'warning-tint': 'rgb(245 165 36 / 0.14)',
    success: palette.green[600],
    'success-tint': 'rgb(35 154 100 / 0.12)',
    info: palette.sky[600],
    'info-tint': 'rgb(29 147 208 / 0.10)',
    /** Dark chrome (recording bar, menus, tooltips) stays dark in both themes. */
    chrome: palette.paper[900],
    'chrome-2': palette.paper[800],
    'on-chrome': palette.paper[50],
    'on-chrome-muted': palette.paper[400],
    overlay: 'rgb(18 18 17 / 0.5)',
  },
  dark: {
    bg: palette.paper[950],
    surface: palette.paper[900],
    'surface-2': palette.paper[850],
    'surface-sunken': '#0d0d0c',
    border: palette.paper[800],
    'border-strong': palette.paper[700],
    text: palette.paper[50],
    'text-muted': palette.paper[400],
    'text-faint': palette.paper[500],
    accent: palette.ink[400],
    'accent-hover': palette.ink[300],
    'accent-text': palette.ink[300],
    'on-accent': palette.paper[950],
    'accent-tint': 'rgb(109 125 235 / 0.18)',
    'capture-tint': 'rgb(255 201 51 / 0.24)',
    focus: palette.ink[300],
    danger: palette.red[400],
    'danger-hover': '#f58a7f',
    'on-danger': palette.paper[950],
    'danger-tint': 'rgb(240 103 90 / 0.14)',
    warning: palette.amber[400],
    'warning-tint': 'rgb(245 165 36 / 0.14)',
    success: palette.green[400],
    'success-tint': 'rgb(76 194 138 / 0.14)',
    info: palette.sky[400],
    'info-tint': 'rgb(79 179 232 / 0.14)',
    chrome: palette.paper[850],
    'chrome-2': palette.paper[800],
    'on-chrome': palette.paper[50],
    'on-chrome-muted': palette.paper[400],
    overlay: 'rgb(0 0 0 / 0.6)',
  },
};

export const font = {
  sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

/** Sizes in px. App UI 13 to 14, dev tools panels 12 mono, titles 18 to 20 (ergonomics.md). */
export const scale = {
  'text-xs': '11px',
  'text-sm': '12px',
  'text-md': '13px',
  'text-base': '14px',
  'text-lg': '16px',
  'text-xl': '18px',
  'text-2xl': '20px',
  'text-3xl': '24px',
  'leading-tight': '1.25',
  'leading-normal': '1.5',
  'weight-normal': '400',
  'weight-medium': '500',
  'weight-semibold': '600',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-8': '32px',
  'radius-sm': '6px',
  'radius-md': '8px',
  'radius-lg': '12px',
  'radius-xl': '16px',
  'radius-pill': '999px',
  'control-sm': '28px',
  'control-md': '34px',
  'control-lg': '40px',
  'row-dense': '22px',
  'shadow-sm': '0 1px 2px rgb(0 0 0 / 0.06)',
  'shadow-md': '0 4px 14px rgb(0 0 0 / 0.10), 0 1px 3px rgb(0 0 0 / 0.08)',
  'shadow-lg': '0 16px 40px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.10)',
  'ease-out': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  'dur-fast': '120ms',
  'dur-med': '220ms',
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
  const base = { ...scale, 'font-sans': font.sans, 'font-mono': font.mono };
  return [
    '/* Generated from tokens.ts by `pnpm --filter @toolbar/ui gen:tokens`. Do not edit. */',
    block(':root, :host', { ...base, ...themes.light }),
    `@media (prefers-color-scheme: dark) {\n${block(':root:not([data-theme="light"]), :host(:not([data-theme="light"]))', themes.dark).replace(/^/gm, '  ')}\n}`,
    block('[data-theme="dark"], :host([data-theme="dark"])', themes.dark),
    block('[data-theme="light"], :host([data-theme="light"])', themes.light),
    '',
  ].join('\n\n');
}

// ---------- contrast helpers (used by tests and by the color picker later) ----------

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lum([r, g, b]: [number, number, number]) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2.x contrast ratio between two hex colors. */
export function contrast(a: string, b: string): number {
  const [x, y] = [lum(hexToRgb(a)), lum(hexToRgb(b))].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
