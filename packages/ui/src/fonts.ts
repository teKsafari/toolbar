// The bundled faces (fonts.css) for places where a style sheet's @font-face does not reach:
// @font-face inside a shadow root is ignored, so the in-page UI registers the faces on the
// host document with the FontFace API, from URLs it serves itself (the extension's
// web_accessible_resources, the server's static files). Never from a third-party CDN.

export const LATIN_RANGE =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

/** File names under packages/ui/fonts/, with the family and weight range each one carries. */
export const fontFiles = [
  { family: 'tb-inter', file: 'inter-latin-wght-normal.woff2', weight: '100 900' },
  { family: 'tb-nunito', file: 'nunito-latin-wght-normal.woff2', weight: '200 1000' },
  { family: 'tb-geist-mono', file: 'geist-mono-latin-wght-normal.woff2', weight: '100 900' },
] as const;

/**
 * Add the faces to a document once. `url` maps a file name to where it is served, for example
 * `(f) => browser.runtime.getURL('/fonts/' + f)`. Failures leave the system font stack in place.
 */
export function registerFonts(doc: Document, url: (file: string) => string): void {
  const set = doc.fonts as FontFaceSet & { add(f: FontFace): void };
  const have = new Set<string>();
  set.forEach((f) => have.add(f.family.replace(/['"]/g, '')));
  for (const f of fontFiles) {
    if (have.has(f.family)) continue;
    try {
      const face = new FontFace(f.family, `url("${url(f.file)}") format("woff2")`, { weight: f.weight, display: 'swap', unicodeRange: LATIN_RANGE });
      set.add(face);
      void face.load().catch(() => undefined);
    } catch {
      // a page without FontFace keeps the fallback stack
    }
  }
}
