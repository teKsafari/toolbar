import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Dev convenience: read the repo root .env (the same file docker compose reads).
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url).pathname);
} catch {
  /* no .env: dev defaults in src/lib/server/env.ts apply */
}

const devPort = Number(process.env.DEV_PORT || 3000);

export default defineConfig({
  plugins: [
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
      },
      adapter: adapter({ out: 'build' }),
    }),
  ],
  // DEV_PORT lets area worktrees run side by side (docs/parallel.md: 3100 + area index).
  server: { port: devPort, strictPort: true, host: true },
  preview: { port: devPort, strictPort: true },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'], environment: 'node' },
});
