import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, themes, tokensCss, iconNames, icons, iconSvg } from '../src/index.ts';
import { shadowTokensCss } from '../src/tokens.ts';
import { BASE_ACCENT, accentCss, accentVars, deriveAccent } from '../src/accent.ts';
import { DEFAULT_ACCENT } from '@toolbar/shared/api';

describe('tokens', () => {
  it('tokens.css matches tokens.ts (run gen:tokens after editing tokens.ts)', () => {
    expect(readFileSync(join(import.meta.dirname, '../src/tokens.css'), 'utf8')).toBe(tokensCss());
  });

  it('tokens.shadow.css matches tokens.ts, :host only and important', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/tokens.shadow.css'), 'utf8');
    expect(css).toBe(shadowTokensCss());
    expect(css).not.toMatch(/:root/);
    for (const line of css.split('\n').filter((l) => /^\s*--nb-/.test(l))) expect(line).toMatch(/ !important;$/);
  });

  it('defines the same token names in both themes', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  // WCAG AA: 4.5:1 for text, 3:1 for focus indicators, accent fills against the page and large marks
  const pairs: [string, string, number][] = [
    ['text', 'bg', 4.5],
    ['text', 'surface', 4.5],
    ['text', 'surface-sunken', 4.5],
    ['text-body', 'surface', 4.5],
    ['text-body', 'bg', 4.5],
    ['text-muted', 'surface', 4.5],
    ['text-muted', 'bg', 4.5],
    ['text-muted', 'surface-sunken', 4.5],
    ['text-muted', 'surface-raised', 4.5],
    ['text-faint', 'surface', 4.5],
    ['text-faint', 'bg', 4.5],
    ['accent-text', 'surface', 4.5],
    ['accent-text', 'bg', 4.5],
    ['accent-text', 'surface-sunken', 4.5],
    ['on-accent', 'accent', 4.5],
    ['on-accent', 'accent-hover', 4.5],
    ['on-accent', 'accent-active', 4.5],
    ['accent', 'bg', 3],
    ['focus', 'bg', 3],
    ['focus', 'surface', 3],
    ['focus', 'surface-sunken', 3],
    ['on-danger', 'danger', 4.5],
    ['on-danger', 'danger-hover', 4.5],
    ['on-chrome', 'chrome', 4.5],
    ['on-chrome', 'chrome-2', 4.5],
    ['on-chrome-muted', 'chrome', 4.5],
    ['on-chrome-accent', 'chrome-accent', 4.5],
    ['on-chrome-accent', 'chrome-accent-hover', 4.5],
    ['chrome-accent', 'chrome', 3],
    ['danger', 'surface', 4.5],
    ['danger', 'bg', 4.5],
    ['success', 'surface', 4.5],
    ['warning', 'surface', 4.5],
    ['info', 'surface', 4.5],
  ];
  for (const theme of ['light', 'dark'] as const)
    for (const [fg, bg, min] of pairs)
      it(`${theme}: ${fg} on ${bg} has contrast >= ${min}`, () => {
        expect(contrast(themes[theme][fg]!, themes[theme][bg]!)).toBeGreaterThanOrEqual(min);
      });

  // A tint token is `rgb(r g b / a)` laid over a page fill; flatten it to the hex a reader sees.
  const over = (tint: string, base: string) => {
    const m = /rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(tint)!;
    const a = Number(m[4]);
    const b = parseInt(base.slice(1), 16);
    const ch = [16, 8, 0].map((s, i) => Math.round(Number(m[i + 1]) * a + ((b >> s) & 255) * (1 - a)));
    return '#' + ch.map((c) => c.toString(16).padStart(2, '0')).join('');
  };
  // Tinted pills and dev-tools rows (error, warning, navigation, failed request): the status text
  // and the row's secondary text (text-muted, which tinted rows use in place of text-faint) on the
  // tint over each fill a row or pill sits on.
  for (const theme of ['light', 'dark'] as const)
    for (const s of ['danger', 'warning', 'success', 'info'])
      for (const fill of ['surface', 'bg', 'surface-sunken'])
        it(`${theme}: ${s}-text and text-muted on ${s}-tint over ${fill} pass AA`, () => {
          const t = themes[theme];
          const bg = over(t[`${s}-tint`]!, t[fill]!);
          expect(contrast(t[`${s}-text`]!, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t['text-muted']!, bg)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(t.text!, bg)).toBeGreaterThanOrEqual(4.5);
        });
  for (const theme of ['light', 'dark'] as const)
    it(`${theme}: text-muted on the selected row (accent-tint over surface) passes AA`, () => {
      const t = themes[theme];
      expect(contrast(t['text-muted']!, over(t['accent-tint']!, t.surface!))).toBeGreaterThanOrEqual(4.5);
    });

  it('takes the light values from teksafari.org', () => {
    const l = themes.light;
    expect([l.bg, l.surface, l['surface-sunken'], l.border, l['border-strong'], l.text, l['text-body'], l['text-faint']]).toEqual(['#fafafa', '#ffffff', '#f3f4f6', '#e5e7eb', '#d1d5db', '#111827', '#374151', '#6b7280']);
    expect([l.accent, l['accent-hover'], l['accent-active'], l['on-accent']]).toEqual(['#000000', '#1a1a1a', '#333333', '#ffffff']);
    expect([themes.dark.bg, themes.dark.surface, themes.dark.accent, themes.dark['on-accent']]).toEqual(['#0b0b0b', '#131313', '#fafafa', '#0b0b0b']);
  });

  it('declares the bundled faces first in each stack', () => {
    const css = tokensCss();
    expect(css).toMatch(/--nb-font-sans: 'tb-inter'/);
    expect(css).toMatch(/--nb-font-display: 'tb-nunito'/);
    expect(css).toMatch(/--nb-font-mono: 'tb-geist-mono'/);
  });
});

