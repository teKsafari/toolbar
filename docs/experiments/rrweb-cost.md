# Experiment 1: rrweb size and CPU on a ten-minute Nuru lesson

PLAN "Part 2 specifics", "Experiments", item 1, run on 2026-10-16 against https://116.nuru.sh (Swahili course, Next.js 15, interpreter in a Web Worker). Nuru was not changed.

## Result in short

| | Recording off | Extension on, no trace | Trace |
|---|---|---|---|
| rrweb, raw | | | 4.77 MB a minute (46.8 MB in 9 min 49 s) |
| rrweb, gzipped (as uploaded) | | | 0.64 MB a minute (6.28 MB) |
| Upload, all streams | | | 14.3 MB: keyframes 7.74 MB, rrweb 6.28 MB, events 0.27 MB, card still 17 KB |
| CPU of the whole browser, 10 min | 130 s | 159 s (+22 %) | 278 s (+113 %) |
| Page main thread busy (`TaskDuration`) | 43.4 s | 46.8 s | 65.7 s |
| Extension JS in the page (content scripts) | 0 | 2.7 s | 12.6 s |
| Extension service worker JS | | 1.8 s | 20.7 s |
| Long tasks (over 50 ms) | 131, 9.2 s in all | 143, 9.9 s | 247, 18.9 s |
| Slow interaction events, 75th / 98th percentile | 72 / 136 ms | 72 / 128 ms | 88 / 176 ms |
| Page JS heap, peak | 32 MB | 38 MB | 72 MB |
| Service worker JS heap, peak | | 12 MB | 126 MB while tracing, 349 MB during Stop |
| Stop to upload done | | | 4.8 s |

Two thirds of the rrweb bytes and nine tenths of the gzipped upload come from one Nuru bug, not from the lesson: CodeMirror rewrote its whole `<style>` element on every keystroke (below). Without those 661 events the same session gzips to 0.74 MB, about 75 KB a minute.

## Method

- **Browser.** Playwright 1.63.0's Chromium 153 on its own Xvfb display `:262` (1280x800, openbox), its own profile, CDP on port 9462. The release build of the extension (`wxt build -b chrome` of main at `3a266c8`, the build `scripts/release-extension.sh` zips into `dist/`), signed in as a reviewer of the "Nuru" project (origin `https://116.nuru.sh`, preset "Staging, own team"), host access granted from the popup. Server: the compose stack on `http://localhost:3000`. Machine: 4 vCPU, 8 GB.
- **Session.** One script (`docs/experiments/scripts/session.mjs`) drives the same ten minutes three times with real input through xdotool: open `/sw`, then lessons 1 to 10 of "Misingi ya Nuru". On each lesson it reads for 12 to 20 s with the mouse wheel over the lesson text, types a program at 150 ms a key (about 400 keys in the session), runs it (Endesha), and waits 3 to 5 s. Along the way: two programs with errors (a parse error, an unknown name), the hint, Wasilisha (tests), the Terminali tab, the theme switch twice, EN and back to SW, a program that reads input and its answer, a reload with Ctrl+R; reading until 10 minutes. The three runs are:
  - **off**: the extension disabled (`--disable-extensions`), same profile;
  - **idle**: the extension on and granted, no trace (instant replay is off by default, so no rrweb; the page hooks and the ring buffer run);
  - **trace**: the reviewer opens the extension menu once (for screenshots, D-185), wakes the toolbar, `x` starts the trace at 0:12, `x` stops it at 10:00.
  Each run has a fresh browser process. The trace run was done twice; the second (`01a1456b-bc90-7bc6-a3ce-2724aba5e8fc`) is the one in the tables, the first (`01a1454e-49d0-7609-bf44-d20a14c7c006`) gave the same rrweb bytes to 0.1 % and the same main-thread time to 1 % (65.4 s); its process CPU was not read (a parser bug in the script, fixed before the three runs).
