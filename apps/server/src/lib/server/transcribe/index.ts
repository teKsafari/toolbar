// Transcription behind an interface so the provider can change (architecture section 12).
// Adapters are stubs; the media area agent fills them in.
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

export function createTranscriber(): Transcriber | null {
  switch (env.transcribe.provider) {
    case 'whispercpp':
      return {
        id: 'whispercpp',
        async transcribe() {
          throw new Error('whispercpp adapter not implemented yet');
        },
      };
    case 'openai-compatible':
      return {
        id: 'openai-compatible',
        async transcribe() {
          throw new Error('openai-compatible adapter not implemented yet');
        },
      };
    default:
      return null;
  }
}

/** Liveness of the whisper.cpp server, for /api/health. It answers GET / once the model is loaded. */
export async function whisperPing(timeoutMs = 1500): Promise<void> {
  const r = await fetch(env.transcribe.whisperUrl + '/', { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}
