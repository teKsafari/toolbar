// Rename guard (D-083, D-111): the old working name must not come back in apps/ or packages/.
// The only allowed hits are the frozen identifiers that keep stored data readable, each pinned
// to its file and line text below.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SCAN = ['apps', 'packages'];
const SKIP_DIRS = new Set(['node_modules', '.output', '.svelte-kit', 'build', 'dist', '.wxt', 'drizzle', 'coverage']);
const TEXT = /\.(ts|js|mjs|svelte|html|css|json|svg|md|txt|yml|yaml)$/;
const OLD = /(?<![a-z])nib(?![a-z])/i;

/** file -> substrings that make a line acceptable there */
const FROZEN: Record<string, string[]> = {
  'apps/server/src/lib/server/crypto.ts': ["'nib-seal-v1'"],
  'apps/server/src/lib/server/upload/token.ts': ["'nib-upload-v1'"],
  'packages/shared/src/ext/storage.ts': ["name: 'nib'", "LEGACY_KEY_PREFIX = 'nib:'", 'legacy `nib:*`'],
  'apps/extension/lib/migrate.ts': ['"nib:" prefix'],
  'apps/server/src/lib/server/branding/head.ts': ["LEGACY_LOCAL_PREFIX = 'nib.'", '"nib." keys'],
  'apps/extension/test/migrate.test.ts': ['*'],
  'packages/shared/test/rename-guard.test.ts': ['*'],
};

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* files(p);
    else if (TEXT.test(name) && st.size < 2_000_000) yield p;
  }
}

describe('rename guard', () => {
  it('finds no "Nib" or "nib" outside the frozen identifiers', () => {
    const hits: string[] = [];
    for (const top of SCAN) {
      for (const f of files(join(ROOT, top))) {
        const rel = relative(ROOT, f);
        const allow = FROZEN[rel] ?? [];
        if (allow.includes('*')) continue;
        readFileSync(f, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (OLD.test(line) && !allow.some((a) => line.includes(a))) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });

  it('catches the old name in its usual shapes', () => {
    for (const s of ['Nib', 'nib:auth', 'x-nib-share', 'NIB_TOKEN', 'nib.theme', 'a nib capture']) expect(OLD.test(s), s).toBe(true);
    for (const s of ['nibble', 'omnibox', 'open-toolbar']) expect(OLD.test(s), s).toBe(false);
  });
});
