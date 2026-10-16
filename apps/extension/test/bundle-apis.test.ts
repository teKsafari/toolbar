// The built extension must run on its minimum_chrome_version (116). A dependency update can bring
// in a call to a newer built-in (URL.canParse is Chrome 120, Uint8Array.prototype.toBase64 is
// Chrome 140), which throws "is not a function" only on an older browser. This test greps the
// release bundles for such calls; a call is fine when a feature check (`typeof X`, `"X" in`)
// sits right before it, as zod does for URL.canParse (D-199). It runs on what the last
// `wxt build` wrote, so `pnpm -r build` before `pnpm -r test` checks the current code.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const OUT = path.resolve(import.meta.dirname, '../.output');
const BUNDLES = ['chrome-mv3', 'page'].map((d) => path.join(OUT, d)).filter((d) => fs.existsSync(d));
const MINIMUM = Number(/minimum_chrome_version:\s*'(\d+)'/.exec(fs.readFileSync(path.resolve(import.meta.dirname, '../wxt.config.ts'), 'utf8'))?.[1]);

/** Built-ins newer than Chrome 116, with the version that brought them and the name a feature check uses. */
const NEWER: { re: RegExp; chrome: number; feature: string }[] = [
  { re: /\bObject\.groupBy\(/g, chrome: 117, feature: 'groupBy' },
  { re: /\bMap\.groupBy\(/g, chrome: 117, feature: 'groupBy' },
  { re: /\bPromise\.withResolvers\(/g, chrome: 119, feature: 'withResolvers' },
  { re: /\bURL\.canParse\(/g, chrome: 120, feature: 'canParse' },
  { re: /\bArray\.fromAsync\(/g, chrome: 121, feature: 'fromAsync' },
  { re: /\.(?:symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/g, chrome: 122, feature: 'isSubsetOf' },
  { re: /\bIterator\.from\(/g, chrome: 122, feature: 'Iterator' },
  { re: /\bURL\.parse\(/g, chrome: 126, feature: 'parse' },
  { re: /\bPromise\.try\(/g, chrome: 128, feature: 'try' },
  { re: /\bError\.isError\(/g, chrome: 134, feature: 'isError' },
  { re: /\bRegExp\.escape\(/g, chrome: 136, feature: 'escape' },
  { re: /\bUint8Array\.(?:fromBase64|fromHex)\(/g, chrome: 140, feature: 'fromBase64' },
  // a method of the same name on an object of the bundle's own (postcss's this.toBase64) is not the built-in
  { re: /(?<!\bthis)\.(?:toBase64|toHex|setFromBase64|setFromHex)\(/g, chrome: 140, feature: 'toBase64' },
];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));
}

/** Methods the bundle defines itself (`toHex(e){`), so `.toHex(` there is its own. */
function ownMethods(src: string): Set<string> {
  return new Set([...src.matchAll(/[,;{}]\s*(?:static\s+)?(toBase64|toHex|setFromBase64|setFromHex)\([\w$,\s]*\)\s*\{/g)].map((m) => m[1]!));
}

describe('bundle APIs', () => {
  it('reads the minimum Chrome version', () => {
    expect(MINIMUM).toBe(116);
  });

  it.skipIf(!BUNDLES.length)('calls no built-in newer than minimum_chrome_version without a feature check', () => {
    const found: string[] = [];
    for (const dir of BUNDLES) {
      for (const file of files(dir)) {
        const src = fs.readFileSync(file, 'utf8');
        const own = ownMethods(src);
        for (const api of NEWER) {
          if (api.chrome <= MINIMUM) continue;
          for (const m of src.matchAll(api.re)) {
            const name = m[0].replace(/[.(]/g, '');
            if (own.has(name)) continue;
            const before = src.slice(Math.max(0, m.index! - 200), m.index!);
            const guarded = before.includes(`typeof `) && (before.includes(api.feature) || before.includes(name)) ? true : new RegExp(`["'\`]${api.feature}["'\`]\\s*in\\b`).test(before);
            if (!guarded) found.push(`${path.relative(OUT, file)}: ${m[0]} (Chrome ${api.chrome}) near "${src.slice(Math.max(0, m.index! - 60), m.index! + 40)}"`);
          }
        }
      }
    }
    expect(found).toEqual([]);
  });
});