- **Measurements** (`docs/experiments/scripts/measure.mjs`), over the whole ten minutes:
  - page main thread: `Performance.getMetrics` with `timeDomain: threadTicks` (`TaskDuration`, `ScriptDuration`, `LayoutDuration`, `RecalcStyleDuration`), sampled every 5 s and summed;
  - who ran the JS: CDP `Profiler` sampling at 1 ms on the page target and on the extension's service worker, in one-minute profiles; each sample goes to the nearest frame with a script URL (`chrome-extension://...` is the extension, `https://116.nuru.sh` is Nuru);
  - process CPU: `utime + stime` from `/proc` for every process under our browser, grouped by `--type` (browser, renderer, extension renderer, GPU, network);
  - responsiveness: a `PerformanceObserver` injected before the page's scripts for `longtask`, `long-animation-frame` and `event` entries of 16 ms or more with an interaction id;
  - memory: `JSHeapUsedSize` of the page, `Runtime.getHeapUsage` of the service worker, RSS per process group, every 5 s;
  - sizes: chunk rows (`recording_chunk`, `recording_stream`, `asset`) from Postgres, and the rrweb chunks pulled with `GET /api/v1/recordings/:id/media/rrweb-NNN`, gunzipped and binned by minute by event timestamp (`docs/experiments/scripts/rrsize.mjs`).
- **Spend:** no OpenAI calls (0 USD).

## Size

rrweb by minute of the trace (second run):

| Minute | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| Raw, MB | 1.2 | 4.6 | 4.0 | 4.6 | 1.4 | 7.8 | 10.5 | 8.4 | 3.6 | 0.8 |
| Gzipped, KB | 117 | 679 | 616 | 657 | 194 | 1031 | 1311 | 1029 | 515 | 134 |

By rrweb event type: DOM mutations 42.8 MB in 3,645 events (91 %), 18 full snapshots (one every 30 s, `LIMITS.rrwebCheckoutMs`) 3.9 MB, mouse, scroll, selection and input 0.04 MB together.

Upload by stream: keyframes 83 PNGs, 7.74 MB (54 %, one every 7 s on average, 93 KB each); rrweb 12 gzipped chunks, 6.28 MB (44 %); `events` 271 KB gzipped (1.54 MB raw, 158 KB a minute raw); the card still 17 KB. Keyframes go up as they are taken; rrweb and events go up at Stop.

