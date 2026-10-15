// Offscreen document: MediaRecorder for tab video, screen video and the microphone, the
// instant-replay video ring, and clipboard writes (architecture s10, s11; spikes S1, S2).
// One document exists per extension, so recorders are multiplexed by recording id. Each 1 s
// chunk goes to IndexedDB `uploads` first, then to the server when the worker passed an upload
// token (J-087). The full video is also kept locally for the editor preview.
import { browser } from 'wxt/browser';
import type { MicState, OffscreenEvent, OffscreenRequest, UploadAuth } from '@toolbar/shared/ext';
import { STREAM_CONTENT_TYPES } from '@toolbar/shared/constants';
import type { StreamName } from '@toolbar/shared';
import { putBlob } from '../../lib/idb';
import { enqueueChunk, sendRow } from '../../lib/upload/queue';

const TIMESLICE_MS = 1000;
const REPLAY_SEGMENT_MS = 10_000;

type WithoutFrom<T> = T extends unknown ? Omit<T, 'from'> : never;
function emit(e: WithoutFrom<OffscreenEvent>) {
  void browser.runtime.sendMessage({ from: 'offscreen', ...e }).catch(() => {});
}

function pickMime(video: boolean): string {
  const prefs = video ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'] : ['audio/webm;codecs=opus', 'audio/webm'];
  return prefs.find((m) => MediaRecorder.isTypeSupported(m)) ?? prefs[prefs.length - 1]!;
}

interface StreamSink {
  name: StreamName;
  seq: number;
  bytes: number;
  parts: Blob[];
  chain: Promise<void>;
}

interface Recording {
  id: string;
  upload: UploadAuth | null;
  video: MediaRecorder;
  voice: MediaRecorder | null;
  sinks: Map<StreamName, StreamSink>;
  streams: MediaStream[];
  audio: AudioContext;
  micGain: GainNode | null;
  micSource: MediaStreamAudioSourceNode | null;
  micStream: MediaStream | null;
  micState: MicState;
  startedAt: number;
  pausedAt: number | null;
  pausedMs: number;
  stopping: Promise<void> | null;
}

const recordings = new Map<string, Recording>();

function sink(rec: Recording, name: StreamName): StreamSink {
  let s = rec.sinks.get(name);
  if (!s) {
    s = { name, seq: 0, bytes: 0, parts: [], chain: Promise.resolve() };
    rec.sinks.set(name, s);
  }
  return s;
}

function onChunk(rec: Recording, name: StreamName, blob: Blob, t0: number) {
  if (!blob.size) return;
  const s = sink(rec, name);
  const seq = s.seq++;
  s.bytes += blob.size;
  s.parts.push(blob);
  const t1 = Date.now();
  // Ordered per stream: write to IndexedDB, then upload; a failed upload stays queued for the worker.
  s.chain = s.chain.then(async () => {
    const row = await enqueueChunk({ recordingId: rec.id, stream: name, seq, body: blob, t0, t1, contentType: name === 'voice' ? STREAM_CONTENT_TYPES.voice : STREAM_CONTENT_TYPES.video, contentEncoding: null });
    let uploaded = false;
    if (rec.upload?.token) {
      try {
        await sendRow(rec.upload, rec.id, row);
        uploaded = true;
      } catch {
        /* stays in the queue */
      }
    }
    emit({ type: 'chunk', recordingId: rec.id, stream: name, seq, bytes: blob.size, uploaded });
  });
}

/** Tab streams taken at the gesture, by stream id, until the countdown ends (hold-tab). */
const held = new Map<string, { media: MediaStream; audio: AudioContext; timer: ReturnType<typeof setTimeout>; mic: Promise<MediaStream | null> | null; micDeviceId?: string }>();

async function releaseHeld(streamId: string) {
  const h = held.get(streamId);
  if (!h) return;
  held.delete(streamId);
  clearTimeout(h.timer);
  for (const t of h.media.getTracks()) t.stop();
  void h.mic?.then((m) => m?.getTracks().forEach((t) => t.stop()));
  await h.audio.close().catch(() => undefined);
}

function openTab(streamId: string, w: number, h: number): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: {
      mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxFrameRate: 30, minWidth: w, maxWidth: w, minHeight: h, maxHeight: h },
    } as MediaTrackConstraints,
  });
}

async function openMic(deviceId?: string): Promise<MediaStream | null> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false });
  } catch {
    return null;
  }
}

/**
 * The extension's microphone permission (J-200): 'granted', 'denied' or 'prompt' (never asked).
 * Unknown when the Permissions API cannot tell; then nothing is claimed missing.
 */
async function micPermission(): Promise<PermissionState | 'unknown'> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    return 'unknown';
  }
}

