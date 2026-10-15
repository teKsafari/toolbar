# G3 replica results (Nib side)

Raw results of group G3 in `docs/parity/scenarios.md` (S3.1 to S3.5), run on the replica only. The Jam side and the match, better or gap verdicts belong in `docs/parity.md`. Product code was not changed in this step; bugs are listed at the end.

Run on 2026-10-15. All five scenarios passed in one full run (10.3 min, 1-minute load 2.3 to 7.2 between scenarios; every timing below was taken at load 6 or less). Values come from that run unless a row says otherwise. Single-scenario runs made earlier the same night give a second point for the timings and for the event losses in bug 1.

## How to rerun

```sh
pnpm --filter @toolbar/extension build            # release build, closed shadow root
cd e2e && npx playwright test -c playwright.parity.config.ts G3           # all five
cd e2e && npx playwright test -c playwright.parity.config.ts G3 -g S3.2   # one
```

This run used a private copy of the release build (`PARITY_EXT_BUILD=chrome-mv3-g3`, copied from `chrome-mv3` of 2026-10-14 21:49; no extension, capture or shared commits since). Evidence lands in `e2e/parity-shots/G3/` (git-ignored): one `<scenario>.json` per scenario with every count, check and timing; `S3.1-contents.json` and `S3.2-rec*-contents.json` hold the full API answers (console, network with headers and bodies, actions, raw events, detail); screenshots are named `<scenario>-<step>-nib-<width>-<theme>.png`.

## Rig

