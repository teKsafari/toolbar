// Voice notes in the page (D-212): the microphone through getUserMedia and MediaRecorder, as the
// recording-link recorder does (apps/server/src/lib/components/dashboard/recorder.ts, whose mic
// request and type picker this copies). The browser asks for the host site's origin. Inside an
// iframe it needs allow="microphone", and a site's Permissions-Policy can turn it off.

/** The microphone was refused or is missing. */
export class MicUnavailableError extends Error {
  constructor(readonly reason: 'denied' | 'missing') {
    super(reason === 'denied' ? 'Allow the microphone for this site first' : 'No microphone found');
    this.name = 'MicUnavailableError';
  }
}

export async function requestMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicUnavailableError('missing');
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (e) {
    const name = (e as DOMException)?.name;
    throw new MicUnavailableError(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'missing' : 'denied');
  }
}

const pick = (types: string[]) => types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) ?? '';

/** One voice note at a time. */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private parts: Blob[] = [];
  private t0 = 0;

  get recording(): boolean {
    return !!this.rec;
  }

  async start(): Promise<void> {
    if (this.rec) return;
    const stream = await requestMic();
    const mimeType = pick(['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']);
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    this.parts = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) this.parts.push(e.data);
    };
    rec.start(1000);
    this.stream = stream;
    this.rec = rec;
    this.t0 = performance.now();
  }

  /** The clip and its length; null when nothing was recorded or `cancel`. */
  async stop(cancel = false): Promise<{ blob: Blob; durationMs: number } | null> {
    const rec = this.rec;
    if (!rec) return null;
    this.rec = null;
    const durationMs = Math.round(performance.now() - this.t0);
    if (rec.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        rec.stop();
      });
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const parts = this.parts;
    this.parts = [];
    if (cancel || !parts.length) return null;
    const blob = new Blob(parts, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
    return blob.size ? { blob, durationMs } : null;
  }
}

/** The file name extension of a recorded clip. */
export const clipExt = (type: string) => (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm');
