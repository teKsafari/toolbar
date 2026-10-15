# G8 replica results (Nib side)

Raw results of group G8 in `docs/parity/scenarios.md` (S8.1 to S8.5), run on the replica only. The Jam side and the match, better or gap verdicts belong in `docs/parity.md`. Product code was not changed in this step; bugs and loose ends are listed at the end.

Run on 2026-10-15. Each scenario first ran alone (S8.1 three times while the spec was fixed, S8.3 twice, S8.4 and S8.5 together once), then G8 ran in full once (11.2 min, 1-minute load 0.3 to 2.0). Every value below comes from the full run unless a row says otherwise; the solo runs gave the same states, texts and counts, with timings in the same range. Every timing was taken at load 2.0 or less.

## How to rerun

```sh
pnpm --filter @toolbar/extension build            # release build, closed shadow root
cd e2e && npx playwright test -c playwright.parity.config.ts G8           # S8.1, S8.3, S8.4, S8.5 (S8.2 skips)
cd e2e && npx playwright test -c playwright.parity.config.ts G8 -g S8.4   # one
```

S8.1 also needs `claude` (Claude Code) on `PATH`, signed in. The run used a private copy of the release build (`PARITY_EXT_BUILD=chrome-mv3-g8`, a copy of `chrome-mv3` of 2026-10-14 21:49, the same build G4 to G7 used). Evidence lands in `e2e/parity-shots/G8/` (git-ignored): one `<scenario>.json` per scenario with every state, count, click count and timing, the raw Claude Code streams as `S8.1-agent-<step>.jsonl`, and screenshots named `<scenario>-<step>-nib-<width>-<theme>.png`. The share-page markdown of S8.1 step 7 is in git, under `docs/parity/evidence/G8/` (share token replaced by `<share-token>`). Logs: `e2e/runs/parity-G8.log` (full run), `parity-G8-s81.log`, `parity-G8-s83.log`, `parity-G8-s84-85.log` (solo runs).

The server was the compose image built 2026-10-14 20:58 EDT (health version 1792025872427), the one G6 and G7 ran against. It predates the owner-scope commits, so paused features (the CLI page and the CLI hints, "Send to app") still show in it (G7 loose end 1).

## Rig

The G1 rig (`e2e/parity/rig.ts`): Playwright 1.63.0 Chromium, fresh profile, release build unpacked, action pinned, Xvfb `:130` with openbox, compose stack on :3000, owner `parity@example.com` signed in through the popup. The toolbar icon, popup rows, chords, page clicks and drags, the consent page's Allow button and the clicks on `chrome://extensions/shortcuts` use real X input through xdotool. Web pages of the product are otherwise driven with Playwright, as in G4 to G7. Timings come from CDP screencast frames (first frame that shows the result), from the popup's own paint timing (S8.4, J-193), or from DOM polling, as named in each row.

Rig change: `launchNib` takes an optional `userDataDir` that survives `close()`, so S8.4 can restart the browser on the same profile for a cold popup open.

Owner scope (`docs/scope.md`): S8.2 (CLI) is paused and was not run; its rows J-155, J-244, J-245, J-246 and J-247 stay "paused" in `docs/parity.md`, and the spec holds a skipped test for it. No Mailpit or email step exists in G8. No row of `docs/parity.md` was changed.

## Deviations from the script

