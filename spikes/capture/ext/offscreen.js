chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.to !== 'offscreen') return;
  handle(msg).then(sendResponse, (e) => sendResponse({ ok: false, error: `${e.name}: ${e.message}` }));
  return true;
});

async function handle(msg) {
  if (msg.type === 'record-tab') {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: msg.streamId } },
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: msg.streamId,
          maxFrameRate: 30,
          ...(msg.w && { minWidth: msg.w, maxWidth: msg.w, minHeight: msg.h, maxHeight: msg.h }),
        },
      },
    });
    // Capturing tab audio mutes the tab for the user; play it back.
    const ctx = new AudioContext();
    ctx.createMediaStreamSource(stream).connect(ctx.destination);
    const res = await recordStream(stream, msg.ms, msg.name);
    ctx.close();
    return res;
  }
  if (msg.type === 'record-screen-gdm') {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    return recordStream(stream, msg.ms, msg.name);
  }
  if (msg.type === 'record-desktop') {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: msg.streamId } },
    });
    return recordStream(stream, msg.ms, msg.name);
  }
  return { ok: false, error: 'unknown type' };
}
