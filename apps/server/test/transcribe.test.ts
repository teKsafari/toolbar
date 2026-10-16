// Transcription (D-087) without network or ffmpeg: settings, pause detection and chunk planning on
// synthetic PCM, cue building, and the OpenAI-compatible client against recorded responses
// (gpt-transcribe `json`, the 400 that refuses `vtt`, a whisper-1 VTT body), with retries and the
// length and monthly guards.
import { afterEach, describe, expect, it } from 'vitest';
import { findPauses, planChunks, SAMPLE_RATE, voicedIn, type Pause } from '../src/lib/server/transcribe/chunk.ts';
import { normaliseProvider, transcribeConfig } from '../src/lib/server/transcribe/config.ts';
import { _resetVttMemo, createTranscriber, openAiCompatible, voiceNoteStream } from '../src/lib/server/transcribe/index.ts';
import { postTranscription, transcribeText, TranscribeHttpError, type RetryPolicy } from '../src/lib/server/transcribe/openai.ts';
import { memoryLedger, monthOf, runTranscription } from '../src/lib/server/transcribe/run.ts';
import { buildVtt, cuesForChunk, dropOverlap, formatTime, parseVtt, sentences } from '../src/lib/server/transcribe/vtt.ts';
import type { Transcriber } from '../src/lib/server/transcribe/index.ts';

// ---------- recorded responses (docs/research/transcription.md, 2026-10-14) ----------

const GPT_JSON_SW = JSON.stringify({
  text: 'Katika miaka yote ya 1960, Brzezinski alimfanyia kazi John F. Kennedy kama mshauri wake na pia utawala wa Lyndon B. Johnson.',
  languages: [{ code: 'sw' }],
  usage: { type: 'duration', seconds: 19 },
});
const GPT_JSON_EN = JSON.stringify({
  text: 'However, due to the slow communication channels, styles in the West could lag behind by 25 to 30 years.',
  languages: [{ code: 'en' }],
  usage: { type: 'duration', seconds: 11 },
});
const VTT_REFUSED = JSON.stringify({
  error: {
    message: "response_format 'vtt' is not compatible with model 'gpt-transcribe'. Use 'json' or 'text' instead.",
    type: 'invalid_request_error',
    param: 'response_format',
    code: 'unsupported_value',
  },
});
const WHISPER_VTT = 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHowever, due to the slow communication channels,\n\n00:00:05.000 --> 00:00:10.000\nstyles in the West could lag behind by 25 to 30 years.\n';
const QUOTA = JSON.stringify({ error: { message: 'You exceeded your current quota.', type: 'insufficient_quota', code: 'insufficient_quota' } });

const noSleep: RetryPolicy = { attempts: 4, baseMs: 1, maxMs: 1, sleep: async () => {} };

type Seen = { url: string; auth: string; form: FormData };
function fakeFetch(answer: (form: FormData, n: number) => Promise<Response> | Response) {
  const seen: Seen[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const form = init.body as FormData;
    seen.push({ url, auth: (init.headers as Record<string, string>).authorization ?? '', form });
    return answer(form, seen.length);
  }) as unknown as typeof fetch;
  return { f, seen };
}

// ---------- synthetic PCM ----------

/** Speech as a tone with a syllable-rate envelope, silence as faint noise; level in dBFS. */
function pcmOf(parts: { s: number; speech: boolean; db?: number }[]): { pcm: Int16Array; pauses: Pause[] } {
  const total = parts.reduce((n, p) => n + p.s, 0);
  const pcm = new Int16Array(Math.round(total * SAMPLE_RATE));
  const pauses: Pause[] = [];
  let t = 0;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (const p of parts) {
    const a = Math.round(t * SAMPLE_RATE);
    const z = Math.round((t + p.s) * SAMPLE_RATE);
    const amp = 32767 * 10 ** ((p.db ?? -20) / 20);
    for (let i = a; i < z; i++) {
      const x = i / SAMPLE_RATE;
      pcm[i] = p.speech ? Math.round(amp * Math.sin(2 * Math.PI * 220 * x) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * x))) : Math.round(amp * 0.003 * rnd());
    }
    if (!p.speech) pauses.push({ start: t, end: t + p.s });
    t += p.s;
  }
  return { pcm, pauses };
}

