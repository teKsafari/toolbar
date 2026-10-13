# Capture spikes (S1, S2 and three extras)

Run on 2026-10-13 against Playwright 1.63.0's Chromium (`chromium-1243`), headful on a private `Xvfb :100`, with the lab app at `http://localhost:5173` (production build, `node server.js`). The throwaway extension and the harness live in `spikes/capture/`. Raw output for each question is in `spikes/capture/evidence/`.

| # | Question | Result | Use in the product and tests |
|---|---|---|---|
| 1 | Tab video from an action click or a command | Works | Action click, command and popup all count. Tests add `--allowlisted-extension-id=<id>` and skip the gesture. |
| 2 | Screen video via `getDisplayMedia` | Works, with caveats | Offscreen document, as the architecture says. Tests use fake UI plus fake device. |
| 3 | MAIN world hooks at `document_start` | Works | As designed. Page code may wrap `fetch` again on top of ours. |
| 4 | Closed shadow root UI | Works, with caveats | Needs `:host { all: initial !important }`. Tests use an open-root build, plus one CDP smoke test on the release build. |
| 5 | `captureVisibleTab` crop with DPR | Works | Take the scale from the bitmap, scroll the element into view, floor the start and ceil the end. |

## How to run

```sh
nix profile add nixpkgs#xorg.xvfb nixpkgs#openbox nixpkgs#ffmpeg-headless   # xdotool and imagemagick are already here
spikes/capture/run/xvfb.sh start           # Xvfb :100 + openbox; never :99
cd spikes/capture && npm i                 # playwright 1.63.0
node run/q1.mjs                            # ALLOWLIST=1 node run/q1.mjs for the flag variant
node run/q2.mjs offscreen                  # PICK="903,256;600,350;963,657" to click through the picker
node run/q2.mjs window auto | offscreen fakeboth | desktop
node run/q3.mjs; node run/q4.mjs; node run/q5.mjs
```

`run/launch.mjs` is the fixture. Points worth copying into `tests/e2e`:

- The manifest carries a `key`, so the extension id is fixed (`kbadilafkmgcdhpkbkhkihmihjpemhpp` here).
- Writing `Default/Preferences` with `{"extensions":{"pinned_extensions":["<id>"]}}` into the fresh profile before launch pins the action. The icon then sits in the toolbar at a stable spot (x 1127 to 1131, y 63 on a 1280x800 window at 0,0). Without the pin it hides in the puzzle menu.
- `viewport: null` keeps the page size equal to the real window, so screen coordinates match.
- The harness finds the icon by its color in a root-window screenshot (`findIcon()`), so a moved toolbar does not break it.
- The VM ran at load 17 on 8 vCPUs during these runs. Fixed sleeps were flaky. `waitLog()` polls the extension's log instead.

## 1. Tab video (S1)

| Trigger | `getMediaStreamId({ targetTabId })` |
|---|---|
| `serviceWorker.evaluate()` from Playwright (no gesture) | Fails: "Extension has not been invoked for the current page (see activeTab permission)" |
| Playwright click on an extension page opened as a tab (`isTrusted: true`) | Fails with the same error. The click invokes the extension on its own tab, and the lab tab gets nothing. |
| xdotool click on the pinned action icon on :100 | Works |
| xdotool `alt+shift+y` (a `commands` shortcut) on a tab the extension never touched | Works |
| No gesture, Chromium started with `--allowlisted-extension-id=<id>` | Works |

ffprobe of the 5 s recordings (`evidence/q1.txt`, `evidence/q1-allowlist-flag.txt`):

```
action click  stream|codec_name=vp9|codec_type=video|width=1270|height=708|nb_read_frames=107
              stream|codec_name=opus|codec_type=audio|nb_read_frames=73
              format|format_name=matroska,webm|duration=N/A|size=86406   last video pts 4.994
command       vp9 1270x708, 136 frames, opus, last video pts 4.961
allowlisted   vp9 1278x712, 120 frames, opus (no gesture at all)
```

Working code. Service worker:

