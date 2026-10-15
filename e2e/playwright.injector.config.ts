import { defineConfig } from '@playwright/test';

// The injector's compose test (D-128), run by apps/injector/test/run.sh: a plain Chromium with no
// extension, the injector in front of the lab app (INJECTOR_URL), the server on SERVER_URL.
// Headless, so it needs no display.
export default defineConfig({
  testDir: './injector',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results-injector',
  use: { headless: true, trace: 'retain-on-failure' },
});
