// dist/embed.js: the script tag build (D-211), one classic script with everything inlined (the
// capture code, the reviewer toolbar, Svelte and the DOM rasteriser), and the OFL fonts beside it.
// The server serves the folder at /embed.js and /embed/<file>. `pnpm --filter @open-toolbar/embed build`.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig, type Plugin, type UserConfig } from 'vite';

/** The bundled faces (SIL OFL 1.1, D-175) with their licence texts, beside embed.js. */
const fontDir = new URL('../ui/fonts/', import.meta.url).pathname;
export const fonts: Plugin = {
  name: 'tb-embed-fonts',
  generateBundle() {
    for (const f of readdirSync(fontDir).filter((n) => n.endsWith('.woff2') || n.startsWith('OFL-')))
      this.emitFile({ type: 'asset', fileName: f, source: readFileSync(fontDir + f) });
  },
};

/**
 * Component styles as constructed style sheets in the shadow root (src/css.ts): Svelte compiles
 * with css: 'injected', and every import of its client runtime gets src/svelte-client.ts, whose
 * append_styles registers the sheet instead of adding a <style> element.
 */
const shim = new URL('./src/svelte-client.ts', import.meta.url).pathname;
export const svelteCss: Plugin = {
  name: 'tb-embed-svelte-css',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id === 'svelte/internal/client' && importer !== shim) return shim;
    return null;
  },
};

/**
 * zod stays out of the bundle: the shared contracts define their schemas at the top of modules
 * whose constants and helpers the toolbar uses, and the page never validates with them. Their
 * `zod` import gets a stand-in (src/zod-stub.ts) that lets the definitions run.
 */
const sharedDir = new URL('../shared/src/', import.meta.url).pathname;
const zodStub = new URL('./src/zod-stub.ts', import.meta.url).pathname;
export const noZod: Plugin = {
  name: 'tb-embed-no-zod',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id === 'zod' && importer?.startsWith(sharedDir)) return zodStub;
    return null;
  },
};

export const shared: UserConfig = {
  root: new URL('.', import.meta.url).pathname,
  plugins: [svelteCss, noZod, svelte({ compilerOptions: { runes: true, css: 'injected' }, emitCss: false })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
};

export default defineConfig({
  ...shared,
  plugins: [...shared.plugins!, fonts],
  build: {
    outDir: new URL('./dist', import.meta.url).pathname,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    minify: true,
    lib: { entry: new URL('./src/embed.ts', import.meta.url).pathname, formats: ['iife'], name: 'openToolbarEmbed', fileName: () => 'embed.js' },
  },
});
