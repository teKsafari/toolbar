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
 * Dev mirror of server.js: requests with a bearer token, and the OAuth token and revoke form posts
 * from MCP clients, carry no cookies, so Kit's CSRF origin check does not apply to them. Without
 * this the CLI's multipart uploads and agents' token exchanges fail under `vite dev`.
 */
const OAUTH_FORM_PATHS = /^\/mcp\/(token|revoke)(\?|$)/;
const oauthFormOrigin = {
  name: 'tb-oauth-form-origin',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string; headers: Record<string, unknown> }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      if ((req.url && OAUTH_FORM_PATHS.test(req.url)) || /^Bearer\s/i.test(String(req.headers.authorization ?? ''))) req.headers.origin = process.env.PUBLIC_URL || `http://localhost:${devPort}`;
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
