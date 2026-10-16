// Transcription settings (docs/configuration.md "Transcription", D-087, D-194). Settings > Server
// holds them; each variable below, when set, wins and locks its field. Read on every call, so a
// test, a saved setting or a restart with new values needs no module reload.
//
//   TRANSCRIBE_PROVIDER         none (default) | local (whisper.cpp) | openai (any OpenAI-compatible endpoint)
//                               old names: whispercpp = local, openai-compatible = openai
//   TRANSCRIBE_MODEL            model id for openai; default gpt-transcribe (STT_MODEL is the old name)
//   TRANSCRIBE_API_KEY          bearer token; falls back to OPENAI_API_KEY, then STT_API_KEY
//   TRANSCRIBE_BASE_URL         default https://api.openai.com/v1 (STT_URL is the old name, without /v1)
//   TRANSCRIBE_LANGUAGE         empty (detect) or ISO 639-1 codes, comma separated
//   TRANSCRIBE_TIMESTAMPS       auto | chunked | native
//   TRANSCRIBE_CHUNK_SECONDS    longest chunk, default 30
//   TRANSCRIBE_MAX_MINUTES      longer audio is not transcribed, default 60
//   TRANSCRIBE_MONTHLY_MINUTES  hosted audio per calendar month (UTC); empty means no cap
//   TRANSCRIBE_CONCURRENCY      parallel chunk requests per recording, default 4

import { DEFAULT_HOSTED_MODEL, OPENAI_BASE_URL, setting } from '../settings/index.ts';

export type ProviderId = 'local' | 'openai' | 'none';
export type TimestampMode = 'auto' | 'chunked' | 'native';

export interface TranscribeConfig {
  provider: ProviderId;
  /** whisper.cpp server (local provider) */
  whisperUrl: string;
  whisperModel: string;
  /** openai provider */
  baseUrl: string;
  apiKey: string;
  model: string;
  languages: string[];
  timestamps: TimestampMode;
  chunkSeconds: number;
  maxMinutes: number;
  /** null: no monthly cap */
  monthlyMinutes: number | null;
  concurrency: number;
}

export { OPENAI_BASE_URL, DEFAULT_HOSTED_MODEL, normaliseProvider } from '../settings/index.ts';

const read = (name: string, fallback = ''): string => {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
};

/**
 * The effective transcription settings: each field from its environment variable when set, else
 * from Settings > Server, else the default (D-194). The provider is `none` until an admin picks
 * one; docker-compose.whisper.yml runs the local whisper.cpp and points WHISPER_URL at it.
 */
export function transcribeConfig(): TranscribeConfig {
  return {
    provider: setting('transcribeProvider') ?? 'none',
    whisperUrl: setting('whisperUrl') ?? 'http://localhost:8080',
    // the whisper container downloads this model; the label is stored with each transcript
    whisperModel: read('WHISPER_MODEL', 'base'),
    baseUrl: setting('transcribeBaseUrl') ?? OPENAI_BASE_URL,
    apiKey: setting('transcribeApiKey') ?? '',
    model: setting('transcribeModel') ?? DEFAULT_HOSTED_MODEL,
    languages: setting('transcribeLanguage') ?? [],
    timestamps: setting('transcribeTimestamps') ?? 'auto',
    chunkSeconds: setting('transcribeChunkSeconds') ?? 30,
    maxMinutes: setting('transcribeMaxMinutes') ?? 60,
    monthlyMinutes: setting('transcribeMonthlyMinutes'),
    concurrency: setting('transcribeConcurrency') ?? 4,
  };
}

/** A model id whose endpoint returns text only (no `vtt`): the gpt-* transcription models. */
export const isTextOnlyModel = (model: string) => /^gpt-/i.test(model);
