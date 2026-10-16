#!/bin/bash
# Chromium (Playwright 1.63.0 build) on :262; $1 = profile name, $2 = "noext" to run without the extension
PROFILE=/home/dev/nuru-exp/${1:-profile}
mkdir -p $PROFILE/Default
[ -f $PROFILE/Default/Preferences ] || echo '{"extensions":{"pinned_extensions":["fmongfmimgdafigcahdpofnmmhljpnei"]}}' > $PROFILE/Default/Preferences
EXT=/home/dev/nuru-exp/ext
EXTARGS="--disable-extensions-except=$EXT --load-extension=$EXT"
[ "$2" = noext ] && EXTARGS="--disable-extensions"
DISPLAY=:262 nohup ~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
  --user-data-dir=$PROFILE --no-first-run --no-default-browser-check $EXTARGS \
  --window-position=0,0 --window-size=1280,800 --force-device-scale-factor=1 \
  --remote-debugging-port=9462 --test-type --disable-features=Translate,TranslateUI --disable-infobars \
  --enable-logging=stderr --v=0 about:blank >/home/dev/nuru-exp/chrome.log 2>&1 &
echo $! > /home/dev/nuru-exp/chrome.pid