/** Builds recorders for a captured video stream plus optional mic, and starts them. */
async function startRecording(id: string, media: MediaStream, opts: { mic: boolean; micDeviceId?: string; upload: UploadAuth | null; playBack: boolean; warmMic?: Promise<MediaStream | null> | null }): Promise<Recording> {
  const audio = new AudioContext();
  const mix = audio.createMediaStreamDestination();
  let hasAudio = false;
  if (media.getAudioTracks().length) {
    const src = audio.createMediaStreamSource(media);
    src.connect(mix);
    if (opts.playBack) src.connect(audio.destination); // tab capture mutes the tab; play it back
    hasAudio = true;
  }
  let micStream: MediaStream | null = null;
  let micGain: GainNode | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let voice: MediaRecorder | null = null;
  let micState: MicState = 'off';
  if (opts.mic) {
    micStream = (await opts.warmMic) ?? (await openMic(opts.micDeviceId));
    if (micStream) {
      micGain = audio.createGain();
      micSource = audio.createMediaStreamSource(micStream);
      micSource.connect(micGain);
      micGain.connect(mix);
      const voiceDest = audio.createMediaStreamDestination();
      micGain.connect(voiceDest);
      voice = new MediaRecorder(voiceDest.stream, { mimeType: pickMime(false) });
      hasAudio = true;
      micState = 'on';
    } else micState = 'denied';
  } else {
    // mic off and the extension never got (or lost) the permission: the bar shows the struck
    // through mic with the missing-permission tip, as Jam's does, not a plain off (J-200)
    const perm = await micPermission();
    if (perm === 'prompt' || perm === 'denied') micState = 'denied';
  }
  const tracks = [...media.getVideoTracks(), ...(hasAudio ? mix.stream.getAudioTracks() : [])];
  const video = new MediaRecorder(new MediaStream(tracks), { mimeType: pickMime(true), videoBitsPerSecond: 2_500_000 });
  const rec: Recording = {
    id,
    upload: opts.upload,
    video,
    voice,
    sinks: new Map(),
    streams: [media, ...(micStream ? [micStream] : [])],
    audio,
    micGain,
    micSource,
    micStream,
    micState,
    startedAt: 0,
    pausedAt: null,
    pausedMs: 0,
    stopping: null,
  };
  let lastVideo = Date.now();
  let lastVoice = Date.now();
  video.ondataavailable = (e) => {
    onChunk(rec, 'video', e.data, lastVideo);
    lastVideo = Date.now();
  };
  if (voice)
    voice.ondataavailable = (e) => {
      onChunk(rec, 'voice', e.data, lastVoice);
      lastVoice = Date.now();
    };
  const started = new Promise<void>((resolve) => {
    video.onstart = () => {
      rec.startedAt = performance.timeOrigin + performance.now();
      resolve();
    };
  });
  const vt = media.getVideoTracks()[0];
  vt?.addEventListener('ended', () => {
    // Chrome's own "Stop sharing" button, or the shared tab closed.
    if (recordings.has(id) && !rec.stopping) emit({ type: 'ended', recordingId: id });
  });
  recordings.set(id, rec);
  video.start(TIMESLICE_MS);
  voice?.start(TIMESLICE_MS);
  await started;
  const settings = vt?.getSettings() ?? {};
  emit({ type: 'started', recordingId: id, t: rec.startedAt, mime: video.mimeType, width: settings.width ?? 0, height: settings.height ?? 0, mic: micState });
  return rec;
}

async function stopRecording(id: string): Promise<{ durationMs: number; lastSeq: Partial<Record<StreamName, number>>; bytes: Partial<Record<StreamName, number>>; blobs: Partial<Record<StreamName, string>> }> {
  const rec = recordings.get(id);
  if (!rec) throw new Error('not_found');
  if (!rec.stopping) {
    rec.stopping = (async () => {
      const ended = (r: MediaRecorder | null) =>
        r && r.state !== 'inactive' ? new Promise<void>((res) => r.addEventListener('stop', () => res(), { once: true })) : Promise.resolve();
      const waits = [ended(rec.video), ended(rec.voice)];
      if (rec.pausedAt !== null) {
        rec.pausedMs += Date.now() - rec.pausedAt;
        rec.pausedAt = null;
      }
      try {
        rec.video.state !== 'inactive' && rec.video.stop();
        rec.voice && rec.voice.state !== 'inactive' && rec.voice.stop();
      } catch {
        /* already stopped */
      }
      await Promise.all(waits);
      for (const s of rec.streams) for (const t of s.getTracks()) t.stop();
      await rec.audio.close().catch(() => {});
      await Promise.all([...rec.sinks.values()].map((s) => s.chain));
    })();
  }
  await rec.stopping;
  const lastSeq: Partial<Record<StreamName, number>> = {};
  const bytes: Partial<Record<StreamName, number>> = {};
  const blobs: Partial<Record<StreamName, string>> = {};
  for (const s of rec.sinks.values()) {
    if (!s.seq) continue;
    lastSeq[s.name] = s.seq - 1;
    bytes[s.name] = s.bytes;
    const type = s.name === 'voice' ? 'audio/webm' : 'video/webm';
    blobs[s.name] = await putBlob(`${s.name}-${id}`, new Blob(s.parts, { type }));
  }
  const durationMs = Math.max(0, performance.timeOrigin + performance.now() - rec.startedAt - rec.pausedMs);
  recordings.delete(id);
  return { durationMs, lastSeq, bytes, blobs };
}