/** Speech of `n` sentences of `len` seconds with `gap` second pauses, at `db`. */
const sentencesPcm = (n: number, len: number, gap: number, db = -20) =>
  pcmOf(Array.from({ length: n }, (_, i) => [{ s: len, speech: true, db }, ...(i < n - 1 ? [{ s: gap, speech: false, db }] : [])]).flat());

const inPause = (t: number, pauses: Pause[], slack = 0.06) => pauses.some((p) => t >= p.start - slack && t <= p.end + slack);

// ---------- settings ----------

describe('transcription settings', () => {
  const env0 = { ...process.env };
  afterEach(() => {
    process.env = { ...env0 };
  });
  const clear = () => {
    for (const k of Object.keys(process.env)) if (/^(TRANSCRIBE_|STT_|OPENAI_API_KEY|WHISPER_)/.test(k)) delete process.env[k];
  };

  it('defaults to off (D-194), 30 s chunks, 60 min per recording, no monthly cap', () => {
    clear();
    const c = transcribeConfig();
    expect(c).toMatchObject({ provider: 'none', baseUrl: 'https://api.openai.com/v1', model: 'gpt-transcribe', chunkSeconds: 30, maxMinutes: 60, monthlyMinutes: null, concurrency: 4, timestamps: 'auto', languages: [] });
  });

  it('accepts the old provider names and the STT_* variables', () => {
    expect(normaliseProvider('whispercpp')).toBe('local');
    expect(normaliseProvider('openai-compatible')).toBe('openai');
    expect(normaliseProvider('none')).toBe('none');
    clear();
    Object.assign(process.env, { TRANSCRIBE_PROVIDER: 'openai-compatible', STT_URL: 'http://speaches:8000/', STT_MODEL: 'Systran/faster-whisper-small', STT_API_KEY: 'old' });
    expect(transcribeConfig()).toMatchObject({ provider: 'openai', baseUrl: 'http://speaches:8000/v1', model: 'Systran/faster-whisper-small', apiKey: 'old' });
  });

  it('TRANSCRIBE_API_KEY wins over OPENAI_API_KEY; a key alone does not switch provider', () => {
    clear();
    process.env.OPENAI_API_KEY = 'from-openai';
    expect(transcribeConfig()).toMatchObject({ provider: 'none', apiKey: 'from-openai' });
    process.env.TRANSCRIBE_API_KEY = 'own';
    expect(transcribeConfig().apiKey).toBe('own');
  });

  it('reads languages, chunk length, caps and timestamps mode', () => {
    clear();
    Object.assign(process.env, { TRANSCRIBE_LANGUAGE: 'sw, EN', TRANSCRIBE_CHUNK_SECONDS: '12', TRANSCRIBE_MONTHLY_MINUTES: '6000', TRANSCRIBE_MAX_MINUTES: '20', TRANSCRIBE_TIMESTAMPS: 'native', TRANSCRIBE_CONCURRENCY: '99' });
    expect(transcribeConfig()).toMatchObject({ languages: ['sw', 'en'], chunkSeconds: 12, monthlyMinutes: 6000, maxMinutes: 20, timestamps: 'native', concurrency: 16 });
  });

  it('the hosted provider without a key on api.openai.com is off; a keyless self-hosted endpoint is on', () => {
    clear();
    process.env.TRANSCRIBE_PROVIDER = 'openai';
    expect(createTranscriber()).toBeNull();
    process.env.TRANSCRIBE_BASE_URL = 'http://speaches:8000/v1';
    expect(createTranscriber()?.id).toBe('openai');
    process.env.TRANSCRIBE_PROVIDER = 'none';
    expect(createTranscriber()).toBeNull();
    process.env.TRANSCRIBE_PROVIDER = 'local';
    expect(createTranscriber()).toMatchObject({ id: 'local', hosted: false });
  });

  it('names voice-note transcript streams by asset', () => {
    expect(voiceNoteStream('0190a0b0-0000-7000-8000-000000000001')).toBe('voice:0190a0b0-0000-7000-8000-000000000001');
  });
});

// ---------- pauses and chunks ----------

