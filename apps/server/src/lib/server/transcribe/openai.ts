// OpenAI-compatible `/audio/transcriptions` client: one request per audio file or chunk, with
// retries. `json` for the text-only gpt-* models, `vtt` for Whisper-style servers.

export interface HttpTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export interface TextReply {
  text: string;
  /** detected language codes (gpt-transcribe returns `languages: [{ code }]`) */
  languages: string[];
  /** billed audio seconds when the endpoint reports them (`usage.type = duration`) */
  seconds: number | null;
}

export class TranscribeHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly retryable: boolean;
  constructor(status: number, body: string, retryable: boolean) {
    super(`transcription HTTP ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.retryable = retryable;
  }
  /** HTTP 400 "response_format 'vtt' is not compatible with model ...": the model returns text only */
  get formatRefused() {
    return this.status === 400 && /response_format|not compatible/i.test(this.body);
  }
}

export interface RetryPolicy {
  attempts: number;
  baseMs: number;
  maxMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const defaultRetry: RetryPolicy = {
  attempts: 4,
  baseMs: 1000,
  maxMs: 30_000,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

const fileName = (mime: string) =>
  mime.includes('wav') ? 'audio.wav' : mime.includes('ogg') ? 'audio.ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'audio.m4a' : mime.includes('mp') ? 'audio.mp3' : 'audio.webm';

function retryAfterMs(h: string | null): number | null {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s)) return s * 1000;
  const d = Date.parse(h);
  return Number.isFinite(d) ? Math.max(0, d - Date.now()) : null;
}

/** POST one file; retries 408, 429 (except an exhausted quota), 5xx and network errors with backoff. */
export async function postTranscription(
  t: HttpTarget,
  audio: Uint8Array,
  mime: string,
  fields: Record<string, string | string[]>,
  retry: RetryPolicy = defaultRetry,
): Promise<string> {
  const f = t.fetchImpl ?? fetch;
  let last: unknown = null;
  for (let attempt = 1; attempt <= retry.attempts; attempt++) {
    const form = new FormData();
    form.set('file', new Blob([audio as Uint8Array<ArrayBuffer>], { type: mime }), fileName(mime));
    form.set('model', t.model);
    for (const [k, v] of Object.entries(fields)) {
      if (Array.isArray(v)) for (const x of v) form.append(k, x);
      else form.set(k, v);
    }
    let wait: number | null = null;
    try {
      const r = await f(`${t.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        body: form,
        headers: t.apiKey ? { authorization: `Bearer ${t.apiKey}` } : {},
        signal: AbortSignal.timeout(5 * 60_000),
      });
      const body = await r.text();
      if (r.ok) return body;
      const quota = r.status === 429 && /insufficient_quota|billing/i.test(body);
      const retryable = !quota && (r.status === 408 || r.status === 409 || r.status === 429 || r.status >= 500);
      last = new TranscribeHttpError(r.status, body, retryable);
      if (!retryable) throw last;
      wait = retryAfterMs(r.headers.get('retry-after'));
    } catch (e) {
      if (e instanceof TranscribeHttpError && !e.retryable) throw e;
      last = e;
    }
    if (attempt < retry.attempts) {
      const backoff = Math.min(retry.maxMs, retry.baseMs * 2 ** (attempt - 1));
      await retry.sleep(Math.min(retry.maxMs, wait ?? backoff + Math.random() * retry.baseMs * 0.25));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

/** Text of one chunk with `response_format=json`. */
export async function transcribeText(t: HttpTarget, audio: Uint8Array, mime: string, languages: string[], retry?: RetryPolicy): Promise<TextReply> {
  const fields: Record<string, string | string[]> = { response_format: 'json' };
  if (languages.length) {
    // gpt-transcribe takes a list; the older models one `language`
    if (/^gpt-transcribe/i.test(t.model)) fields['languages[]'] = languages;
    else fields.language = languages[0]!;
  }
  const body = await postTranscription(t, audio, mime, fields, retry);
  let j: { text?: unknown; language?: unknown; languages?: unknown; usage?: { type?: string; seconds?: unknown } };
  try {
    j = JSON.parse(body);
  } catch {
    // a server that ignored response_format and sent plain text
    return { text: body.trim(), languages: [], seconds: null };
  }
  const langs: string[] = [];
  if (Array.isArray(j.languages)) for (const l of j.languages) if (l && typeof (l as { code?: unknown }).code === 'string') langs.push((l as { code: string }).code);
  if (typeof j.language === 'string' && j.language) langs.push(j.language);
  const seconds = j.usage?.type === 'duration' && typeof j.usage.seconds === 'number' ? j.usage.seconds : null;
  return { text: typeof j.text === 'string' ? j.text.trim() : '', languages: langs, seconds };
}

/** WebVTT of one file with `response_format=vtt` (whisper-1, Groq Whisper, speaches). */
export async function transcribeVtt(t: HttpTarget, audio: Uint8Array, mime: string, languages: string[], retry?: RetryPolicy): Promise<string> {
  const fields: Record<string, string> = { response_format: 'vtt' };
  if (languages[0]) fields.language = languages[0];
  return postTranscription(t, audio, mime, fields, retry);
}
