# Experiment 2: span outcomes against hand labels on Nuru

PLAN "Part 2 specifics", "Experiments", item 2, run on 2026-10-16 on https://116.nuru.sh inside one trace (`01a14576-4b54-7861-bc8e-24e62797eea6`, 8 min 44 s). Nuru was not changed.

## Result in short

| | Before | After |
|---|---|---|
| Agreement with the hand labels | 25 of 30 (83 %) | 26 of 30 (87 %) on the stored events; 27 of 30 (90 %) with the click target's link that captures now record |
| Agreement under the PLAN's own definitions of the outcomes | 27 of 30 | 28 of 30; 29 of 30 with the link |
| Runs whose output lands inside their span | 4 of 6 | the two slow ones too on a new capture (worker messages) |

Changing the windows did not move the agreement at all: every combination of quiet 250 ms to 4 s, no-effect 1.5 to 4 s and open-request 5 to 30 s gave 25 of 30 with the old engine and 26 of 30 with the new one. The defaults stay at 500 ms, 2.5 s and 10 s (the project setting, D-166). What the labels found were rules, not windows; four changed (D-188, D-189):

1. **A link clicked while its hover prefetch is still open** (action 21). Next.js starts the route's request when the pointer reaches the link and the click waits for it, so the span saw no request of its own and closed as `dead` after 2.5 s while the page waited 13 s. A pending request no span owns now joins the next click when it asks for the clicked link's path and began up to 2 s before (`adoptLinkMs`), or joins any action when it began up to 300 ms before (`adoptMs`, work started on pointerdown). Captures now record the link around a click target (`TargetRef.link`, origin and path only), because the click lands on the `<span>` inside the `<a>`. The stored events of this trace have no `link`, so the re-derived span still reads `dead`; the same click on a new capture reads `stuck` (verified below and in `packages/trace/test/nuru-labels.test.ts`).
2. **Enter in a form field** (action 29). The browser submits the form with a click on its submit button 13 ms after the key. That click took the page's change and the Enter span read `dead`. A click on a button within 80 ms of an Enter span is now part of it (`doubleFireMs`, as for Enter on a button), and so is the field's cleared value right after.
3. **Code runs in a worker** (actions 15 and 17). Nuru posts the program to a Web Worker and hears nothing until the output, 3.2 s later for a 990,000-step loop and 1.3 s for an endless loop. The span closed 500 ms after the button turned to "Simamisha" and the output went to no span. Captures now record a `worker` event when the page posts to a dedicated worker that owes it no answer, and another at the worker's first message back (timing only, no payload); a span holds open between the two, up to the open-request window. Making the quiet window long enough instead (4 s) would also have caught both outputs, but would keep every span open 4 s after its last change.
4. **Trace stop after a failed upload** (found during experiment 1, not a label): see D-190.

The four disagreements that remain:

| # | Action | Hand | Spans | Why |
|---|---|---|---|---|
| 6 | Run a program with a parse error | error | changed | Nuru prints "Kuna makosa yafuatayo ..." in its terminal and logs nothing; the PLAN defines `error` as a console error, an uncaught exception or an unhandled rejection, so the span is right by the PLAN and wrong for the reviewer. |
| 17 | Run an endless loop | error | changed | The same: "Kosa: mzunguko usio na mwisho umegunduliwa" in red in the terminal. |
| 10 | Click the current lesson's step dot | silent | changed | The request came back and React replaced 46 nodes of the lesson panel with identical ones: a DOM change with no visible change. Telling them apart needs a pixel comparison of the page before and after, which the engine has for canvases only. |
| 21 | (above) | stuck | dead | Re-derived from events captured before `TargetRef.link`; a new capture reads `stuck`. |

So under the PLAN's definitions one disagreement is left (10); for a reviewer, in-page errors are the gap. The span text that would show them is in `outline/` and the README's timeline, not in the outcome: Nuru re-renders its whole lesson panel on every run, so the five text snippets a DOM summary carries (`dom.texts`) are filled by the lesson's paragraphs before the terminal line.

## Method