// ---------- instant replay video ring (D-013) ----------

interface ReplayRing {
  stream: MediaStream;
  audio: AudioContext;
  segments: { blob: Blob; t0: number; t1: number }[];
  keep: number;
  current: MediaRecorder | null;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}
const rings = new Map<number, ReplayRing>();

function nextSegment(tabId: number) {
  const r = rings.get(tabId);
  if (!r || r.stopped) return;
  const parts: Blob[] = [];
  const t0 = Date.now();
  const mr = new MediaRecorder(r.stream, { mimeType: pickMime(true) });
  mr.ondataavailable = (e) => e.data.size && parts.push(e.data);
  mr.onstop = () => {
    if (parts.length) {
      r.segments.push({ blob: new Blob(parts, { type: 'video/webm' }), t0, t1: Date.now() });
      while (r.segments.length > r.keep) r.segments.shift();
    }
  };
  r.current = mr;
  mr.start();
  r.timer = setTimeout(() => {
    if (mr.state !== 'inactive') mr.stop();
    nextSegment(tabId); // a standalone WebM per segment; the gap is a few ms
  }, REPLAY_SEGMENT_MS);
}

async function startReplayVideo(tabId: number, streamId: string, minutes: number) {
  await stopReplayVideo(tabId);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId, maxFrameRate: 15 } } as MediaTrackConstraints,
  });
  const audio = new AudioContext();
  audio.createMediaStreamSource(stream).connect(audio.destination);
  rings.set(tabId, { stream, audio, segments: [], keep: Math.ceil((minutes * 60_000) / REPLAY_SEGMENT_MS) + 1, current: null, timer: null, stopped: false });
  nextSegment(tabId);
}

async function stopReplayVideo(tabId: number) {
  const r = rings.get(tabId);
  if (!r) return;
  r.stopped = true;
  if (r.timer) clearTimeout(r.timer);
  if (r.current && r.current.state !== 'inactive') r.current.stop();
  for (const t of r.stream.getTracks()) t.stop();
  await r.audio.close().catch(() => {});
  rings.delete(tabId);
}

/** Copies the kept segments into IndexedDB blobs for a replay draft; the ring keeps running. */
async function saveReplaySegments(tabId: number, key: string): Promise<{ blobIds: string[]; t0: number | null }> {
  const r = rings.get(tabId);
  if (!r) return { blobIds: [], t0: null };
  const segs = [...r.segments];
  const ids: string[] = [];
  for (let i = 0; i < segs.length; i++) ids.push(await putBlob(`replay-${key}-${i}`, segs[i]!.blob));
  return { blobIds: ids, t0: segs[0]?.t0 ?? null };
}

// ---------- clipboard ----------

