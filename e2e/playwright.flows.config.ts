import { defineConfig } from '@playwright/test';

// User journeys from docs/jam/flows.md against the real stack (docker compose on SERVER_URL,
// the lab on LAB_URL) with the release build of the extension. One worker: the flows share
// one browser profile and one signed-in user, and later flows reuse the captures earlier
// flows made. Chromium runs headed on a private Xvfb display (E2E_DISPLAY, default :120).
//   pnpm --filter @toolbar/extension build && pnpm --filter @toolbar/e2e flows
process.env.E2E_DISPLAY ??= ':120';
export default defineConfig({
  testDir: './flows',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-flows' }]],
  globalSetup: './global-setup.ts',
  use: { trace: 'retain-on-failure' },
});
