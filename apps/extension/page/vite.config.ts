// Page bundle for the injector (D-131): one classic script, apps/extension/.output/page/toolbar.js,
// built from the extension's capture packages. `pnpm --filter @toolbar/extension build:page`.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [svelte({ compilerOptions: { runes: true, css: 'external' }, emitCss: false })],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: new URL('../.output/page', import.meta.url).pathname,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    lib: { entry: new URL('./main.ts', import.meta.url).pathname, formats: ['iife'], name: 'openToolbarPage', fileName: () => 'toolbar.js' },
  },
});
