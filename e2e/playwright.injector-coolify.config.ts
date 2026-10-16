import { defineConfig } from '@playwright/test';

// The injector behind a Traefik set up like Coolify's (D-200), run by
// apps/injector/test/coolify-like/run.sh: a headed Chromium with no extension on the display the
// script names (E2E_DISPLAY, default :350), the proxy's self-signed certificate accepted.
export default defineConfig({
  testDir: './injector',
  testMatch: 'coolify.spec.ts',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results-injector',
  use: { headless: false, ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 }, trace: 'retain-on-failure' },
});