describe('pause detection and chunk planning', () => {
  it('finds the pauses between sentences', () => {
    const { pcm, pauses } = sentencesPcm(6, 4, 0.8);
    const found = findPauses(pcm);
    expect(found.duration).toBeCloseTo(6 * 4 + 5 * 0.8, 1);
    for (const p of pauses) expect(found.pauses.some((f) => f.start <= p.start + 0.1 && f.end >= p.end - 0.1)).toBe(true);
    // no pause inside speech
    for (const f of found.pauses) expect(inPause((f.start + f.end) / 2, pauses)).toBe(true);
  });

  it('adapts to a quiet microphone (-60 dB speech)', () => {
    const { pcm, pauses } = sentencesPcm(5, 3, 1, -60);
    const found = findPauses(pcm);
    expect(found.pauses.length).toBeGreaterThanOrEqual(4);
    for (const f of found.pauses) expect(inPause((f.start + f.end) / 2, pauses)).toBe(true);
  });

  it('cuts at pauses, never past the chunk length, and covers the whole file', () => {
    const { pcm, pauses } = sentencesPcm(20, 4.5, 0.8);
    const found = findPauses(pcm);
    const chunks = planChunks(found.pauses, found.duration, 30);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks[0]!.start).toBe(0);
    expect(chunks.at(-1)!.end).toBeCloseTo(found.duration, 2);
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      expect(c.end - c.start).toBeLessThanOrEqual(30.001);
      expect(c.overlap).toBe(false);
      if (i > 0) {
        expect(c.start).toBe(chunks[i - 1]!.end);
        expect(inPause(c.start, pauses)).toBe(true);
      }
    }
  });

  it('cuts hard with a one second overlap when nobody pauses, and skips silent chunks', () => {
    const chunks = planChunks([], 70, 30);
    expect(chunks.map((c) => [c.start, c.end, c.overlap])).toEqual([
      [0, 30, false],
      [29, 59, true],
      [58, 70, true],
    ]);
    // 40 s of silence after 10 s of speech: only the speech is sent
    const quiet = planChunks([{ start: 10, end: 50 }], 50, 30);
    expect(quiet).toHaveLength(1);
    expect(quiet[0]!.voiced).toEqual([{ start: 0, end: 10 }]);
  });

  it('a 12 s chunk length gives shorter chunks', () => {
    const { pcm } = sentencesPcm(10, 3, 0.6);
    const found = findPauses(pcm);
    for (const c of planChunks(found.pauses, found.duration, 12)) expect(c.end - c.start).toBeLessThanOrEqual(12.001);
  });

  it('voiced spans are the complement of the pauses', () => {
    expect(voicedIn([{ start: 2, end: 3 }, { start: 5, end: 6 }], 0, 8)).toEqual([
      { start: 0, end: 2 },
      { start: 3, end: 5 },
      { start: 6, end: 8 },
    ]);
  });
});

// ---------- cues ----------

describe('WebVTT cues from chunk text', () => {
  it('splits sentences and places them on the voiced time, offset by the chunk start', () => {
    const cues = cuesForChunk('First sentence here. Second one is a bit longer here!', { start: 60, end: 70, voiced: [{ start: 60.5, end: 64 }, { start: 65, end: 69.5 }] });
    expect(cues).toHaveLength(2);
    expect(cues[0]!.startMs).toBe(60_500);
    expect(cues[0]!.text).toBe('First sentence here.');
    expect(cues[1]!.endMs).toBe(69_500);
    expect(cues[1]!.startMs).toBeGreaterThan(cues[0]!.startMs);
    expect(cues[0]!.endMs).toBeLessThanOrEqual(cues[1]!.startMs);
  });

  it('keeps cues under about 7 s by splitting long sentences at commas', () => {
    const text = 'Katika miaka yote ya 1960, Brzezinski alimfanyia kazi John F. Kennedy kama mshauri wake, na pia utawala wa Lyndon B. Johnson, kwa miaka mingi sana.';
    const cues = cuesForChunk(text, { start: 0, end: 20, voiced: [{ start: 0, end: 20 }] });
    expect(cues.length).toBeGreaterThanOrEqual(3);
    for (const c of cues) expect(c.endMs - c.startMs).toBeLessThanOrEqual(9000);
    expect(cues.map((c) => c.text).join(' ')).toBe(text);
  });

  it('drops the words a hard cut repeats', () => {
    expect(dropOverlap('we pressed the submit button', 'submit button and nothing happened')).toBe('and nothing happened');
    expect(dropOverlap('the order failed.', 'The order failed. Then it worked')).toBe('Then it worked');
    // one short shared word is left alone
    expect(dropOverlap('look at it', 'it works')).toBe('it works');
    expect(dropOverlap('nothing shared', 'completely new words')).toBe('completely new words');
  });

  it('builds WebVTT that parses back, with no timing arrow inside a cue', () => {
    const vtt = buildVtt([
      { startMs: 0, endMs: 1500, text: 'Hello.' },
      { startMs: 3_723_004, endMs: 3_724_000, text: 'a --> b' },
    ]);
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nHello.')).toBe(true);
    expect(parseVtt(vtt)).toEqual([
      { startMs: 0, endMs: 1500, text: 'Hello.' },
      { startMs: 3_723_004, endMs: 3_724_000, text: 'a -> b' },
    ]);
    expect(formatTime(61_005)).toBe('00:01:01.005');
    expect(buildVtt([])).toBe('WEBVTT\n');
  });

  it('splits sentences after full stops, question and exclamation marks', () => {
    expect(sentences('One. Two? Three!  Four')).toEqual(['One.', 'Two?', 'Three!', 'Four']);
  });
});

