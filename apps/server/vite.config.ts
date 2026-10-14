import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Dev convenience: read the repo root .env (the same file docker compose reads).
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);
} catch {
  /* no .env: dev defaults in src/lib/server/env.ts apply */
}

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
      },
      adapter: adapter({ out: 'build' }),
    }),
  ],
  server: { port: 3000, strictPort: true, host: true },
  preview: { port: 3000, strictPort: true },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'], environment: 'node' },
});