- S8.1 step 2: `claude -p` cannot run an MCP OAuth sign-in; with only the URL in its config it reports that the server "needs authentication" and loads no tool. The spec therefore plays the client half of the flow the way Claude Code does it (first call answered 401, discovery from `resource_metadata`, dynamic registration with the client name "Claude Code", PKCE S256, a loopback redirect on 127.0.0.1:47121), opens the authorize URL in the rig's browser and clicks Allow once with a real X click. The access token then goes into the scratch `--mcp-config` as an `Authorization` header, and every later agent step is a real `claude -p --strict-mcp-config` run against it (model sonnet). The scratch folder was under the system temp dir and is deleted at the end; the user's own Claude Code config was not touched.
- Claude Code keeps a "needs auth" cache by server name in `~/.claude/mcp-needs-auth-cache.json`. A first exploratory call made before the spec existed wrote a `nib` entry there, and step 8's refused call writes one again; the spec drops the `nib` entry before each agent run and removes the file at the end when only that entry made it. The file is gone after the run, as it was before.
- S8.1 step 3: besides the agent, the spec calls the same four tools over JSON-RPC with the same token, to get exact counts without the agent's choice of filters.
- S8.1 step 9: CLI is paused, so the token's write was tried as the CLI would send it (`x-nib-client: cli` on `/mcp`), plus a REST write and a plain MCP call. The token was revoked afterwards.
- S8.3 step 2: the cursor pill follows the pointer and appears on the first pointer move after arming. The spec holds the pointer still on the page, presses the chord, and moves it by one pixel every 15 ms or so (as a resting hand does) until the pill shows; it records both the veil (armed overlay) and the pill.
- S8.3 step 4 and S8.4 (J-194): instant replay was already on in the account's synced extension settings (G1 S1.4 left it on), so neither step had to turn it on, and neither turned it off. The S1.4 step 1 "turn it off again" is a Jam-side step.
- S8.3 step 5: the rebind used Alt+Shift+S (a chord Chromium accepts with no conflict on this rig) and put Ctrl+Shift+S back.
- S8.4: J-193 runs in a browser of its own on a kept profile: sign in, close, start again, then the first icon click is the cold run. J-194 runs in that same browser. Rows J-195 to J-198 are copied from earlier groups, as the script says.
- S8.5 step 1: Chromium's commands still reach the extension on `chrome://extensions`; the spec read the extension's session state, the open tabs and whether a popup opened before and after the chord.

## S8.1 MCP, markdown and copy for AI (N1)

N1 = `parity S3.1 lab` (`01a13e12-...`), in "parity's workspace".

