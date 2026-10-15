// Transcription behind an interface so the provider can change (architecture section 12, D-087).
//
//   local   whisper.cpp server: POST ${WHISPER_URL}/inference (whisper-server --convert), WebVTT back
//   openai  any OpenAI-compatible endpoint: POST ${TRANSCRIBE_BASE_URL}/audio/transcriptions
//           - gpt-* models return text only: the voice track is cut at pauses into chunks of at
//             most TRANSCRIBE_CHUNK_SECONDS, each chunk is sent as `json`, and the server builds
//             the WebVTT from the chunk offsets (chunked mode)
//           - Whisper-style models return `vtt` (native mode); files over 24 MB are chunked too
//   none    no transcripts
//
// Settings: ./config.ts. The size, length and monthly guards are in ./run.ts.
import { decodePcm, encodeSlice } from './audio.ts';
import { findPauses, planChunks, SAMPLE_RATE, type Chunk } from './chunk.ts';
import { isTextOnlyModel, transcribeConfig, type ProviderId, type TranscribeConfig } from './config.ts';
import { defaultRetry, TranscribeHttpError, transcribeText, transcribeVtt, type HttpTarget, type RetryPolicy } from './openai.ts';
import { buildVtt, cuesForChunk, dropOverlap, normaliseVtt, offsetCues, parseVtt, type Cue } from './vtt.ts';

export { parseVtt, normaliseVtt, buildVtt, vttPlainText, type Cue } from './vtt.ts';
export { transcribeConfig, type TranscribeConfig } from './config.ts';

export interface TranscribeInput {
  audio: Uint8Array;
  mime: string;
  /** length of the audio when known (ffprobe), for billing estimates */
  durationMs?: number | null;
  /** the audio already decoded to 16 kHz mono PCM, when the caller has it */
  pcm?: Int16Array;
}

export interface TranscribeResult {
  vtt: string;
  /** detected or configured language codes, most spoken first, comma separated */
  language?: string;
  model: string;
  /** audio seconds the hosted provider bills (0 for local) */
  billedSeconds: number;
  /** requests sent */
  requests: number;
  mode: 'local' | 'native' | 'chunked';
}

export interface Transcriber {
  id: Exclude<ProviderId, 'none'>;
  model: string;
  /** audio leaves the server and costs money: the monthly cap applies */
  hosted: boolean;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

/**
 * Transcript stream names: `voice` is the capture's microphone track (a recording or a trace);
 * `voice:<assetId>` is a voice note attached to a comment.
 */
export const voiceNoteStream = (assetId: string) => `voice:${assetId}`;

/** One request may carry at most 25 MB (OpenAI); keep a margin for the multipart envelope. */
export const MAX_REQUEST_BYTES = 24 * 1024 * 1024;

// ---------- local: whisper.cpp ----------

export function whisperCpp(baseUrl: string, model = 'base', fetchImpl: typeof fetch = fetch, languages: string[] = []): Transcriber {
  return {
    id: 'local',
    model: `whisper.cpp ${model}`,
    hosted: false,
    async transcribe(input) {
      const form = new FormData();
      form.set('file', new Blob([input.audio as Uint8Array<ArrayBuffer>], { type: input.mime }), 'audio.webm');
      form.set('response_format', 'vtt');
      form.set('language', languages[0] ?? 'auto');
      form.set('temperature', '0.0');
      const r = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(30 * 60_000) });
      const body = await r.text();
      if (!r.ok) throw new Error(`whisper.cpp HTTP ${r.status}: ${body.slice(0, 300)}`);
      if (body.trim().startsWith('{')) {
        const j = JSON.parse(body) as { error?: string };
        if (j.error) throw new Error(`whisper.cpp: ${j.error}`);
      }
      return { vtt: normaliseVtt(body), model: `whisper.cpp ${model}`, language: languages[0], billedSeconds: 0, requests: 1, mode: 'local' };
    },
  };
}

// ---------- openai: any OpenAI-compatible endpoint ----------

export interface OpenAiDeps {
  fetchImpl?: typeof fetch;
  retry?: RetryPolicy;
  decode?: (audio: Uint8Array) => Promise<Int16Array>;
  encode?: (pcm: Int16Array, a: number, b: number) => Promise<Uint8Array>;
}

/** Models whose endpoint refused `vtt` once (TRANSCRIBE_TIMESTAMPS=auto remembers it per process). */
const refusedVtt = new Set<string>();

async function pool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

/** Language codes ordered by the voiced seconds they were detected in. */
function rankLanguages(hits: { langs: string[]; seconds: number }[], fallback: string[]): string | undefined {
  const score = new Map<string, number>();
  for (const h of hits) for (const l of h.langs) score.set(l.toLowerCase(), (score.get(l.toLowerCase()) ?? 0) + h.seconds / h.langs.length);
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  return (ranked.length ? ranked : fallback).join(',') || undefined;
}

