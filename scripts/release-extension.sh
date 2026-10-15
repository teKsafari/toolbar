#!/usr/bin/env bash
# Builds the browser extension release into dist/ (docs/extension-release.md).
#
#   scripts/release-extension.sh            # version from apps/extension/package.json
#   FIREFOX=0 scripts/release-extension.sh  # Chrome only
#
# Writes, for version V:
#   dist/open-toolbar-extension-V-chrome.zip            unpacked build with the manifest key: unzip and
#                                                       "Load unpacked"; the id stays pinned
#   dist/open-toolbar-extension-V-chrome-webstore.zip   the same build without the key, for the
#                                                       Chrome Web Store (unlisted item)
#   dist/open-toolbar-extension-V-firefox.zip           Firefox MV3 build (recording is Chrome-only)
#   dist/SHA256SUMS
#
# Build-time settings pass through: WXT_SERVER_URL, WXT_APP_NAME, WXT_APP_ICON, WXT_MANIFEST_KEY,
# WXT_GECKO_ID (docs/configuration.md, "Extension build").
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
ext="$root/apps/extension"
out="$root/dist"
command -v zip >/dev/null || { echo "zip is not installed" >&2; exit 1; }

version=$(node -p "require('$ext/package.json').version")
name=open-toolbar-extension-$version
if [ -n "${RELEASE_TAG:-}" ]; then
  # a tag v1.2.3 or extension-v1.2.3 must match package.json, so the zip and the manifest agree
  tag_version=${RELEASE_TAG#extension-}
  tag_version=${tag_version#v}
  [ "$tag_version" = "$version" ] || { echo "tag $RELEASE_TAG does not match apps/extension/package.json version $version" >&2; exit 1; }
fi

mkdir -p "$out"
rm -f "$out/$name"-*.zip "$out/SHA256SUMS"

# zip a folder's contents (not the folder) with stable ordering
zipdir() { (cd "$1" && find . -type f | LC_ALL=C sort | sed 's#^\./##' | zip -q -X -@ "$2"); }

echo "[release] chrome $version"
(cd "$ext" && pnpm exec wxt build -b chrome >/dev/null)
chrome="$ext/.output/chrome-mv3"
[ "$(node -p "require('$chrome/manifest.json').version")" = "$version" ] || { echo "manifest version differs from package.json" >&2; exit 1; }
zipdir "$chrome" "$out/$name-chrome.zip"

# The Chrome Web Store gives the item an id of its own and does not take one from a manifest
# "key" (an upload that carries one can be refused), so the store zip leaves it out
# (docs/extension-release.md, "Chrome Web Store").
store=$(mktemp -d)
trap 'rm -rf "$store"' EXIT
cp -R "$chrome/." "$store/"
node -e "
const fs = require('node:fs'); const f = process.argv[1];
const m = JSON.parse(fs.readFileSync(f, 'utf8')); delete m.key;
fs.writeFileSync(f, JSON.stringify(m, null, 2));
" "$store/manifest.json"
zipdir "$store" "$out/$name-chrome-webstore.zip"

if [ "${FIREFOX:-1}" = 1 ]; then
  echo "[release] firefox $version"
  (cd "$ext" && pnpm exec wxt build -b firefox --mv3 >/dev/null)
  zipdir "$ext/.output/firefox-mv3" "$out/$name-firefox.zip"
fi

(cd "$out" && sha256sum "$name"-*.zip > SHA256SUMS)
echo "[release] wrote:"
(cd "$out" && ls -l "$name"-*.zip SHA256SUMS | awk '{print "  dist/" $NF "  " $5 " bytes"}')
