# G4 replica results (Nib side)

Raw results of group G4 in `docs/parity/scenarios.md` (S4.1 to S4.3), run on the replica only. The Jam side and the match, better or gap verdicts belong in `docs/parity.md`. Product code was not changed in this step; bugs and loose ends are listed at the end.

Run on 2026-10-15. All three scenarios passed in one full run (6.0 min, 1-minute load 1.0 to 2.3 between scenarios). Every timing below was taken at load 1.8 or less. Values come from that full run; single-scenario runs made just before it gave the same lists and counts.

## How to rerun

```sh
pnpm --filter @toolbar/extension build            # release build, closed shadow root
cd e2e && npx playwright test -c playwright.parity.config.ts G4           # all three
cd e2e && npx playwright test -c playwright.parity.config.ts G4 -g S4.2   # one
```

This run used a private copy of the release build (`PARITY_EXT_BUILD=chrome-mv3-g4`, identical to `chrome-mv3` of 2026-10-14 21:49 and to the G3 copy). Evidence lands in `e2e/parity-shots/G4/` (git-ignored): one `<scenario>.json` per scenario with every list, count, state and timing; screenshots are named `<scenario>-<step>-nib-<width>-<theme>.png`.

## Rig

The G1 rig (`e2e/parity/rig.ts`): Playwright 1.63.0 Chromium, fresh profile, release build unpacked, action pinned, Xvfb `:130` with openbox, compose stack on :3000, account `parity@example.com`, signed in through the popup. The capture page runs at 1440x900 in that browser as a signed-in member. Playwright drives the capture page (a web page, no extension UI). The player keys of S4.1 step 4 and the arrow keys of step 15 go through the X server with xdotool, so fullscreen, Escape and picture-in-picture behave as for a person. S4.3 makes its capture through the extension with X input, as G1 does.

Deviations from the script:

- Captures reused: N1 is the S3.1 tab recording `parity S3.1 lab` (2:14), N4 the S2.1 annotated screenshot, N5 the S2.2 area screenshot with the full viewport kept. The spec reads their ids from `e2e/parity-shots/G3/S3.1.json` and `e2e/parity-shots/G2/` (or `PARITY_N1`, `PARITY_N4`, `PARITY_N5`).
- S4.1 step 3 sets 1.5x, reloads, then plays to the end at 1.5x (90.4 s wall). The spec then sets 1x again so the 20 s of step 12 are 20 s of video.
- S4.1 step 7: the player was paused, so "pause at about 12 s" is one click on the seek bar at 12 s. The click count includes it.
- S4.1 step 8: the browser fired the download (`parity-S3.1-lab.webm`) but Playwright could not save it from the persistent profile (same rig limit as G3). The spec fetched the same URL and measured that file.
- S4.1 step 18 types " edited" after the caret (the input opens with the caret at the end of the title). The description had no text, so "add a line" put a blank line first.
- S4.1 ends by putting N1 back: title, description, viewer prefs on the account (speed 1x), the panel width and the time zone. The restore call answered 200, and N1 reads `parity S3.1 lab` with no description again.
- S4.3 makes a fresh replay capture on each run (Nib has no budget): this run's capture is `parity S4.3 replay`, `01a13e3e-897d-7131-a5a6-e749555a83e0`, 10 s. The earlier single run left a second one (`01a13e38-...`).
- Shots: every page state named in the script was shot at 1440 and 390, light and dark, where it is a page state (page, hidden panel, info, console, network, request detail, actions, header, screenshot page, lightbox, N5 full view, replay). Transient states (hover pills, menus, the toast, fullscreen, the loading card) were shot at 1440 light only. No sideways overflow in any of the 4-way shots.
- No paused rows in G4. The header's "Send to app" split is a tracker feature (paused, `FEATURE_TRACKERS`); step 19 only opened and closed it. Mailpit was not used.

## S4.1 Video capture page (N1)

