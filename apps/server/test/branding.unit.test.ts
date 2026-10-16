// Instance branding (D-112): precedence, colours, SVG sanitising and PNG renditions.
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { contrast, defaultIconSvg, defaultLogoSvg, onAccentOf, resolveBrand, validAccent, type BrandInputs } from '../src/lib/server/branding/resolve.ts';
import { BrandImageError, processLogo, renditions, sanitizeSvg } from '../src/lib/server/branding/image.ts';
import { brandHead } from '../src/lib/server/branding/head.ts';

const noLogo = { light: null, dark: null, lightSet: false, darkSet: false };
const ref = (c: string) => ({ hash: c.repeat(64), type: 'image/png' as const, width: 10, height: 10 });
const inputs = (p: Partial<BrandInputs>): BrandInputs => ({ env: {}, envLogo: noLogo, stored: null, ...p });

describe('resolveBrand', () => {
  it('falls back to the defaults', () => {
    const b = resolveBrand(inputs({}));
    expect(b.name).toBe('open-toolbar');
    expect(b.accent).toBe('#000000');
    expect(b.onAccent).toBe('#ffffff');
    expect(b.logo).toEqual({ light: null, dark: null });
    expect(b.locked).toEqual({ name: false, accent: false, logo: false, logoDark: false });
  });

  it('takes stored values over defaults and env over both, locking env fields', () => {
    const stored = { name: 'Stored', accent: '#0b7a5c', logo: { light: ref('a') } };
    const s = resolveBrand(inputs({ stored }));
    expect([s.name, s.accent, s.logo.light?.hash]).toEqual(['Stored', '#0b7a5c', 'a'.repeat(64)]);
    const e = resolveBrand(inputs({ stored, env: { name: 'Acme Review', accent: '#B00020' }, envLogo: { ...noLogo, light: ref('b'), lightSet: true } }));
    expect([e.name, e.accent, e.logo.light?.hash]).toEqual(['Acme Review', '#b00020', 'b'.repeat(64)]);
    expect(e.locked).toEqual({ name: true, accent: true, logo: true, logoDark: false });
  });

  it('ignores invalid env values with a warning', () => {
    const b = resolveBrand(inputs({ env: { name: '<script>', accent: 'red' }, stored: { name: 'Stored' } }));
    expect(b.name).toBe('Stored');
    expect(b.accent).toBe('#000000');
    expect(b.locked.name).toBe(false);
    expect(b.warnings).toHaveLength(2);
  });

  it('changes the version when any input changes', () => {
    const v = (p: Partial<BrandInputs>) => resolveBrand(inputs(p)).version;
    const base = v({});
    expect(v({ stored: { name: 'X' } })).not.toBe(base);
    expect(v({ stored: { accent: '#0b7a5c' } })).not.toBe(base);
    expect(v({ stored: { logo: { dark: ref('c') } } })).not.toBe(base);
    expect(v({})).toBe(base);
  });
});

