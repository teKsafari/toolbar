import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, themes, tokensCss, iconNames, icons, iconSvg } from '../src/index.ts';

describe('tokens', () => {
  it('tokens.css matches tokens.ts (run gen:tokens after editing tokens.ts)', () => {
    expect(readFileSync(join(import.meta.dirname, '../src/tokens.css'), 'utf8')).toBe(tokensCss());
  });

  it('defines the same token names in both themes', () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  const pairs: [string, string, number][] = [
    ['text', 'bg', 4.5],
    ['text', 'surface', 4.5],
    ['text-muted', 'surface', 4.5],
    ['accent-text', 'surface', 4.5],
    ['on-accent', 'accent', 4.5],
    ['on-danger', 'danger', 4.5],
    ['on-chrome', 'chrome', 4.5],
    ['on-chrome-muted', 'chrome', 4.5],
    ['danger', 'surface', 4.5],
    ['success', 'surface', 3],
    ['warning', 'surface', 3],
  ];
  for (const theme of ['light', 'dark'] as const)
    for (const [fg, bg, min] of pairs)
      it(`${theme}: ${fg} on ${bg} has contrast >= ${min}`, () => {
        expect(contrast(themes[theme][fg]!, themes[theme][bg]!)).toBeGreaterThanOrEqual(min);
      });
});

describe('icons', () => {
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
