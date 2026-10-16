import { defineConfig } from '@playwright/test';

// Parity scenarios (docs/parity/scenarios.md), the open-toolbar side: one spec per group under parity/,
// release build of the extension, a private Xvfb display (PARITY_DISPLAY, default :130) with
// openbox. One worker; the scenarios run in order, at human speed, and take minutes each.
// The scenarios sign in with passwords as parity@example.com and teammates @example.com, so the
// server needs AUTH_DEV_PASSWORD=1 and example.com in its allowlist (ALLOWED_EMAIL_DOMAINS=test,example.com).
//   cd e2e && PARITY_EXT_BUILD=chrome-mv3 npx playwright test -c playwright.parity.config.ts G1
process.env.PARITY_DISPLAY ??= ':130';
export default defineConfig({
  testDir: './parity',
  outputDir: './test-results-parity',
  timeout: 900_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './parity/global-setup.ts',
  use: { trace: 'off', actionTimeout: 30_000 },
});
