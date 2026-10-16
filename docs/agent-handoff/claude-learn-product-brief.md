# Nuru product brief: what reviewers report

Source: 6 open-toolbar captures (2 traces, 4 single-pin reports, 13 pins in total), pulled on 2026-10-16 with `status=all`. Amani Reviewer filed all six on 2026-10-16, against the deploy at `116.nuru.sh`, on the Swahili site, inside module 1 (`misingi-ya-nuru`). No capture carries a deploy commit. Evidence lives in `.feedback/<id>/`, which is gitignored; pull it again with the export command in the open-toolbar skill.

The sample is one reviewer in one session. Read the counts below as "seen in N captures", and treat them as weak evidence of how common a problem is.

## What the product is meant to be

Nuru is a programming course in Swahili for young East African learners, Tanzania first. You write code with Swahili keywords (`andika`, `fanya`, `jaza`), press **Endesha**, and read the result in the **Terminali** panel. Each lesson has a task and tests (**Majaribio**) that check your code and output. `docs/MAONO.md` states the promise as removing the translation layer between thought and code, and the reviewer judged the product by that standard: every report except the two layout bugs flags a place where English, or an engine-level message, leaks into the Swahili experience.

Vocabulary the reviewer used: lesson, step (`HATUA n / 13`), task, Endesha, Terminali, Majaribio, Tuma, Kosa, learner, Swahili site.

## Core flows

1. **Start the course.** `/sw` landing page, click **Anza**, land on `/sw/anza/misingi-ya-nuru/karibu`. The reviewer expects the lesson, its task and the UI to be in Swahili.
2. **Do a lesson.** Edit the starter code in the editor, press **Endesha**, read the output in **Terminali**, check the task against **Majaribio**. The task text should name the controls the learner sees on screen.
3. **Move on.** **Somo linalofuata** goes to the next lesson; the module sidebar jumps to any lesson. The reviewer walked karibu, andika, aina-za-data, jaza, safu and wakati.
4. **Answer a prompt.** On `jaza`, a running program asks for input in the terminal; you type and press **Tuma**. A badge reading "Inasubiri jibu" shows that the program is waiting.
5. **Switch language.** The **EN / SW** toggle keeps you on the same lesson in the other locale.
6. **Hit an error on purpose.** The reviewer tried bad input (`10 % 0`, divide by zero, a 2,000,000-step loop) and expected a Swahili **Kosa** message naming the real cause.

## Recurring problems

Ranked by the number of captures that show each one.

### 1. Runtime errors that mislead the learner (3 captures, 3 pins)

| Case | Route | What the learner sees | Cause in the code | Evidence |
|---|---|---|---|---|
| `10 % 0` | `aina-za-data` | "programu imeishiwa nafasi ... kujirudia kwa kina zaidi ya hatua 200", a recursion hint for code with no recursion | `evalIntegerInfixExpression` in `packages/wasm/core/Nuru/evaluator/infix.go` computes `leftVal % rightVal` with no zero check; Go panics, the wasm traps, and `explainCrash` in `packages/wasm/runtime.ts` maps any trap to the recursion message | `.feedback/01a14506-94e7-799e-ac3f-8fd711dec338` (pin 5) |
| `10 / 0` | `aina-za-data` | `+Inf`, and the run counts as finished | The `/` branches in `infix.go` divide floats with no zero check | `.feedback/01a1450b-9aff-7ca7-976f-d8efaae47f36` |
| Loop to 2,000,000 | `wakati` | "mzunguko usio na mwisho umegunduliwa" and the program never prints its last line | `MAX_ITERATIONS = 1_000_000` in `packages/wasm/core/Nuru/evaluator/while.go` treats any long loop as infinite | `.feedback/01a1450a-d800-7a52-99b4-78c2b4505433` |

The `+Inf` pin is marked resolved on the server, but `infix.go` still has no zero check, so the fix either lives elsewhere or has not landed. Check before you close it.

### 2. Lesson copy out of step with the Swahili UI (2 captures, 7 pins)

On `/sw`, step 1 (`karibu`) showed an English title and body while step 2 was Swahili. The task told the learner to press a white "Run" button and read "Output", while the screen shows a black **Endesha** button and a **Terminali** panel. The `andika` task said to split lines with `/n`, which prints as text; Nuru uses `\n`.

Evidence: `.feedback/01a14506-94e7-799e-ac3f-8fd711dec338` (pins 1 to 4), `.feedback/01a1451c-6df5-7199-93dd-fd14ac6139ba` (pins 1 to 3, all marked resolved).

The source has caught up: `packages/mtaala/moduli/01-misingi-ya-nuru/sw/01-karibu.md` is Swahili and names **Endesha**, and `sw/02-andika.md` says `\n` and warns against `/n`. The four pins on the older trace are still pending and can close once the deploy carries these files. The mtaala `hakiki` check runs reference solutions against tests, but it cannot catch a Swahili lesson written in English or a task naming a button the UI does not have.

### 3. Layout defects around the terminal (2 captures, 2 pins)

- The **Terminali / Majaribio** tab strip shows a small horizontal and vertical scrollbar on every lesson, at 390 px wide too, with nothing to scroll. Route `safu`. `.feedback/01a1450c-a715-7892-8d78-f1aa0e85cc5f`
- While a `jaza()` prompt waits, the yellow "Inasubiri jibu" badge covers the border and label of the **Tuma** button. Route `jaza`. `.feedback/01a1450c-1db1-7e6a-8032-b9f0a1936f12`

I did not trace either one to a component. The strings live in `apps/playground/app/(main)/[lang]/dictionaries/sw/uwanja.json` (`tests`, `waiting`), which gives you a starting point for the search.

### No network or console failures

Across 87 recorded requests and both traces, no request failed or hung and no console error fired. Every click on a control had a visible effect. The two dead spans are clicks on the `HATUA n / 13` step counter, which is plain text.

## Open questions

- **Which commit runs at `116.nuru.sh`?** No capture records one, so you cannot tell whether the resolved lesson-copy pins are live or only fixed in source.
- **Who resolved the `+Inf` pin, and with what change?** The pin carries no note, and the evaluator still returns `+Inf`.
- **What should stop a long loop?** `docs/MAONO.md` lists a **Simamisha** button for runaway loops. If that button works, the 1,000,000-iteration cap may be unnecessary, or it could become a time budget whose message says "ran too long" without claiming the loop is infinite.
- **Should integer `/` by zero return a Kosa or a float?** The fix for `%` is clear. For `/`, decide whether Nuru follows maths (error) or IEEE floats (`+Inf`), then say so in Kamusi.
- **Does the reviewer expect the step counter to be clickable?** Two clicks on `HATUA n / 13` did nothing. That fits a person poking around, or a wish to jump between steps; one session cannot separate the two.
- **What has nobody reviewed?** Every capture sits in module 1 on `/sw`. Kobe, Ubao, Uwanja share links, Kamusi, Darasa, the dashboard and the English site have no feedback yet.
