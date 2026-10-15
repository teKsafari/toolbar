// The `%brand.head%` part of app.html (D-112): favicons, the site name and, for a custom accent,
// the accent tokens. Written into the server HTML, so the first paint already has the brand.
import { DEFAULT_ACCENT } from '@toolbar/shared/api';
import type { Brand } from './resolve.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Dashboard localStorage keys of builds before the rename (D-111) move once to "tb.". */
export const LEGACY_LOCAL_PREFIX = 'nib.';
// Moves "nib." keys to "tb." in this origin's localStorage; runs before the app reads them.
const MIGRATE_LOCAL = `<script>try{var s=localStorage;for(var i=s.length;i--;){var k=s.key(i);if(k&&k.indexOf(${JSON.stringify(LEGACY_LOCAL_PREFIX)})===0){var n="tb."+k.slice(${LEGACY_LOCAL_PREFIX.length});if(s.getItem(n)===null)s.setItem(n,s.getItem(k));s.removeItem(k)}}}catch(e){}</script>`;

function accentStyle(b: Brand): string {
  if (b.accent === DEFAULT_ACCENT) return '';
  const tint = (hex: string, a: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
  };
  // darker hover and text in light mode; the dark theme uses the lightened pair
  const light = `--nb-accent:${b.accent};--nb-accent-hover:color-mix(in oklch,${b.accent} 82%,black);--nb-accent-text:color-mix(in oklch,${b.accent} 82%,black);--nb-on-accent:${b.onAccent};--nb-accent-tint:${tint(b.accent, 0.12)}`;
  const dark = `--nb-accent:${b.accentDark};--nb-accent-hover:color-mix(in oklch,${b.accentDark} 75%,white);--nb-accent-text:color-mix(in oklch,${b.accentDark} 75%,white);--nb-on-accent:${b.onAccentDark};--nb-accent-tint:${tint(b.accentDark, 0.18)}`;
  // one step more specific than tokens.css, so the order of the style sheets does not matter
  return `<style id="tb-brand">html:root,html[data-theme="light"]{${light}}@media (prefers-color-scheme: dark){html:root:not([data-theme="light"]){${dark}}}html[data-theme="dark"]{${dark}}</style>`;
}

export function brandHead(b: Brand): string {
  const v = `?v=${b.version}`;
  const svgIcon = !b.logo.light || b.logo.light.type === 'image/svg+xml';
  return [
    svgIcon ? `<link rel="icon" href="/brand/logo.svg${v}" type="image/svg+xml">` : '',
    `<link rel="icon" href="/brand/icon-32.png${v}" sizes="32x32" type="image/png">`,
    `<link rel="apple-touch-icon" href="/brand/icon-180.png${v}">`,
    `<meta name="application-name" content="${esc(b.name)}">`,
    `<meta property="og:site_name" content="${esc(b.name)}">`,
    `<meta name="theme-color" content="${b.accent}">`,
    accentStyle(b),
    MIGRATE_LOCAL,
  ]
    .filter(Boolean)
    .join('\n    ');
}
