// Fallback host for "record screen": a visible extension page, where a click gives
// getDisplayMedia the transient user activation it needs.
const out = document.getElementById('out');
document.getElementById('go').addEventListener('click', async () => {
  out.textContent = 'picking';
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    out.textContent = `recording ${stream.getVideoTracks()[0].label}`;
    const res = await recordStream(stream, 3000, 'screen-window-gdm.webm');
    out.textContent = JSON.stringify(res);
  } catch (e) {
    out.textContent = `ERROR ${e.name}: ${e.message}`;
  }
});