// ---------- the OpenAI-compatible client ----------

const target = (f: typeof fetch, model = 'gpt-transcribe') => ({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model, fetchImpl: f });

describe('OpenAI-compatible requests', () => {
  it('gpt-transcribe: json with languages[] and usage seconds', async () => {
    const { f, seen } = fakeFetch(() => new Response(GPT_JSON_SW));
    const r = await transcribeText(target(f), new Uint8Array([1]), 'audio/webm', ['sw', 'en'], noSleep);
    expect(r).toEqual({ text: expect.stringMatching(/^Katika miaka/), languages: ['sw'], seconds: 19 });
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(seen[0]!.auth).toBe('Bearer sk-test');
    expect(seen[0]!.form.get('model')).toBe('gpt-transcribe');
    expect(seen[0]!.form.get('response_format')).toBe('json');
    expect(seen[0]!.form.getAll('languages[]')).toEqual(['sw', 'en']);
    expect(seen[0]!.form.get('language')).toBeNull();
  });

  it('older models get one language field', async () => {
    const { f, seen } = fakeFetch(() => new Response(JSON.stringify({ text: 'x', usage: { type: 'tokens', total_tokens: 20 } })));
    const r = await transcribeText(target(f, 'gpt-4o-mini-transcribe'), new Uint8Array([1]), 'audio/webm', ['sw', 'en'], noSleep);
    expect(r.seconds).toBeNull();
    expect(seen[0]!.form.get('language')).toBe('sw');
    expect(seen[0]!.form.getAll('languages[]')).toEqual([]);
  });

  it('retries 429 and 5xx with backoff, honours Retry-After, then succeeds', async () => {
    const waits: number[] = [];
    const { f, seen } = fakeFetch((_, n) =>
      n === 1 ? new Response('{"error":{"message":"Rate limit"}}', { status: 429, headers: { 'retry-after': '2' } }) : n === 2 ? new Response('upstream', { status: 503 }) : new Response(GPT_JSON_EN),
    );
    const body = await postTranscription(target(f), new Uint8Array([1]), 'audio/webm', {}, { attempts: 4, baseMs: 100, maxMs: 30_000, sleep: async (ms) => void waits.push(ms) });
    expect(JSON.parse(body).languages).toEqual([{ code: 'en' }]);
    expect(seen).toHaveLength(3);
    expect(waits[0]).toBe(2000);
    expect(waits[1]).toBeGreaterThanOrEqual(200);
  });

  it('retries a network error, and gives up after the last attempt', async () => {
    let n = 0;
    const f = (async () => {
      n++;
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(postTranscription(target(f), new Uint8Array([1]), 'audio/webm', {}, noSleep)).rejects.toThrow(/fetch failed/);
    expect(n).toBe(4);
  });

  it('does not retry a bad key, a refused format or an exhausted quota', async () => {
    for (const [status, body] of [
      [401, '{"error":{"message":"Incorrect API key"}}'],
      [400, VTT_REFUSED],
      [429, QUOTA],
    ] as const) {
      const { f, seen } = fakeFetch(() => new Response(body, { status }));
      const err = await postTranscription(target(f), new Uint8Array([1]), 'audio/webm', {}, noSleep).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TranscribeHttpError);
      expect(seen).toHaveLength(1);
      expect((err as TranscribeHttpError).formatRefused).toBe(status === 400);
    }
  });
});

describe('transcribers', () => {
  afterEach(() => _resetVttMemo());

  // 3 sentences of 12 s with 1 s pauses: two chunks at 30 s
  const synthetic = sentencesPcm(3, 12, 1);
  const decode = async () => synthetic.pcm;
  // the "encoded" chunk is its time range as text, so the fake endpoint knows which chunk it got
  const encode = async (_: Int16Array, a: number, b: number) => new TextEncoder().encode(`${a.toFixed(2)}-${b.toFixed(2)}`);
  const cfg = { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-transcribe', languages: [], timestamps: 'auto' as const, chunkSeconds: 30, concurrency: 2 };

  it('chunked mode: one json request per chunk, cues offset by the chunk start, billed seconds summed', async () => {
    const ranges: string[] = [];
    const { f, seen } = fakeFetch(async (form) => {
      const range = await (form.get('file') as Blob).text();
      ranges.push(range);
      const first = range.startsWith('0.00');
      return new Response(JSON.stringify({ text: first ? 'One thing broke. Then another.' : 'Mambo yalikuwa mabaya.', languages: [{ code: first ? 'en' : 'sw' }], usage: { type: 'duration', seconds: first ? 26 : 13 } }));
    });
    const t = openAiCompatible(cfg, { fetchImpl: f, retry: noSleep, decode, encode });
    const r = await t.transcribe({ audio: new Uint8Array([1]), mime: 'audio/webm', durationMs: 38_000 });
    expect(seen).toHaveLength(2);
    expect(seen.every((s) => s.form.get('response_format') === 'json')).toBe(true);
    expect(r).toMatchObject({ mode: 'chunked', requests: 2, billedSeconds: 39, model: 'gpt-transcribe', language: 'en,sw' });
    const cues = parseVtt(r.vtt);
    expect(cues.map((c) => c.text)).toEqual(['One thing broke.', 'Then another.', 'Mambo yalikuwa mabaya.']);
    const secondStart = Number(ranges.find((x) => !x.startsWith('0.00'))!.split('-')[0]);
    expect(secondStart).toBeGreaterThan(20);
    expect(cues[2]!.startMs).toBeGreaterThanOrEqual(secondStart * 1000);
    expect(cues.at(-1)!.endMs).toBeLessThanOrEqual(38_000);
  });

  it('auto mode tries vtt for a Whisper model, falls back to chunks on the 400, and remembers it', async () => {
    const { f, seen } = fakeFetch((form) => (form.get('response_format') === 'vtt' ? new Response(VTT_REFUSED, { status: 400 }) : new Response(GPT_JSON_EN)));
    const t = openAiCompatible({ ...cfg, model: 'my-transcriber' }, { fetchImpl: f, retry: noSleep, decode, encode });
    const r = await t.transcribe({ audio: new Uint8Array([1]), mime: 'audio/webm', durationMs: 38_000 });
    expect(r.mode).toBe('chunked');
    expect(seen[0]!.form.get('response_format')).toBe('vtt');
    const before = seen.length;
    await t.transcribe({ audio: new Uint8Array([1]), mime: 'audio/webm', durationMs: 38_000 });
    expect(seen.slice(before).every((s) => s.form.get('response_format') === 'json')).toBe(true);
  });

  it('native mode keeps a whisper-1 VTT as sent', async () => {
    const { f, seen } = fakeFetch(() => new Response(WHISPER_VTT));
    const t = openAiCompatible({ ...cfg, model: 'whisper-1' }, { fetchImpl: f, retry: noSleep, decode, encode });
    const r = await t.transcribe({ audio: new Uint8Array([1]), mime: 'audio/webm', durationMs: 10_600 });
    expect(seen).toHaveLength(1);
    expect(r).toMatchObject({ mode: 'native', billedSeconds: 11, requests: 1 });
    expect(parseVtt(r.vtt)).toHaveLength(2);
  });

  it('native mode chunks a file over 24 MB and shifts each chunk VTT', async () => {
    const big = new Uint8Array(25 * 1024 * 1024);
    const { f, seen } = fakeFetch(() => new Response('WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nPart.\n'));
    const t = openAiCompatible({ ...cfg, model: 'whisper-1', timestamps: 'native' }, { fetchImpl: f, retry: noSleep, decode, encode });
    const r = await t.transcribe({ audio: big, mime: 'audio/webm', durationMs: 38_000 });
    expect(seen).toHaveLength(2);
    const cues = parseVtt(r.vtt);
    expect(cues[0]).toMatchObject({ startMs: 1000, endMs: 4000 });
    expect(cues[1]!.startMs).toBeGreaterThan(20_000);
  });

  it('TRANSCRIBE_TIMESTAMPS=native does not fall back', async () => {
    const { f } = fakeFetch(() => new Response(VTT_REFUSED, { status: 400 }));
    const t = openAiCompatible({ ...cfg, timestamps: 'native' }, { fetchImpl: f, retry: noSleep, decode, encode });
    await expect(t.transcribe({ audio: new Uint8Array([1]), mime: 'audio/webm' })).rejects.toThrow(/400/);
  });
});

// ---------- guards ----------

describe('length and monthly guards', () => {
  const fake = (hosted: boolean, billed = 0): Transcriber & { calls: number } => {
    const t = {
      id: hosted ? ('openai' as const) : ('local' as const),
      model: 'm',
      hosted,
      calls: 0,
      async transcribe() {
        t.calls++;
        return { vtt: 'WEBVTT\n', model: 'm', billedSeconds: billed, requests: 1, mode: 'chunked' as const };
      },
    };
    return t;
  };
  const now = new Date('2026-10-15T12:00:00Z');

  it('skips audio longer than TRANSCRIBE_MAX_MINUTES', async () => {
    const t = fake(true);
    const out = await runTranscription(t, { audio: new Uint8Array(), mime: 'audio/webm', durationMs: 61 * 60_000 }, { maxMinutes: 60, monthlyMinutes: null }, memoryLedger(), now);
    expect(out).toEqual({ status: 'skipped', reason: expect.stringMatching(/TRANSCRIBE_MAX_MINUTES/) });
    expect(t.calls).toBe(0);
  });

  it('reserves the length, settles to the billed seconds, and stops at the monthly cap', async () => {
    const ledger = memoryLedger();
    const t = fake(true, 310);
    const cfg = { maxMinutes: 60, monthlyMinutes: 10 };
    expect((await runTranscription(t, { audio: new Uint8Array(), mime: 'audio/webm', durationMs: 300_000 }, cfg, ledger, now)).status).toBe('done');
    expect(ledger.months[monthOf(now)]).toBe(310);
    // 310 s used of 600: a 5 min note still fits, a 5 min 1 s one does not
    const over = await runTranscription(t, { audio: new Uint8Array(), mime: 'audio/webm', durationMs: 291_000 }, cfg, ledger, now);
    expect(over).toEqual({ status: 'skipped', reason: expect.stringMatching(/monthly limit/) });
    expect(t.calls).toBe(1);
    // next month starts from zero
    expect((await runTranscription(t, { audio: new Uint8Array(), mime: 'audio/webm', durationMs: 291_000 }, cfg, ledger, new Date('2026-11-01T00:00:00Z'))).status).toBe('done');
  });

  it('gives the reservation back when the provider fails', async () => {
    const ledger = memoryLedger();
    const t: Transcriber = { id: 'openai', model: 'm', hosted: true, transcribe: async () => Promise.reject(new Error('HTTP 500')) };
    await expect(runTranscription(t, { audio: new Uint8Array(), mime: 'audio/webm', durationMs: 60_000 }, { maxMinutes: 60, monthlyMinutes: 100 }, ledger, now)).rejects.toThrow();
    expect(ledger.months[monthOf(now)]).toBe(0);
  });

  it('local whisper.cpp is free: no cap', async () => {
    const ledger = memoryLedger({ [monthOf(now)]: 1e9 });
    const out = await runTranscription(fake(false), { audio: new Uint8Array(), mime: 'audio/webm', durationMs: 60_000 }, { maxMinutes: 60, monthlyMinutes: 1 }, ledger, now);
    expect(out.status).toBe('done');
  });
});
