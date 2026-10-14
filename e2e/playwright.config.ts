import { defineConfig } from '@playwright/test';

// The extension e2e suite. Needs:
//   - the test build of the extension: pnpm --filter @toolbar/extension build:test
//   - the lab app on http://localhost:5173 (user service toolbar-lab)
//   - the server on SERVER_URL (docker compose up, or pnpm dev:server)
// Chromium runs headed on a private Xvfb display (:101 by default; never :99, the shared browser).
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './global-setup.ts',
  use: { trace: 'retain-on-failure' },
});