function copyText(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

// ---------- requests ----------

type Reply = (r: unknown) => void;

async function handle(msg: OffscreenRequest): Promise<unknown> {
  switch (msg.type) {
    case 'ping':
      return { ok: true, recorders: recordings.size, rings: rings.size };
    case 'hold-tab': {
      await releaseHeld(msg.streamId);
      const media = await openTab(msg.streamId, msg.w, msg.h);
      // tab capture mutes the tab: play it back while the countdown runs
      const audio = new AudioContext();
      if (media.getAudioTracks().length) audio.createMediaStreamSource(media).connect(audio.destination);
      // a countdown that is never finished or cancelled must not keep the tab captured
      const timer = setTimeout(() => void releaseHeld(msg.streamId), 600_000);
      held.set(msg.streamId, { media, audio, timer, mic: msg.mic ? openMic(msg.micDeviceId) : null, micDeviceId: msg.micDeviceId });
      return { ok: true };
    }
    case 'release-tab':
      await releaseHeld(msg.streamId);
      return { ok: true };
    case 'record-tab': {
      const h = held.get(msg.streamId);
      if (h) {
        held.delete(msg.streamId);
        clearTimeout(h.timer);
        await h.audio.close().catch(() => undefined);
      }
      const media = h?.media ?? (await openTab(msg.streamId, msg.w, msg.h));
      // a microphone warmed at the gesture is used when it is the one asked for now
      const warm = h?.mic && msg.mic && h.micDeviceId === msg.micDeviceId ? h.mic : null;
      if (h?.mic && !warm) void h.mic.then((m) => m?.getTracks().forEach((t) => t.stop()));
      const rec = await startRecording(msg.recordingId, media, { mic: msg.mic, micDeviceId: msg.micDeviceId, upload: msg.upload, playBack: true, warmMic: warm });
      return { ok: true, t: rec.startedAt, mic: rec.micState };
    }
    case 'record-screen': {
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: msg.surface === 'desktop' ? 'monitor' : 'window', frameRate: 30 } as MediaTrackConstraints,
          audio: false,
          selfBrowserSurface: 'include',
          monitorTypeSurfaces: 'include',
        } as DisplayMediaStreamOptions);
      } catch (e) {
        // Cancel in Chrome's picker, or the picker failed (J-201): no draft is left.
        emit({ type: 'picker-cancelled', recordingId: msg.recordingId });
        return { ok: false, error: 'permission_denied', message: e instanceof Error ? e.message : String(e) };
      }
      const rec = await startRecording(msg.recordingId, media, { mic: msg.mic, micDeviceId: msg.micDeviceId, upload: msg.upload, playBack: false });
      return { ok: true, t: rec.startedAt, mic: rec.micState };
    }
    case 'pause': {
      const r = recordings.get(msg.recordingId);
      if (!r) return { ok: false, error: 'not_found' };
      if (r.video.state === 'recording') r.video.pause();
      if (r.voice?.state === 'recording') r.voice.pause();
      r.pausedAt ??= Date.now();
      return { ok: true };
    }
    case 'resume': {
      const r = recordings.get(msg.recordingId);
      if (!r) return { ok: false, error: 'not_found' };
      if (r.video.state === 'paused') r.video.resume();
      if (r.voice?.state === 'paused') r.voice.resume();
      if (r.pausedAt !== null) {
        r.pausedMs += Date.now() - r.pausedAt;
        r.pausedAt = null;
      }
      return { ok: true };
    }
    case 'mic-devices': {
      // the extension's own grant gives labels here; the page cannot list them (J-211)
      const all = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
      const devices = all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications').map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
      const r = msg.recordingId ? recordings.get(msg.recordingId) : [...recordings.values()][0];
      const current = r?.micStream?.getAudioTracks()[0]?.getSettings().deviceId ?? null;
      return { ok: true, devices, current };
    }
    case 'mic': {
      const r = recordings.get(msg.recordingId);
      if (!r) return { ok: false, error: 'not_found' };
      if (msg.deviceId && r.micGain) {
        // Switch microphones without stopping (J-211): swap the source feeding the gain node.
        const next = await openMic(msg.deviceId);
        if (next) {
          r.micSource?.disconnect();
          for (const t of r.micStream?.getTracks() ?? []) t.stop();
          r.micStream = next;
          r.micSource = r.audio.createMediaStreamSource(next);
          r.micSource.connect(r.micGain);
          r.streams.push(next);
        }
      }
      if (r.micGain) {
        r.micGain.gain.value = msg.muted ? 0 : 1; // silence keeps the voice stream's timeline intact
        r.micState = msg.muted ? 'muted' : 'on';
      }
      return { ok: true, mic: r.micState };
    }
    case 'stop': {
      const res = await stopRecording(msg.recordingId);
      emit({ type: 'stopped', recordingId: msg.recordingId, durationMs: res.durationMs, lastSeq: res.lastSeq });
      return { ok: true, ...res };
    }
    case 'replay-video-start':
      await startReplayVideo(msg.tabId, msg.streamId, msg.minutes);
      return { ok: true };
    case 'replay-video-stop':
      await stopReplayVideo(msg.tabId);
      return { ok: true };
    case 'replay-video-flush':
      return { ok: true, ...(await saveReplaySegments(msg.tabId, msg.recordingId)) };
    case 'clipboard':
      return { ok: copyText(msg.text) };
  }
}

browser.runtime.onMessage.addListener((msg: OffscreenRequest, _sender, reply: Reply) => {
  if (msg?.to !== 'offscreen') return false;
  handle(msg).then(reply, (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e);
    emit({ type: 'error', recordingId: 'recordingId' in msg ? (msg.recordingId as string) : null, error: 'offscreen', message });
    reply({ ok: false, error: 'offscreen', message });
  });
  return true;
});
