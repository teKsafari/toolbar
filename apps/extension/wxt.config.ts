import { defineConfig } from 'wxt';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { COMMANDS, PRODUCT_NAME } from '@toolbar/shared';
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

/**
 * The public key a build pins its id with (docs/extension-release.md). WXT_MANIFEST_KEY replaces
 * the repository's key, for example with the Chrome Web Store item's public key (Developer
 * Dashboard, Package, "View public key"), so unpacked builds get the store item's id.
 */
const manifestKey = (process.env.WXT_MANIFEST_KEY ?? '').replace(/-----[^-]+-----|\s/g, '') || MANIFEST_KEY;

/** Firefox add-on id (browser_specific_settings.gecko.id); AMO signs an add-on under it. */
export const GECKO_ID = process.env.WXT_GECKO_ID || 'open-toolbar@self-hosted';
/** Chrome-only permissions Firefox does not know: tab and screen video, offscreen documents. */
const CHROME_ONLY_PERMISSIONS = ['tabCapture', 'offscreen', 'desktopCapture'];

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
const appIcon = process.env.WXT_APP_ICON ? resolve(process.env.WXT_APP_ICON) : null;
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  outDirTemplate: testHooks ? `{{browser}}-mv{{manifestVersion}}-test${process.env.WXT_OUT_SUFFIX ?? ''}` : undefined,
  // The VM has no display for WXT's own browser runner, and the shared browser belongs to another agent.
  webExt: { disabled: true },
  // the Firefox build sets data_collection_permissions in build:manifestGenerated below
  suppressWarnings: { firefoxDataCollection: true },
  // Port 3000 belongs to the server; WXT's HMR server takes 3001. Area worktrees set
  // WXT_DEV_PORT=320<i> (docs/parallel.md).
  dev: { server: { port: devPort, origin: `http://localhost:${devPort}` } },
  manifest: {
    name: testHooks ? `${appName} (test)` : appName,
    description: 'Capture bugs with console, network, user actions, screenshots, video and voice.',
    key: manifestKey,
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
    action: { default_title: appName },
  },
  vite: () => ({
    define: { __TB_TEST_HOOKS__: JSON.stringify(testHooks), __TB_APP_NAME__: JSON.stringify(appName) },
    plugins: [{ name: 'tb-app-name', transformIndexHtml: (html: string) => html.replaceAll('%APP_NAME%', escHtml(appName)) }],
  }),
  hooks: {
    // WXT takes the popup's <title> (the %APP_NAME% placeholder) for the action title
    'build:manifestGenerated': (wxt, manifest) => {
      if (manifest.action) manifest.action.default_title = appName;
      if (manifest.browser_action) manifest.browser_action.default_title = appName;
      // Firefox (docs/extension-release.md): no Chrome key or version floor, an add-on id instead,
      // and without the Chrome-only permissions (recording is Chrome-only)
      if (wxt.config.browser === 'firefox') {
        delete manifest.key;
        delete manifest.minimum_chrome_version;
        manifest.permissions = (manifest.permissions ?? []).filter((p) => !CHROME_ONLY_PERMISSIONS.includes(p));
        // Mozilla's data-collection consent (required for new AMO listings): the extension sends page
        // content and activity, which the reviewer captures, to the server they sign in to
        const gecko = { id: GECKO_ID, strict_min_version: '128.0', data_collection_permissions: { required: ['websiteActivity', 'websiteContent'] } };
        manifest.browser_specific_settings = { gecko } as typeof manifest.browser_specific_settings;
      }
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
