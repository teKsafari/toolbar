// The `%brand.head%` part of app.html (D-112): favicons, the site name and, for a custom accent,
// the accent tokens. Written into the server HTML, so the first paint already has the brand.
import { DEFAULT_ACCENT } from '@toolbar/shared/api';
import { accentCss } from '@toolbar/ui/accent';
import type { Brand } from './resolve.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// The accent tokens of both themes from the shared derivation (D-175): hover, pressed, link
// text, focus and the dark chrome's accent, each contrast-checked. Nothing for the default,
// which tokens.css already carries.
function accentStyle(b: Brand): string {
  if (b.accent === DEFAULT_ACCENT) return '';
  return `<style id="tb-brand">${accentCss(b.accent)}</style>`;
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
  ]
    .filter(Boolean)
    .join('\n    ');
}
