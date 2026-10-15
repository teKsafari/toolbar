// Transcription settings (docs/configuration.md "Transcription", D-087). Read from process.env on
// every call, so a test or a restart with new values needs no module reload.
//
//   TRANSCRIBE_PROVIDER         local (whisper.cpp, default) | openai (any OpenAI-compatible endpoint) | none
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

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_HOSTED_MODEL = 'gpt-transcribe';

const read = (name: string, fallback = ''): string => {
  const v = process.env[name];
  return v === undefined || v.trim() === '' ? fallback : v.trim();
};

const num = (name: string, fallback: number, min: number, max: number): number => {
  const n = Number(read(name));
  if (!read(name) || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

export function normaliseProvider(v: string): ProviderId {
  const s = v.toLowerCase();
  if (s === 'none' || s === 'off' || s === '0') return 'none';
  if (s === 'openai' || s === 'openai-compatible' || s === 'hosted') return 'openai';
  return 'local';
}

export function transcribeConfig(): TranscribeConfig {
  const sttUrl = read('STT_URL');
  const monthly = read('TRANSCRIBE_MONTHLY_MINUTES');
  const timestamps = read('TRANSCRIBE_TIMESTAMPS', 'auto').toLowerCase();
  return {
    provider: normaliseProvider(read('TRANSCRIBE_PROVIDER', 'local')),
    whisperUrl: read('WHISPER_URL', 'http://localhost:8080').replace(/\/+$/, ''),
    whisperModel: read('WHISPER_MODEL', 'base'),
    baseUrl: read('TRANSCRIBE_BASE_URL', sttUrl ? `${sttUrl.replace(/\/+$/, '')}/v1` : OPENAI_BASE_URL).replace(/\/+$/, ''),
    apiKey: read('TRANSCRIBE_API_KEY', read('OPENAI_API_KEY', read('STT_API_KEY'))),
    model: read('TRANSCRIBE_MODEL', read('STT_MODEL', DEFAULT_HOSTED_MODEL)),
    languages: read('TRANSCRIBE_LANGUAGE')
      .split(/[\s,]+/)
      .map((l) => l.toLowerCase())
      .filter((l) => /^[a-z]{2,3}$/.test(l)),
    timestamps: timestamps === 'chunked' || timestamps === 'native' ? timestamps : 'auto',
    chunkSeconds: num('TRANSCRIBE_CHUNK_SECONDS', 30, 5, 600),
    maxMinutes: num('TRANSCRIBE_MAX_MINUTES', 60, 0.1, 24 * 60),
    monthlyMinutes: monthly && Number.isFinite(Number(monthly)) && Number(monthly) >= 0 ? Number(monthly) : null,
    concurrency: Math.round(num('TRANSCRIBE_CONCURRENCY', 4, 1, 16)),
  };
}

/** A model id whose endpoint returns text only (no `vtt`): the gpt-* transcription models. */
export const isTextOnlyModel = (model: string) => /^gpt-/i.test(model);
