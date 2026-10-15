# Status: traces and interaction spans (Part 2, step 4)

Branch `p4/trace`. Decisions D-117 to D-122.

## What is built

| Part | Where | What it does |
|---|---|---|
| Span engine | `packages/trace/src/engine.ts` | Streams the capture events of one tab into interaction spans. Actions: click, double and right click, committed input, Enter, Escape, Ctrl/Meta chords, a navigation with no span open, annotations, voice segments, marks. Effects: requests by `rid` (webRequest twins merged), console, errors, DOM summaries with changed text, route changes, scroll, selection, canvas samples, screenshots. Close after 500 ms quiet with nothing in flight, 2.5 s with no effect, 10 s at most (`maxOpenMs`). Outcomes `changed`, `error`, `dead`, `stuck`, `silent` (2xx, 4xx, 5xx, network) and `note`. `causedBy` with a confidence on overlapping actions. |
| Live use | `packages/trace/src/live.ts` | The same engine behind a 1 s buffer that sorts late, out-of-order batches. |
| Keyframes | `packages/trace/src/keyframes.ts` | Planner (route change, annotation, changed span, DOM burst, one per 1.5 s, strongest reason wins) and a 33x32 dHash with a near-duplicate threshold of 3 of 1024 bits. |
| Framework names | `packages/trace/src/classify.ts` | SvelteKit loads, form actions and remote functions; Next.js RSC, prefetch and server actions. Span summaries and the timeline use these names. |
| Output | `packages/trace/src/index.ts` | `deriveTrace()`, `spansJsonl()`, `timelineLines()`, a summary whose `attention` list puts dead, stuck and silent spans first. |
| Page signals | `packages/capture/src/canvas-sample.ts`, `dom-summary.ts`, `isolated.ts` | New event kind `canvas.sample` (before and after hashes around each action, while attached). `dom` summaries carry up to five scrubbed text snippets, left out under the production preset. |
| Extension | `apps/extension/lib/bg/trace.ts`, popup `screens/Main.svelte` | "Start trace" and "Stop trace" (popup row after Jam's rows, TR badge). Creates a `trace` capture, attaches the tab, runs the live engine, takes keyframes with captureVisibleTab, uploads events and rrweb from the ring at stop, finalizes, opens the capture. Survives a worker restart (re-attaches from `tb:trace`). Stops by itself when the traced tab closes. |
| Server | `routes/api/v1/recordings/[id]/spans/+server.ts`, contract `packages/shared/src/api/areas/trace.ts` | `GET /api/v1/recordings/:id/spans` returns `{ items, summary, timeline }`; `?format=jsonl` returns spans.jsonl; `?outcome=dead,stuck` filters. Works on any capture, not only traces. Recording kind `trace` (no migration: the column is text). A trace's card image is its first keyframe. |
| Viewer | `lib/components/viewer/ActionsTab.svelte`, `viewer.svelte.ts` | For traces, each action row shows its outcome chip (summary in the tooltip) and a count line on top. |
| Dashboard | `packages/shared/src/areas/dashboard.ts` | Type filter "Trace"; untitled traces read "X's trace". |

## How it was verified

- Unit tests, `packages/trace/test` (41): a fixture event stream for each outcome shaped like the lab buttons (Save changed, Export dead, Sync stuck, Submit order silent 5xx, Show profile error), the 10 s setting, shown versus hidden failures, the fallback for captures without text snippets, network failure, silent 2xx, canvas redraw changed, unchanged canvas dead, unreadable canvas caveat, Enter plus click as one action, Ctrl+Enter and typing, committed input, checkbox, focus click, non-interactive dead click, route change as effect and back navigation as action, SvelteKit form action naming, notes, `causedBy` (in flight and repeat), webRequest twins, SSE ignored, unattributed effects, keyframe gap and reasons, keyframe shot attachment, live versus batch on shuffled batches, spans.jsonl and timeline. Classifier and dHash tests.
- Capture tests (`packages/capture/test/trace-signals.test.ts`): text snippets with email scrubbing and the preset switch, hash and pixel diff, sampler start and stop.
- e2e `e2e/tests/trace/trace.spec.ts` on display :181 against a dev server on :3301 (database `toolbar_p4_trace`, prefix `p4-trace/`, mock OIDC): signs in, makes a personal token, starts a trace on the lab app, clicks Save, Export, Submit order, Show profile, the Canvas link, Run again, the Buttons link and Sync, stops, and checks the server's spans: Save changed, Export dead, Submit order silent 5xx, Show profile error, canvas redraw changed with `effects.canvas = changed`, Sync stuck, the Canvas click carries the route change, the timeline names `POST /api/fail 500`, at least three keyframes, spans.jsonl line count, the live engine agreeing with the server, and the outcome chips in the capture page's Actions tab. A second test starts and stops a trace from the popup. Both pass (about 70 s).
- `pnpm -r --workspace-concurrency=2 build`, `check` and `test` pass. The server's `auth.int.test.ts` fails only when the worktree's `.env` (with `ALLOWED_EMAIL_DOMAINS=test`) is present; without it, all 181 pass.
- Regression runs on this branch: `e2e/tests/ext-ui/popup.spec.ts` 20 of 20 (row counts updated for the trace row); `e2e/tests/capture` 31 passed, 2 skipped (real-server, opt-in), 3 failed on the first run. `pages.spec.ts:41` (J-069 visibility row before the load) fails the same way on a build from `main`; the two `video.spec.ts` timing tests failed under load (load average 7) and passed on a rerun, 7 of 7.

## What is not built or not verified

- The flows (`e2e/flows`) and parity suites were not run on this branch; nothing they cover changed except the popup's extra row at the end.
- No in-page trace indicator: the trace shows only as the TR badge and the popup row. A floating pill with the span count and a stop button (closer to the owner's Agentation and Vercel Toolbar taste) is open.
- The live engine starts afresh after a service worker restart; keyframes resume, and the server's spans are complete because they come from the stored events.
- Keyframes need the traced tab to be the active tab of its window (captureVisibleTab). A trace of a background tab gets no keyframes.
- Canvas sampling cannot read WebGL canvases without a kept drawing buffer (they sample as blank, so no change is seen) or canvases tainted by cross-origin images (null hash, `dead` gets a caveat).
- Error-text detection for `silent` versus `changed` is a word list (English and a few Swahili words); an app that shows failures as icons only, or in another language, reads as `silent`.
- The `.feedback/<id>/` folder (spans.jsonl inside it, keyframes, outline, README "what did not happen") belongs to the hand-off work package; it can call `deriveTrace()` and `spansJsonl()` from `@toolbar/trace` or read the spans route.
- Not tested on Nuru or a Next.js app (step 5). Window tuning against 30 hand-labelled actions is experiment 2 of step 5.