```js
chrome.action.onClicked.addListener((tab) => recordTab(tab.id));
chrome.commands.onCommand.addListener((cmd, tab) => cmd === 'record-tab' && recordTab(tab.id));

async function recordTab(tabId) {
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  const tab = await chrome.tabs.get(tabId);
  const [{ result: dpr }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => devicePixelRatio });
  if (!(await chrome.offscreen.hasDocument()))
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'], justification: '…' });
  return chrome.runtime.sendMessage({ to: 'offscreen', type: 'record-tab', streamId,
    w: Math.round(tab.width * dpr), h: Math.round(tab.height * dpr) });
}
```

Offscreen document:

```js
const stream = await navigator.mediaDevices.getUserMedia({
  audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
  video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxFrameRate: 30,
                        minWidth: w, maxWidth: w, minHeight: h, maxHeight: h } },
});
const ctx = new AudioContext();                       // tab capture mutes the tab; play it back
ctx.createMediaStreamSource(stream).connect(ctx.destination);
const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9,opus' });
```

Findings:

- **The size constraints matter.** Without them Chrome letterboxes the tab into a screen-sized frame (1440x900 with black bars). With them the video matches the viewport in device pixels.
- **MediaRecorder WebM has no duration** (`duration=N/A`). `ffmpeg -i in.webm -c copy out.webm` fixes it (5.057 s after remux). The server's finalize step already remuxes, so add nothing.
- **Tab capture is variable frame rate.** A static page gave 5 frames in 5 s. The viewer must not assume a constant rate.
- **Keyboard commands go to the focused window.** `xdotool windowfocus --sync <win>` then `xdotool key --clearmodifiers alt+shift+y` worked on bare Xvfb and under openbox.
- **S1 answer:** a Playwright click cannot stand in for the invocation, and `--allowlisted-extension-id=<id>` removes the need for one. Recommended split: most video tests launch with the allowlist flag and start recording through `__tb` hooks. One headed smoke test on :100 clicks the real action icon with xdotool, and one sends the shortcut, so the gesture path stays covered. Never ship the flag; it is a Chromium command-line switch only.

## 2. Screen video (S2)

| Variant | Result |
|---|---|
| `getDisplayMedia({ video: true })` in the offscreen document, called from the service worker with no gesture | Picker opens. xdotool picks "Entire Screen", the thumbnail, then Share. 1440x900 VP9 recorded (`evidence/q2-offscreen-picker.txt`). Passed 4 of 6 runs; the other 2 crashed (below). |
| Same, with `--auto-select-desktop-capture-source="Entire screen"` | Browser crashes every time (0 of 4): X `BadWindow` in `X_GetProperty` |
| `getDisplayMedia` in an extension page tab (`screen.html`) after a Playwright click, with the auto-select flag | Works 5 of 5, no picker, 1440x900 |
| Offscreen, `--use-fake-ui-for-media-stream` alone | `NotReadableError: Could not start video source` |
| Offscreen, `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` | Works, no picker, synthetic 1440x810 test pattern |
| `chrome.desktopCapture.chooseDesktopMedia(['screen','window','tab'], cb)` from the service worker without `targetTab` | Returns an empty id at once, no picker |

The picker is Chromium's own share dialog in a separate top-level window titled "Choose what to share with <extension name>", centered over the browser. It has three tabs: Chromium Tab, Window, Entire Screen. Screenshots: `evidence/q2-picker-tab.png`, `evidence/q2-picker-entire-screen.png`. With a 1280x800 window at 0,0 the click targets were Entire Screen (903,256), the screen thumbnail (600,350) and Share (963,657). These shift if the window size changes, so a real test should locate them from a screenshot the way `findIcon()` does.

Caveats:

- **Xvfb needs a window manager.** Without one Chromium died with X `BadAtom` as soon as the picker enumerated windows. `run/xvfb.sh` starts openbox next to Xvfb.
- **The real picker crashes Chromium now and then on Xvfb** (`BadWindow`, 2 of 6 runs). Treat picker-driven tests as smoke tests with a retry.
- **The offscreen document needs no gesture for `getDisplayMedia`.** The picker opened from a plain `serviceWorker.evaluate()`. The user still has to choose a source, which is the consent step.

