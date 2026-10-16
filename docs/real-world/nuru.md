# Real-world test 1: Nuru on https://116.nuru.sh

PLAN "Part 2, step 5", item 1: the owner's scenario on Nuru, the Swahili coding course, with the release extension and no change to Nuru. Run on 2026-10-16.

## The app

https://116.nuru.sh is the preview deployment of pull request #116 ("New UX experiment") of `teKsafari/nuru`, branch `nuru-platform`. The source was read at commit `9f380fd`, with the interpreter submodule `packages/wasm/core/Nuru` at `7bf0486`, in a read-only clone at `/home/dev/nuru` (local branch `review-local`, nothing pushed, nothing changed). The playground is a Next.js 15 App Router app (`apps/playground`): lessons come from Postgres through `lib/lessons.server.ts`, code runs in a TinyGo build of the Go interpreter inside a web worker (`packages/wasm/runtime.ts`), and the terminal is DOM text. Swahili lives at `/sw`, English at `/en`.

## Setup

- Chromium 153 (Playwright 1.63.0) on Xvfb `:260` at 1280x800 with openbox, its own profile, the release build `apps/extension/.output/chrome-mv3` of main (`0b40bfb`) copied to `/home/dev/nuru-run/ext`. Fake microphone: `--use-file-for-fake-audio-capture` with a 15 s English WAV made with OpenAI's TTS, in which the reviewer says what they saw on lesson 1.
- Server: the compose stack on `http://localhost:3000`, Dev SSO through the mock OIDC provider, local whisper.cpp (`base`) for voice notes. Reviewer `Amani Reviewer <amani@nuru.test>`.
- Input: page clicks, drags and typing through xdotool on the X server, at reading speed; the popup shortcut and Chrome's permission prompt the same way. Playwright over CDP only read the page (boxes, terminal text) and the worker's storage, to know when a note was kept.
- Screen: ffmpeg `x11grab` of `:260` for the whole scenario, `/home/dev/demo-raw/nuru-scenario.mp4` (2 min 43 s, 1280x800, 0.9 MB). The run with the fixed extension is `/home/dev/demo-raw/nuru-fixed-run.mp4` (1 min 45 s).
- Spend on OpenAI: one TTS clip and one comparison transcription, about 0.01 USD.

Scripts, screenshots and logs stay on this machine in `/home/dev/nuru-run/` (not in git).

## Step 1: project and grant

In Settings, Projects: Add project, name "Nuru", origin `https://116.nuru.sh`, preset "Staging, own team", saved (`project-saved.png`). On a Nuru tab the popup said "Allow on Nuru"; Allow raised Chrome's "requested additional permissions" prompt for "Read and change your data on 116.nuru.sh", accepted with Tab and Return. Chrome then held `http://localhost:3000/*` and `https://116.nuru.sh/*` and nothing else, and the capture scripts were registered for the Nuru origin only.

## Step 2: the scenario, with timings

Offsets from the start of the recording (`/home/dev/nuru-run/scenario-marks.json`):

| At | Step |
|---|---|
| 0:01 | Nuru home `/sw` |
| 0:07 | Wake the toolbar (Ctrl+Shift+.), `x` starts the trace |
| 0:11 | Click "Anza": first lesson, `/sw/anza/misingi-ya-nuru/karibu` |
| 0:17 | Write code in the editor: a comment line and `andika("Habari Nuru! Mimi ni Amani")` |
| 0:24 | Run (Endesha); the terminal prints the line |
| 0:27 | Drag over the terminal output, `t`, a note on the highlight |
| 0:35 | `c` on the lesson title, a note |
| 0:40 | `v` voice note, 16 s |
| 0:58 | Next lesson (Somo linalofuata), lesson 2 `andika` |
| 1:03 | Follow the task as written: `andika("Jina langu ni Amani /n Naishi Arusha")`, run: one line with a literal `/n` |
| 1:11 | `c` on the task box, a note |
| 1:17 | The same with `\n`: two lines |
| 1:25 | Lesson 5 from the step dots |
| 1:29 | Wrong code, `fanya x = (5 + )`: a parse error, in Swahili |
| 1:35 | Edge input, `10 % 0`: "PROGRAMU IMEANGUKA" with a message about recursion |
| 1:44 | `c` on the crash message, a note |
| 1:53 | `andika(7 % 3)` runs again: the interpreter recovered |
| 1:58 | Language switch to EN, then back to SW |
| 2:07 | Lesson 8 (`jaza`), a program that asks for a name |
| 2:20 | Reload (Ctrl+R) while it waits for the answer; the code survives, the run is gone |
| 2:24 | Run again and answer "Amani" |
| 2:30 | 390 px wide (device metrics override), the Matokeo tab |
| 2:37 | `x` stops the trace; the five notes go onto it |

