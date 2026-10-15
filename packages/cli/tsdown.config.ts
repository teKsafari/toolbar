// One ESM file with a shebang, @toolbar/shared inlined, Node built-ins external.
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { 'open-toolbar': 'src/main.ts' },
  format: 'esm',
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  dts: false,
  deps: { alwaysBundle: [/^@toolbar\//] },
  outExtensions: () => ({ js: '.mjs' }),
  banner: { js: '#!/usr/bin/env node' },
});
