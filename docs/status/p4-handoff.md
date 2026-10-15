# Status: agent hand-off (Part 2, step 4)

Branch `p4/handoff`. Decisions D-142 to D-149 in `docs/decisions.md` (written as D-117 to D-124 on the branch, renumbered at the merge, D-150). p4/trace, p4/locator, p4/transcribe and p4/zero-integration use D-117 onwards too: renumber at merge, including the references in `docs/architecture.md` section 17 and `e2e/tests/agent/agent.spec.ts`.

## What is built

| Part | Where | What it does |
|---|---|---|
| Folder download | `GET /api/v1/recordings/:id/folder`, `apps/server/src/lib/server/handoff/{folder,assemble,tar}.ts` | `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "<server>/api/v1/recordings/<id>/folder" \| tar xz` writes `.feedback/<id>/` with the PLAN layout: README.md, feedback.json, spans.jsonl, annotations/aNN.png + .shapes.json + .locator.json, keyframes/ (at most ten), outline/, text/ (OCR), voice/transcript.vtt + audio.webm, console.jsonl, network.jsonl (redacted, bodies cut at 256 KB), raw/rrweb-NNN.json.gz, raw/network.har. Members only: a personal token, an MCP token or a session. A share token gets 401. |
| Listing and single files | `GET .../folder/files`, `GET .../folder/file?path=` | The same built folder (cached ten minutes per capture). |
| README.md | `renderReadme()` in `packages/shared/src/areas/handoff.ts` | PLAN order: header (reviewer, identity, app, deploy, browser, masking preset, status), the one fence rule, the reviewer's words fenced with source and author, "what did not happen" (dead, stuck and silent spans), the timeline with `-> open <image>` pointers, search hints and the file index. Cut in steps to stay under 26,000 characters (about 7,400 tokens). |
| Images | `handoff/images.ts` (sharp) | 1x CSS pixels: editor crops divided by the device pixel ratio, locator and toolbar crops kept, drawings burned in through an SVG overlay. The reviewer's screenshot is `keyframes/k01.png`. Video captures without keyframe assets get stills at player time 1.5 s after each failure, navigation and error. |
| OCR | `handoff/ocr.ts`, Dockerfile | tesseract (`eng`, `swa` in the image), `OCR_BIN`, `OCR_LANGS`. Canvas regions from `canvas.sample` events (p4/trace) cut from the nearest keyframe, plus annotations on a `<canvas>`. Each `text/*.md` says it is OCR and fences the text. |
| Share URL | `mcp/markdown.ts`, `handoff/summary.ts`, `sharePageMarkdown()` | `Accept: text/markdown` or `.md`: line one is the pull command, then a summary only (title fenced, counts, no comment bodies, logs or images). `/s/*` keeps no-referrer and noindex. New links expire after `SHARE_LINK_DAYS` (14), revocable as before. |
| Agent Skill | `skills/open-toolbar-feedback/SKILL.md`, `GET /api/v1/skill`, `scripts/gen-skill.ts` | Pull with curl, read README.md first, open images only when the timeline points at them, grep and jq hints, resolve through the API (whole capture or pin numbers). A unit test keeps the repo copy equal to `handoffSkill()`. |
| MCP | `mcp/handoff-tools.ts` | `get_feedback_folder` (README, listing, pull command), `get_feedback_file` (images as image content, text in pages), `resolve_feedback` (note, commit, optional pins). Link holders are refused with a pointer to the markdown summary. |
| Resolve | `POST`/`GET`/`DELETE /api/v1/recordings/:id/resolve`, table `feedback_resolution`, migration `0009_feedback_resolution.sql` (written as `0006` on the branch) | Note, commit, who, via (MCP client name, API or browser). `items: [n]` closes reviewer toolbar pins; the capture is resolved once no pin is open. |
| Webhooks | `dashboard/notices.ts`, `handoff/resolve.ts`, `handoff/payload.ts` | `feedback.created` (with `capture.created`, adds folder URL, pull command, skill URL) and `feedback.resolved` (adds the resolution), signed like the rest. Labels in Settings > Webhooks. |
| Reviewer toolbar items | `handoff/items.ts` | Rows of `feedback_item` (p4/reviewer-ui) become annotations with pin, kind, intent, severity, status, quote, voice transcript and 60-second context. Read with plain SQL, so the folder works with and without that table. |
| Spans | `handoff/spans.ts` | The one call into `@toolbar/trace`: `deriveTrace()`, wired at the merge into main (D-150). |