| Step | Row | Result |
|---|---|---|
| 1 | J-090 | Two columns: left 865 px, right panel 535 px = 37.2 percent of the 1440 px page, both under a 56 px header. Panel tabs: Info, Console, Network, Actions, Agent, plus a hide button at the right end of the tab row. A 100 px drag of the splitter to the left widened the panel by 105 px (it snaps to whole percent, 45 percent stored per browser). |
| 2 | J-091 | Hide button (30x30, top right of the panel): the panel goes, a "Dev tools" button (101x34) takes its corner, and the left column (960 px wide) centres within 4 px. "Dev tools" brings the panel back. 2 clicks. |
| 3 | J-092 | Hover shows: share-at-time pill (top right, reads the time with hundredths), big play button with the length, markers, seek bar, then play, back 5 s, forward 5 s, mute, time, chapter pill (chapters split at page loads, not AI), speed, quality, download, fullscreen. Speed menu: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x. After 1.5x and a reload the label reads 1.5x and the video plays at 1.5 (2 clicks; kept in the browser and on the account). Quality menu: Original, 720p, 480p, 360p, 240p, Auto. Played to the end: "Watch again" prompt over the last frame. |
| 4 | J-093 | k: plays (from the end it starts at 0:00). Space: pauses. m: mutes; m again unmutes. f: fullscreen on; Escape: off. i: picture-in-picture on; i again closes it. Right: +5 s (0:00.6 to 0:05.6). Left: -5 s. 5: jumps to 50 percent (1:07 of 2:14). |
| 5 | J-072 | Six markers above the seek bar: "xhr" (Sync aborted, 0:17), "500" (Submit order, 0:21), error at 0:25 (TypeError), error at 0:28 (rejection), "2" errors at 0:32 (console.error and assert), "403" (form POST, 1:08). No marker for the GraphQL call: its row is a plain 200 (G3 bug 5). |
| 6 | J-095 | Hovering the 500 marker shows a pill "1 failed request" with "POST /api/fail: database_unavailable" (the error text from the response body). Clicking it (1 click) seeks to 0:21, opens the console tab and scrolls to the POST /api/fail 500 row, which flashes. |
| 7 | J-097 | Seek-bar click at 12 s, then the pill: 2 clicks. Toast "Link to 0:12.00 copied"; the clipboard holds the share link with `?t=12`. Opened in a new tab it lands on the capture page with the player paused at 0:12.0. |
| 8 | J-098 | 1 click: the browser downloads `parity-S3.1-lab.webm` (Content-Disposition attachment), 1.89 MB, WebM magic bytes, `video/webm`. Toast "Download started" with a "Set up your agent" action. |
| 9 | J-101 | Info rows: Captured (with a zone menu), URL, Page title, OS, Browser (Chrome 153.0.8010.12), Viewport 1440 x 900, Screen, Pixel ratio, Language, Time zone, Network speed (4G, 1.5 Mbps, 100 ms latency), Incognito, Extension, User agent, Custom logs ("None sent." with a Set up button). Zone menu: the capture's zone (America/New_York), yours, UTC; the timestamp follows each choice (01:39:17 GMT-4, 01:39:17 GMT-4, 05:39:17 UTC). No country row (as in G3). |
| 10 | J-102 | 45 rows with filters cleared. "profile" leaves 3 (the Show profile click, the log, the TypeError); clearing gives 45 back. Level menu: Errors, Warnings, Info, Logs, Debug as check boxes; Errors alone leaves 30 rows, because the level menu filters console and error rows only and keeps clicks, navigations, network failures and the video start/stop rows (7 error rows among them). Kind chips: Navigations (off: 41 rows), Network errors (off: 42), User activity (off: 28); each restores 45. |
| 11 | J-103 | The gutter triangle is invisible (opacity 0) until the row is hovered (opacity 1). Clicking it on the TypeError row seeks from 0:12 to 0:25.2 and the composer's send button turns into the timed pill "Comment at 0:25". A click on the row body expands it to the stack and a `fn at file:line:col` link. The time cell's tooltip is the wall clock with milliseconds (05:39:46.726). |
| 12 | J-104 | Console open, 20 s from 0:00 (load 1.4): the current row moves with the video (4 distinct rows: video start, Save, Export, then the Sync request), always scrolled into view, marked with a dark left bar and a triangle. Network open, 20 s from 0:00 (load 1.7): no current row until the first request at 0:10, then `/api/ok?q=works` and `/api/hang`, same marking, always in view. |
| 13 | J-105 | 17 rows. Type chips: All 17, Fetch/XHR 9, WS 0, JS 3, CSS 1, Media 1, Font 0, Doc 3, Other 0. Errors only: `/api/hang` abort, `/api/fail` 500, `/form` 403. Sort by status: abort, 200 x14, 403, 500; again: reversed. Sort by time: 12 ms up to 33.7 s (the aborted Sync last). Text filter "api": 6 rows (works, hang, fail, iframe, graphql, auth). |
| 14 | J-106 | 1 click on Submit order: the list drops from 10 columns (#, Name, Method, Status, Domain, Type, Frame, Size, Time, Waterfall) to 2 (#, Name), 181 px beside a 352 px detail pane. Pane header: red status dot, "500", "POST /api/fail", Copy as cURL, close. Sub-tabs: Headers, Payload, Response, Timing. |
| 15 | J-243 | Response sub-tab, then Down x3 and Up x1: selection `/api/fail` to `/_app/version.json` to `/api/ok?q=iframe` to a second `/_app/version.json`, then back to `/api/ok?q=iframe`. The pane stays on Response and shows each row's body. |
| 16 | J-107 | 2 clicks (row, Copy as cURL). Toast "cURL copied". The command is multi-line: URL, `-X POST`, 14 headers, `--data-raw '{"item":"lab-42","qty":3}'`. Run against the lab it returns 500. The cookie header reads `cookie: <cookie>` (placeholder). |
| 17 | J-108 | 25 rows: 21 user events and 4 navigation rows ("Loaded" and "Navigated to"), plus "Tab hidden" rows (G3 bug 7). No filter bar. The Save row's "+6 attributes" chip expands to selector, role, name, data-testid, heading, landmarks. Key rows read "Pressed R" and "Pressed L" (the console tab says "Pressed ctrl+R"; bug 2) and carry an attributes chip too. |
| 18 | J-110 | Click the title: an input opens with the caret at the end. " edited" and Enter: saved (API title `parity S3.1 lab edited`), the browser tab title becomes "parity S3.1 lab edited \| Nib". Description: click, new line, text, click outside: saved (API holds the new line). Restored at the end. |
| 19 | J-112 | Header left: home (to `/`), folder chip "All captures" (to `/`; N1 has no folder), three-dot menu: Move to folder (submenu No folder, parity, New folder) and Delete. Right: "Send to app" split (caret: Connect GitHub, Connect GitLab, Connect Slack, Set up a webhook), "Copy link" split (caret: a share card with Full link, Without dev tools and the access line). Each closed with Escape, nothing picked. |

Click counts for the script's named steps: step 2 = 2, step 6 = 1, step 7 = 2, step 14 = 1 (plus 1 for the Network tab from a fresh page), step 16 = 2.

## S4.2 Screenshot captures (N4, N5)

| Step | Row | Result |
|---|---|---|
| 1 N4 | J-099 | Media card 842x571 with the author chip and a download button on top; the 1440x900 image shows at 808x505. 1 click on the image opens a lightbox (image 1361x851, close button top right, dimmed page behind). Escape closes it; a second click opens it; a click on the backdrop closes it. |
| 2 N5 | J-209 | Two 84x56 thumbnails under the image: "Selected area" first and selected, showing the 946x107 crop; "Full viewport" second. Clicking the second shows the 1440x900 full viewport and selects it; clicking the first brings the crop back. 2 clicks. E7 is the Jam cross-check. |

Shots: N4 page and lightbox, N5 page and full view, each at 1440 and 390, light and dark; N4 media card and N5 crop and full cards at 1440 light.

## S4.3 Replay capture

| Step | Row | Result |
|---|---|---|
| 1 | | Popup settings: instant replay switched on (fresh profile). Ctrl+R on `/`, Submit order, Show profile, 5 s, icon, replay row, title, Create. Capture kind `replay`, one rrweb chunk, no video, 10 s. |
| 2 | J-100 | Open to the loading card ("Rebuilding the session in your browser" with a thin progress bar): 0.2 to 0.3 s. Open to first frame of the replay: 0.7 s (load 1.7), 0.8 s (load 1.6), 0.5 s (load 1.6); median 0.7 s. The page renders in an iframe scaled into the media card, letterboxed. Playing: the rrweb pointer glyph is present and visible (12 px), at the stage's top-left until the first recorded pointer move. |
| 3 | J-229 | Replay bar: seek bar, play, back 5 s, forward 5 s, time, speed, fullscreen. Absent: download, share-at-time, mute, quality, chapters, captions. Markers sit above the seek bar: "500" at 0:03 and an error at 0:04. |

Shots: loading card (screenshot and screencast frame), first frame and playing at 1440 light; the ready replay page at 1440 and 390, light and dark; the control bar.

## Bugs and loose ends (not fixed in this step)

1. The console's level menu filters console and error rows only. With "Errors" picked the list still holds 23 click, navigation, network and video rows next to the 7 error rows, which reads as "the filter did not work". This is the code's design (`filterConsole` in `packages/shared/src/derive/panels.ts`); whether Jam does the same decides between gap and match.
2. Key rows in the actions tab drop the modifier ("Pressed R" for Ctrl+R; the console tab says "Pressed ctrl+R") and show a "+6 attributes" chip of the focused element.
3. The header shows the "Send to app" split with Connect GitHub, GitLab and Slack items, although `docs/scope.md` pauses trackers and Slack behind `FEATURE_TRACKERS` and `FEATURE_SLACK` with their UI hidden. No such flag exists in the code yet.
4. No seek-bar marker for the failed GraphQL call: the same cause as G3 bug 5 (the row shows a plain 200).
5. In the replay, the pointer glyph sits at the stage's top-left corner until the first recorded pointer move, instead of where the pointer was when the buffer starts.

G3 bug 6 (no downscaled renditions in the quality menu) no longer shows on N1: the menu lists 720p to 240p.
