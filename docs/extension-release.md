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
4. Distribution: Visibility "Unlisted". Submit for review.
5. Send testers the item's store link.

For an update, raise the version in `apps/extension/package.json`, build and upload the new `-chrome-webstore.zip` to the same item.

## Firefox

`wxt build -b firefox --mv3` builds cleanly (0 errors from `web-ext lint`; 8 warnings about `Function` and `innerHTML` in bundled code). The build drops the Chrome `key` and `minimum_chrome_version`, adds `browser_specific_settings.gecko` (id from `WXT_GECKO_ID`, default `open-toolbar@self-hosted`, Firefox 128 or later, and the data-collection consent AMO asks of new add-ons: website activity and content) and leaves out the permissions Firefox does not have.

### Sign-in

Firefox's `identity.launchWebAuthFlow` redirects to `https://<hash>.extensions.allizom.org/cb`, where the hash is the hex SHA-1 of the add-on id (Firefox's `identity.getRedirectURL`). For `open-toolbar@self-hosted` that is `https://3f18c6a2e177ff8b2822340b2d9f8e65a8d2ce12.extensions.allizom.org/cb`. `/ext/connect` accepts this form for the add-on ids in `EXTENSION_GECKO_IDS` (default `open-toolbar@self-hosted`) beside the Chrome form for `EXTENSION_IDS`. A build with another `WXT_GECKO_ID` needs that id added to the server's `EXTENSION_GECKO_IDS`.

After sign-in the extension calls the API with its device token. The server treats a request with a bearer token as same-origin (`apps/server/server.js`), so the add-on's `moz-extension://<uuid>` origin needs no entry anywhere. That origin is a random UUID per install, so it could not be listed anyway. Firefox MV3 treats `host_permissions` as optional: if the person declines the server's host permission at install, grant it in the add-on's Permissions tab.

### What works on Firefox

| Feature | Firefox | Why |
|---|---|---|
| Sign-in, popup, options, site access per project | Expected to work | Plain WebExtension APIs. The redirect is covered by unit and integration tests; no real Firefox run has been made yet. |
| Reviewer toolbar: comments, drawings, text highlights, element notes | Expected to work | In-page UI and the worker's upload path; no Chrome-only API. Not yet run in Firefox. |
| Traces (console, network, user events, DOM replay) | Expected to work | Content scripts and `webRequest`. Not yet run in Firefox. |
| Screenshots | No | Capture works, but the draft opens in the editor page, which the Firefox build leaves out (`manifest.include` in `entrypoints/editor/index.html`). |
| Video: tab, window and screen recording, instant replay, the recording bar | No | They need `tabCapture`, `offscreen` and `desktopCapture`, which Firefox lacks. |

### Signing

Firefox installs only signed add-ons, apart from temporary loading in `about:debugging`. Signing an unlisted add-on on AMO needs an AMO account and API keys (`web-ext sign --channel unlisted`). The PLAN puts a signed, unlisted Firefox add-on in a later phase.
