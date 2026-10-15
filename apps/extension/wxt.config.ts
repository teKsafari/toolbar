import { defineConfig } from 'wxt';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COMMANDS, PRODUCT_NAME } from '@toolbar/shared';
import { DEFAULT_SERVER_URL } from '@toolbar/shared/constants';
import { ICON_SIZES, renderIcons } from './scripts/icons';

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

const devPort = Number(process.env.WXT_DEV_PORT || 3001);

/**
 * Build-time brand for self-built extensions (D-111): WXT_APP_NAME names the manifest, the action
 * title and the page titles; WXT_APP_ICON (an SVG or PNG path) replaces the packaged icons. A
 * signed-in extension shows the server's name and logo on top of these at runtime.
 */
export function buildName(raw = process.env.WXT_APP_NAME): string {
  const name = (raw ?? '').trim();
  if (!name) return PRODUCT_NAME;
  // eslint-disable-next-line no-control-regex
  if (name.length > 60 || /[\u0000-\u001f<>]/.test(name)) throw new Error('WXT_APP_NAME must be 1 to 60 characters with no control characters or angle brackets');
  return name;
}
const appName = buildName();

/**
 * Host access (D-126). A release build asks at install for its own server only; every site it
 * records on is an optional permission the person grants from a click, for the origins of their
 * projects. Test builds also hold <all_urls>, so the area suites run without a permission prompt
 * (captureVisibleTab needs <all_urls> or activeTab); their capture scripts still follow
 * lib/scope.ts.
 */
export function serverPattern(raw = process.env.WXT_SERVER_URL): string {
  return `${new URL(raw || DEFAULT_SERVER_URL).origin}/*`;
}
export const OPTIONAL_HOSTS = ['http://*/*', 'https://*/*'];
const appIcon = process.env.WXT_APP_ICON ? resolve(process.env.WXT_APP_ICON) : null;
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  outDirTemplate: testHooks ? `{{browser}}-mv{{manifestVersion}}-test${process.env.WXT_OUT_SUFFIX ?? ''}` : undefined,
  // The VM has no display for WXT's own browser runner, and the shared browser belongs to another agent.
  webExt: { disabled: true },
  // Port 3000 belongs to the server; WXT's HMR server takes 3001. Area worktrees set
  // WXT_DEV_PORT=320<i> (docs/parallel.md).
  dev: { server: { port: devPort, origin: `http://localhost:${devPort}` } },
  manifest: {
    name: testHooks ? `${appName} (test)` : appName,
    description: 'Capture bugs with console, network, user actions, screenshots, video and voice.',
    key: MANIFEST_KEY,
    minimum_chrome_version: '116',
    // D-126: the server only; project origins are optional and granted from a click
    host_permissions: testHooks ? ['<all_urls>'] : [serverPattern()],
    optional_host_permissions: OPTIONAL_HOSTS,
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
    action: { default_title: appName },
  },
  vite: () => ({
    define: { __TB_TEST_HOOKS__: JSON.stringify(testHooks), __TB_APP_NAME__: JSON.stringify(appName) },
    plugins: [{ name: 'tb-app-name', transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', escHtml(appName)) }],
  }),
  hooks: {
    // WXT takes the popup's <title> (the %APP_NAME% placeholder) for the action title
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.action) manifest.action.default_title = appName;
      // D-126: WXT adds the matches of runtime-registered scripts to host_permissions; set them
      // here, after it. The server-page script runs on the build's server only (a server chosen on
      // the options page gets it at runtime, lib/bg/scope.ts).
      manifest.host_permissions = testHooks ? ['<all_urls>'] : [serverPattern()];
      manifest.optional_host_permissions = OPTIONAL_HOSTS;
      for (const cs of manifest.content_scripts ?? []) if (cs.js?.some((f) => f.includes('toolbar-web'))) cs.matches = [serverPattern()];
    },
    // WXT_APP_ICON: the rendered icons replace public/icon/*.png in this build's output only
    'build:publicAssets': async (_wxt, files) => {
      if (!appIcon) return;
      const icons = await renderIcons(appIcon);
      const dir = mkdtempSync(join(tmpdir(), 'tb-icons-'));
      for (const n of ICON_SIZES) {
        const dest = `icon/${n}.png`;
        const i = files.findIndex((f) => f.relativeDest === dest);
        if (i >= 0) files.splice(i, 1);
        writeFileSync(join(dir, `${n}.png`), icons[n]);
        files.push({ relativeDest: dest, absoluteSrc: join(dir, `${n}.png`) });
      }
    },
  },
});
