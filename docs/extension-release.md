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
| `dist/open-toolbar-extension-0.2.0-chrome.zip` | The Chrome build with the manifest `key` | Testers who load it unpacked: unzip, `chrome://extensions`, Developer mode, Load unpacked. Its id is the one the key pins. |
| `dist/open-toolbar-extension-0.2.0-chrome-webstore.zip` | The same build without `key` | Upload to the Chrome Web Store |
| `dist/open-toolbar-extension-0.2.0-firefox.zip` | Firefox MV3 build, see [Firefox](#firefox) | Not ready for users yet |
| `dist/SHA256SUMS` | Checksums of the zips | Anyone checking a download |

Build-time settings (all optional, [docs/configuration.md](configuration.md), "Extension build"): `WXT_SERVER_URL` (the server a fresh install points at; set it so testers only click Sign in), `WXT_APP_NAME`, `WXT_APP_ICON`, `WXT_MANIFEST_KEY`, `WXT_GECKO_ID`. `FIREFOX=0` skips the Firefox zip.

The zips list their files in sorted order with no extra file attributes, so two builds of the same commit and settings give the same file list.

## With GitHub Actions

Push a tag named after the version: `v0.2.0` or `extension-v0.2.0`. The workflow checks that the tag matches `apps/extension/package.json`, type-checks and unit-tests the extension, builds the zips, keeps them as a run artifact and attaches them to the release of that tag (it creates the release when there is none). It needs no secrets. Repository variables (Settings, Secrets and variables, Actions, Variables) pass the build settings: `WXT_SERVER_URL`, `WXT_APP_NAME`, `WXT_MANIFEST_KEY`, `WXT_GECKO_ID`.

Publishing to the Chrome Web Store stays a manual upload: the store's API needs an OAuth client and refresh token, and a review follows each upload anyway.

## The extension id and the manifest key

Chrome derives an extension's id from the public key in its manifest's `key` field. The repository's manifest carries the public half of `.secrets/extension-key.pem` (not in git), which pins the id `fmongfmimgdafigcahdpofnmmhljpnei` for every dev, test and unpacked build (D-011, D-022). The server only lets extensions whose id is in `EXTENSION_IDS` sign in (`https://<id>.chromiumapp.org/cb` is the only redirect `/ext/connect` accepts), and that id is its default.

A store item gets an id of its own, so two ids are in play once you publish. Pick one of these:

- **Allow both ids on the server.** Add the store id to `EXTENSION_IDS`: `EXTENSION_IDS=fmongfmimgdafigcahdpofnmmhljpnei,<store id>`. Unpacked and store installs then both sign in. This is the simplest.
- **Give unpacked builds the store id.** In the Developer Dashboard, open the item, Package, "View public key", and build with `WXT_MANIFEST_KEY='<that key>'` (the PEM armour and line breaks are stripped). Unpacked builds then share the store id, and `EXTENSION_IDS` needs only that id. You cannot sign a `.crx` with this key, since Google holds its private half.

## Chrome Web Store, unlisted

An unlisted item installs from its store link only and does not show in search, which suits testers (docs/scope.md, "Deliverables").

1. Register as a Chrome Web Store developer (a one-time fee) at https://chrome.google.com/webstore/devconsole.
2. New item, upload `open-toolbar-extension-<version>-chrome-webstore.zip`. The store gives the item its id now; it does not take one from a manifest `key` (an upload with one can be refused), which is why this zip has none.
3. Store listing: description, a 128 px icon, at least one 1280 by 800 screenshot. Privacy: the extension records page content (console, network, DOM, screenshots, video, audio) and sends it to the server the user signs in to; it sells nothing and serves no ads. Justify each permission (tabCapture, offscreen and desktopCapture record tab and screen video; webRequest reads request metadata; scripting and host access run the capture scripts; identity signs in).
4. Distribution: Visibility "Unlisted". Submit for review.
5. Add the item's id to `EXTENSION_IDS` on your server, or rebuild with `WXT_MANIFEST_KEY` as above.
6. Send testers the item's store link.

For an update, raise the version in `apps/extension/package.json`, build and upload the new `-chrome-webstore.zip` to the same item.

## Firefox

`wxt build -b firefox --mv3` builds cleanly (0 errors from `web-ext lint`; 8 warnings about `Function` and `innerHTML` in bundled code). The build drops the Chrome `key` and `minimum_chrome_version`, adds `browser_specific_settings.gecko` (id from `WXT_GECKO_ID`, Firefox 128 or later, and the data-collection consent AMO asks of new add-ons: website activity and content) and leaves out the permissions Firefox does not have. It is not usable for reviewers yet:

- **Sign-in fails.** Firefox's `identity.launchWebAuthFlow` redirects to `https://<hash>.extensions.allizom.org/`, and the server's `/ext/connect` accepts only `https://<id>.chromiumapp.org/cb`.
- **No video.** Tab and screen recording, instant replay and the recording bar rely on `tabCapture`, `offscreen` and `desktopCapture`, which Firefox lacks.
- **No draft editor.** The editor page is built for Chrome only (`manifest.include` in `entrypoints/editor/index.html`).
- **Unsigned.** Firefox installs only signed add-ons, apart from temporary loading in `about:debugging`. Signing an unlisted add-on on AMO needs an AMO account and API keys (`web-ext sign --channel unlisted`).

The PLAN puts a signed, unlisted Firefox add-on in a later phase; the build is here so that phase starts from a manifest that already passes the linter.
