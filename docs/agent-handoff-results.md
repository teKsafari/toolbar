# Agent hand-off results

PLAN "Part 2, step 5", item 4, and experiment 3: real feedback folders from the Nuru and second-app reviews, handed to Claude Code, Codex and opencode with one line each. Run on 2026-10-16. Decision D-187.

## Setup

- **Server**: a dev server of main (`3a266c8`, then this change) on `http://localhost:3263`, on the compose stack's database and bucket, so the folders come out of the current folder code. Share links were minted on it; each prompt carried one.
- **Repos**: for each run a fresh local clone, on its own branch `handoff-<agent>-<bug>`, with no remote. Nuru from `/home/dev/nuru` at `9f380fd` (branch `nuru-platform`, PR #116) with the interpreter submodule cloned from the local copy; the store from `/home/dev/second-app` (`Heracraft/csds221-pr03`). Nothing was pushed, and Nuru's deployment was not touched.
- **Skill**: installed the way the README told users at the start: `curl "$TOOLBAR_SERVER/api/v1/skill"` into `.claude/skills/open-toolbar-feedback/SKILL.md` for Claude Code and `.agents/skills/open-toolbar-feedback/SKILL.md` for Codex and opencode (both read that folder; a probe showed Codex also reads `.codex/skills`, opencode also `.claude/skills` and `.opencode/skills`).
- **Environment**: `TOOLBAR_SERVER` and `TOOLBAR_TOKEN` (a personal token of the reviewer's workspace). No MCP server for any agent, so the folder was the only way in.
- **Prompt**, word for word: `Fix the problem reported in http://localhost:3263/s/<token>`.
- **Agents and models**:
  - Claude Code 2.1.283, `claude -p --dangerously-skip-permissions --strict-mcp-config --setting-sources project`, the logged-in default model (Opus 5.5).
  - Codex CLI 0.157.1, `codex exec --json --dangerously-bypass-approvals-and-sandbox`, scratch `CODEX_HOME` logged in with `OPENAI_API_KEY`, model `gpt-5.4-mini` at medium reasoning. `gpt-5.1-codex-mini` was listed by the API but answered 404 for this key.
  - opencode 1.18.34, `opencode run --format json`, scratch XDG config and data dirs, `openai/gpt-5.4-mini`, the shared browser's MCP servers turned off.
- **Between runs** the capture was opened again (`DELETE /api/v1/recordings/<id>/resolve`), so each agent met an open capture. Until fix 2 below, that left the reviewer's pins marked `resolved`: the first-round runs after the first agent on each capture (Claude Code on `lessons` and `address`, Codex on `inf` and `address`, opencode on `inf` and `lessons`) read `resolved` under each note of an open capture. The reruns read `pending`. None of them stopped over it.
- **Spend**: OpenAI 2.74 USD in all (Codex 1.83, opencode 0.89, probes 0.02), from the token counts at `gpt-5.4-mini` prices (0.75 USD per million input, 0.075 cached, 4.50 output). Claude Code runs on the account's plan; its API-equivalent cost is in the table.

Transcripts, clones and the runner stay on this machine in `/home/dev/handoff-run/` (not in git). Diffs are in `docs/agent-handoff/<agent>-<bug>.diff`.

## The three bugs

| Bug | Capture | What the folder holds | Cause in the source |
|---|---|---|---|
| `inf`: `10 / 0` prints `+Inf` and the run counts as finished (Nuru bug 4) | `01a1450b-9aff-7ca7-976f-d8efaae47f36`, an element comment on lesson 5's terminal | the comment, a locator with the text `+Inf`, no requests, no image (made before the screenshot fix of D-185) | `packages/wasm/core/Nuru/evaluator/infix.go`: `/` divides as float64 with no zero check |
| `lessons`: lesson 1 is English on `/sw`, lesson 2 says `/n` (Nuru bugs 1 and 2) | `01a1451c-6df5-7199-93dd-fd14ac6139ba`, a 2:41 trace with three notes | 10 spans, 5 keyframes, 3 crops, the Next.js RSC response of lesson 2 with its body | the repo's lesson files are right; the preview's database holds an older import of the module, and `packages/mtaala/scripts/seed.ts` skips a module whose slug an older row holds |
| `address`: the checkout's Address field says "Enter your phone number" (second-app bug 8) | `01a14516-2c11-7b61-bb1c-08a80a1373e2`, an element comment | the comment, a locator naming `src/routes/cart/+page.svelte` and the field | `store/src/routes/cart/checkout.svelte`: the Address input was copied from the phone input, placeholder and `id="user"` included |

## Results

"Pull" means the agent fetched the share link as markdown and ran its first line (`curl ... | tar xz`). "README first" means README.md was the first folder file it read. "Image" counts the PNGs it opened; "none in folder" means the capture had no image. "Request" is whether it named the request or error that carries the evidence.

| Agent | Bug | Pull | README first | Image | Request or error named | Cause found | Fix (diff) | Time | Cost |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | inf | yes | yes | none in folder | no request exists; named the `+Inf` text and the run summary | yes, `infix.go` `/` | the repo keeps `core/Nuru` as pinned upstream and patches it at build: new `web/patches/0002-division-by-zero.patch` for `/`, `%` and `/=`, `nuru.wasm` rebuilt, tests run through the wasm worker | 5:51 | 0.83 (plan) |
| Codex | inf | yes | yes | none in folder | the `+Inf` text | yes, `infix.go` `/` | zero checks for `/` and `%` in `infix.go` with tests, committed inside the submodule | 1:08 | 0.31 |
| opencode | inf | yes | yes | none in folder | the `+Inf` text | yes, `infix.go` `/` | zero checks in `infix.go` and `assignEqual.go` with tests, committed inside the submodule | 3:28 | 0.22 |
| Claude Code | address | yes | yes | none in folder | the locator's field and placeholder | yes, `checkout.svelte` line 125 | own `id`/`for` for phone and address, the right placeholder, no `for` on the City text | 1:10 | 0.36 (plan) |
| Codex | address | yes | yes | none in folder | the locator's field | yes | the same, plus a unique id for the first name; ran `npm install` and the build, put the lockfile back | 2:03 | 0.29 |
| opencode | address | yes | yes | none in folder | the locator's field | yes | the same; its build stopped on the missing `sass` (store bug 9), which it named | 2:47 | 0.12 |
| Claude Code | lessons | yes | yes | 0 of 8 | yes: read the body of `top-xghx-n` (`GET /sw/anza/misingi-ya-nuru/andika`, RSC) and found `"sw":"1. Welcome to Nuru!"` and the `/n` task | yes, and deeper: the module on the deploy has a dashboard UUID, so `seed.ts` counts a slug conflict and skips it | `seed.ts --chukua <slug>` takes the old module over and moves learner progress, tested on a throwaway Postgres; left the feedback open because a re-seed is still needed | 5:10 | 1.16 (plan) |
| Codex | lessons | yes | yes | 0 of 8 | no; never opened `network.jsonl` | half: guessed "stale seeded copy" from the correct Markdown, without evidence | guard tests in `packages/mtaala/scripts/tests.ts` for the two lessons; resolved | 2:38 | 0.60 |
| opencode | lessons | yes | yes | 0 of 8 | no; tried `psql $DATABASE_URL`, which was not set | **no** | broke a correct sentence: "si `/n`" became "si `\n`" in `sw/02-andika.md`; resolved | 2:59 | 0.26 |
| **Rerun after the folder and skill fixes below** | | | | | | | | | |
| Claude Code | lessons-v2 | yes | yes | 3: `keyframes/k03.png`, `annotations/a02.png`, `annotations/a03.png`, right after README | yes, `top-xghx-n`, from the README line under the notes | yes, the same seed conflict | `seed.ts --adopt <slug>`, which also rewrites `madarasa.module_ids`; tested on a throwaway Postgres; resolved with the command to run | 4:51 | 1.11 (plan) |
| Codex | lessons-v2 | yes | yes | 0 of 8 | yes, read the body of `top-xghx-n` | yes: the deploy serves stale database rows | `lessons.server.ts` lays the checked-in `packages/mtaala` Markdown over the database rows (adds the `@nuru/mtaala` dependency); works, but changes the app's data path where a re-seed would do | 4:02 | 0.63 |
| opencode | lessons-v2 | yes | yes | 0 of 8 | yes, read the body of `top-xghx-n` and named it in the note | **yes**: "serving stale seeded rows ... Reseed the curriculum from that source and redeploy" | no code change (only `.gitignore`); resolved with the re-seed step | 3:29 | 0.29 |

Every agent found the cause of at least one real bug from the folder alone: all three fixed `inf` and `address`. opencode failed `lessons` on the first run and found it on the rerun; Codex went from a guess to evidence.

Learn-from-all-feedback mode, once with Claude Code (`Learn from all the open-toolbar feedback on Nuru and write a product brief.`): it pulled the bulk export (six captures), read INDEX.md, then every README (only six), checked each pattern against the source, and wrote the brief in 1:35 (0.66 USD API-equivalent). The brief is kept as `docs/agent-handoff/claude-learn-product-brief.md`. It ranks the runtime errors first (three captures: `10 % 0`, `10 / 0`, the loop cap, each with the file and line), the stale lesson copy second, the two layout bugs third, and notes that no request or console error failed. It also reported "the `+Inf` pin is marked resolved, but `infix.go` still has no zero check". That pin status came from the reopen bug below, left over from the Codex and opencode runs on the same capture.

## What in the folder helped

- **The pull line.** Every agent took the share link's first line and ran it unchanged. None needed the token explained, and none printed it.
- **README first.** The skill's step 2 held in all 12 fix runs: README was the first folder file every agent read.
- **The locator packet.** On `address` all three went from `a01.locator.json` (field, placeholder, `for`) straight to `checkout.svelte`; Claude Code needed 11 turns.
- **The reviewer's words with the page text.** On `inf` the note and the locator's `+Inf` were enough to search the interpreter for `/`.
- **Network bodies.** On `lessons` the RSC body of lesson 2 holds the deployed curriculum. Claude Code found it on its own in the first round; Codex and opencode found it only after README pointed at it.

## What misled or was missing, and the fixes (D-187)

1. **Nothing tied a marked text to the response that carried it.** Codex and opencode read correct Markdown in the repo and either guessed or "fixed" it. README now says under each element, text or screenshot note which captured response body held the marked text: "The marked text came in the response body of request `top-xghx-n` (`GET /sw/anza/misingi-ya-nuru/andika 200, span s008`) ... Read it with `jq -r 'select(.rid=="top-xghx-n") | .responseBody' network.jsonl`", or that no captured body held it. The match ignores markup, Markdown, escapes, spacing and case, takes the first 48 letters and digits, and skips texts under 10 (`textSources()` in `packages/shared/src/areas/handoff.ts`); under the production preset the line is left out. In the rerun all three agents read that body; opencode's diagnosis went from wrong to right.
2. **Reopening feedback left its pins resolved.** `DELETE .../resolve` removed the capture's resolution but not the pins' status, so the next folder read `Status: open` above notes marked `resolved`, and the learn-mode brief took them for real resolutions. Reopening now opens the pins too (`reopenItems()`).
3. **Route guesses from older captures.** The `inf` capture predates the Next.js locator (D-185) and lists `src/routes/sw/.../+page.svelte`. Codex and opencode opened that missing file first. The skill now says a route file with `"source": "guess"` may not exist and to search for the visible text instead.
4. **The skill did not say when an image is worth opening.** In the first round no agent opened an image. The skill now says to open a note's image when the note is about what the page shows (wording, language, layout, colour), and names each agent's tool for PNGs. Claude Code then opened the three images the timeline pointed at. Codex and opencode with `gpt-5.4-mini` still opened none in any of their eight runs; the text was enough for these bugs, so nothing in the outcome turned on it.
5. **A data-only bug has no repo fix.** Codex and opencode resolved `lessons` with tests or no change. The skill now has "When the code already looks right": read the named body, fix what put the wrong value there (seed, migration, loader, build), and leave the feedback open with the step to run when no repo change can fix it. The opencode rerun resolved before this sentence existed.
6. **Where to put the skill.** README said only "install the Agent Skill" and the share page named `.claude/skills/`. README now gives the two commands for `.claude/skills/` and `.agents/skills/`, and the share page names both.
7. **A search hint pointed at nothing.** README's hint `grep -n '<rid>' ... # a request id from the timeline` named something the timeline does not print; it now says to take the id from `spans.jsonl` or the lines above.

Tests: `packages/shared/test/handoff.test.ts` (`textSources`, skill text), `apps/server/test/handoff.unit.test.ts` ("where a marked text came from": the line under each note, the line for no match, quiet under production), `apps/server/test/handoff.int.test.ts` (reopening opens the pins, and the next folder shows them pending).

## Other things the transcripts show

- **Machine instructions reached the agents.** This VM tells every agent to run `repose-notify --done` at the end. opencode did so once in round two and reached the owner; the later runs had a stub on `PATH`, and Codex called it once more. Run agents for experiments with that command stubbed.
- **Side effects outside the clone.** Claude Code installed TinyGo 0.39 and Go 1.25.8 under `~/.local` to rebuild `nuru.wasm`, and twice started a throwaway Postgres container (removed afterwards).
- **Repository conventions.** Claude Code found that Nuru patches its pinned interpreter through `packages/wasm/web/patches/` and followed it; Codex and opencode committed inside the submodule, which a push to Nuru would not carry.
- **Cost shape.** Codex read files in 240-line `sed` chunks and re-sent the growing context each turn: 1.3 to 4.4 million input tokens a run, mostly cached. opencode used about the same input for half the price. Claude Code was the slowest on `inf` (it rebuilt the wasm) and the fastest on `address`.
