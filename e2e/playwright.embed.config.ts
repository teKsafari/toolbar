import { defineConfig } from '@playwright/test';
import { browserEnv } from './fixtures/browser-env.ts';

// The embed suite (D-211, D-212): a plain Chromium with no extension on the lab app, whose opt-in
// pages (lab/server.js, `?tb-embed=<key>`) carry the script tag from the server on SERVER_URL.
// Headless, so it needs no display. Chromium's fake microphone answers getUserMedia for the
// voice notes. Needs the compose stack with the dev and whisper files (docs/dev.md) and the lab
// (user service toolbar-lab, :5173 and :5174).
export default defineConfig({
  testDir: './embed',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-embed' }]],
  outputDir: 'test-results-embed',
  use: {
    headless: true,
    trace: 'retain-on-failure',
    permissions: ['microphone'],
    launchOptions: {
      // only these names reach the browser, and so the traces of failed tests (D-192)
      env: browserEnv(),
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
});
