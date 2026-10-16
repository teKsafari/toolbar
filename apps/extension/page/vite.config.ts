// Page bundle for the injector (D-158): one classic script, apps/extension/.output/page/toolbar.js,
// built from the extension's capture packages. `pnpm --filter @toolbar/extension build:page`.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, readdirSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * The bundled faces (SIL OFL 1.1, D-175) beside toolbar.js with their licence texts: the injector
 * serves plain files at the top of its assets folder, and the bundle registers them from there.
 */
const fontDir = new URL('../../../packages/ui/fonts/', import.meta.url).pathname;
const fonts: Plugin = {
  name: 'tb-page-fonts',
  generateBundle() {
    for (const f of readdirSync(fontDir).filter((n) => n.endsWith('.woff2') || n.startsWith('OFL-')))
      this.emitFile({ type: 'asset', fileName: f, source: readFileSync(fontDir + f) });
  },
};

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [fonts, svelte({ compilerOptions: { runes: true, css: 'external' }, emitCss: false })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: new URL('../.output/page', import.meta.url).pathname,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    lib: { entry: new URL('./main.ts', import.meta.url).pathname, formats: ['iife'], name: 'openToolbarPage', fileName: () => 'toolbar.js' },
  },
});
