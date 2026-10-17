# Releasing the browser extension

`scripts/release-extension.sh` builds the release zips into `dist/`. `.github/workflows/extension-release.yml` runs it on a version tag and attaches the zips to the GitHub release.

## Build a release

Set the version in `apps/extension/package.json` (one to four dot-separated numbers), then:

```sh
WXT_SERVER_URL=https://feedback.example.com scripts/release-extension.sh
```

| File | Contents |
|---|---|
| `dist/open-toolbar-extension-<version>-chrome.zip` | Chrome build with the manifest `key`, for unpacked installs. Has the store item's id. |
| `dist/open-toolbar-extension-<version>-chrome-webstore.zip` | The same build without `key`, for the Chrome Web Store upload. |
| `dist/open-toolbar-extension-<version>-firefox.zip` | Firefox MV3 build, see [Firefox](#firefox). Not ready for users. |
| `dist/SHA256SUMS` | Checksums. |

Build variables ([docs/configuration.md](configuration.md), "Extension build"): `WXT_SERVER_URL`, `WXT_APP_NAME`, `WXT_APP_ICON`, `WXT_MANIFEST_KEY`, `WXT_GECKO_ID`. `FIREFOX=0` skips the Firefox zip. Zip entries are sorted with no extra attributes, so two builds of one commit list the same files.

## With GitHub Actions

Push `v<version>` or `extension-v<version>`. The workflow checks the tag against `apps/extension/package.json`, type-checks and unit-tests the extension, builds, keeps the zips as a run artifact and attaches them to the tag's release (creating it if needed). No secrets. Repository variables pass `WXT_SERVER_URL`, `WXT_APP_NAME`, `WXT_MANIFEST_KEY`, `WXT_GECKO_ID`.

The Chrome Web Store upload stays manual.

## The extension id and the manifest key

Chrome Web Store item: `laobpjhffglefallhhojihfdbdkoendk`. Google holds the signing key. The repository carries the public half in the manifest `key` (`MANIFEST_KEY` in `apps/extension/wxt.config.ts`), so dev, test and unpacked builds share the store id (D-196). Nobody outside Google can sign a `.crx` for it.

The server accepts sign-in only from ids in `EXTENSION_IDS` (redirect `https://<id>.chromiumapp.org/cb` on `/ext/connect`); the store id is the default.

A fork with its own store item builds with `WXT_MANIFEST_KEY='<that item's public key>'` (PEM armour and line breaks stripped) and sets `EXTENSION_IDS` to that item's id.

## Chrome Web Store, unlisted

Upload `open-toolbar-extension-<version>-chrome-webstore.zip` to the item; a zip with a `key` can be refused. Visibility: Unlisted. Updates go to the same item with a higher version.

Listing facts:

- Privacy policy: the server's `/privacy` page.
- Data: the extension records page content (console, network, DOM, screenshots, video, audio) and sends it only to the server the user signs in to. It sells nothing and serves no ads.
- Permissions: `tabCapture`, `offscreen` and `desktopCapture` record tab and screen video; `webRequest` reads request metadata; `scripting` and host access run the capture scripts; `identity` signs in.
- Host access: since 0.1.4 (D-202), `host_permissions` is the build's server and `<all_urls>`, with no `optional_host_permissions`. The store shows "Read and change all your data on all websites" and runs its in-depth review.

0.1.3 to 0.1.4 adds a required permission. Chrome disables the extension for anyone who had not already allowed all sites until they accept it on `chrome://extensions`. Force-installed copies stay on.

### Permission justification

Text for the "Host permission justification" field (D-202), in ASD-STE100 style:

```text
This extension records bug reports on the websites that the user tests.
To do this, it runs its capture scripts on those websites.
The scripts record the console messages, the network requests and the page.
The data stays in the browser until the user sends a capture.
The extension sends a capture only to the server of the user's organisation.
It sends no data to other servers. It does not sell data or show ads.
Each organisation tests different websites, so the extension needs access to all websites.
With this access, an administrator can install the extension for an organisation and the user gets no prompt.
The server administrator can limit capture to a list of project websites.
Then the extension runs its scripts only on those websites.
The extension never runs its scripts on its own server or on websites that the user blocks.
The user can turn off site access in the Chrome extension settings.
```

## Force-install for your organisation (Google Workspace)

Chrome grants required permissions to a force-installed extension, so a force-installed copy asks for nothing. In the Admin console (Devices > Chrome > Apps & extensions > Users & browsers), add `laobpjhffglefallhhojihfdbdkoendk` from the Chrome Web Store, set "Force install", and paste into "Policy for extensions":

```json
{
  "serverUrl": { "Value": "https://toolbar.teksafari.com" },
  "lockServerUrl": { "Value": true }
}
```

- `serverUrl`: the server. Order of precedence: policy, options page, build's `WXT_SERVER_URL`, `http://localhost:3000`.
- `lockServerUrl` (optional): `true` hides "Use another server" and makes the options page read-only.

The schema is `apps/extension/public/managed-schema.json`; Chrome drops values of the wrong type. `chrome://policy`, "Reload policies" applies a change at once.

The same as a Chrome policy file, for example `/etc/opt/chrome/policies/managed/open-toolbar.json` on Linux:

```json
{
  "ExtensionSettings": {
    "laobpjhffglefallhhojihfdbdkoendk": {
      "installation_mode": "force_installed",
      "update_url": "https://clients2.google.com/service/update2/crx",
      "toolbar_pin": "force_pinned"
    }
  },
  "3rdparty": {
    "extensions": {
      "laobpjhffglefallhhojihfdbdkoendk": { "serverUrl": "https://toolbar.teksafari.com", "lockServerUrl": true }
    }
  }
}
```

`"runtime_blocked_hosts": ["*://*.bank.example"]` in the `ExtensionSettings` entry keeps the extension off those sites for everyone.

## Firefox

`wxt build -b firefox --mv3` passes `web-ext lint` (0 errors, 8 warnings about `Function` and `innerHTML` in bundled code). The build drops the Chrome `key` and `minimum_chrome_version`, adds `browser_specific_settings.gecko` (id from `WXT_GECKO_ID`, default `open-toolbar@self-hosted`, Firefox 128+, data-collection consent for website activity and content) and leaves out permissions Firefox lacks.

### Sign-in

Firefox redirects to `https://<hex SHA-1 of the add-on id>.extensions.allizom.org/cb`; for `open-toolbar@self-hosted` that is `https://3f18c6a2e177ff8b2822340b2d9f8e65a8d2ce12.extensions.allizom.org/cb`. `/ext/connect` accepts it for ids in `EXTENSION_GECKO_IDS` (default `open-toolbar@self-hosted`).

API calls carry the device token, and the server treats bearer requests as same-origin (`apps/server/server.js`), so the random `moz-extension://<uuid>` origin needs no entry. Host permissions match Chrome; there is no `storage.managed_schema`. Firefox 127+ grants MV3 host permissions at install, but the user can revoke them; the popup then asks again. Managed settings use Firefox enterprise policies (`3rdparty`, `Extensions`, the add-on id) with the same keys; untested in a real Firefox.

### What works on Firefox

| Feature | Firefox | Why |
|---|---|---|
| Sign-in, popup, options, site access modes | Expected | Plain WebExtension APIs; the redirect has unit and integration tests, no real Firefox run. |
| Reviewer toolbar | Expected | In-page UI and the worker's upload path. Not run in Firefox. |
| Traces | Expected | Content scripts and `webRequest`. Not run in Firefox. |
| Screenshots | No | The editor page is left out of the Firefox build (`manifest.include` in `entrypoints/editor/index.html`). |
| Video, instant replay, recording bar | No | Needs `tabCapture`, `offscreen` and `desktopCapture`. |

### Signing

Firefox installs only signed add-ons outside `about:debugging`. An unlisted signature needs AMO API keys (`web-ext sign --channel unlisted`). The PLAN puts it in a later phase.
