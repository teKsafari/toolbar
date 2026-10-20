// dist/index.js and dist/react.js: the npm package's ES modules (D-211). They bundle the internal
// @toolbar/* code, Svelte and the DOM rasteriser; React stays an optional peer. Runs after
// vite.config.ts, into the same folder.
import { defineConfig, type Plugin } from 'vite';
import { shared } from './vite.config.ts';

/**
 * dist/react.js starts with 'use client' (D-213): a React Server Components app (Next.js app
 * router) can then render <OpenToolbar /> from a server component. The directive goes on after
 * minification, which would drop it from the middle of a bundle; the source map moves down a line.
 */
export const useClient: Plugin = {
  name: 'tb-embed-use-client',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const chunk = bundle['react.js'];
    if (chunk?.type !== 'chunk' || chunk.code.startsWith("'use client';")) return;
    chunk.code = "'use client';\n" + chunk.code;
    if (chunk.map) chunk.map.mappings = ';' + chunk.map.mappings;
    const map = bundle['react.js.map'];
    if (map?.type === 'asset' && typeof map.source === 'string') {
      const json = JSON.parse(map.source) as { mappings: string };
      json.mappings = ';' + json.mappings;
      map.source = JSON.stringify(json);
    }
  },
};

export default defineConfig({
  ...shared,
  plugins: [...shared.plugins!, useClient],
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