The G1 rig (`e2e/parity/rig.ts`): Playwright 1.63.0 Chromium, fresh profile, release build unpacked, action pinned, Xvfb `:130` with openbox, page viewport 1440x900, compose stack on :3000, account `parity@example.com`. Every page click, the typing, the wheel scroll, Ctrl+R, Ctrl+L and the record chord go through the X server with xdotool. Chord timings come from CDP screencast frames (first frame that shows the bar's stop button, or the editor). Per-step counts come from `GET /api/v1/recordings/<id>/console|network|actions|events`: each row belongs to the last scripted step that started before it. The capture page was read with Playwright (a web page, no extension UI).

Deviations from the script:

- Lab additions L-1 to L-3 were already in the lab (uncommitted in the working tree, served by the running lab); this step did not touch them.
- The Nib recording runs at script speed with 3 s between steps, so N1 lasted 2:12 here (the scenario estimates about 2.5 min for Jam).
- S3.2: `research/jam-private/notes/capture-lab.md` names what rec2 and rec3 covered but not their exact order. The spec rebuilds them: rec2 is `/canvas` with three redraws, then `/live` with the socket connected after the start, one send, and the SSE stream to its end (45 s); rec3 is `/live` (socket connected after the start), `/slow` by link, Ctrl+R, `/slow-raw` typed, the Back link, stopped from the bar (55 s).
- S3.3: Nib has no budget, so the spec makes a fresh N4 pre-roll (Submit order, Log at every level, 20 s, a visible screenshot) and also reads the N4 made in G2 (S2.1, id from `e2e/parity-shots/G2/S2.1-23-recording.json`).
- S3.4 step 2b calls `window.toolbar.setMetadata` with an 11 KB object from a script, as page code would; there is no button for it.
- S3.5: tab capture fails with Chromium's fake-device flags (G1 S1.6), so both recordings are desktop recordings. The narration is a 29 s espeak-ng WAV fed through `--use-file-for-fake-audio-capture` (made at run time in `e2e/.cache/`).
- The player's download button fired a browser download named `parity-S3.1-lab.webm`, but Playwright could not save it from the persistent profile; the spec fetched the same URL (`/media/video?download=1`) and probed that file. This looks like a rig limit, not a product fault.
- No paused rows in G3. Mailpit was not used.

## S3.1 Every lab case in one tab recording (N1)

Capture `parity S3.1 lab`, 2:12 wall, video 2:14.

| Step | Result |
|---|---|
| 1, 2 | Fresh `/`, 5 s; status "idle", saved 0 times. |
| 3 chord to live (J-195) | 6.6 s (load 5.9). Single runs: 6.0 s (load 3.9), 4.2 s (load 5.5). Median 6.0 s. The 3-2-1 countdown is inside this time. |
| 19 stop chord to editor (J-196) | 2.9 s (load 5.5). Single run: 0.5 s (load 4.2). Create to ready: 5.4 s. |

Count table, Nib column from the API. The viewer shows the same totals with filters cleared: console tab 45 rows (UI) and 45 (API), network 17 and 17, actions 25 and 25. "c" counts console rows of kind console and error, "n" network rows, "u" action rows.

| Step | Case | Lab truth c / n / u | Nib c / n / u | Notes |
|---|---|---|---|---|
| 4 | Save | 0 / 1 / 1 | 0 / 1 / 1 | GET `/api/ok?q=works` 200 with JSON body. |
| 5 | Export | 0 / 0 / 1 | 0 / 0 / 1 | Plain click row, no dead-click hint. |
| 6 | Sync | 0 / 1 / 1 | 0 / 1 / 1 | The reload at step 15 cancelled it: status "abort", red, time 33.7 s, detail status "Failed", no body. While the page lived, the row was pending; the capture shows only the final state. |
| 7 | Submit order | 0 / 1 / 1 | 0 / 1 / 1 | POST `/api/fail` 500; console gets a red network row; seek-bar marker with a "500" badge. |
| 8 | Show profile | 2 / 0 / 1 | 2 / 0 / 1 | The log, then "Uncaught TypeError: Cannot read properties of undefined (reading 'profile')" with class, message and a two-frame stack; error marker on the seek bar. |
| 9 | Refresh | 1 / 0 / 1 | 1 / 0 / 1 | "Uncaught (in promise) Error: unhandled rejection from the lab app", error marker. Jam missed this case. |
| 10 | Log at every level | 15 calls / 0 / 1 | 14 rows / 0 / 1 | Every call has a row except `groupEnd` (it logs nothing): log, info, warn, error, debug, table, group, the log inside, trace, assert, count 1, count 2, time, timeEnd. The "count: 2" row carries a repeat badge of 2 (bug 8). |
| 11 | Modal | 1 / 0 / 2 | 1 / 0 / 2 | Warn row; the Delete click's selector is a structural path (no test id on that button). |
| 12 | Iframe button | 1 / 1 / 1 | 1 / 2 / 1 | Iframe log, click inside the iframe, and the fetch with frame id `fljwob`; the extra request is the iframe's SvelteKit `version.json` poll. |
| 13 | GraphQL | 0 / 1 / 1 | 0 / 2 / 1 | POST `/api/graphql` 200; the API row carries `graphql: {operationName: GetCart, hasErrors: true}`, but the network tab shows a plain 200 row with a green dot and no operation name (bug 5). Extra row: `version.json` poll. |
| 14 | Auth | 0 / 1 / 1 | 0 / 1 / 1 | `authorization`, `x-api-key` and `cookie` request headers show a shield "masked" badge. |
| 15 | Reload | 0 / several / 0 | 0 / 3 / 5 | Network: document `/`, iframe document `/embed`, `badge.svg` from :5174 (image, no body). The page's scripts and styles of the reload are not listed (served from cache). Actions: the Ctrl+R key row, two "Tab hidden" rows (page and iframe), "Loaded /" and "Loaded /embed". The raw event says cause `reload`; the actions row drops it (bug 3). |
| 16 | Form | 0 / 2 / 9 | 0 / 2 / 5 | Network: the route script and POST `/form` 403 (the lab rejects cross-site form posts; seek-bar marker "403"). The request body masks email, password and the card number; the `sk_live_` token stays in clear. Actions: SPA navigation row, a "Tab hidden" row (iframe unload, bug 7), clicks on Name and Email, and one typing row (Notes, marked masked because of the card number). Missing: the Password and Notes clicks, typing rows for Name, Email and Password, and the Create account click (bug 1). The earlier single run lost a different set (Name click, Notes click, all four typing rows, Create account). |
| 17 | List | 0 / 0 / 2 + scroll | 0 / 2 / 1 | SPA navigation row and the route script and CSS. The row 3 click is missing (bug 1). The wheel scroll exists as 11 raw scroll events but the actions tab and API leave scrolls out. |
| 18 | Canvas | 0 / 1+ / 1 | 0 / 2 / 2 | Document `/canvas` and its script. Actions: the Ctrl+L key row and "Tab hidden"; no navigation row for the typed load and, in this run, no Redraw click (bug 1; the single run kept the click but also lost the navigation row). |
| all | Extension's own requests (J-248) | 0 | 0 | No row from :3000, a CDN or `chrome-extension://`. |

After-checks on the capture page:

- Console (J-055, J-056): chips "Navigations", "Network errors", "User activity"; level menu. Per level: log and info and debug share a grey icon; warn amber icon on an amber-tinted row; error red icon on a red-tinted row. Objects render as one line (`{user: {id: 7, roles: ["admin", "editor"]}, at: ...}`); a Date shows as `{"$t":"date","value":...}` (bug 8). All 19 console and error rows expand to a call-site stack with a `fn at file:line:col` link.
- Uncaught TypeError (J-057): row with class, message and stack; seek-bar markers: "xhr" (Sync abort), "500", error at 0:25, error at 0:28, "2 errors" at 0:32 (the console.error and assert), "403".
- Network (J-058): columns #, Name, Method, Status, Domain, Type, Frame, Size, Time, Waterfall; type chips All, Fetch/XHR, WS, JS, CSS, Media, Font, Doc, Other. Sync (J-061) and GraphQL (J-064) as in the table.
- Headers (J-059): Save and the auth call both show General (URL, method, status, type, seen by, size), Response headers (5) and Request headers (12 and 14). Cookie, Authorization and X-Api-Key are masked.
- Bodies (J-060): Submit order's request and response bodies are pretty-printed JSON. No line numbers, no folding, no copy button and no format toggle in the body pane. The document (`/canvas`) and image (`badge.svg`) rows say no response body was captured.
- Actions (J-067, J-068, J-069): no filter bar. The Save row reads as the button tag with its test id and a "+6 attributes" chip; expanded: selector, role, name, data-testid, heading, landmark. Typing rows: see step 16. Navigation rows read "Loaded <url>" and "Navigated to <url>", with no cause words; "Tab hidden" precedes each full load.
- Info (J-070): Captured (with a capture, yours or UTC zone menu), URL (start URL), page title, OS Linux, Chrome 153.0.8010.12, viewport 1440 x 900, screen, pixel ratio, language, time zone, network speed "4G, 1.5 Mbps, 100 ms latency", incognito, extension version, user agent, custom logs with Set up. No country row.
- Player (J-054): the quality menu lists Original and Auto only, no 720p to 240p (bug 6). The download is a 1.98 MB WebM, VP9 1440x900 (the viewport, no browser chrome) with an Opus tab-audio track, 2:14.
- Shots: info, console, network and actions tabs at 1440 and 390, light and dark (16), plus the expanded console, TypeError, request details, actions attributes and quality menu at 1440 light. No sideways overflow in any of the 16.

## S3.2 Sockets, streams and slow pages

| Step | Result |
|---|---|
| rec2 timings | Chord to live 4.1 s (load 5.8); stop chord to editor 1.2 s (load 3.5). Single run: 4.3 s (load 2.9), 0.9 s (load 2.5). |
| rec3 timings | Chord to live 5.3 s (load 4.0); bar stop to editor 1.0 s (load 3.3). Single run: 4.0 s (load 3.3), 1.3 s (load 4.9). |
| 3 socket row (J-062) | rec2: one `ws://localhost:5173/ws` row, 101, type websocket, plus a duplicate 101 row of type "other" (bug 4). Its response sub-tab is labelled "Messages": 14 rows (2 open, the hello, 1 sent, the echo, 9 ticks), columns time, direction, length, data; regex filter ("tick" leaves 9 of 14), direction filter All, Sent, Received ("Sent" leaves 1 of 14); clicking a row opens a lower pane. The page itself logged the same hello, echo and 9 ticks, so every frame was kept; the two "open" rows are one open seen twice (bug 4). Single run: 15 rows (10 ticks). E2 on Jam held 16 frames over a longer session. |
| 3 rec3 socket | 101 row, 5 frames plus open and close (8 rows), closed 7.1 s in when the page left `/live`. |
| 4 SSE (P2, noted) | `/api/sse` 200, type eventsource, 20.1 s, with a Messages sub-tab: 24 rows (2 open, 20 tick messages with data, error, close); plus a duplicate "fetch" row for the same request (bug 4). Jam showed the SSE row without its events. |
| 4 slow pages (P2, noted) | rec3: `/slow` document 3.9 s, its streamed `__data.json` 3.9 s with a 269-char body, `/slow-raw` document 4.2 s; documents carry no body. Actions keep the `/slow` SPA navigation, Ctrl+R, the reload and Ctrl+L, but no navigation row for the typed `/slow-raw` load nor for the Back link's load of `/` (bug 1). |
| shots | Socket sub-tab at 1440 and 390, light and dark, no overflow; SSE detail at 1440 light. |

## S3.3 Logs from before a screenshot

| Step | Result |
|---|---|
| fresh N4 (J-071) | Screenshot taken 23.8 s after the first row. Console: 19 rows (2 page loads, 2 clicks, the 500 network row, the 14 log rows). Network: 20 rows, from the page load (document, 16 scripts and styles, badge, iframe) to the 500 and a `version.json` poll. Actions: 2 load rows and the 2 clicks. The rows show negative times (-0:24 to -0:21) on the capture clock. No "screenshot taken" row closes the list (bug 9). No seek-bar markers (a screenshot has no timeline). |
| reach back | The first row is the page load of `/`, 0.9 s before the spec's "page loaded" mark: the buffer reaches back to the load of the tab. The previous capture (S3.2 rec3, another tab) ended 49.6 s before that row and plays no part. |
| N4 from G2 | Same shape: 19 console rows, from the page load to the timer row, the 500 included. |
| J-057 on a screenshot | The pre-roll does not click Show profile, so no TypeError is expected; console.error and assert rows are present as errors. |

## S3.4 Custom metadata (J-073)

| Step | Result |
|---|---|
| 2 set and capture | The lab logged "metadata set" (the SDK was present on `window.toolbar`). The capture stores `{"plan":"parity","seats":3}` in the database, but `GET /api/v1/recordings/<id>` returns `metadata: null` and the info tab reads "None sent" with a Set up button (bug 2). |
| 2 over 10 KB | The call itself is accepted; at capture time the object is refused: no metadata on the capture and a console warn row "Custom metadata was not attached: too_large". |
| 3 setup path | From the capture page: 1 click (Info tab) plus 1 (Set up) = 2 clicks, one step. It opens an inline note with a 4-line `window.toolbar?.setMetadata({...})` snippet. |

## S3.5 Voice transcript (J-074)

| Step | Result |
|---|---|
| 1 record | Mic pill on, desktop recording of `/` for 34 s with the narration, Save, Submit order and Show profile clicked; streams video, voice (Opus), events, rrweb. |
| 2 transcript | Done 12.9 s after create (load 3.8 at the start, 4.5 at the end). Single run: 28.7 s (load 4.5 at the start, 8.7 at the end: whisper itself is the load; unreliable). 9 cues with start and end times, close to the narration word for word ("parity" heard as "parody"); the last cue is the WAV starting to loop. `language` is null (bug 10). The viewer shows the transcript as captions (CC button; at 0:06 "The status line says saved."); there is no transcript list. |
| 3 mic off | No voice stream; `GET .../transcript` answers `status: none, reason: no-voice`, and the capture detail has `transcript: null`: no job ran. |

## Bugs (not fixed in this step)

1. User events go missing in a tab recording after navigations, differently on each run: clicks (Password and Notes fields, Create account, list row 3, Redraw), typing rows (Name, Email, Password), and navigation rows for typed and link-driven full loads (`/canvas`, `/slow-raw`, `/` after Back). The capture code emits them (`packages/capture/src/user-events.ts` listens for all of them); they are absent from the stored events, so something between emit and upload drops them. Not traced further.
2. Custom metadata never reaches the viewer: `apps/server/src/lib/server/viewer/detail.ts` sets `metadata: null` in the capture detail while the `recording.metadata` column holds the value.
3. Navigation action rows lose the cause: the raw `nav` event says `reload`, `link` or `typed`, the actions row and the tab show only `load`.
4. Network duplicates: each WebSocket and SSE request appears twice (a websocket or eventsource row and an "other" or "fetch" row), and the socket's open frame appears twice.
5. GraphQL errors stay hidden in the network tab: the API knows `operationName` and `hasErrors`, the row and its detail show a plain green 200.
6. The quality menu has no downscaled renditions (Original and Auto only).
7. A "Tab hidden" action row appears on an SPA navigation; it comes from the iframe unloading.
8. Console formatting: a Date argument renders as `{"$t":"date","value":...}`, and the second `console.count` row carries a repeat badge of 2.
9. A screenshot capture has no closing "screenshot taken" row in its console.
10. The transcript's `language` is null for English speech.
