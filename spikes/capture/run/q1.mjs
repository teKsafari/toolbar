// Q1 / S1: which gestures let chrome.tabCapture.getMediaStreamId work, and record 5 s of WebM.
const animate = (page) =>
  page.evaluate(() => {
    // A ticking clock so the tab produces frames for the whole recording.
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;top:0;right:0;font:32px monospace;background:#ff0;z-index:1';
    document.body.append(d);
    const tick = () => { d.textContent = (performance.now() / 1000).toFixed(2); requestAnimationFrame(tick); };
    tick();
  });
import { launch, x, shot, sleep, saveFile, ffprobe, getLog, findIcon, lastPts, waitLog, EXT_ID } from './launch.mjs';

const extraArgs = process.env.ALLOWLIST ? [`--allowlisted-extension-id=${EXT_ID}`] : [];
const { context, sw } = await launch({ args: extraArgs });
const page = context.pages()[0] ?? (await context.newPage());
await page.goto('http://localhost:5173/');
await animate(page);
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
console.log('lab tab', tabId, 'extra args', extraArgs);

// A. No gesture: service worker call from the harness.
console.log('A no gesture:', JSON.stringify(await sw.evaluate((id) => globalThis.__spike.recordTab(id, 'no-gesture', 5000), tabId)));
const a = await saveFile(sw, 'tab-no-gesture.webm');
if (a) console.log('A ffprobe', ffprobe(a));
if (process.env.ALLOWLIST) { console.log((await getLog(sw)).join('\n')); await context.close(); process.exit(0); }

// B. Playwright click on an extension page opened in a tab (S1 as written in the architecture).
const trig = await context.newPage();
await trig.goto(`chrome-extension://${EXT_ID}/trigger.html?tab=${tabId}`);
await trig.click('#go');
await sleep(500);
console.log('B extension page click:', await trig.textContent('#out'));
await trig.close();
await page.bringToFront();
await sleep(500);

// C. xdotool click on the pinned action icon.
const icon = findIcon();
console.log('C icon at', icon);
x('mousemove', String(icon.x), String(icon.y), 'click', '1');
await waitLog(sw, /getMediaStreamId ok action/);
await sleep(2000);
shot('q1-during-action-recording.png');
await waitLog(sw, /record-tab result action/);
const c = await saveFile(sw, 'tab-action.webm');
console.log('C saved', c, '\nC ffprobe', c && ffprobe(c), '\nC last video pts', c && lastPts(c));

// D. Keyboard command Alt+Shift+Y sent with xdotool to the focused Chromium window.
const page2 = await context.newPage(); // a new tab the extension was never invoked on
await page2.goto('http://localhost:5173/list');
await animate(page2);
await sleep(1000);
const win = x('search', '--onlyvisible', '--class', 'chromium').split('\n').pop();
x('windowfocus', '--sync', win);
x('key', '--clearmodifiers', 'alt+shift+y');
await waitLog(sw, /record-tab result command/);
const d = await saveFile(sw, 'tab-command.webm');
console.log('D saved', d, '\nD ffprobe', d && ffprobe(d), '\nD last video pts', d && lastPts(d));

console.log('--- extension log ---\n' + (await getLog(sw)).join('\n'));
await context.close();
