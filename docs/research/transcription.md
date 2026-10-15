# Hosted transcription: model choice and limits

Research for D-085 (2026-10-14): which hosted speech-to-text model open-toolbar offers next to local whisper.cpp. Voice notes are reviewer narration over a web app, often several minutes long, sometimes Swahili or Swahili/English code-switched (Nuru). The output must be WebVTT aligned to the recording.

## Recommendation

Default hosted model: **OpenAI `gpt-transcribe`** at $0.0045 per minute ($0.27 per hour), called on pause-aligned chunks of at most 30 s, with cue times taken from the chunk offsets and split per sentence.

- Best measured accuracy per dollar on every clip once chunked: 7.0% WER English, 15.1% on the code-switched clip, 25.6% WER / 13.9% CER on 8.9 min of Swahili (tables below).
- 25% cheaper than `whisper-1` and `gpt-4o-transcribe` ($0.006), and OpenAI's own guide now lists it as the recommended transcription model, with the `gpt-4o-*-transcribe` pair marked legacy.
- It returns text only (`json` or `text`; `vtt`, `srt` and `verbose_json` are refused with HTTP 400), so open-toolbar has to make the timestamps. Chunking does that and also fixes the model's habit of dropping sentences in long single requests.
- `/v1/audio/transcriptions` keeps no data at OpenAI: no training, no abuse-monitoring retention, eligible for Zero Data Retention.

`whisper-1` stays as the fallback for providers that only offer Whisper. Any OpenAI-compatible server that returns `vtt` (Groq, speaches) uses the native path and needs no chunking.

## 1. Survey (verified 2026-10-14)

OpenAI facts come from the pricing page, the speech-to-text guide, the model pages and the data-controls guide (links at the end), and from calling the API with the project's key. `GET /v1/models` on that key lists `whisper-1`, `gpt-4o-mini-transcribe` (snapshots 2025-03-20 and 2025-12-15), `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`, `gpt-transcribe`, and the realtime-only `gpt-live-transcribe` and `gpt-realtime-whisper`.

### OpenAI

| Model | Price | Timestamps / VTT | Notes |
|---|---|---|---|
| `gpt-transcribe` | $0.0045/min, billed per second of audio | none; `json` or `text` only | Recommended by OpenAI. Takes `prompt`, `keywords` and `languages` (an array that replaces `language`). Returns detected languages (`"languages":[{"code":"sw"}]`). Streaming gives text deltas without times. Build tier: 5,000 RPM. |
| `gpt-4o-transcribe` | $0.006/min estimate ($2.50 in / $10 out per 1M tokens) | none; `json` or `text` only | Legacy. 16k context, 2,000 max output tokens. |
| `gpt-4o-mini-transcribe` | $0.003/min estimate ($1.25 / $5 per 1M tokens) | none; `json` or `text` only | Legacy. 16k context, **2,000 max output tokens**: our 8.9 min Swahili request used 1,968 of them. Build tier: 2,000 RPM. |
| `gpt-4o-transcribe-diarize` | $0.006/min | speaker segments (`diarized_json`) | Needs `chunking_strategy` above 30 s. Not needed for one narrator. |
| `whisper-1` | $0.006/min | `vtt`, `srt`, `verbose_json` with segment or word times | Segment times are whole seconds in practice (`00:00:18.000`). Prompt limited to 224 tokens. No streaming. |

Shared limits: 25 MB per file; formats mp3, mp4, mpeg, mpga, m4a, wav, webm (WebM/Opus from the extension is accepted as is). The docs state no duration cap; a single 8 min 52 s file worked for every model. The data-controls table lists `/v1/audio/transcriptions` as: not used for training, no abuse-monitoring retention, no application state, ZDR eligible.

Swahili: the guide's language list is not explicit about Swahili, but every model accepted it, `gpt-transcribe` detected `sw`, and `whisper-1` reported `"language":"swahili"`.

### Others (price and quality comparison only)