## How it was verified

- Unit: `packages/shared/test/handoff.test.ts` (fences that captured text cannot close, README order and the 8k budget with 3,000 spans and 40 long comments, share page first line, repo skill equals the generated one), `apps/server/test/handoff.unit.test.ts` (tar against GNU tar with a PAX long path; `assembleFolder` on hand-made events, spans, images and OCR: the exact file list, 1x widths, redacted headers, query and body fields, the 256 KB cut, span links, OCR and outline files fenced, README order, no captured text outside a fence, the archive unpacking to the same list; real tesseract reading text from an image).
- Integration (Postgres): `apps/server/test/handoff.int.test.ts`: resolving sends a signed `feedback.resolved` that `verify()` accepts, with the pull command; share links default to 14 days and the default link is reused; MCP folder tools for members, refused for a link holder without a seat; toolbar pins as annotations and resolving pin by pin.
- E2E on display :185 against the dev server on :3305: `e2e/tests/handoff/handoff.spec.ts` (3 tests, pass): the test extension records a tab on the lab app (works, hidden 500, hanging request, uncaught error); the share URL as markdown starts with the pull command; the share token alone gets 401; running that first line in bash unpacks only PLAN paths; README lists the hanging request under "what did not happen" and the 500 in the timeline; network bodies stay under 256 KB; MCP returns the same README and an image; resolving shows in the next pull; `/api/v1/skill` serves the skill. Also passing against this branch: `tests/agent` (J-153 updated to the new markdown, J-152 with `AGENT_SHARE_TOKEN_C1`), `tests/viewer/page.spec.ts`, J-142 in `tests/dashboard/settings.spec.ts`.
- With `p4/trace` merged on a throwaway branch (and `spans.ts` calling `deriveTrace`), the same real capture got spans.jsonl, outline/ files, a "what did not happen" with the stuck span and stills per span; server check passed. That wiring is below.
- Server image built with the new Dockerfile (`tesseract --list-langs`: eng, osd, swa).
- `pnpm -r --workspace-concurrency=2 build`, `test` and `check` pass. `apps/server/test/auth.int.test.ts` fails only while the worktree `.env` sets `ALLOWED_EMAIL_DOMAINS=test` (known, see p4-locator status); it passes without that file.

## What is not built or not checked

- Spans: wired at the merge (D-150); `handoff.unit.test.ts` passes with it. `e2e/tests/handoff` was not rerun on main after the merge.
- Locator packets (p4/locator): the folder reads `annotation.locator` when the column exists and builds a packet from the TargetRef otherwise; not run against a real packet. `stackmap` events are attached to console rows by `ref` without a check on real data.
- OCR on real canvas pixels is unit-tested with a mocked region; a real `canvas.sample` from a trace on the lab canvas was not run, because those events come with p4/trace.
- No UI: the viewer shows no resolved badge, no "copy pull command" button and no per-pin status. The agent tab still shows its Part 1 prompts.
- The comment voice notes of p4/transcribe (`transcript.stream = voice:<assetId>`) are read into the README; not run against that branch.
- Migration: written as `0006_feedback_resolution.sql` on the branch; the merge regenerated it on main as `0009_feedback_resolution.sql` (after `0006_projects`, `0007_annotation_locator` and `0008_feedback_items`), same SQL.
- Folders are built in memory; a capture with hundreds of MB of rrweb would need streaming. Not measured.

## How to run it

```sh
set -a; . ./.env; set +a                      # DEV_PORT=3305, DATABASE_URL=.../toolbar_p4_handoff
pnpm --filter @toolbar/server dev
curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "http://localhost:3305/api/v1/recordings/<id>/folder" | tar xz
curl -s -H 'Accept: text/markdown' http://localhost:3305/s/<token> | head -1
pnpm --filter @toolbar/extension build:test
cd e2e && TOOLBAR_E2E_TOKEN=<personal token> SERVER_URL=http://localhost:3305 E2E_DISPLAY=:185 npx playwright test tests/handoff --workers=1
```
