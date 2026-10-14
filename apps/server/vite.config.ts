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

/**
 * OAuth token and revoke requests from MCP clients are form posts without an Origin header, which
 * Kit's CSRF check refuses. They carry no cookies (PKCE or client secret only), so treat them as
 * same-origin. server.js does the same in production.
 */
const OAUTH_FORM_PATHS = /^\/mcp\/(token|revoke)(\?|$)/;
const oauthFormOrigin = {
  name: 'nib-oauth-form-origin',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string; headers: Record<string, unknown> }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && OAUTH_FORM_PATHS.test(req.url)) req.headers.origin = process.env.PUBLIC_URL || `http://localhost:${devPort}`;
      next();
    });
  },
};

export default defineConfig({
  plugins: [
    oauthFormOrigin,
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
