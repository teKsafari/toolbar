// Transcription behind an interface so the provider can change (architecture section 12).
//   TRANSCRIBE_PROVIDER=whispercpp        POST ${WHISPER_URL}/inference (whisper-server --convert)
//   TRANSCRIBE_PROVIDER=openai-compatible POST ${STT_URL}/v1/audio/transcriptions
//   TRANSCRIBE_PROVIDER=none              no transcripts
// Both return WebVTT. The transcribe job runs one at a time (whisper-server is single-request).
import { env } from '../env.ts';

export interface TranscribeInput {
  audio: ReadableStream<Uint8Array> | Uint8Array;
  mime: string;
  language?: string;
}
export interface TranscribeResult {
  vtt: string;
  language?: string;
  model: string;
}
export interface Transcriber {
  id: string;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

async function toBlob(input: TranscribeInput): Promise<Blob> {
  if (input.audio instanceof Uint8Array) return new Blob([input.audio as Uint8Array<ArrayBuffer>], { type: input.mime });
  return new Response(input.audio).blob().then((b) => new Blob([b], { type: input.mime }));
}

const fileName = (mime: string) => (mime.includes('wav') ? 'audio.wav' : mime.includes('ogg') ? 'audio.ogg' : mime.includes('mp') ? 'audio.mp3' : 'audio.webm');

export function normaliseVtt(text: string): string {
  const t = text.replace(/\r\n/g, '\n').trim();
  return (t.startsWith('WEBVTT') ? t : `WEBVTT\n\n${t}`) + '\n';
}

export function whisperCpp(baseUrl: string, model = process.env.WHISPER_MODEL || 'base', fetchImpl: typeof fetch = fetch): Transcriber {
  return {
    id: 'whispercpp',
    async transcribe(input) {
      const form = new FormData();
      form.set('file', await toBlob(input), fileName(input.mime));
      form.set('response_format', 'vtt');
      form.set('language', input.language ?? 'auto');
      form.set('temperature', '0.0');
      const r = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(15 * 60_000) });
      const body = await r.text();
      if (!r.ok) throw new Error(`whisper.cpp HTTP ${r.status}: ${body.slice(0, 300)}`);
      if (body.trim().startsWith('{')) {
        const j = JSON.parse(body) as { error?: string };
        if (j.error) throw new Error(`whisper.cpp: ${j.error}`);
      }
      return { vtt: normaliseVtt(body), model: `whisper.cpp ${model}`, language: input.language };
    },
  };
}

export function openAiCompatible(baseUrl: string, apiKey: string, model: string, fetchImpl: typeof fetch = fetch): Transcriber {
  return {
    id: 'openai-compatible',
    async transcribe(input) {
      const form = new FormData();
      form.set('file', await toBlob(input), fileName(input.mime));
      form.set('model', model);
      form.set('response_format', 'vtt');
      if (input.language) form.set('language', input.language);
      const r = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/audio/transcriptions`, {
        method: 'POST',
        body: form,
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(15 * 60_000),
      });
      const body = await r.text();
      if (!r.ok) throw new Error(`STT HTTP ${r.status}: ${body.slice(0, 300)}`);
      return { vtt: normaliseVtt(body), model, language: input.language };
    },
  };
}

export function createTranscriber(): Transcriber | null {
  switch (env.transcribe.provider) {
    case 'whispercpp':
      return whisperCpp(env.transcribe.whisperUrl);
    case 'openai-compatible':
      return env.transcribe.sttUrl ? openAiCompatible(env.transcribe.sttUrl, env.transcribe.sttApiKey, env.transcribe.sttModel) : null;
    default:
      return null;
  }
}

/** Liveness of the whisper.cpp server, for /api/health. It answers GET / once the model is loaded. */
export async function whisperPing(timeoutMs = 1500): Promise<void> {
  const r = await fetch(env.transcribe.whisperUrl + '/', { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

const ts = (s: string) => {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return NaN;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]!.padEnd(3, '0'));
};

/** Parse WebVTT cues (timing lines and their text); ignores NOTE and STYLE blocks. */
export function parseVtt(vtt: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i]!.split('-->');
    const startMs = ts(a!);
    const endMs = ts(z!.trim().split(/\s+/)[0]!);
    const text = lines
      .slice(i + 1)
      .join('\n')
      .trim();
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && text) cues.push({ startMs, endMs, text });
  }
  return cues;
}