- **Setup** as in experiment 1 (`docs/experiments/rrweb-cost.md`): Playwright 1.63.0's Chromium on Xvfb `:262`, the release extension, the compose server, a reviewer of the "Nuru" project.
- **Actions.** One action per command (`docs/experiments/scripts/act.mjs`): real input through xdotool (pointer moved to the element, 300 ms, click; typing at 90 ms a key; keys), then a wait of 1.5 to 12 s for what the action does. Each run took a screenshot before and after and listened like DevTools would: console warnings and errors, uncaught errors, every request with status and time. Two actions ran under network emulation of our own browser over CDP (`Network.emulateNetworkConditions`): 14 s of latency (21) and offline (22), restored right after.
- **Labels.** Right after each action, before the next, I looked at the before-and-after screenshots and the console and network lists and labelled it `changed`, `error`, `dead`, `stuck` or `silent` with a note (`label.mjs`, `docs/experiments/data/labels.jsonl`). Where the PLAN's definitions give another outcome than what a reviewer sees (an error printed in the page), the note says so.
- **Comparison** (`compare.mjs`): the trace's stored events (`GET /api/v1/recordings/:id/media/events`) through `deriveTrace()` with the trace's start and end, each action matched to the span of its kind nearest in time (from 150 ms before to 1.5 s after the input; typing to the committed input that follows it). "Before" is the engine of main at `3a266c8` (the same spans as the server's `GET .../spans`, 60 spans, 53 changed, 6 dead, 1 error); "after" is this change. The grid ran 60 combinations of the three windows on both engines.
- **Live check of the new rules** on a second trace with the rebuilt extension (`01a14586-9039-7166-92be-389a6979481e`): the 990,000-step run's span lasted 4.1 s (was 0.6 s) and the endless loop's 2.0 s (was 0.6 s), both past their output; the click on a prefetching link under 14 s of latency read `stuck` at 10 s with the request; Enter in the answer field read `changed` as one span with its submit click.
- **Spend:** no OpenAI calls (0 USD).

## The 30 actions

"Before" is main's engine, "after" this change, both re-derived from the same stored events.

| # | Action | Hand | Before | After | Note |
|---|---|---|---|---|---|
| 1 | Next lesson (Somo linalofuata) | changed | changed | changed | lesson 2 after a 1 s RSC request |
| 2 | Type a program | changed | changed | changed | |
| 3 | Run (Endesha) | changed | changed | changed | output "Habari, Amani!" |
| 4 | Click the "HATUA 2 / 13" label | dead | dead | dead | |
| 5 | Type a broken line | changed | changed | changed | |
| 6 | Run | error | changed | changed | parse error printed in the terminal; PLAN: changed |
| 7 | Hint (Dokezo) | changed | changed | changed | hint box, lesson scrolls to it |
| 8 | Submit (Wasilisha) | changed | changed | changed | tests tab, 0 of 2 passed (the learner's failure, as designed); POST /api/maendeleo 200 |
| 9 | Terminali tab | changed | changed | changed | |
| 10 | Current lesson's step dot | silent | changed | changed | RSC 200, identical re-render |
| 11 | SW, already the language shown | dead | dead | dead | no request |
| 12 | EN | changed | changed | changed | English lesson, 20 prefetches |
| 13 | SW | changed | changed | changed | |
| 14 | Type a 990,000-step loop | changed | changed | changed | |
| 15 | Run | changed | changed | changed | output after 3.2 s (outside the span before, inside on a new capture) |
| 16 | Type an endless loop | changed | changed | changed | |
| 17 | Run | error | changed | changed | loop error printed after 1.3 s; PLAN: changed |
| 18 | Theme button | changed | changed | changed | dark |
| 19 | Theme button | changed | changed | changed | light |
| 20 | Click lesson paragraph text | dead | dead | dead | |
| 21 | Next lesson, 14 s latency | stuck | dead | dead | stuck on a new capture (link) |
| 22 | Next lesson, offline | error | error | error | 20 console errors "Failed to fetch RSC payload"; Nuru's service worker served the page |
| 23 | Show solution (Onyesha jibu) | changed | changed | changed | GET /api/suluhisho 200 |
| 24 | Ctrl+R | changed | changed | changed | reload, code kept |
| 25 | Step dot of lesson 8 | changed | changed | changed | |
| 26 | Type a program that reads input | changed | changed | changed | |
| 27 | Run | changed | changed | changed | prompt with an answer field |
| 28 | Type "Amani" in the answer field | changed | changed | changed | |
| 29 | Enter | changed | dead | changed | submit click folded into the Enter |
| 30 | Reset (Anza upya) | changed | changed | changed | |

Confusion, after (rows: hand, columns: spans):

| | changed | error | dead | stuck | silent |
|---|---|---|---|---|---|
| changed (22) | 22 | | | | |
| error (3) | 2 | 1 | | | |
| dead (3) | | | 3 | | |
| stuck (1) | | | 1 | | |
| silent (1) | 1 | | | | |

Before, row "changed" had one `dead` (29). No `stuck` or `silent` span came from Nuru on its own: its runs make no requests and its navigations answer within 1.5 s. The `stuck` case needed the slow network, and the only `silent` action read `changed`. Hand-label counts are small for the rare outcomes (3 dead, 1 stuck, 1 silent); the lab's buttons cover those in `packages/trace/test/engine.test.ts`.

## Observations for later

- **Enter in a code editor** starts a span for each line typed (8 of 33 spans in the live check were "Press Enter in ..." in CodeMirror). They read `changed` and do no harm to outcomes, but they lengthen the README timeline on coding sites. Enter in a multi-line field could count as typing; a chat box that sends on Enter is the case against it. Not changed.
- **In-page errors.** A rule "a changed span whose new text reads like an error" would turn 6 and 17 into errors for a reviewer, but it departs from the PLAN's definition of `error` and needs the terminal's text in the span, which Nuru's re-renders crowd out of `dom.texts` today.
- **Canvas comparison** was not exercised: Nuru's only canvas is the confetti of a passed lesson. No action here read `dead` or `silent` because of a canvas.

Data and scripts: `docs/experiments/data/` (actions, labels), `docs/experiments/scripts/` (`act.mjs`, `label.mjs`, `compare.mjs`, `derive.mjs`); the regression test `packages/trace/test/nuru-labels.test.ts` runs the engine over a slimmed copy of this trace's events (`packages/trace/test/fixtures/nuru-span-labels.json.gz`, request bodies and most headers removed) and checks the agreement above. Screenshots stay on this machine in `/home/dev/nuru-exp/exp2/` and `/home/dev/nuru-exp/verify/`.
