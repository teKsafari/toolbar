const out = document.getElementById('out');
document.getElementById('go').addEventListener('click', async (e) => {
  const targetTabId = Number(new URL(location.href).searchParams.get('tab'));
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId });
    out.textContent = `OK ${streamId.slice(0, 12)}… isTrusted=${e.isTrusted}`;
  } catch (err) {
    out.textContent = `ERROR ${err.message} isTrusted=${e.isTrusted}`;
  }
});
