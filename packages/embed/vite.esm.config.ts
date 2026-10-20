// dist/index.js and dist/react.js: the npm package's ES modules (D-211). They bundle the internal
// @toolbar/* code, Svelte and the DOM rasteriser; React stays an optional peer. Runs after
// vite.config.ts, into the same folder.
import { defineConfig } from 'vite';
import { shared } from './vite.config.ts';

export default defineConfig({
  ...shared,
  build: {
    outDir: new URL('./dist', import.meta.url).pathname,
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: true,
    minify: true,
    lib: {
      entry: { index: new URL('./src/index.ts', import.meta.url).pathname, react: new URL('./src/react.ts', import.meta.url).pathname },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: ['react'],
      output: { chunkFileNames: 'init-[hash].js' },
    },
  },
});
