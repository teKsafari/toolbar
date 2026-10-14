import { defineConfig } from 'wxt';
import { COMMANDS, PRODUCT_NAME } from '@toolbar/shared';

// Test builds (WXT_TEST_HOOKS=1) render the in-page UI in an open shadow root and expose
// globalThis.__tb in the service worker; they go to .output/chrome-mv3-test.
const testHooks = process.env.WXT_TEST_HOOKS === '1';

/**
 * Public half of the extension signing key. It pins the extension id to
 * fmongfmimgdafigcahdpofnmmhljpnei for dev, test and unpacked builds (D-011, D-022).
 * The private key lives in .secrets/extension-key.pem, outside git.
 */
export const MANIFEST_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtNg37Vl/0bFbNV9otDQqWsKWtLal5T1CQbwaL2ThxXVFciM48JAQh+kbMjYe9fn1ghRiJxsZZJsl+pqde/H2465YOO7BKIOl3dEFCVwfScZg2LttOmKUTJSfRgrTxk6TPZoj1VBBmuICkQxoavGPluHZgcCI+uzV1qvQxgcYDbRrJ/dTtyiYL2rWFAKuXiX3jV9Ndx9JGYjx2N1wcKKPrOsw3phPGhHKJVmoHvSTz49f5v2hL1+36gEfEI+IyTQVcJDePXTTG81H6MeH+gB5dqyphwls5qJV5q0lWhHqyDvOeLaUhWy9LEfWNR1SlPTLjGYikWZZfPE4YKTbrC3aLQIDAQAB';

const commands = Object.fromEntries(
  Object.entries(COMMANDS).map(([name, c]) => [
    name,
    {
      description: c.description,
      ...(c.key ? { suggested_key: { default: c.key, mac: c.mac } } : {}),
    },
  ]),
);

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  outDirTemplate: testHooks ? '{{browser}}-mv{{manifestVersion}}-test' : undefined,
  // The VM has no display for WXT's own browser runner, and the shared browser belongs to another agent.
  webExt: { disabled: true },
  manifest: {
    name: testHooks ? `${PRODUCT_NAME} (test)` : PRODUCT_NAME,
    description: 'Capture bugs with console, network, user actions, screenshots, video and voice.',
    key: MANIFEST_KEY,
    minimum_chrome_version: '116',
    // Part 1 replicates Jam: all sites. Part 2 moves these to optional_host_permissions.
    host_permissions: ['<all_urls>'],
    permissions: [
      'activeTab',
      'scripting',
      'tabCapture',
      'offscreen',
      'storage',
      'unlimitedStorage',
      'identity',
      'webRequest',
      'alarms',
      'desktopCapture',
    ],
    commands,
    action: { default_title: PRODUCT_NAME },
  },
  vite: () => ({
    define: { __TB_TEST_HOOKS__: JSON.stringify(testHooks) },
  }),
});
