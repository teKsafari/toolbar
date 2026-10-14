// Recorder page logic for a recording-link recipient (J-017): screen (and optional voice)
// capture with MediaRecorder, then upload through the contract routes with the per-capture
// upload token: create, chunks, complete, finalize.
import { HEADERS, LIMITS, uuidv7 } from '@toolbar/shared';
import { buildPath, ROUTES } from '@toolbar/shared/api';

export interface Recording {
  video: Blob;
  voice: Blob | null;
  startedAt: number;
  durationMs: number;
  width: number | null;
  height: number | null;
}

const pick = (types: string[]) => types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

export class ScreenRecorder {
  private display: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private rec: MediaRecorder | null = null;
  private voiceRec: MediaRecorder | null = null;
  private parts: Blob[] = [];
  private voiceParts: Blob[] = [];
  private t0 = 0;
  private size: { w: number | null; h: number | null } = { w: null, h: null };
  onended: (() => void) | null = null;

  /** Ask for a screen (and the microphone) and start recording. Throws when the person cancels. */
  async start(withVoice: boolean) {
    this.display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
    if (withVoice) {
      try {
        this.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        this.mic = null;
      }
    }
    const vt = this.display.getVideoTracks()[0]!;
    const st = vt.getSettings();
    this.size = { w: st.width ?? null, h: st.height ?? null };
    vt.addEventListener('ended', () => this.onended?.());
    const audio: MediaStreamTrack[] = [];
    const sources = [this.display, this.mic].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
    if (sources.length === 1) audio.push(...sources[0]!.getAudioTracks());
    else if (sources.length > 1) {
      this.ctx = new AudioContext();
      const dest = this.ctx.createMediaStreamDestination();
      for (const s of sources) this.ctx.createMediaStreamSource(s).connect(dest);
      audio.push(...dest.stream.getAudioTracks());
    }
    const stream = new MediaStream([vt, ...audio]);
    const mimeType = pick(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']);
    this.rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : undefined);
    this.parts = [];
    this.rec.ondataavailable = (e) => e.data.size && this.parts.push(e.data);
    if (this.mic) {
      const vm = pick(['audio/webm;codecs=opus', 'audio/webm']);
      this.voiceRec = new MediaRecorder(this.mic, vm ? { mimeType: vm } : undefined);
      this.voiceParts = [];
      this.voiceRec.ondataavailable = (e) => e.data.size && this.voiceParts.push(e.data);
      this.voiceRec.start(1000);
    }
    this.t0 = Date.now();
    this.rec.start(1000);
  }

  get hasVoice() {
    return !!this.mic;
  }

  async stop(): Promise<Recording> {
    const done = (r: MediaRecorder | null) =>
      new Promise<void>((res) => {
        if (!r || r.state === 'inactive') return res();
        r.addEventListener('stop', () => res(), { once: true });
        r.stop();
      });
    await Promise.all([done(this.rec), done(this.voiceRec)]);
    const durationMs = Date.now() - this.t0;
    this.release();
    return {
      video: new Blob(this.parts, { type: 'video/webm' }),
      voice: this.voiceParts.length ? new Blob(this.voiceParts, { type: 'audio/webm' }) : null,
      startedAt: this.t0,
      durationMs,
      width: this.size.w,
      height: this.size.h,
    };
  }

  release() {
    for (const s of [this.display, this.mic]) s?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.display = this.mic = null;
    this.ctx = null;
  }
}

async function sha256(b: ArrayBuffer) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', b));
  return [...d].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function check(res: Response) {
  if (res.ok) return res;
  const j = await res.json().catch(() => ({}));
  throw new Error(j.message ?? `Upload failed (${res.status})`);
}

async function putStream(id: string, token: string, stream: 'video' | 'voice', blob: Blob, onBytes: (n: number) => void) {
  const size = LIMITS.chunkBytes;
  const n = Math.max(1, Math.ceil(blob.size / size));
  for (let seq = 0; seq < n; seq++) {
    const part = await blob.slice(seq * size, (seq + 1) * size).arrayBuffer();
    const url = buildPath(ROUTES['captures.putChunk'].path, { id, stream, seq });
    for (let attempt = 0; ; attempt++) {
      try {
        await check(
          await fetch(url, {
            method: 'PUT',
            headers: { authorization: `Bearer ${token}`, 'content-type': blob.type || 'video/webm', [HEADERS.sha256]: await sha256(part) },
            body: part,
          }),
        );
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    onBytes(part.byteLength);
  }
  await check(
    await fetch(buildPath(ROUTES['captures.completeStream'].path, { id, stream }), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ lastSeq: n - 1, totalBytes: blob.size }),
    }),
  );
}

/** Create the capture through the link, upload, finalize. Returns the capture id. */
export async function submitRecording(
  token: string,
  r: Recording,
  opts: { note: string; title: string | null; folder: string | null; ref: string | null },
  onProgress: (pct: number) => void,
): Promise<{ id: string }> {
  const env = {
    ua: navigator.userAgent,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    screen: { w: screen.width, h: screen.height },
    dpr: window.devicePixelRatio || 1,
    locale: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const created = await check(
    await fetch(buildPath(ROUTES['recordingLinks.createCapture'].path, { token }), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: uuidv7(),
        kind: 'link',
        startedAt: r.startedAt,
        env,
        note: opts.note || undefined,
        folder: opts.folder ?? undefined,
        ref: opts.ref ?? undefined,
      }),
    }),
  ).then((x) => x.json() as Promise<{ id: string; uploadToken: string }>);
  const total = r.video.size + (r.voice?.size ?? 0);
  let sent = 0;
  const tick = (n: number) => onProgress(Math.min(99, Math.round(((sent += n) / total) * 100)));
  await putStream(created.id, created.uploadToken, 'video', r.video, tick);
  if (r.voice) await putStream(created.id, created.uploadToken, 'voice', r.voice, tick);
  const metadata: Record<string, string> = {};
  if (opts.note) metadata.note = opts.note;
  if (opts.ref) metadata.ref = opts.ref;
  await check(
    await fetch(buildPath(ROUTES['captures.finalize'].path, { id: created.id }), {
      method: 'POST',
      headers: { authorization: `Bearer ${created.uploadToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: opts.title ?? '',
        description: opts.note,
        annotations: [],
        durationMs: r.durationMs,
        metadata: Object.keys(metadata).length ? metadata : undefined,
      }),
    }),
  );
  onProgress(100);
  return { id: created.id };
}
