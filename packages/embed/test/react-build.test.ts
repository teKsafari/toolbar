// @vitest-environment node
// dist/react.js starts with 'use client' (D-213), so a Next.js app router page can render
// <OpenToolbar /> from a server component. Builds the ES modules in memory with the package's
// own config; nothing is written to dist/.
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

type Output = { output: (Rolldown.OutputChunk | Rolldown.OutputAsset)[] };

describe('react entry build', () => {
  it("starts dist/react.js with 'use client' and keeps its source map on the code", async () => {
    const root = new URL('..', import.meta.url).pathname;
    const res = (await build({ configFile: root + 'vite.esm.config.ts', logLevel: 'silent', build: { write: false } })) as Output | Output[];
    const out = (Array.isArray(res) ? res : [res]).flatMap((r) => r.output);
    const react = out.find((f): f is Rolldown.OutputChunk => f.type === 'chunk' && f.fileName === 'react.js');
    expect(react?.code.startsWith("'use client';\n")).toBe(true);
    // the directive is on the bundle's first line only, never in the shared chunk index.js uses
    for (const f of out) if (f.type === 'chunk' && f.fileName !== 'react.js') expect(f.code).not.toContain("'use client'");
    const map = out.find((f): f is Rolldown.OutputAsset => f.type === 'asset' && f.fileName === 'react.js.map');
    const mappings = (JSON.parse(String(map?.source)) as { mappings: string }).mappings;
    // the directive's line maps to nothing: each mapped line moved down one
    expect(mappings.startsWith(';')).toBe(true);
  }, 120_000);
});