export function openAiCompatible(cfg: Pick<TranscribeConfig, 'baseUrl' | 'apiKey' | 'model' | 'languages' | 'timestamps' | 'chunkSeconds' | 'concurrency'>, deps: OpenAiDeps = {}): Transcriber {
  const target: HttpTarget = { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, fetchImpl: deps.fetchImpl };
  const retry = deps.retry ?? defaultRetry;
  const decode = deps.decode ?? decodePcm;
  const encode = deps.encode ?? encodeSlice;
  const memo = `${cfg.baseUrl} ${cfg.model}`;
  const hosted = true;

  async function chunksOf(input: TranscribeInput): Promise<{ pcm: Int16Array; chunks: Chunk[] }> {
    const pcm = input.pcm ?? (await decode(input.audio));
    const { pauses, duration } = findPauses(pcm);
    return { pcm, chunks: planChunks(pauses, duration, cfg.chunkSeconds) };
  }

  async function chunked(input: TranscribeInput): Promise<TranscribeResult> {
    const { pcm, chunks } = await chunksOf(input);
    const replies = await pool(chunks, cfg.concurrency, async (c) => transcribeText(target, await encode(pcm, c.start, c.end), 'audio/webm', cfg.languages, retry));
    const cues: Cue[] = [];
    let prevText = '';
    let billed = 0;
    replies.forEach((r, i) => {
      const c = chunks[i]!;
      billed += r.seconds ?? Math.ceil(c.end - c.start);
      const text = c.overlap ? dropOverlap(prevText, r.text) : r.text;
      prevText = r.text;
      cues.push(...cuesForChunk(text, c));
    });
    const voiced = (c: Chunk) => c.voiced.reduce((n, v) => n + v.end - v.start, 0);
    return {
      vtt: buildVtt(cues),
      language: rankLanguages(
        replies.map((r, i) => ({ langs: r.languages, seconds: voiced(chunks[i]!) })),
        cfg.languages,
      ),
      model: cfg.model,
      billedSeconds: billed,
      requests: chunks.length,
      mode: 'chunked',
    };
  }

  async function native(input: TranscribeInput): Promise<TranscribeResult> {
    const seconds = Math.ceil((input.durationMs ?? 0) / 1000);
    if (input.audio.byteLength <= MAX_REQUEST_BYTES) {
      const vtt = await transcribeVtt(target, input.audio, input.mime, cfg.languages, retry);
      if (!/-->/.test(vtt) && vtt.trim().startsWith('{')) throw new Error(`transcription: expected WebVTT, got ${vtt.slice(0, 120)}`);
      return { vtt: normaliseVtt(vtt), language: cfg.languages.join(',') || undefined, model: cfg.model, billedSeconds: seconds || Math.ceil((parseVtt(vtt).at(-1)?.endMs ?? 0) / 1000), requests: 1, mode: 'native' };
    }
    // too big for one request: the same chunks, each with its own VTT shifted by its offset
    const { pcm, chunks } = await chunksOf(input);
    const parts = await pool(chunks, cfg.concurrency, async (c) => parseVtt(await transcribeVtt(target, await encode(pcm, c.start, c.end), 'audio/webm', cfg.languages, retry)));
    const cues: Cue[] = [];
    parts.forEach((p, i) => {
      const c = chunks[i]!;
      const lastEnd = cues.length ? cues[cues.length - 1]!.endMs : 0;
      cues.push(...offsetCues(p, Math.round(c.start * 1000), c.overlap ? lastEnd : 0));
    });
    return {
      vtt: buildVtt(cues),
      language: cfg.languages.join(',') || undefined,
      model: cfg.model,
      billedSeconds: chunks.reduce((n, c) => n + Math.ceil(c.end - c.start), 0) || Math.ceil(pcm.length / SAMPLE_RATE),
      requests: chunks.length,
      mode: 'native',
    };
  }

  return {
    id: 'openai',
    model: cfg.model,
    hosted,
    async transcribe(input) {
      const mode = cfg.timestamps === 'auto' ? (isTextOnlyModel(cfg.model) || refusedVtt.has(memo) ? 'chunked' : 'native') : cfg.timestamps;
      if (mode === 'chunked') return chunked(input);
      try {
        return await native(input);
      } catch (e) {
        if (cfg.timestamps === 'auto' && e instanceof TranscribeHttpError && e.formatRefused) {
          refusedVtt.add(memo);
          return chunked(input);
        }
        throw e;
      }
    },
  };
}

/** Test hook: forget which models refused `vtt`. */
export const _resetVttMemo = () => refusedVtt.clear();

let warned = '';

/** The configured transcriber, or null when transcription is off (or the hosted provider has no key). */
export function createTranscriber(cfg: TranscribeConfig = transcribeConfig()): Transcriber | null {
  switch (cfg.provider) {
    case 'local':
      return whisperCpp(cfg.whisperUrl, cfg.whisperModel, fetch, cfg.languages);
    case 'openai':
      // api.openai.com needs a key; a self-hosted compatible server (speaches) may not
      if (!cfg.apiKey && /\/\/api\.openai\.com\b/.test(cfg.baseUrl)) {
        if (warned !== cfg.baseUrl) console.warn('[transcribe] TRANSCRIBE_PROVIDER=openai needs TRANSCRIBE_API_KEY or OPENAI_API_KEY; transcription is off');
        warned = cfg.baseUrl;
        return null;
      }
      return openAiCompatible(cfg);
    default:
      return null;
  }
}

/** Liveness of the whisper.cpp server, for /api/health. It answers GET / once the model is loaded. */
export async function whisperPing(timeoutMs = 1500): Promise<void> {
  const r = await fetch(transcribeConfig().whisperUrl + '/', { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}