| Provider / model | $/min | Max file / duration | WebM/Opus | Timestamps | OpenAI-compatible | Swahili | Retention |
|---|---|---|---|---|---|---|---|
| Groq `whisper-large-v3-turbo` | $0.00067 ($0.04/h) | 25 MB free, 100 MB dev tier; 10 s minimum bill | yes | segment/word in `verbose_json` | yes, `https://api.groq.com/openai/v1` | Whisper weights (FLEURS sw WER about 39.5% for large-v3, per ElevenLabs' comparison) | not retained by default, ZDR toggle |
| Groq `whisper-large-v3` | $0.00185 ($0.111/h) | same | yes | same | yes | same | same |
| Deepgram Nova-3 | $0.0043 mono, $0.0052 multilingual | 2 GB; sync requests time out past 10 min | not enumerated | word times; VTT via helper library | no | **not supported** | opt out of model improvement with `mip_opt_out=true` |
| AssemblyAI Universal-2 | $0.0025 | 5 GB, up to 10 h | yes | word times; native `GET .../vtt` | no (async jobs) | yes (`sw`), no published WER | ZDR only with training opt-out |
| ElevenLabs Scribe | about $0.17-0.20 from a credit pool; no plain pay-as-you-go | 3-5 GB, 10 h | yes | word times | no | "High accuracy" tier; ElevenLabs cites FLEURS sw WER 10.2% | ZDR only on Enterprise |
| Mistral `voxtral-mini-transcribe-26-02` | $0.001 at launch (2025), $0.003 via OpenRouter today; Mistral's page did not render | up to 3 h | not confirmed | segment/word | same path and shape | **not among its 13 languages** | ZDR on request |
| Google Gemini 2.5 Flash / Flash-Lite | $0.0019 / $0.00058 (32 audio tokens per second) | about 9.5 h per request | yes | only as generated text, not a structured field | no | no published figure | paid tier not used for training; free tier is |

The third-party rows come from each vendor's pricing and docs pages (sources at the end); the Mistral price and the Swahili WER figures are the least certain. Deepgram and Voxtral drop out because they do not support Swahili. ElevenLabs reports the best Swahili number but costs about 40 times more and has no OpenAI-compatible endpoint. Groq Whisper is the cheapest compatible option; it shares Whisper's weaker Swahili, and `whisper-1` scored 53.7% WER on our Swahili clip, so it fits as a budget alternative that works through `TRANSCRIBE_BASE_URL` with no new code.

## 2. Measurements

### Test audio

All clips come from **FLEURS** (`google/fleurs`, CC BY 4.0), test split, `sw_ke` (Kenyan Swahili) and `en_us`, read speech with reference transcripts. FLEURS was streamed from the Hugging Face tarball; Common Voice needs a login and was skipped.

| Clip | Content | Length |
|---|---|---|
| `en_short` | FLEURS en_us 1904 | 11.4 s |
| `sw_short` | FLEURS sw_ke 1999 | 18.8 s |
| `en_3min` | 16 English sentences, 0.8 s pauses | 2 min 43 s |
| `mix_sw_en` | 16 sentences alternating Swahili and English, different speakers | 3 min 11 s |
| `sw_long` | 36 Swahili sentences | 8 min 52 s |

Each was encoded the way the extension records (`audio/webm;codecs=opus`, 48 kHz mono, Chrome's default 128 kbps). The sentence start times in the concatenations are known exactly, which gives a timestamp reference.

Caveats. FLEURS is read speech by many speakers; one reviewer narrating is easier (one voice, fewer speaker changes). The code-switched clip switches between sentences, not inside them. Swahili WER is inflated by numerals (reference "1960", models write "elfu moja mia tisa sitini") and by spelling variants ("mojawapo" / "moja wapo"), so CER is the steadier Swahili number. Each configuration ran once.

Scripts and outputs: `/tmp/claude-1000/transcribe-research/` on the dev VM (`build.py`, `run.py`, `chunk.py`, `eval.py`, `split2.py`, `out/`, `results.json`). WER and CER via `jiwer` after lowercasing and stripping punctuation.

### One request per file

| Model | en_3min WER | mix WER (words kept of 338) | sw_long WER / CER (words kept of 737) | sw_long latency | Timestamps |
|---|---|---|---|---|---|
| `gpt-transcribe` | 5.8% | 34.0% (250) | 31.9% / 22.2% (642) | 11.0 s | none |
| `gpt-4o-transcribe` | **4.7%** | 94.7% (**37**) | 36.6% / **9.3%** (757) | 19.3 s | none |
| `gpt-4o-mini-transcribe` | 21.2% (298 words) | 107.1% (391, repeated text) | 52.8% / 45.4% (443) | 8.9 s | none |
| `whisper-1` (`vtt`) | 26.2% (283 words) | 66.9% (181) | 53.7% / 29.0% (614) | 32.2 s | median cue-start error 0.8 / 4.3 / 0.95 s |
| `gpt-transcribe`, `languages[]=sw` | | | 31.8% / 22.5% | 10.5 s | none |

Short clips: all four models scored 5.3% on `en_short` (one word: the reference says "year"). On `sw_short`, `gpt-4o-transcribe` 4.8%, `gpt-4o-mini-transcribe` 28.6%, `gpt-transcribe` 33.3%, `whisper-1` 33.3%; most of the gap is the spelled-out year.

The main finding: every model **drops sentences** in long single requests, worst at speaker or language changes. `gpt-4o-transcribe` returned the first Swahili sentence of the mixed clip and stopped. `gpt-transcribe` dropped the first and last sentences of the mixed clip and 13% of the Swahili words. An 8.9 min Swahili request to `gpt-4o-mini-transcribe` without a language hint produced 1,968 output tokens, close to its 2,000 cap. The Swahili hint changed nothing measurable for `gpt-transcribe`.

### Pause-aligned chunks (max 30 s), 8 parallel requests

| Model | en_3min WER | mix WER | sw_long WER / CER | sw_long wall time | Billed audio |
|---|---|---|---|---|---|
| **`gpt-transcribe`** | 7.0% | **15.1%** | **25.6% / 13.9%** | **5.2 s** | 545 s for 532 s (+2.4%) |
| `gpt-4o-mini-transcribe` | 18.7% | 51.5% | 31.9% / 20.7% | 11.4 s | tokens |
| `gpt-4o-transcribe` | 49.9% | 60.1% | 41.5% / 36.6% | 9.7 s | tokens |
| `gpt-transcribe`, max 12 s | 9.2% | 12.1% | 28.5% / 15.6% | 11.1 s | 564 s (+6%) |

Chunking turned `gpt-transcribe` from the second-best into the clear best, and cut wall time for 9 minutes of audio from 11 s to 5 s. The `gpt-4o-*` models still dropped whole sentences inside 30 s chunks that held two or three speakers (`gpt-4o-transcribe` kept 190 of 359 English words), so they are unreliable for this input.

Timestamp accuracy after splitting each chunk's text into sentences, timed by each sentence's share of the chunk's voiced time (median distance between a reference sentence start and the nearest cue start; the reference start includes FLEURS' leading silence of up to about a second, so 0.5-1 s is close to the floor):

| Method | en_3min | mix | sw_long |
|---|---|---|---|
| `whisper-1` native VTT | 0.80 s | 4.30 s | 0.95 s |
| `gpt-transcribe`, 30 s chunks, sentence split | 0.80 s | 0.94 s | 1.14 s |
| `gpt-transcribe`, 12 s chunks, sentence split | 0.35 s | 0.72 s | 0.54 s |

Chunk-derived cues match or beat `whisper-1`. Thirty-second chunks give the best text and about one second of timing error, which a viewer jumping to a cue will not notice; `TRANSCRIBE_CHUNK_SECONDS=12` buys tighter cues for about 4% more billed audio and slightly worse text.

### Cost

Measured: `gpt-transcribe` bills by audio seconds rounded per request (533 s for one 532.4 s file; 545 s for the same audio in 23 chunks). A 5-minute voice note costs about $0.023, an hour $0.27-0.28 with chunk overhead. Total spend for this research: about $1.35 by list price (an upper bound, since token-billed models were counted at their per-minute estimate).

### Local whisper.cpp on the same clips

These runs used the compose image (same digest) in two private containers on ports 18081 and 18082, so the shared `whisper` service on :8080 stayed free for the other workflow. Each container was capped at 2 vCPUs on a 4-vCPU VM whose load average was 6-15 from other work, so the times are pessimistic.

| whisper.cpp | en_3min WER | mix WER | sw_long WER / CER | sw_long time | Median cue-start error (en / mix / sw) |
|---|---|---|---|---|---|
| `base` (compose default) | 17.5% | 76.3% | 94.8% / 54.9% | 115 s | 0.29 / 0.47 / 1.24 s |
| `small` | 38.2% (dropped text) | 69.2% | 80.1% / 38.4% | 361 s | 1.23 / 0.88 / 1.40 s |
| `small`, `language=sw` | | | 80.1% / 38.4% | 294 s | |

Local whisper.cpp gives good timestamps and acceptable English, but its Swahili output is not usable for a reader (CER 38-55%). For Nuru the hosted model is the real option.

## 3. Limits and how to handle them

**File size: 25 MB per request.** At the extension's 128 kbps Opus that is about 27 minutes (8.2 MB for 8 min 52 s). Chunking removes the limit: each chunk is re-encoded with the server's ffmpeg to 48 kbps mono Opus, about 180 KB per 30 s.

**No timestamps from `gpt-*` models.** Confirmed by calling the API: `response_format=vtt` and `verbose_json` return HTTP 400 `"response_format 'vtt' is not compatible with model ... Use 'json' or 'text' instead."` Streaming (`stream=true`) yields only `transcript.text.delta` and `transcript.text.done` events, without times. So:

1. Decode the voice track to 16 kHz mono PCM (ffmpeg, already in the server image).
2. Find pauses with an adaptive energy detector: 30 ms frames, threshold = local 10th percentile + 0.35 x (95th - 10th percentile) over a 10 s window, pauses of 0.3 s or more. A fixed `silencedetect=-35dB` failed here: some FLEURS recordings sit at -60 dB RMS, which is quieter than the threshold, so speech was treated as silence. Laptop microphones vary as much.
3. Cut contiguous chunks: from the chunk start, cut at the centre of the longest pause between 15 s and 30 s. With no pause in that window, cut hard at 30 s and start the next chunk 1 s earlier; drop the repeated words where the two texts overlap. Chunks with no voiced frames are skipped (saves money and avoids "Thank you." style hallucinations on silence).
4. Transcribe chunks in parallel (4-8 at once; well under the 5,000 RPM limit), `response_format=json`, retry 429 and 5xx with backoff.
5. Build cues: split each chunk's text at sentence ends and spread the sentences over the chunk's voiced time by character share; keep cues under about 7 s by splitting long sentences at commas. Offsets are chunk start + position, so cues line up with the recording.
6. Store `model`, detected `languages` and billed seconds with the transcript.

**Native-timestamp models (`whisper-1`, Groq Whisper, speaches).** Send `response_format=vtt` as today; for files over 25 MB use the same chunking and add each chunk's offset to its cue times. Groq bills at least 10 s per request, so keep chunks long there.

**Output caps.** `gpt-4o-mini-transcribe` stops at 2,000 output tokens; 30 s chunks stay far below it.

**Language.** Leave it on automatic detection. Code-switched narration needs no hint, and the Swahili hint gave no gain. `TRANSCRIBE_LANGUAGE` is there for single-language deployments.

## 4. Configuration design

| Variable | Default | Meaning |
|---|---|---|
| `TRANSCRIBE_PROVIDER` | `local` | `local` (whisper.cpp), `openai` (any OpenAI-compatible endpoint) or `none`. Accept the current `whispercpp` and `openai-compatible` as aliases. |
| `TRANSCRIBE_MODEL` | `gpt-transcribe` when the provider is `openai` | Model id sent to the endpoint. Local whisper keeps `WHISPER_MODEL`. |
| `TRANSCRIBE_API_KEY` | falls back to `OPENAI_API_KEY` | Bearer token. Setting either key with no provider set does not switch providers on its own; the admin chooses `openai` explicitly. |
| `TRANSCRIBE_BASE_URL` | `https://api.openai.com/v1` | Includes `/v1`, as OpenAI SDKs expect. Groq: `https://api.groq.com/openai/v1`. The server posts to `${TRANSCRIBE_BASE_URL}/audio/transcriptions`. |
| `TRANSCRIBE_LANGUAGE` | empty (auto) | ISO 639-1 hint, or a comma list such as `sw,en`; sent as `languages[]` to `gpt-transcribe`, as `language` (first entry) to others. |
| `TRANSCRIBE_TIMESTAMPS` | `auto` | `native` asks for `vtt`; `chunked` uses step 3 above; `auto` picks `chunked` for `gpt-*` model ids and otherwise tries `vtt`, switching to `chunked` (and remembering it) on the 400 "not compatible" error. |
| `TRANSCRIBE_CHUNK_SECONDS` | `30` | Longest chunk; 12 gives tighter cues for about 4% more cost. |
| `TRANSCRIBE_MAX_MINUTES` | `60` | Recordings longer than this are not sent; the transcript row is marked `skipped` with the reason. |
| `TRANSCRIBE_MONTHLY_MINUTES` | empty (no cap) | Cost guard: the server sums billed seconds per calendar month and stops sending audio past the cap (transcripts marked `skipped: monthly limit`). |
| `TRANSCRIBE_CONCURRENCY` | `4` | Parallel chunk requests per recording. With a hosted provider the `transcribe` job no longer needs whisper.cpp's concurrency of 1. |

The current code reads `STT_URL` and appends `/v1/audio/transcriptions`, and always asks for `response_format=vtt`. With `gpt-transcribe` that request fails with HTTP 400, so the hosted path needs the chunked mode before `gpt-*` models work. `STT_URL`, `STT_API_KEY` and `STT_MODEL` can stay as deprecated aliases (with `STT_URL` treated as a base without `/v1`).

Cost guard in the docs: at $0.0045/min, 1,000 five-minute notes cost about $23. `TRANSCRIBE_MONTHLY_MINUTES=6000` caps a month at about $27.

### Privacy note for `docs/configuration.md`

> With `TRANSCRIBE_PROVIDER=openai`, the microphone track of each recording is sent from your server to the provider at `TRANSCRIBE_BASE_URL` for transcription. Only the voice audio is sent: no video, screenshots, console or network data. OpenAI states that audio sent to `/v1/audio/transcriptions` is not used for training and is not retained for abuse monitoring, and the endpoint is eligible for Zero Data Retention; other providers have their own terms, so check them before pointing `TRANSCRIBE_BASE_URL` elsewhere. Keep the default `local` provider when recordings must not leave your server.

## 5. Test fixtures

Commit two short FLEURS clips, re-encoded to WebM/Opus at 32 kbps mono (sizes measured):

- `apps/server/fixtures/transcribe/fleurs-sw_ke-1999.webm`: 18.8 s, 70 KB. Reference: "Katika miaka yote ya 1960, Brzezinski alimfanyia kazi John F. Kennedy kama mshauri wake na pia utawala wa Lyndon B. Johnson."
- `apps/server/fixtures/transcribe/fleurs-en_us-1904.webm`: 11.4 s, 41 KB. Reference: "However, due to the slow communication channels, styles in the west could lag behind by 25 to 30 year."
- `apps/server/fixtures/transcribe/ATTRIBUTION.md`: FLEURS, Conneau et al. 2022, https://huggingface.co/datasets/google/fleurs, CC BY 4.0, test split ids 1999 (sw_ke) and 1904 (en_us), re-encoded to Opus; plus both reference texts.

CC BY 4.0 permits redistribution and modification with attribution, so this is safe to commit. `gpt-transcribe` on the 32 kbps Swahili fixture gave the same text as on the 128 kbps source.

Tests:

- Unit (CI, no network): recorded HTTP responses for `gpt-transcribe` (`json` with `languages` and `usage`), the 400 "not compatible" body, and a `whisper-1` VTT body. Check cue building, offsets, the `auto` fallback, overlap de-duplication and the monthly guard.
- Chunker (CI, no network): build a 2-minute file at test time from the two fixtures with ffmpeg (alternating, with 0.8 s and 2 s pauses, one span amplified 30 dB down to mimic a quiet microphone) and assert every cut falls inside a pause. No extra bytes committed.
- Live (skipped unless `TRANSCRIBE_LIVE_TEST=1` and a key are set): transcribe both fixtures with `gpt-transcribe`; assert detected `sw` / `en`, CER under 25%, and cues inside the clip's duration. Cost about $0.002 per run.

## Sources

- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI speech to text guide: https://developers.openai.com/api/docs/guides/speech-to-text
- `gpt-transcribe` model page: https://developers.openai.com/api/docs/models/gpt-transcribe
- `gpt-4o-mini-transcribe` model page: https://developers.openai.com/api/docs/models/gpt-4o-mini-transcribe
- OpenAI data controls: https://developers.openai.com/api/docs/guides/your-data
- Groq: https://console.groq.com/docs/speech-to-text, https://console.groq.com/docs/model/whisper-large-v3-turbo, https://console.groq.com/docs/rate-limits, https://console.groq.com/docs/your-data
- Deepgram: https://deepgram.com/pricing, https://developers.deepgram.com/docs/models-languages-overview, https://developers.deepgram.com/docs/the-deepgram-model-improvement-partnership-program
- AssemblyAI: https://www.assemblyai.com/pricing, https://www.assemblyai.com/docs/faq/what-languages-do-you-support-, https://www.assemblyai.com/docs/pre-recorded-audio/export-transcripts-as-srt-vtt-or-text
- ElevenLabs: https://elevenlabs.io/pricing, https://elevenlabs.io/docs/capabilities/speech-to-text, https://elevenlabs.io/speech-to-text/swahili
- Mistral: https://docs.mistral.ai/capabilities/audio/, https://docs.mistral.ai/api/endpoint/audio/transcriptions, https://openrouter.ai/mistralai/voxtral-mini-transcribe/pricing
- Gemini: https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/audio
- FLEURS: https://huggingface.co/datasets/google/fleurs (CC BY 4.0)
