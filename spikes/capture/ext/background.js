importScripts('idb.js');

// ---- log kept in storage.session so the test harness can read it ----
const logLines = [];
function log(...args) {
  const line = `${new Date().toISOString()} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
  console.log(line);
  logLines.push(line);
  chrome.storage.session.set({ log: logLines });
}

// ---- offscreen document ----
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'],
    justification: 'Record tab and screen video with MediaRecorder',
  });
}
async function toOffscreen(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ to: 'offscreen', ...msg });
}

// ---- Q1: tab video ----
async function recordTab(tabId, via, ms = 5000) {
  log('recordTab', via, 'tab', tabId);
  let streamId;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    log('getMediaStreamId ok', via);
  } catch (e) {
    log('getMediaStreamId FAILED', via, e.message);
    return { ok: false, error: e.message };
  }
  // Without size constraints Chrome letterboxes the tab into a screen-sized frame.
  const tab = await chrome.tabs.get(tabId);
  const [{ result: dpr }] = await chrome.scripting.executeScript({ target: { tabId }, func: () => devicePixelRatio });
  const size = { w: Math.round(tab.width * dpr), h: Math.round(tab.height * dpr) };
  const res = await toOffscreen({ type: 'record-tab', streamId, ms, name: `tab-${via}.webm`, ...size });
  log('record-tab result', via, res);
  return res;
}

chrome.action.onClicked.addListener((tab) => recordTab(tab.id, 'action'));
chrome.commands.onCommand.addListener((cmd, tab) => {
  log('command', cmd, tab?.id);
  if (cmd === 'record-tab') recordTab(tab.id, 'command');
});

// ---- Q2: screen video ----
// a) getDisplayMedia inside the offscreen document
async function screenViaOffscreenGDM(ms = 3000) {
  const res = await toOffscreen({ type: 'record-screen-gdm', ms, name: 'screen-offscreen-gdm.webm' });
  log('screen offscreen gDM', res);
  return res;
}
// b) chrome.desktopCapture picker from the service worker, stream used in the offscreen document
async function screenViaDesktopCapture(ms = 3000, sources = ['screen', 'window', 'tab']) {
  const streamId = await new Promise((resolve) => chrome.desktopCapture.chooseDesktopMedia(sources, (id, opts) => resolve({ id, opts })));
  log('chooseDesktopMedia returned', streamId);
  if (!streamId.id) return { ok: false, error: 'cancelled' };
  const res = await toOffscreen({ type: 'record-desktop', streamId: streamId.id, ms, name: 'screen-desktopcapture.webm' });
  log('screen desktopCapture', res);
  return res;
}

// ---- Q5: captureVisibleTab + crop ----
async function cropElement(tabId, selector, name) {
  const tab = await chrome.tabs.get(tabId);
  const [{ result: m }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (sel) => {
      const el = document.querySelector(sel);
      // captureVisibleTab only sees the viewport: bring the element in first.
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight };
    },
    args: [selector],
  });
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  // Scale from the bitmap itself: it equals devicePixelRatio, and also covers page zoom.
  const scale = bmp.width / m.iw;
  // Grow to whole device pixels (floor the start, ceil the end) so antialiased edges stay in.
  const sx = Math.floor(m.x * scale), sy = Math.floor(m.y * scale);
  const sw = Math.min(bmp.width, Math.ceil((m.x + m.w) * scale)) - sx;
  const sh = Math.min(bmp.height, Math.ceil((m.y + m.h) * scale)) - sy;
  const canvas = new OffscreenCanvas(sw, sh);
  canvas.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  await idbPut(name, png);
  await idbPut(`full-${name}`, await (await fetch(dataUrl)).blob());
  const info = { name, rect: m, bitmap: [bmp.width, bmp.height], scale, crop: [sx, sy, sw, sh], bytes: png.size };
  log('crop', info);
  return info;
}

// ---- capture events relayed from the isolated content script ----
const events = [];
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'capture') return;
  port.onMessage.addListener((msg) => {
    events.push(msg);
    chrome.storage.session.set({ events });
  });
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.to === 'bg-log') log(...msg.args);
});

// ---- hooks for the test harness (called with serviceWorker.evaluate) ----
globalThis.__spike = {
  recordTab,
  screenViaOffscreenGDM,
  screenViaDesktopCapture,
  cropElement,
  getLog: () => logLines,
  getEvents: () => events,
  clearEvents: () => { events.length = 0; },
  async readFile(name) {
    const blob = await idbGet(name);
    if (!blob) return null;
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  },
};
log('service worker started');