describe('accent derivation', () => {
  it('the default accent is the shared DEFAULT_ACCENT and gives the token values', () => {
    expect(BASE_ACCENT).toBe(DEFAULT_ACCENT);
    for (const theme of ['light', 'dark'] as const)
      for (const [k, v] of Object.entries(accentVars(BASE_ACCENT, theme))) expect(themes[theme][k.slice(5)], `${theme} ${k}`).toBe(v);
  });

  // admin accents of every kind: brand blues and greens, a dark navy, a light yellow, greys
  const accents = ['#3446cf', '#0b7a5c', '#b00020', '#1e2a5a', '#ffd866', '#6b7280', '#111827', '#ff00ff', '#00ffff', '#7c3aed'];
  for (const a of accents)
    it(`${a}: every derived pair passes AA in both themes`, () => {
      const d = deriveAccent(a);
      for (const theme of ['light', 'dark'] as const) {
        const s = d[theme];
        const t = themes[theme];
        expect(s.accent).toBe(theme === 'light' ? a : s.accent);
        for (const fill of [s.accent, s.hover, s.active]) expect(contrast(s.on, fill), `${theme} on ${fill}`).toBeGreaterThanOrEqual(4.5);
        for (const bg of [t.surface!, t.bg!, t['surface-sunken']!, t['surface-raised']!]) {
          expect(contrast(s.text, bg), `${theme} text on ${bg}`).toBeGreaterThanOrEqual(4.5);
          expect(contrast(s.focus, bg), `${theme} focus on ${bg}`).toBeGreaterThanOrEqual(3);
        }
      }
      expect(contrast(d.dark.accent, themes.light.chrome!)).toBeGreaterThanOrEqual(3);
    });

  it('inverts black and greys for dark pages instead of greying them', () => {
    expect(deriveAccent('#000000').dark.accent).toBe('#fafafa');
    expect(contrast(deriveAccent('#111827').dark.accent, '#131313')).toBeGreaterThan(10);
  });

  it('writes a style sheet that follows the OS theme and a data-theme pin', () => {
    const css = accentCss('#0b7a5c');
    expect(css).toContain('html:root,html[data-theme="light"]{--nb-accent:#0b7a5c;');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\{html:root:not\(\[data-theme="light"\]\)\{--nb-accent:#54a28d;/);
    expect(css).toContain('--nb-chrome-accent:#54a28d');
  });
});

describe('icons', () => {
  it('draws 2 px strokes by default', () => {
    expect(iconSvg('pen')).toContain('stroke-width="2"');
  });
  it('has the icons the capture flows need', () => {
    for (const n of ['logo', 'screenshot', 'record', 'replay', 'link', 'mic', 'stop', 'pause', 'pen', 'blur', 'undo', 'redo'])
      expect(iconNames).toContain(n);
  });
  it('renders standalone SVG', () => {
    const svg = iconSvg('logo', { size: 32, color: '#3446cf' });
    expect(svg).toMatch(/^<svg [^>]*width="32"/);
    expect(svg).toContain(icons.logo[0]);
  });
});