| Step | Row | Result |
|---|---|---|
| 1 | J-145 | Dashboard, workspace menu, Settings, MCP: 3 clicks. The page: "MCP" heading, the server URL `http://localhost:3000/mcp` with Copy, five cards (Claude Code, Cursor, Codex, VS Code, "Add another agent", each with a two-letter mark), then "Connected agents" (empty). The Claude Code card opens a dialog "Connect Claude Code" with the snippet `claude mcp add --transport http nib http://localhost:3000/mcp`, a Copy button and three numbered steps (run it, start Claude Code and run /mcp, approve in the browser). Copy put exactly that line on the clipboard: server URL yes, token no. Card, Copy = 2 clicks. Shots at 1440 and 390, light and dark; no sideways overflow. |
| 2 | J-146 | First call: 401 with `WWW-Authenticate: Bearer resource_metadata="<server>/.well-known/oauth-protected-resource/mcp"`; the metadata names the server itself as authorization server, scopes `captures:read captures:write`, registration endpoint, PKCE S256. Consent page (`/mcp/authorize`): the product mark, "Claude Code wants to use your Nib account", "Signed in as parity@example.com. The agent will act as you in the workspace you pick.", a Workspace select (parity's workspace preselected; also Parity and Parity 2), "It will be able to" with two bullets (see captures with console, network, user events, frames, transcripts and comments; comment on, rename and move captures), "Allow access", a quiet "Cancel", and a footer naming the return host (127.0.0.1:47121) and where to remove the agent. One click on Allow: callback with code and state after 0.14 s (load 1.2). Token exchange 200: scope `captures:read captures:write`, 24 h access token, a refresh token. 33 tools listed. Shots at 1440 and 390, light and dark; no overflow. |
| 3 | J-149 | Agent (26 s, load 1.2): called `get_capture`, `get_console_logs`, `get_network_requests` with status 5xx, `get_user_events`. Counts it reported: console 45 of 45, 5xx 1 (POST `/api/fail` 500), user events 25 of 25. Direct calls agree: console 45 (19 of kind console or error; the others are network, navigation, click, input and media rows), network 17 in all and 1 with 5xx, user events 25 (click, key, visibility, navigation, input). Viewer counts in S3.1: console 45, network 17, actions 25, one 500. Fields of the 5xx row: method, url, status, timing, `requestHeaders`, `responseHeaders`, `requestBody`, `responseBody` (by default for failures), `frame` (frame id), `tabId`, `initiator`, `graphql`, `cors`, `wsFrames`, `videoMs` and more. The agent answered `frameId: false` because the field is named `frame`. `get_capture` returns details plus `signals`, `counts`, `media`, `comments`, `transcript`, `chapters` and a `devtools` guide. |
| 4 | J-150 | Agent (31 s, load 0.8): `search` with the pasted share URL found N1 (1 hit, match by id); `search` "parity" gave 37 hits (first page 10, the agent then paged with `search_captures` to list all 37; two are recording-link captures with no title); `list_folders`: "parity" (4 captures); `list_members`: parity@example.com admin, mate@example.com creator. |
| 5 | J-151 | Agent (11 s, load 1.2): `create_comment` "agent parity check" with `videoMs` 10000 and `update_capture` title "parity S3.1 lab (agent)". Capture page after a load: title changed; the comment shows by "parity" with a 0:10 time chip and a comment marker on the seek bar. Agent (13 s, load 1.0): `update_capture` back to "parity S3.1 lab" and `delete_comment` by id. After: title back, comment gone (list_comments). The capture page needed a load to show the agent's writes (see loose end 3). |
| 6 | J-152 | Dev tools, Agent tab (1 click at 1440; the dev tools are open). With an agent connected the tab shows three presets as chips: "Fix it" (selected), "Summarise", "E2E test", each a prompt in a box with "Copy prompt" and a "Setup prompt" link, then "No MCP in your tool? Copy everything as markdown." with "Copy for AI", and a CLI hint (`nib get <url>`). Each copied preset holds N1's member URL `/c/<id>` (269, 215 and 227 characters). Copy for AI put a 3.4 KB markdown bundle with front matter and N1's URL on the clipboard. Clicks per preset: chip, Copy prompt = 2 (Fix it: 1). Shots at 1440 and 390, light and dark; no overflow. |
| 7 | J-153 | `curl -H 'Accept: text/markdown' <share URL>` and `<share URL>.md` return the same 935-byte markdown, `content-type: text/markdown`, `vary: Accept`. Front matter: title, url, type, captured_on, page_title, image, duration_ms, browser, os, viewport, screen, time_zone, locale, author, created. Body: the title, a signals line ("4 console errors, 3 failed requests, 1 with a 5xx status, 0 requests never answered, 17 interactions"), "More detail" with the MCP server URL (call `get_capture` first) and CLI commands. N1 has no comments, so no comment section shows. `curl -sI` on the share URL: `link: <.../s/<token>.md>; rel="alternate"; type="text/markdown"`. An unknown token's `.md` answers 404 "Not found". Files: `docs/parity/evidence/G8/N1-share-accept.md`, `N1-share-suffix.md`, `N1-share-head.txt`. |
| 8 | J-147 | MCP page: one row "Claude Code", parity's workspace, "read, comment and organise", connected and last-used times. Row menu, Remove, confirm ("Remove Claude Code? Its access stops at once. Connect it again to use it."): 3 clicks. The row went without a reload 0.16 s after the confirm (load 0.7). Next MCP call with the old token: 401. The agent's next run (10 s) loaded no tools and said the server failed with 401, token unknown, expired or revoked. |
| 9 | J-148 | Settings, API tokens, "Create token": a dialog "Create a token" with Name, Expires (7, 30, 90 days, a year, never; 30 preselected), CLI (Read only preselected, Read and write, No access) and MCP (No access preselected). Name typed, Create: 2 clicks. The secret shows once in a green box with Copy ("Copy it now: it will not be shown again"), 39 characters starting `tb_pat_`; the list row shows the name, `tb_pat_xxxx...`, "CLI, read only", created, expiry 11/14/2026, "never used". After a reload the secret is gone. With the token, as the CLI calls: a read (`get_capture`) works; a write (`create_comment`) is refused with "This connection is read-only..." (a tool error, HTTP 200). The same token on the MCP surface gets 403 and a REST PATCH gets 403; N1's title did not change. Revoked afterwards. Shots of the tokens page at 1440 and 390, light and dark; dialog and secret at 1440 light. |

## S8.2 CLI

Paused by owner scope (`docs/scope.md`, `FEATURE_CLI`). Not run. Rows J-155, J-244, J-245, J-246 and J-247 stay "paused" in `docs/parity.md`.

## S8.3 Shortcuts

| Step | Row | Result |
|---|---|---|
| 1 | J-179 | Ctrl+Shift+Y on `/` opens the popup (rows screenshot, record, replay, link). Chord to the popup's content ready and reachable over CDP: 0.6 s (load 1.5; that time includes the CDP attach, see S8.4 J-193 for paint times). Escape closes it. |
| 2 | J-180 | Ctrl+Shift+S, then the resting pointer moves: armed veil on screen after 31, 26 and 26 ms; cursor pill "Click or drag to capture" on screen after 181, 123 and 118 ms (median 0.12 s, load 1.3 to 1.4). Under 0.5 s in every run. A click on the page opened the editor; closing it discarded the draft (session idle). |
| 3 | J-181 | From G3 S3.1: chord to first live frame 6.6 s (load 5.9; median of three runs there 6.0 s, the 3-2-1 countdown included); stop chord to first editor frame 2.9 s (load 5.5; another run 0.5 s at load 4.2). |
| 4 | J-182 | Replay on, Ctrl+Shift+X: the replay draft opens over the page with no popup in all three runs. Editor shell in the DOM after 253, 214, 216 ms; replay loaded after 309, 321, 257 ms; first frame showing the editor 344, 457, 373 ms (median 0.37 s, load 1.3 to 1.6). Discarded each time. |
| 5 | J-184 | Popup, three-dot menu, Settings, "Keyboard shortcuts: Change": `chrome://extensions/shortcuts` in a new tab (4 clicks; the three-dot menu's own "Keyboard shortcuts" item makes it 3). The page lists five commands for Nib: Activate the extension (Ctrl+Shift+Y, scope fixed to In Chromium), Share the last moments of this tab (Ctrl+Shift+X), Start or stop recording this tab (Ctrl+Shift+Space), Create a recording link (not set, scope disabled), Take a screenshot (Ctrl+Shift+S); each scope menu offers In Chromium or Global. Rebind: pencil on "Take a screenshot", Alt+Shift+S, stored as `screenshot-mode=Alt+Shift+S`; the new chord armed screenshot mode on the lab; the popup's screenshot row tooltip read "Alt+Shift+S". Set back to Ctrl+Shift+S (checked through `chrome.commands`). Shots: the shortcuts page and one open scope menu at 1440, default theme; the rebound page and the tooltip. |

## S8.4 Speed

Nib, every timing below at load 2.0 or less. Medians of the runs shown; ms unless marked.

| Row | Step | Runs (load) | Median |
|---|---|---|---|
| J-193 | Icon click to the popup's first paint (header with the wordmark), from the popup's paint timing | cold 306 (1.2); warm 174, 155, 213 (1.1 to 1.2) | cold 0.31 s, warm 0.17 s |
| J-193 | Icon click to full content (last largest-content paint, the account line and the four rows) | cold 362 (1.2); warm 174, 167, 229 (1.1 to 1.2) | cold 0.36 s, warm 0.17 s |
| J-194 | Screenshot click on `/` to first editor frame (DOM in brackets) | 547 (358), 335 (212), 441 (266) at load 1.0 to 1.2 | 0.44 s (DOM 0.27 s) |
| J-194 | Area drag release to first editor frame | 592 (470), 519 (379), 283 (223) at load 1.1 to 1.2 | 0.52 s (DOM 0.38 s) |
| J-194 | Replay key to editor shell, to replay loaded, to first editor frame | shell 430, 225, 322; loaded 443, 287, 382; frame 519, 355, 423 at load 1.4 to 2.0 | shell 0.32 s, loaded 0.38 s, frame 0.42 s |
| J-195 | Chord or record click to first live frame | S1.2 step 1: 5.5 s (5.9), median of six there 5.0 s; S3.1 step 3: 6.6 s (5.9), median of three 6.0 s | 5.0 to 6.0 s |
| J-196 | Stop to editor; drafts healthy | S1.2 step 13: 0.9 s (4.6), median of five 1.4 s; S1.3 step 6: 0.5 s (5.4), median of four 0.6 s; S3.1 step 19: 2.9 s (5.5), another run 0.5 s. Healthy drafts: 5 of 5 in S1.2; every S1.3 and S3.1 run opened a playable draft and created | tab 1.4 s, desktop 0.6 s |
| J-197 | Create to link on the clipboard, and to the background tab | S2.1 step 21: link 0.4 s, tab 0.5 s (1.5); S2.4 step 9: link 0.2 s (1.3); S3.1 step 19: create to ready 5.4 s. S2.2 created with the Create button and kept no timing | link 0.2 to 0.4 s, tab 0.5 s |
| J-198 | Signed-out share page, first contentful paint and load | S5.1 step 4: FCP 0.17, 0.27, 0.22 s; load 0.20, 0.30, 0.25 s (1.9 to 2.2). Create to playable video: S3.1 create to ready 5.4 s | FCP 0.2 s, load 0.3 s |

Earlier solo run (load 1.2 to 1.7): J-193 cold 0.21 s first paint and 0.24 s full; warm 0.15 s and 0.17 s; J-194 screenshot 0.36 s, area 0.45 s, replay frame 0.45 s.

## S8.5 Errors and empty states

| Step | Row | Result |
|---|---|---|
| 1 | J-199 | On `chrome://extensions` the icon opens the popup with the account line, a drawn browser window with a red no-entry sign, "This page can't be captured.", and "Browser pages and extension stores are off limits. Open a regular website and try again." No capture rows. Ctrl+Shift+S there: nothing happens (no session, no tab, no popup, no message). Shot at 1440, default theme. |
| 2 | J-200 | From G1 S1.2 step 2: the bar's mic shows its off state with the tooltip "Microphone off" (mic setting off, not the missing-permission state). From G6 S6.3 step 3: on the link recorder with no microphone, a notice "No microphone was found. Plug in or turn on a microphone, then try again." with "Record without voice"; the start button becomes "Try again with voice"; no permission prompt in between. |
| 3 | J-202 | From G2 S2.1 step 22: no clipboard permission bubble or prompt window with the lab origin's grants cleared; the extension writes the link itself. |
| 4 | J-203 | "parity-empty" made from the sidebar (hover the Folders heading, plus, type, Enter) and opened (2 clicks). The folder page: the title with a 0 count, Share and a menu; centred below, a folder icon, "This folder is empty", "Captures you move here, or make with this folder picked, show up here.", and a "Make a capture" button. No filter bar. Shots at 1440 and 390, light and dark; no overflow. Deleted through the folder menu (warning, "Delete folder"): toast after 45 ms, back on `/`, not listed. |
| 5 | J-205 | `/c/<N7>` (deleted in G7 S7.4) and `/c/<random uuid>`: both answer 404 with the tab title "Not found | Nib" and one centred line, "This capture could not be found.", with nothing else on the page. Shots at 1440 and 390, light and dark; no overflow. |

## Bugs and loose ends (not fixed in this step)

1. J-153: a HEAD request with `Accept: text/markdown` answers `content-type: text/html`, while the GET with the same header answers markdown. A client that probes with HEAD first is told the wrong type.
2. J-153: the markdown's signals line says "17 interactions" while the capture has 25 user events (and 25 rows in the actions tab); the two counts use different rules and the line does not say which.
3. J-151: the agent's comment and title change show on an open capture page only after a load (the MCP writes do not publish to the page's live comment stream; noted in `docs/status.md`, agent area, "For the merge step").
4. J-153 and J-152: the share markdown and the "Copy for AI" bundle still point to the CLI (`nib get ...`), and the agent tab shows a CLI hint, although the CLI is paused by owner scope. The running image predates the scope change (G7 loose end 1); check again after a rebuild.
5. J-152: the "Copy for AI" bundle says `image: null` for N1, while the share markdown gives the thumbnail URL.
6. J-149: the network rows name the frame id field `frame`; the agent read that as "no frame id". A clearer name (`frameId`) or a line in the tool description would help agents.
7. J-146: `claude -p` cannot do the OAuth sign-in on its own; a person must run `/mcp` in an interactive Claude Code once (the card's steps say so). Not a product fault, but the flow cannot be tested headless end to end without the spec's client stand-in.
8. Instant replay stays on in the parity account's synced settings (since G1 S1.4). Turn it off before any run that expects the default.