Then four comments without a trace, each with one problem and its own Send (about 30 s each), and later a short second trace with the fixed extension (below).

## What open-toolbar captured

| Capture | Kind | Folder |
|---|---|---|
| `01a14506-94e7-799e-ac3f-8fd711dec338` | Trace, 2:29.6, 56 spans (49 changed, 2 dead, 5 notes), 87 requests, notes a01 (text highlight), a02 (element), a03 (voice), a04 (element), a05 (element) | `/home/dev/nuru/.feedback/01a14506-94e7-799e-ac3f-8fd711dec338/` |
| `01a1450a-d800-7a52-99b4-78c2b4505433` | Comment on lesson 11's terminal (loop limit) | `/home/dev/nuru/.feedback/01a1450a-d800-7a52-99b4-78c2b4505433/` |
| `01a1450b-9aff-7ca7-976f-d8efaae47f36` | Comment on lesson 5's terminal (`+Inf`) | `/home/dev/nuru/.feedback/01a1450b-9aff-7ca7-976f-d8efaae47f36/` |
| `01a1450c-1db1-7e6a-8032-b9f0a1936f12` | Element screenshot on lesson 8's answer row (badge over Tuma) | `/home/dev/nuru/.feedback/01a1450c-1db1-7e6a-8032-b9f0a1936f12/` |
| `01a1450c-a715-7892-8d78-f1aa0e85cc5f` | Comment on the output tab strip (scrollbars) | `/home/dev/nuru/.feedback/01a1450c-a715-7892-8d78-f1aa0e85cc5f/` |
| `01a1451c-6df5-7199-93dd-fd14ac6139ba` | Trace with the fixed extension, 2:41 (the stop key was lost once and pressed again later), lessons 1 and 2, 10 spans, three notes, 5 keyframes and 3 crops | `/home/dev/nuru/.feedback/01a1451c-6df5-7199-93dd-fd14ac6139ba/` |