describe('accent colours', () => {
  it('picks readable text on the accent', () => {
    expect(onAccentOf('#3446cf')).toBe('#ffffff');
    expect(onAccentOf('#ffd866')).toBe('#0b0b0b');
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
  it('inverts the black default for dark pages and lightens other accents until they read', () => {
    const d = resolveBrand(inputs({}));
    expect([d.accentDark, d.onAccentDark]).toEqual(['#fafafa', '#0b0b0b']);
    const n = resolveBrand(inputs({ stored: { accent: '#1e2a5a' } }));
    expect(contrast(n.accentDark, '#1b1b1b')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(n.onAccentDark, n.accentDark)).toBeGreaterThanOrEqual(4.5);
  });
  it('rejects malformed colours', () => {
    expect(validAccent('#0B7A5C')).toBe('#0b7a5c');
    expect(validAccent('0b7a5c')).toBeNull();
    expect(validAccent('#fff')).toBeNull();
  });
});

const CLEAN = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 40 20"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs><rect width="40" height="20" fill="url(#g)"/><path d="M0 0h10v10z" style="fill:#00f"/></svg>';

describe('sanitizeSvg', () => {
  it('keeps a clean logo and reads its size', () => {
    const c = sanitizeSvg(CLEAN);
    expect(c.width).toBe(40);
    expect(c.height).toBe(20);
    expect(c.svg).toContain('linearGradient');
    expect(c.svg).toContain('url(#g)');
  });

  const hostile: [string, string][] = [
    ['script', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><script>alert(1)</script></svg>'],
    ['onload', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" onload="alert(1)"><rect width="1" height="1"/></svg>'],
    ['foreignObject', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><foreignObject><div>x</div></foreignObject></svg>'],
    ['javascript href', '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1 1"><a xlink:href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>'],
    ['external image', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><image href="http://evil.example/x.png" width="1" height="1"/></svg>'],
    ['external use', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><use href="http://evil.example/s.svg#a"/></svg>'],
    ['style import', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><style>@import url(http://evil.example/a.css);</style></svg>'],
    ['css url', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" style="fill:url(http://evil.example/p)"/></svg>'],
    ['entities', '<!DOCTYPE svg [<!ENTITY a "aaaaaaaa"><!ENTITY b "&a;&a;&a;&a;">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><text>&b;</text></svg>'],
    ['no size', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'],
  ];
  for (const [what, svg] of hostile) {
    it(`refuses ${what}`, () => {
      expect(() => sanitizeSvg(svg)).toThrow(BrandImageError);
    });
  }
});

describe('processLogo', () => {
  it('renders every icon size and the email logo from an SVG', async () => {
    const f = await processLogo(Buffer.from(defaultLogoSvg('#0b7a5c')), 'image/svg+xml');
    expect(f.ref.type).toBe('image/svg+xml');
    for (const n of [16, 32, 48, 128, 180, 512] as const) {
      const m = await sharp(f.icons[n]).metadata();
      expect([m.format, m.width, m.height, m.hasAlpha]).toEqual(['png', n, n, true]);
    }
    const e = await sharp(f.email).metadata();
    expect(e.height).toBe(64);
    // the corner of a square icon is transparent, the middle is the rectangle
    const { data } = await sharp(f.icons[32]).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
    expect(data[(16 * 32 + 16) * 4 + 3]).toBe(255);
  });

  it('accepts a PNG and refuses other types and sizes', async () => {
    const png = await sharp({ create: { width: 300, height: 100, channels: 4, background: '#0b7a5c' } }).png().toBuffer();
    const f = await processLogo(png, 'image/png');
    expect([f.ref.type, f.ref.width, f.ref.height]).toEqual(['image/png', 300, 100]);
    const jpeg = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } }).jpeg().toBuffer();
    await expect(processLogo(jpeg, 'image/jpeg')).rejects.toMatchObject({ code: 'unsupported_media_type' });
    await expect(processLogo(Buffer.alloc(600 * 1024, 1), 'image/png')).rejects.toMatchObject({ code: 'too_large' });
    const big = await sharp({ create: { width: 2100, height: 10, channels: 4, background: '#000' } }).png().toBuffer();
    await expect(processLogo(big, 'image/png')).rejects.toMatchObject({ code: 'invalid_image' });
  });
});

describe('brandHead', () => {
  it('links the favicons and sets no accent style for the default', () => {
    const h = brandHead(resolveBrand(inputs({})));
    expect(h).toContain('rel="icon"');
    expect(h).toContain('rel="apple-touch-icon"');
    expect(h).toContain('og:site_name" content="open-toolbar"');
    expect(h).not.toContain('--nb-accent:');
  });
  it('writes the accent pair and escapes the name', () => {
    const h = brandHead(resolveBrand(inputs({ stored: { name: "Lee's & Co", accent: '#0b7a5c' } })));
    expect(h).toContain('--nb-accent:#0b7a5c');
    expect(h).toContain('Lee&#39;s &amp; Co');
  });
});

describe('default icon', () => {
  it('edges the black rectangle in white, so the 16 px PNG reads on a dark toolbar (D-178)', async () => {
    const r = await renditions(Buffer.from(defaultIconSvg('#000000', '#ffffff')), true);
    const { data, info } = await sharp(r.icons[16]).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 4));
    const [cr, cg, cb, ca] = px(8, 8);
    expect([cr, cg, cb, ca]).toEqual([0, 0, 0, 255]);
    // the edge row above the fill is light and opaque
    const edge = px(8, 4);
    expect(edge[3]).toBeGreaterThan(200);
    expect(Math.min(edge[0]!, edge[1]!, edge[2]!)).toBeGreaterThan(150);
  });
});
