# Releasing the browser extension

`scripts/release-extension.sh` builds the release zips into `dist/`. The GitHub Actions workflow `.github/workflows/extension-release.yml` runs the same script when you push a version tag and attaches the zips to the GitHub release.

## Build a release

1. Set the version in `apps/extension/package.json` (WXT copies it into the manifest). Chrome wants one to four dot-separated numbers, such as `0.2.0`.
2. Build:

```sh
WXT_SERVER_URL=https://feedback.example.com scripts/release-extension.sh
```

For version `0.2.0` you get:

| File | What it is | Who uses it |
|---|---|---|
| `dist/open-toolbar-extension-0.2.0-chrome.zip` | The Chrome build with the manifest `key` | Testers who load it unpacked: unzip, `chrome://extensions`, Developer mode, Load unpacked. It has the store item's id. |
| `dist/open-toolbar-extension-0.2.0-chrome-webstore.zip` | The same build without `key` | Upload to the Chrome Web Store |
| `dist/open-toolbar-extension-0.2.0-firefox.zip` | Firefox MV3 build, see [Firefox](#firefox) | Not ready for users yet |
| `dist/SHA256SUMS` | Checksums of the zips | Anyone checking a download |

Build-time settings (all optional, [docs/configuration.md](configuration.md), "Extension build"): `WXT_SERVER_URL` (the server a fresh install points at; set it so testers only click Sign in), `WXT_APP_NAME`, `WXT_APP_ICON`, `WXT_MANIFEST_KEY` (a fork's own store key), `WXT_GECKO_ID`. `FIREFOX=0` skips the Firefox zip.

The zips list their files in sorted order with no extra file attributes, so two builds of the same commit and settings give the same file list.

## With GitHub Actions

Push a tag named after the version: `v0.2.0` or `extension-v0.2.0`. The workflow checks that the tag matches `apps/extension/package.json`, type-checks and unit-tests the extension, builds the zips, keeps them as a run artifact and attaches them to the release of that tag (it creates the release when there is none). It needs no secrets. Repository variables (Settings, Secrets and variables, Actions, Variables) pass the build settings: `WXT_SERVER_URL`, `WXT_APP_NAME`, `WXT_MANIFEST_KEY`, `WXT_GECKO_ID`.

Publishing to the Chrome Web Store stays a manual upload: the store's API needs an OAuth client and refresh token, and a review follows each upload anyway.

## The extension id and the manifest key

The extension is published in the Chrome Web Store as item `laobpjhffglefallhhojihfdbdkoendk`. Google holds the item's signing key. The repository carries only its public half, in the manifest's `key` field (`MANIFEST_KEY` in `apps/extension/wxt.config.ts`), and Chrome derives an extension's id from that key. Dev, test and unpacked builds therefore have the store id too (D-196).

The server only lets extensions whose id is in `EXTENSION_IDS` sign in (`https://<id>.chromiumapp.org/cb` is the only redirect `/ext/connect` accepts), and the store id is its default. A store install and an unpacked build sign in to the same server with no setting.

You cannot sign a `.crx` yourself, since nobody outside Google has the private key. Testers load the unpacked zip or install from the store.

A fork that publishes its own store item builds with `WXT_MANIFEST_KEY='<that item's public key>'` (Developer Dashboard, the item, Package, "View public key"; the PEM armour and line breaks are stripped) and sets `EXTENSION_IDS` to that item's id.

## Chrome Web Store, unlisted

An unlisted item installs from its store link only and does not show in search, which suits testers (docs/scope.md, "Deliverables").

1. Open the item in the Developer Dashboard at https://chrome.google.com/webstore/devconsole.
2. Package, upload `open-toolbar-extension-<version>-chrome-webstore.zip`. The store keeps the item's id; an upload whose manifest carries a `key` can be refused, which is why this zip has none.
3. Store listing: description, a 128 px icon, at least one 1280 by 800 screenshot. Privacy: the extension records page content (console, network, DOM, screenshots, video, audio) and sends it to the server the user signs in to; it sells nothing and serves no ads. The privacy policy is the server's `/privacy` page. Justify each permission (tabCapture, offscreen and desktopCapture record tab and screen video; webRequest reads request metadata; scripting and host access run the capture scripts; identity signs in).

   Since 0.1.4 (D-202) the manifest holds every site as a required host permission: `host_permissions` is the build's server and `<all_urls>`, and there is no `optional_host_permissions`. The store shows the warning "Read and change all your data on all websites" at install, and the item gets the store's in-depth review for broad host access, which can take longer. Paste the text in [Permission justification](#permission-justification) into the "Host permission justification" field.
4. Distribution: Visibility "Unlisted". Submit for review.
5. Send testers the item's store link.

For an update, raise the version in `apps/extension/package.json`, build and upload the new `-chrome-webstore.zip` to the same item.

The update from 0.1.3 to 0.1.4 adds a required permission. Chrome compares the install warnings of the two versions. A person who clicked Allow for all sites in 0.1.3 already accepted the same warning. Expect Chrome to turn the extension off for a person who did not, until they accept the new permission on `chrome://extensions`. A force-installed copy is never turned off.

### Permission justification

Text for the Developer Dashboard, Privacy, "Host permission justification" (D-202). It follows ASD-STE100 style: short sentences, active voice, simple words.

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

A Google Workspace admin can install the extension for a whole organisation. People then get it with no prompt: Chrome grants required permissions to a force-installed extension, and every site is a required permission since 0.1.4 (D-202). A policy cannot grant optional permissions, which is why the earlier "ask once" screen is gone.

1. Sign in to the Admin console at https://admin.google.com as an admin.
2. Go to Devices > Chrome > Apps & extensions > Users & browsers.
3. Select the organisational unit (or group) on the left.
4. Click the add button (+) at the bottom right, then "Add Chrome app or extension by ID".
5. Enter `laobpjhffglefallhhojihfdbdkoendk`, keep "From the Chrome Web Store", and click Save. An unlisted item can be added by its id.
6. Set the installation policy to "Force install + pin to browser toolbar" (or "Force install").
7. In the panel on the right, paste this into "Policy for extensions" and click Save:

```json
{
  "serverUrl": { "Value": "https://toolbar.teksafari.com" },
  "lockServerUrl": { "Value": true }
}
```

The Admin console wants each setting wrapped in `{"Value": ...}`. `serverUrl` is the server people sign in to; it wins over the address typed on the options page and over the build's `WXT_SERVER_URL` (order: policy, options page, build, `http://localhost:3000`). `lockServerUrl` is optional: `true` hides "Use another server" in the popup and makes the options page read-only. The extension declares both keys in its managed storage schema (`apps/extension/public/managed-schema.json`), and Chrome drops values of the wrong type.

What people see after the next policy refresh (Chrome fetches policy at start and about every three hours; `chrome://policy`, "Reload policies" forces it):

- The extension is installed and pinned in the toolbar. They cannot remove or turn it off.
- The popup says "Sign in to start capturing" and names your server. They click Sign in once and sign in with their Google account through your server's OIDC sign-in.
- After that, nothing more is asked. In the default site access mode the extension records on every site except your server and their blocked sites. In the strict mode (Settings > Server, Site access) it records on your projects' sites only, and the popup says so on other sites.

Without the Admin console, the same policies go in a Chrome policy file, for example `/etc/opt/chrome/policies/managed/open-toolbar.json` on Linux:

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

To keep the extension off some sites for everyone, add `"runtime_blocked_hosts": ["*://*.bank.example"]` to the extension's `ExtensionSettings` entry. The reviewer's own blocked sites list (popup, Settings) does the same per person.

## Firefox

`wxt build -b firefox --mv3` builds cleanly (0 errors from `web-ext lint`; 8 warnings about `Function` and `innerHTML` in bundled code). The build drops the Chrome `key` and `minimum_chrome_version`, adds `browser_specific_settings.gecko` (id from `WXT_GECKO_ID`, default `open-toolbar@self-hosted`, Firefox 128 or later, and the data-collection consent AMO asks of new add-ons: website activity and content) and leaves out the permissions Firefox does not have.

### Sign-in

Firefox's `identity.launchWebAuthFlow` redirects to `https://<hash>.extensions.allizom.org/cb`, where the hash is the hex SHA-1 of the add-on id (Firefox's `identity.getRedirectURL`). For `open-toolbar@self-hosted` that is `https://3f18c6a2e177ff8b2822340b2d9f8e65a8d2ce12.extensions.allizom.org/cb`. `/ext/connect` accepts this form for the add-on ids in `EXTENSION_GECKO_IDS` (default `open-toolbar@self-hosted`) beside the Chrome form for `EXTENSION_IDS`. A build with another `WXT_GECKO_ID` needs that id added to the server's `EXTENSION_GECKO_IDS`.

After sign-in the extension calls the API with its device token. The server treats a request with a bearer token as same-origin (`apps/server/server.js`), so the add-on's `moz-extension://<uuid>` origin needs no entry anywhere. That origin is a random UUID per install, so it could not be listed anyway. The Firefox build has the same `host_permissions` as Chrome (the server and `<all_urls>`, D-202) and no `storage.managed_schema`, which Firefox does not use. Firefox 127 and later list MV3 host permissions at install and grant them by default, but the person can turn them off in the add-on's Permissions tab; the popup then shows "Site access is off" and its Allow asks again. Managed settings come from Firefox's enterprise policies (`3rdparty`, `Extensions`, the add-on id) with the same `serverUrl` and `lockServerUrl` keys; this has not been tried in a real Firefox.

### What works on Firefox

| Feature | Firefox | Why |
|---|---|---|
| Sign-in, popup, options, site access modes | Expected to work | Plain WebExtension APIs. The redirect is covered by unit and integration tests; no real Firefox run has been made yet. |
| Reviewer toolbar: comments, drawings, text highlights, element notes | Expected to work | In-page UI and the worker's upload path; no Chrome-only API. Not yet run in Firefox. |
| Traces (console, network, user events, DOM replay) | Expected to work | Content scripts and `webRequest`. Not yet run in Firefox. |
| Screenshots | No | Capture works, but the draft opens in the editor page, which the Firefox build leaves out (`manifest.include` in `entrypoints/editor/index.html`). |
| Video: tab, window and screen recording, instant replay, the recording bar | No | They need `tabCapture`, `offscreen` and `desktopCapture`, which Firefox lacks. |

### Signing

Firefox installs only signed add-ons, apart from temporary loading in `about:debugging`. Signing an unlisted add-on on AMO needs an AMO account and API keys (`web-ext sign --channel unlisted`). The PLAN puts a signed, unlisted Firefox add-on in a later phase.