Each folder was pulled into `/home/dev/nuru/.feedback/` (listed in Nuru's `.git/info/exclude`) with the documented command, `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "$TOOLBAR_SERVER/api/v1/recordings/<id>/folder" | tar xz`, from the compose server; the last one from a dev server of the fixed tree on :3260 (same database and bucket), to show the new README.

What the folders hold, checked file by file:

- **README.md order**: header (reviewer, OIDC issuer and subject, app, browser, `staging` preset), the fence rule, the reviewer's words, what did not happen, the timeline, search hints and files. The trace's README is 16.1k characters, about 4.6k tokens.
- **Spans and outcomes**: plausible for every action. Clicks on Endesha and the lesson links read `changed`; client navigations name the Next.js RSC requests (`Next.js RSC /sw/anza/misingi-ya-nuru/andika 200`); the reload reads `Press Ctrl+R ... went to /sw/anza/misingi-ya-nuru/jaza`. The two `dead` spans were the reviewer's clicks on the "HATUA 5 / 13" and "HATUA 8 / 13" labels to leave the editor, which are no failed controls (fixed below). The runs that printed an error (`10 % 0`) read `changed`: Nuru writes its errors into the terminal, and open-toolbar counts only console errors and failed requests as errors. Eight Google Analytics beacons (`POST /g/collect`) show status 0 and are not counted as failures.
- **Keyframes and crops**: none in the first five captures (cause below). The fixed run has five keyframes (editor, run, highlight, lesson 2 after the navigation, task box) and three crops; `annotations/a01.png` is the highlighted terminal line at 1x.
- **OCR**: no `text/` files. Nuru's terminal is DOM text, so the outline and the DOM recording carry it; the only canvas is the confetti of a passed lesson.
- **Transcript**: `voice/a03.vtt` from whisper.cpp `base`: "I am on the Swahili version of the course, but this first lesson is written in English. The task tells me to press the white run button and read the output section. The button is black and says in Dacia, and the panel is called Terminale." It misheard the two Swahili words. The hosted `gpt-transcribe` on the same file wrote "Indesha" and "Terminali". The trailing "I" cue is the fake microphone looping its file.
- **Locator packets**: the release build guessed SvelteKit files, `src/routes/sw/anza/misingi-ya-nuru/karibu/+page.svelte`, and used React's generated ids in selectors (`#_r_1p_ > div > ...`). With the fix every packet names `app/(main)/[lang]/anza/[moduleSlug]/[lessonSlug]/page.tsx` (source `next-tree`, params `lang`, `moduleSlug`, `lessonSlug`, framework `nextjs`), including the note on lesson 2 after a client-side navigation. The real file is `apps/playground/app/(main)/[lang]/anza/[moduleSlug]/[lessonSlug]/page.tsx`: the packet has no monorepo prefix, so an agent matches it by suffix.
- **Raw**: four rrweb chunks, 2.21 MB gzipped for 2.5 minutes (about 0.9 MB a minute), `network.jsonl` 473 KB with the RSC bodies of the app's own origin, `raw/network.har` 540 KB.

## Bugs found in Nuru

Each was confirmed in the source; nothing was fixed or pushed.

| # | Bug | Capture and note | Cause in the source |
|---|---|---|---|
| 1 | On `/sw` the first lesson is English, and its task points at a "white Run button" and an "Output" section; the button is black and says Endesha, the panel is Terminali. Lesson 13's Swahili title is "Functions". | `01a14506-...` a01, a02, a03 (voice); `01a1451c-...` a01, a02 | The deployed database holds an old curriculum: the page's RSC payload has `"title":{"en":"1. Welcome to Nuru!","sw":"1. Welcome to Nuru!"}`, and `getModuleBySlug` (`apps/playground/lib/lessons.server.ts`) serves what is stored. The branch's curriculum, `packages/mtaala/moduli/01-misingi-ya-nuru/sw/01-karibu.md`, has "Karibu Nuru!" and the new UI's words, and `packages/mtaala/scripts/load.ts` takes Swahili from the `sw/` file; the preview was not seeded from it. |
| 2 | Lesson 2 tells the learner to split lines with `/n`; `/n` prints as text and the output stays on one line. | `01a14506-...` a04; `01a1451c-...` a03 | Same stale data: main's `apps/playground/content/lessons/01-misingi-ya-nuru/sw/02-andika.md` lines 3 and 25 say `/n`; the branch's `packages/mtaala/moduli/01-misingi-ya-nuru/sw/02-andika.md` says `\n` but is not what the preview serves. |
| 3 | `10 % 0` crashes the run ("PROGRAMU IMEANGUKA") with "programu imeishiwa nafasi ... kujirudia kwa kina zaidi ya hatua 200": a message about recursion for a modulo by zero. | `01a14506-...` a05 | `evalIntegerInfixExpression` in `packages/wasm/core/Nuru/evaluator/infix.go` (line 234) does `leftVal % rightVal` with no zero check; Go panics, the TinyGo build traps with `unreachable`, and `explainCrash` in `packages/wasm/runtime.ts` (lines 67 to 72) maps every `unreachable` to the recursion text. |
| 4 | `10 / 0` prints `+Inf` and the run is marked finished (IMEKAMILIKA). | `01a1450b-9aff-7ca7-976f-d8efaae47f36` | The same function's `/` case (line 226) divides as `float64` with no zero check; `math.Mod(+Inf, 1)` is NaN, so it returns `Float{+Inf}`, printed with Go's formatting. |
| 5 | A loop that ends after 2,000,000 steps fails with "mzunguko usio na mwisho umegunduliwa" (infinite loop detected) and never prints its result. | `01a1450a-d800-7a52-99b4-78c2b4505433` | `packages/wasm/core/Nuru/evaluator/while.go`: `MAX_ITERATIONS = 1_000_000`, a fixed cap on any `wakati` loop. |
| 6 | While a program waits for input, the yellow "Inasubiri jibu" badge sits on the Tuma button. | `01a1450c-1db1-7e6a-8032-b9f0a1936f12` | `apps/playground/components/runtime/terminal.tsx` lines 177 to 181 place the badge `absolute top-2 right-3`, over the input row's submit button (lines 127 to 160). |
| 7 | The Terminali / Majaribio tab strip shows small horizontal and vertical scrollbars, on every lesson and at 390 px. | `01a1450c-a715-7892-8d78-f1aa0e85cc5f` | `apps/playground/components/runtime/output-tabs.tsx`: the tab list has `overflow-x-auto` (line 51), which makes the vertical axis scroll too, and the active tab's bar is `absolute -bottom-[2px] h-[3px]` (line 70), one pixel past the list. Chromium on Linux draws classic scrollbars for it. |

Bugs 1 and 2 share one cause, the curriculum in the preview's database.

Checked and fine: output with HTML characters (`andika("5 < 10 na <b>nzito</b>")`) prints as typed; a real infinite loop stops with a message; input with `jaza` works; a parse error reads in Swahili; the interpreter recovers after the crash; the code survives a reload and a language switch; at 390 px the lesson splits into Somo, Kodi and Matokeo tabs without a horizontal scroll. The English UI keeps "Uwanja", "Kamusi" and "Darasa" as names on purpose (`app/(main)/[lang]/dictionaries/en/msingi.json`). Nuru logged no console errors during the session; the only warnings were three preloaded fonts not used within seconds, and no request failed.

## Problems open-toolbar had on a real site

All fixed on main with tests (D-185) unless marked.

1. **No screenshots at all.** Every crop, keyframe and card still failed without a word: Chrome's `captureVisibleTab` needs activeTab or `<all_urls>`, and the project's host permission is neither. activeTab comes only from opening the extension's menu (or a shortcut) on the tab, and the reviewer had woken the toolbar with its in-page keys after a browser restart. The e2e runs never met it because each opens the popup on the lab tab first. Fixed: the toolbar probes once and shows "Screenshots are off on this tab. Press Ctrl+Shift+Y once to allow them." until a capture works; traces and feedback record `env.shots`; README.md says why there are no images. Tests: `apps/extension/test/shot-access.test.ts`, `packages/shared/test/handoff.test.ts`, `apps/server/test/handoff.unit.test.ts`. Seen working on Nuru: the notice showed, Ctrl+Shift+Y cleared it, and the trace after it has keyframes and crops (`01a1451c-...`, `shots/v2/` on this machine); a comment sent while blocked got the README line.
2. **Send was out of reach at 390 px.** The pill scrolled sideways with a hidden scrollbar, so Hide pins, Send and Close were off screen, and the pill covered Nuru's Endesha and Wasilisha bar. Fixed: under 520 px the pill wraps onto two rows. Test: e2e `tests/reviewer` "at 390 px the pill wraps onto two rows". The launcher and pill still cover the bottom right corner of the page; they can be dragged to another corner (not changed).
3. **The locator assumed SvelteKit.** Fixed: it reads the App Router tree from the page's flight scripts, or the Pages Router page from `__NEXT_DATA__` (`packages/shared/src/next-route.ts`, `packages/capture/src/next.ts`). Tests: `packages/shared/test/next-route.test.ts` (built on the shape of Nuru's payload), `packages/capture/test/next.test.ts`.
4. **Selectors used React's generated ids** (`#_r_1p_`), which change between loads. Fixed: `generatedId()` in `packages/capture/src/target.ts` skips useId forms. Test in `packages/capture/test/next.test.ts`.
5. **Clicks on plain text counted as dead controls** in "What did not happen". Fixed: they stay in the timeline as `(not a control)`. Test in `apps/server/test/handoff.unit.test.ts`.
6. **Errors printed into the page are not errors to the trace** (not changed). Nuru's `Kosa:` lines and the crash message left the spans `changed` and the signals at "0 console errors". The agent reads them in `outline/` and the reviewer's notes.
7. **Local whisper `base` misheard Swahili words** in an English note (not changed). For Swahili reviewers the hosted provider (`TRANSCRIBE_PROVIDER=openai`, `docs/configuration.md`) did better on the same file.
8. **Labels of typing in a code editor** read `Type in "an"` and `Click "// Huu ni mwanzo ... andika()"` (the whole editor's text). Cosmetic, not changed.
9. **One flaky sign-in** in the e2e rerun: the first reviewer test found no provider button on the login page once and passed on the rerun.

Measured on the side: a 900,000-step loop took 3.0, 1.7, 1.1 and 0.9 s in four runs without the extension and 3.0, 1.6, 1.1 and 0.9 s with it on the project origin, so the capture hooks do not slow Nuru's interpreter (it runs in a worker). PLAN's three experiments (ten-minute rrweb size and CPU, 30 hand-labelled actions, three agents on one folder) were not run in this pass; the numbers above are the first data for the first two.

## Verification of the fixes

- `pnpm --filter @toolbar/shared --filter @toolbar/capture build`, `svelte-check` of the extension and the server: no errors.
- Unit tests: shared 18 files, 167 tests; capture 10 files, 53 tests; extension 9 files, 44 tests; server unit tests (no database) 15 files, 205 tests.
- e2e `tests/reviewer` and `tests/locator` on a test build of this tree (`chrome-mv3-test-260`, display `:262`, compose server): 13 passed, 4 skipped (the Vite dev and source-map lab servers were not running), one sign-in flake that passed on its rerun.
- On Nuru: the fixed release build (pointed at a dev server of this tree on :3260) showed the notice, cleared it after Ctrl+Shift+Y, and the trace `01a1451c-6df5-7199-93dd-fd14ac6139ba` came back with keyframes, crops, `env.shots: blocked` from its start, and Next.js route files.
