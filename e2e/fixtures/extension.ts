// Fixture: Playwright 1.63.0 Chromium with the unpacked extension (ideas from
// spikes/capture/run/launch.mjs): fixed id from the manifest key, the action pinned,
// --allowlisted-extension-id so tabCapture needs no gesture, fake media devices.
import { test as base, chromium, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserEnv } from './browser-env.ts';

export const EXT_ID = 'laobpjhffglefallhhojihfdbdkoendk';
export const DISPLAY = process.env.E2E_DISPLAY ?? ':101';
export const LAB_URL = process.env.LAB_URL ?? 'http://localhost:5173';
export const SERVER_URL = process.env.SERVER_URL ?? 'http://localhost:3000';
export const EXT_DIR = path.resolve(
  import.meta.dirname,
  '../..',
  'apps/extension/.output',
  process.env.E2E_EXT_BUILD ?? 'chrome-mv3-test',
);

/** The test-build hooks the service worker exposes as globalThis.__tb. */
export interface TbHooks {
  ready(): Promise<string[]>;
  stats(): { ports: number; events: number; byKind: Record<string, number>; commands: string[]; pages: string[] };
  events(): unknown[];
}

/** One browser per worker (extension install and service worker start take seconds). */
export const test = base.extend<{ context: BrowserContext }, { extContext: BrowserContext; sw: Worker }>({
  context: async ({ extContext }, use) => {
    await use(extContext);
    // The browser is shared by every test in the worker. Close what this test left open: left
    // behind, lab tabs keep their capture scripts and replay rings running and editors keep
    // talking to the worker, which slowed later tests' draft saves past their waits. The first
    // page stays, since the browser quits with its last window.
    for (const p of extContext.pages().slice(1)) await p.close().catch(() => undefined);
  },
  extContext: [
    async ({}, use) => {
      if (!fs.existsSync(path.join(EXT_DIR, 'manifest.json')))
        throw new Error(`No extension build at ${EXT_DIR}. Run: pnpm --filter @toolbar/extension build:test`);
      const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-e2e-'));
      fs.mkdirSync(path.join(userDataDir, 'Default'), { recursive: true });
      fs.writeFileSync(
        path.join(userDataDir, 'Default', 'Preferences'),
        JSON.stringify({ extensions: { pinned_extensions: [EXT_ID] } }),
      );
      const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        env: browserEnv(DISPLAY),
        viewport: null,
        args: [
          `--disable-extensions-except=${EXT_DIR}`,
          `--load-extension=${EXT_DIR}`,
          `--allowlisted-extension-id=${EXT_ID}`,
          '--use-fake-ui-for-media-stream',
          '--use-fake-device-for-media-stream',
          '--window-position=0,0',
          '--window-size=1280,800',
          '--force-device-scale-factor=1',
        ],
      });
      // E2E_VIEWPORT=390x844 gives every new page that viewport, to run a suite at phone width (D-181);
      // tests that set their own size still win
      const vp = process.env.E2E_VIEWPORT?.match(/^(\d+)x(\d+)$/);
      if (vp) context.on('page', (p) => void p.setViewportSize({ width: Number(vp[1]), height: Number(vp[2]) }).catch(() => {}));
      await use(context);
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  sw: [
    async ({ extContext }, use) => {
      const sw = extContext.serviceWorkers()[0] ?? (await extContext.waitForEvent('serviceworker'));
      await use(sw);
    },
    { scope: 'worker' },
  ],
});

export const expect = test.expect;