**The Nuru bug behind the bytes.** 30.3 MB of the 46.8 MB are 661 text nodes that start with `.ͼ1.cm-focused {...}`: CodeMirror's own stylesheet, recorded again in full each time it changes. On Nuru it changed on every keystroke and grew by four rules each time (26 KB after a reload, 94 KB after ten minutes of typing). gzip cannot share the repeats because each copy is longer than deflate's 32 KB window, which is why the ratio is only 7.5 to 1. The cause is in Nuru: `packages/ui/src/components/code-editor.tsx` passes a new `extensions` array, `basicSetup` object and `onChange` arrow on each render, and `@uiw/react-codemirror` 4.25.4 (Nuru's lockfile) reconfigures the editor on each and builds a new size theme every time. 4.25.12 caches that theme. A standalone repro of Nuru's component (`/home/dev/nuru-exp/cmrepro`, not in git) shows 8 keys growing the sheet by 14 rules with 7 rewrites, and no growth with the props memoized. That fix is on the local branch `perf/editor-reconfigure` of `/home/dev/nuru` (commit `31c1eeb`, not pushed); bumping `@uiw/react-codemirror` would also do it. The same bug costs the rrweb recorder CPU: 5.5 s of the 12.6 s of extension JS in the page is rrweb's `serializeElementNode` reading those stylesheets.

A lesson page without it: dropping those events leaves 0.74 MB gzipped for the session, about 75 KB a minute, which is closer to what an app without a churning `<style>` would cost.

## CPU

Seconds of CPU over the ten minutes, by process:

| Process | Off | Idle | Trace |
|---|---|---|---|
| Renderer (Nuru page, its interpreter worker, compositor) | 104.0 | 103.3 | 139.6 |
| Extension (service worker) | | 26.7 | 59.7 |
| Browser | 13.1 | 16.6 | 45.4 |
| GPU | 10.5 | 9.3 | 29.7 |
| Network, storage, audio | 2.8 | 2.7 | 3.1 |
| **All** | **130.3** | **158.6** | **277.5** |

A trace costs about 0.25 of a core on average over the session (147 s in 600 s), most of it outside the page: the browser process carries the port traffic from the content scripts to the worker and the 83 `captureVisibleTab` calls, the GPU process reads the frames back for those screenshots, and the extension process holds the ring, hashes keyframes, encodes PNGs and gzips at Stop. In the page, the content scripts took 12.6 s of JS (rrweb's serializer 5.5 s, our capture code and message posting the rest) next to Nuru's own 21.8 s, and the main thread was busy 22 s more than with recording off (3.7 % of the ten minutes). Idle, the extension costs 28 s of CPU, mostly in its own process: 26.7 s, of which the profiler saw only 1.8 s as JS. The rest is outside JS (port messages and storage of every console, network and DOM summary event); the profile cannot split it further.

## Responsiveness

| | Off | Idle | Trace |
|---|---|---|---|
| Long tasks | 131 | 143 | 247 |
| Time in long tasks | 9.2 s | 9.9 s | 18.9 s |
| Long task, 95th percentile / longest | 123 / 430 ms | 112 / 449 ms | 141 / 504 ms |
| Long animation frames, blocking time | 3.7 s | 4.2 s | 8.6 s |
| Interaction events of 16 ms or more | 1,877 | 1,892 | 2,069 |
| Their duration, 75th / 98th percentile / longest | 72 / 136 / 464 ms | 72 / 128 / 512 ms | 88 / 176 / 536 ms |

The extension at rest does not change how the page responds. A trace roughly doubles long-task time and moves the slow end of key and click handling by 16 to 40 ms; the run time of Nuru's interpreter is not affected (it runs in a worker; the earlier test measured the same 0.9 to 3.0 s per run with and without the extension). Long-animation-frame entries attribute no script time to the extension, because Chrome does not report isolated-world scripts there; the profile above is the attribution.

## Memory

The page's JS heap peaked at 72 MB with a trace against 32 MB off (rrweb's node map and the mutation buffers). The service worker's heap stayed at 4 to 5 MB for the first five minutes and 80 to 126 MB after, and reached 349 MB during Stop, when it reads the whole trace from the ring, builds one NDJSON string per stream and gzips it; the extension process then held 953 MB of RSS. That peak scales with the trace's rrweb size: on a page like this, a 30-minute trace would take the worker past 1 GB at Stop. Reading the ring and gzipping it in slices of `NDJSON_CHUNK_RAW` (4 MiB) would bound it; not changed in this step.

## Incident during the first attempt

The first traced run stopped at 3 minutes: wheel events at the screen edge switched openbox to another desktop and the driver lost the window (the script now keeps the pointer inside the lesson panel and the display has one desktop). While that trace was still open, the compose server stopped listening on port 3000 (container up, Node process alive, no listener; restarted with `docker restart toolbar-server-1`; the cause is not known). Stop trace then failed with "Failed to fetch", and every retry failed with "Chunks after lastSeq: 1, 2". That was a bug in the extension, fixed in D-190: a retried Stop now uploads the chunks the first one queued.

## What follows

- The defaults stay. A trace on a page without a churning stylesheet costs about 75 KB a minute of rrweb and 0.25 of a core while it runs, and the reviewer feels it as one more long task now and then.
- Keyframes are the larger half of the upload: PNG of the viewport at 1x, 93 KB each, kept lossless for agents that read text off them (the card still, WebP at 640 px, is 17 KB). A lossy format would shrink them; not changed, since OCR and agents read them.
- Stop's memory peak is the risk for long traces (above).
- Nuru: the editor fix is ready on a local branch (above).

Scripts: `docs/experiments/scripts/` (`session.mjs`, `measure.mjs`, `cdp.mjs`, `drv.mjs`, `rrsize.mjs`, `summary1.mjs`). Raw results stay on this machine in `/home/dev/nuru-exp/runs/` (`off-*/result.json`, `idle-*/result.json`, `trace-*/result.json`) and `/home/dev/nuru-exp/pull/`.