Recommendation: keep the architecture's plan. Production calls `getDisplayMedia` in the offscreen document (reason `DISPLAY_MEDIA`), and the extension-window fallback is not needed. CI runs screen tests in the offscreen document with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`. One headed smoke test on :100 drives the real picker with xdotool and retries once on a crash.

## 3. MAIN world hooks at document_start

Manifest entry (static here; the product's `registerContentScripts` path with the same `world` and `runAt` was not tested):

```json
{ "matches": ["http://localhost/*"], "js": ["main.js"], "run_at": "document_start", "world": "MAIN" }
```

Boot record taken as the first statement of `main.js`, on a reload of the lab (`evidence/q3.txt`):

```
{"kind":"boot","readyState":"loading","scriptsInDom":0,"htmlChildren":0,"resourcesFetched":14,"sveltekitGlobals":[]}
```

The lab's first script is an inline `<script>` that sets `__sveltekit_14z8af2`. At hook time the document has no elements and that global does not exist, so no page script has run. `resourcesFetched: 14` comes from the preload scanner and HTTP link preloads; fetched is not executed.

Events relayed to the isolated world, in order, after clicking "Log at every level" and then "Submit order (hidden 500)":

```
console log      ["log: plain string",42,true]
console info     ["info: object",{"user":{"id":7,"roles":["admin","editor"]},"at":{"$date":"…"}}]
console warn     ["warn: deprecated call",["a","b","c"]]
console error    ["error: with stack",{"$error":"Error","message":"lab error object","stack":"Error: lab error object\n    at H…"}]
console debug, table, group, log (inside group), groupEnd, trace, assert, count x2, time, timeEnd
net.request      POST http://localhost:5173/api/fail
net.response     status 500, ok false
net.body         {"error":"database_unavailable","detail":"connection refused to db:5432","requestId":"7f51…"}
```

Bridge, as in architecture section 10:

```js
// main.js (MAIN): offer a port now, and again whenever the isolated world says it is ready
const offerPort = () => {
  const ch = new MessageChannel();
  window.postMessage({ __tb: 'hello' }, '*', [ch.port2]);
  ch.port1.onmessage = (e) => { if (e.data === 'ack' && !port) { port = ch.port1; buffer.splice(0).forEach((ev) => port.postMessage(ev)); } };
};
addEventListener('message', (e) => { if (e.source === window && e.data?.__tb === 'ready' && !port) offerPort(); });
offerPort();

// isolated.js (ISOLATED): take the port in the capture phase, hide the message from the page
addEventListener('message', (e) => {
  if (e.source !== window || e.data?.__tb !== 'hello' || !e.ports[0]) return;
  e.stopImmediatePropagation();
  e.ports[0].onmessage = (m) => bg.postMessage(m.data);   // bg = chrome.runtime.connect({ name: 'capture' })
  e.ports[0].postMessage('ack');
}, true);
postMessage({ __tb: 'ready' }, '*');
```

Findings:

- In both runs the MAIN script started a few milliseconds before the isolated one (197 ms against 202 ms). Chrome does not promise that order, and the handshake above works either way.
- **SvelteKit wraps `fetch` on top of ours.** After load, `window.fetch.toString()` is SvelteKit's arrow function, and SvelteKit's wrapper calls the `fetch` it saw at startup, which is ours. Capture still works. Never check `window.fetch === ourWrapper` to decide whether hooks are live.
- `console.log.toString()` still reads `function log() { [native code] }` after wrapping.

## 4. Closed shadow root UI

Hostile page CSS injected after mount (`evidence/q4.txt`):

```css
body { color: red !important; font-family: monospace !important; letter-spacing: 5px !important; }
* { color: red !important; }
button { background: lime !important; font-size: 40px !important; }
toolbar-root, toolbar-noreset { display: none !important; }
#tb-btn, .txt { background: blue !important; }
```

Two hosts were mounted on `document.documentElement`: `toolbar-root` with a reset, `toolbar-noreset` without one. Computed styles read from inside the shadow root:

| | `toolbar-root` (reset) | `toolbar-noreset` |
|---|---|---|
| Host `display` | `block` | `none` (page hid it) |
| Inner `button` background, font size | ours (`rgb(228,87,46)`, 13px) | ours |
| Inner text `color` (inherited) | `rgb(0,0,0)` | `rgb(255,0,0)`, inherited from the page's `*` rule on the host |

The page's selectors never match nodes inside the shadow root. Two things still leak: rules that hit the host element itself, and inherited properties. Both are closed by this rule in the shadow stylesheet. Inner `!important` beats the page's outer `!important` on the host:

```css
:host { all: initial !important; display: block !important; position: fixed !important;
        bottom: 16px !important; right: 16px !important; z-index: 2147483647 !important; }
```

Position goes in `:host`, since `all: initial !important` also wipes the inline `style` on the host. Mounting on `<html>` instead of `<body>` keeps the host out of `body` inheritance. When the real UI moves to WXT's `createShadowRootUi`, check that its host reset carries `!important`, and add the rule above if it does not.

Driving it from Playwright:

- Release build: `document.querySelector('toolbar-root').shadowRoot` is `null`, and `page.locator('toolbar-root #tb-btn')` finds 0 elements.
- **Open-root test build** (`flags.js` sets `shadowMode: 'open'`; in WXT, `mode: import.meta.env.WXT_TEST_HOOKS ? 'open' : 'closed'`): the locator finds the button and `click()` works.
- **CDP still reaches closed roots.** This drives the release build with no flag:

```js
const cdp = await context.newCDPSession(page);
const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
// walk root.children to the TOOLBAR-ROOT node; host.shadowRoots[0].shadowRootType === 'closed'
const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: host.shadowRoots[0].nodeId, selector: '#tb-btn' });
const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
await page.mouse.click((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
// the extension logged: ui click toolbar-root {"isTrusted":true}
```

Recommendation: use the open-root test build for everyday UI tests. Keep one release-build smoke test that asserts `shadowRoot === null` and then clicks the toolbar through CDP, so the shipped build gets exercised as well.

## 5. captureVisibleTab and crop

Service worker, no gesture needed with `<all_urls>` host permission (called from `serviceWorker.evaluate()`):

```js
const [{ result: m }] = await chrome.scripting.executeScript({ target: { tabId }, func: async (sel) => {
  const el = document.querySelector(sel);
  el.scrollIntoView({ block: 'center', inline: 'center' });            // only the viewport is captured
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, iw: innerWidth };
}, args: [selector] });
const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
const scale = bmp.width / m.iw;                                         // = DPR x page zoom
const sx = Math.floor(m.x * scale), sy = Math.floor(m.y * scale);
const sw = Math.min(bmp.width, Math.ceil((m.x + m.w) * scale)) - sx;
const sh = Math.min(bmp.height, Math.ceil((m.y + m.h) * scale)) - sy;
const canvas = new OffscreenCanvas(sw, sh);
canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
const png = await canvas.convertToBlob({ type: 'image/png' });
```

Results on the "Submit order (hidden 500)" button, compared with Playwright's `locator.screenshot()` (`evidence/q5.txt`):

| Case | Bitmap | Scale | Crop | Playwright shot | Differing pixels |
|---|---|---|---|---|---|
| `--force-device-scale-factor=1` | 1272x709 | 1 | 228x40 | 228x40 | 0 |
| `--force-device-scale-factor=2` | 1424x718 | 2 | 454x77 | 454x78 | 0 against Playwright's shot shifted down one row |
| DPR 1, `chrome.tabs.setZoom(tab, 1.5)` | 1272x709 | 1.5 | 341x59 | 227x39 (Playwright ignores zoom) | n/a |

Findings:

- **Take the scale from `bitmap.width / innerWidth`.** Under page zoom the page's `devicePixelRatio` reads 1.5 while the window is at DPR 1. The bitmap ratio covers both cases.
- **Floor the start and ceil the end.** Rounding both edges lost a pixel row and column against Playwright at DPR 1.
- **Scroll first.** At DPR 2 the viewport was 712x359 CSS px, and the button sat partly below it. The first crop came out 63 px tall instead of 77.
- Chrome documents a limit of two `captureVisibleTab` calls per second. These runs did not hit it; queue screenshots behind it anyway.
