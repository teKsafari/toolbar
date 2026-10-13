// Records a MediaStream for `ms` milliseconds and stores the WebM in IndexedDB.
async function recordStream(stream, ms, name) {
  const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  rec.start(1000);
  await new Promise((r) => setTimeout(r, ms));
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type: 'video/webm' });
  await idbPut(name, blob);
  const track = stream.getVideoTracks()[0];
  return { ok: true, name, mimeType, bytes: blob.size, chunks: chunks.length, settings: track?.getSettings?.() };
}
