# Build status (Part 1, step 2, after the merge)

One line per row of `docs/tasks.md`: the eight foundations (X-01 to X-08) and the 251 catalogue rows, with the status each area reported after its completer pass. Rows marked "merge" changed status in the merge commits on main; their area e2e specs were not re-run after the merge. The per-area reports, with how each row was verified and what a partial row lacks, follow the table.

## Counts (catalogue rows)

| Priority | Built | Partial | Missing | Skipped | Total |
|---|---|---|---|---|---|
| P0 | 73 | 0 | 0 | 0 | 73 |
| P1 | 106 | 0 | 0 | 0 | 106 |
| P2 | 62 | 0 | 0 | 10 | 72 |
| All | 241 | 0 | 0 | 10 | 251 |

"Built" includes rows covered by another row and rows built with a skipped part (see `docs/skip-list.md`).

## Close-out of the partial rows (2026-10-14)

Eleven rows were partial or carried a "Missing" note after the merge: J-011, J-012, J-089, J-136, J-137, J-138, J-140, J-156, J-177, J-200 and J-219. Each is built on main now; its line below says what changed and which test proves the check. Before this pass the table counted 235 built and 6 partial (J-011, J-136, J-137, J-138, J-140, J-200); five more (J-012, J-089, J-156, J-177, J-219) were marked built at the merge with their area report still saying partial.

What was added:

- J-011: page weight from the isolated world (`packages/capture/src/page-weight.ts`), the pause and the per-load continue in `apps/extension/lib/capture/service.ts`. The content script's transport wrapper also had to forward the new message.
- J-012: blocked-site list changes reach pages that are already open.
- J-089: `editor.openCapture` answers whether a tab opened, so the toast stops saying it did.
- J-136: the first-view mail (`notifyFirstView` in `lib/server/dashboard/notices.ts`, called from `POST /api/v1/recordings/:id/views`).
- J-137, J-140: the editor's tracker form with options and recents through a new `editor.trackerOptions` worker request; a tracker failure at create now reaches the page toast (`issueError` in the editor's close message).
- J-138: the capture page's send split opens the field form and lists connect items when the workspace has no apps.
- J-177: `supportLinkUrl()` gives the menu a recording link of the server admin without any setting.
- J-200: the link recorder asks for the microphone before the screen picker and helps when it is refused.

How it was verified:

- `apps/server/test/gates.int.test.ts` (5 tests): a throwaway Postgres database behind the server's own `db` module, Mailpit, and a local OpenAI-compatible stand-in. Covers J-136 (first view, mentions, domain join), J-156 and J-177.
- `e2e/tests/rows/rows.spec.ts` (10 tests): the extension's test build against a real server, signed in with a personal token of an account made through the login page. GitHub is a local stand-in the workspace connects to with a token and a base URL, Slack a local incoming webhook, mail goes to Mailpit. It ran three times in a row without a failure, on Xvfb `:121` against `pnpm --filter @toolbar/server dev` on :3121 (database `toolbar_fix121`, `S3_KEY_PREFIX=fix121/`):

  ```sh
  WXT_OUT_SUFFIX=-121 WXT_TEST_HOOKS=1 pnpm --filter @toolbar/extension exec wxt build
  cd e2e && E2E_DISPLAY=:121 SERVER_URL=http://localhost:3121 E2E_EXT_BUILD=chrome-mv3-test-121 npx playwright test tests/rows
  ```

  `WXT_OUT_SUFFIX` (new) keeps a test build apart from other runs that use `chrome-mv3-test`.
- `packages/capture/test/page-weight.test.ts` (3 tests) for the page-weight watcher.
- Regression against the same server and build: the ext-ui, editor, viewer and dashboard e2e suites pass, and `capture/replay.spec.ts` with `hooks.spec.ts` pass except J-201's picker cancel, which crashes Chromium on Xvfb as noted under "Gaps left". Two viewer tests failed once and passed on a rerun (J-116 waited too long for hydration; J-098 ran right after a `--no-media` reseed of this database). The viewer suite's `reseed()` reads `DATABASE_URL` and `S3_KEY_PREFIX` from the environment, so pass them when the server under test is not the compose one. `pnpm -r build`, `pnpm -r test` (server 145 tests) and `pnpm -r check` pass.

## User journeys on main (2026-10-14)

`e2e/flows/` runs the journeys of `docs/jam/flows.md` the way a user does: `docker compose up --build -d` from empty volumes, the lab on :5173, the release build (`chrome-mv3`, closed shadow root) in a Playwright persistent context on Xvfb `:120` with openbox, the pinned action and `--allowlisted-extension-id`. Chords go through the X server with xdotool, so Chromium's command shortcuts fire; the popup opens with Ctrl+Shift+Y and is reached over a second CDP connection; the link is read from the X clipboard. No test hook drives the product. Run everything with `scripts/e2e-all.sh` (`docs/dev.md`, E2E); screenshots land in `e2e/flows-shots/`. Flows D and E go through Chrome's real share picker with pointer clicks; flow E's recipient uses a second browser with no extension and no account. All 15 journeys are scripted (A to O, plus the CLI pull and the visual pass).

| Flow | Spec | Result | Measured |
|---|---|---|---|
| O sign in | fixture + `o-sign-in` | pass: popup Sign in, auth window, new account with a password, popup shows the account, settings lists the browser | - |
| A screenshot with a box to a link | `a-screenshot` | pass: chord, click (the page gets no click), rectangle, title, Ctrl+Enter, link on the clipboard, capture tab opens, logged-out page shows the box | editor 0.6 to 0.8 s after the click |
| B tab video of the lab errors | `b-recording` | pass: chord, countdown 3-2-1, hidden 500, throw, rejection, console, dead button, chord, editor, Ctrl+Enter; capture ready with the 500 | live about 4.5 s after the chord; editor 0.6 to 1 s after stop |
| C instant replay | `c-instant-replay` | pass: popup menu, Settings, switch (one-time), the bug, replay chord, create; replay holds the 500 | editor 0.9 s after the chord |
| D desktop recording across tabs | `d-desktop` | pass: popup, record chevron, Screen, record row, Chrome's picker (Entire Screen is open already; thumbnail, Share), the hidden 500 in tab A, a save and the console in tab B, record chord in tab B, editor there, Ctrl+Enter; capture kind `screen` with requests from both tabs, each with its own tab id; the popup still says "Record full screen" (sticky). Runs in a browser of its own with its own account; see "Picker crash" below | live 1.3 to 3.1 s after Share; editor 0.8 to 1.3 s after stop |
| E recording link | `e-recording-link` | pass: popup, recording-link row, a name, Create link; the link is on the clipboard. A second browser (no extension, signed out) opens it, keeps "Screen only", Start, Chrome's in-tab picker (Entire Screen, thumbnail, Share), Stop, a note, Send; "Sent". The sender gets the "New recording from" mail with the note and the capture link; the capture is kind `link`, ready, plays, and has no network rows | link copied 0.2 to 1 s after create |
| F logged out, find the failing request | `f-find-request` | pass: hover the 500 marker shows `database_unavailable`; network tab, row, Response shows the body; copy as cURL; arrows keep the sub-tab; console has the TypeError and the rejection | page interactive 0.9 s |
| G timed comment | `g-comment` | pass: seek bar click, composer, Ctrl+Enter; comment carries the time, bubble on the timeline | composer clears in 0.2 s |
| H folders | `h-folders` | pass: new folder from the sidebar, move by checkbox (3 clicks), drag onto the folder | - |
| I Ctrl+K | `i-search` | pass: two words of the title, Enter opens the capture | results 0.4 s |
| J agent over MCP | `j-agent` | pass: MCP page snippet, DCR, consent in one click, `get_capture`, `get_network_requests` (5xx with the body), `get_console_logs`; connected agent listed, removal revokes. With `FLOWS_CLAUDE=1` a real Claude Code run with a throwaway `--mcp-config` answered "`/api/fail` returned `database_unavailable`" | Claude Code run about 10 s |
| CLI pull | `k-cli-pull` | pass: token from Settings, `nib login --token`, `nib pull <share link>` writes summary.md, details, console, network, actions, frames | - |
| K delete | `k-delete` | pass: its own screenshot, then three-dot, Delete, confirm (3 clicks); toast, dashboard, gone from the grid, the API (404), the share link (404) and Ctrl+K search | toast 0.4 s, dashboard 0.6 to 0.8 s after confirm |
| L invite | `l-invite` | pass: header Invite, email, Invite (seat stays creator); the mail reaches Mailpit; the teammate opens the join link in a fresh browser, signs in with a new password, joins in one click as creator; the members page lists them | - |
| M draft after the tab closed | `m-recover-draft` | pass: close the tab with the editor open, drafts pill, View, create | - |
| N create a workspace | `n-workspace` | pass: workspace menu, "Create or join a workspace", name, Next (same-domain box ticked); the new workspace is active and owned; the menu switches back | - |
| Visual | `z-visual` | pass: dashboard, capture pages (video, replay, screenshot), settings, MCP, browsers, login and the share page at 1440 and 390 px in light and dark have no sideways overflow and follow the theme; popup, menu, options and editor checked by eye | - |

Fixed in this pass:
- Tab recording never started outside the fake driver. The tabCapture stream id was taken at the gesture and used after the 3 s countdown; by then it had expired ("Requested device not found") and it blocked a fresh id ("Cannot capture a tab with an active stream"). The offscreen document now opens the stream at the gesture (`hold-tab`), plays the tab audio back during the countdown, and records from it; cancel releases it. Area suites missed it because they used the fake driver or Chromium's fake media flags, and with `--use-fake-ui-for-media-stream` or `--use-fake-device-for-media-stream` tab capture fails anyway; the flows fixture runs without them.
- The popup picked its tab with the worker's `lastFocusedWindow`, which named a closed sign-in window, so it showed "This page can't be captured" over the lab. It now uses the active tab of its own window.
- Tabs open before install, update or reload had no content scripts, so a chord armed screenshot mode with no in-page UI. The worker injects both worlds on demand before a capture, and into open web tabs on install.
- Closing or reloading the editor's tab left the session in `draft`, so every later capture was refused as busy. The draft now goes to the Drafts list (flow M).
- The countdown flashed 4 for up to 200 ms when a session update reset its start time.
- The MCP server URL broke mid-word at 390 px.

Gaps left:
- The recording bar is in the tab video by design (as in Jam), so the first frame and the poster show its "Starting" state.
- The editor frame does not follow an emulated dark scheme in Playwright (the extension frame runs in another process); a real dark OS setting reaches it, which the ext-ui suite checks.
- The AI draft (flow B step 5) is not exercised: compose runs with `AI_PROVIDER=none`.

## Every e2e suite on main (2026-10-14, second pass)

The area suites (`e2e/tests`, test build) and the flows (`e2e/flows`, release build) ran together against one compose stack from empty volumes (`docker compose down -v`, `AUTH_RATE_LIMIT=off docker compose up --build -d`, `db:seed`), with `scripts/e2e-all.sh`. This was the first run of the area suites against the production image instead of area dev servers; most of what failed came from that.

RESULTS_TABLE

Product fixes:
- Every open capture page held a comments stream (SSE) for as long as it stayed open. Chromium allows six HTTP/1.1 connections per host, so with six capture tabs open, any further page of the app never finished loading (reproduced: the seventh capture page timed out). The stream now runs only while the page is visible; a tab that comes back reconnects and reloads the comment list. New test: `viewer/comments.spec.ts` "a hidden tab closes its comments stream".
- Desktop recordings had no Tab column in the network panel (J-224): the worker stamps the tab on the event envelope (`tab`), and the viewer read only `data.tabId`, which nothing sets. The derived rows now take either. Unit test in `packages/shared/test/derive.test.ts`; flow D checks two tab ids.
- The Slack connector refused `http://host.docker.internal` (it allows http only for this machine), so a Slack stand-in on the host was unreachable from the compose server. It now counts as this machine. Compose maps `host.docker.internal` to the host gateway for the server.
- A request seen by both the page hook and `webRequest` showed as two network rows when the browser reported it more than 50 ms after the page did, which happens on a busy machine (flow F found two `/api/fail` rows at a load average near 12). The merge now takes the nearest unmatched page row from 50 ms before to 3 s after. Unit test in `derive.test.ts`.
- `AUTH_RATE_LIMIT` (new): Better Auth's sign-in limits (3 per 10 s per address) stay on in production; `off` turns them off for e2e runs, whose many accounts sign in from one address.

Test fixes (each made deterministic, none retried):
- Webhook, GitHub and Slack stand-ins listened on 127.0.0.1, which a server in Docker cannot reach. They bind 0.0.0.0 and give the server `host.docker.internal` when a container publishes its port (`e2e/fixtures/net.ts`); the browser keeps 127.0.0.1.
- `auth/web.spec.ts` needed `DATABASE_URL`; it now defaults to the compose database.
- `dashboard/extension.spec.ts` (J-018) ran in a worker context an earlier suite had signed in, so `/login` redirected away from the form. It clears cookies first.
- `capture/screenshot.spec.ts` read the mock's log while the capture tab the extension opens after create (J-089) could still be arriving; it now checks the API calls only. The mock server closes its keep-alive sockets on teardown, which had overrun the fixture timeout.
- `rows/rows.spec.ts` J-219 waits for an idle session before reopening a draft; a draft reopens into the session only from idle. The tracker tests wait for the editor's workspaces before opening the destination menu: a click while they arrived could leave the menu shut.
- The viewer suite's `reseed()` now seeds media too: the J-114 delete test removes the screenshot's files, and a rows-only reseed left the next run's J-098 download without them.
- The editor suites' `openEditorInPage` brings the tab to the front first. In the shared worker browser, earlier suites leave tabs open; behind them Chromium held back animation frames, so the editor's fade-in and a trim drag (J-219 in `editor-video.spec.ts`) sometimes never applied. The area fixture (`e2e/fixtures/extension.ts`) now closes the pages each test leaves open in that shared browser: left-over lab tabs kept their capture scripts and replay rings running and left-over editors kept calling the worker, which slowed later draft saves past their waits (J-219 and the GitHub tracker test in `rows.spec.ts`).
- Flow M closes the popup after View, as a person's next click in the page would; over CDP the popup kept the focus and the title and Ctrl+Enter went nowhere.
- `scripts/e2e-all.sh` wipes the volumes and seeds before every run: the suites leave captures behind, and the grid test counts what the seed workspace holds.
- The flows close the app pages each flow leaves open: Playwright reports every page as visible, so left-over capture tabs kept their comment streams (above) and stalled the visual pass.
- The flows write to `test-results-flows/`: a flows run cleared the area suite's `test-results/` traces mid-run.

Picker crash (the documented exception, `docs/spikes.md` S2): flows D and E and the capture suite's J-201 run in a browser of their own on a private display, so a crash cannot take the shared one down. A crash (and only a crash) gets another try in a fresh browser. D and E fall back to Chromium's fake media flags after three crashes and log `LIMITATION`; `FLOWS_PICKER=fake` runs that fallback on purpose, and it passed. J-201 has four tries and no fallback, since a fake picker cannot be cancelled. J-201 now clicks the picker's Cancel button: activating the picker window for an Escape key (xdotool `windowactivate`) crashed Chromium in about half the tries, the click in about one in five. `e2e/global-setup.ts` checks that openbox stays up, since without a window manager the picker crashes every time. In flow E the picker is a dialog inside the tab rather than a window of its own, so the spec finds it by its pixels.

## Rows

| ID | Area | Pri | Feature | Status |
|---|---|---|---|---|
| X-01 | server-core | - | Upload API | built |
| X-02 | server-core | - | Job runner | built |
| X-03 | server-core | - | Share tokens and media proxy with Range | built (merge: server-core API with the viewer share page) |
| X-04 | capture | - | Event envelope, MAIN/ISOLATED hooks and handshake, Transport, redaction module | built |
| X-05 | auth | - | Extension device sign-in via launchWebAuthFlow + PKCE; popup sign-in state | built |
| X-06 | auth | - | Better Auth with organizations, sessions in hooks.server.ts, workspace bootstrap on first sign-in | built |
| X-08 | server-core | - | compose.yaml stack | built |
| X-07 | ext-ui | - | Brand and design tokens shared by extension and web app | built |
| J-002 | capture | P0 | Visible-area screenshot | built |
| J-006 | capture | P0 | Tab video recording | built (flows: the real tabCapture path was broken after the merge and is fixed, see "User journeys on main") |
| J-007 | capture | P0 | Desktop or window recording | built |
| J-008 | capture | P1 | Desktop recording follows tab switches | built |
| J-009 | capture | P0 | Instant replay (share the past) | built |
| J-010 | capture | P0 | Instant replay is a DOM replay | built |
| J-014 | capture | P1 | Microphone narration toggle | built |
| J-210 | capture | P1 | No camera in the extension | built (covered by another row) |
| J-021 | capture | P2 | Incognito and local files | built |
| J-022 | capture | P2 | Emulated mobile viewport | built (covered by another row) |
| J-235 | capture | P2 | Supported browsers | built (covered by another row) |
| J-029 | capture | P1 | Pause and resume | built |
| J-211 | capture | P1 | Mute and switch mic while recording | built |
| J-032 | capture | P0 | Recording survives navigation | built |
| J-034 | capture | P1 | Post-stop processing state | built |
| J-055 | capture | P0 | Console capture by level | built |
| J-056 | capture | P1 | Call-site stack on every console row | built |
| J-057 | capture | P0 | Uncaught exceptions | built |
| J-058 | capture | P0 | Network list | built |
| J-248 | capture | P1 | Leaked requests show as false failures | built |
| J-059 | capture | P0 | Request and response headers | built |
| J-060 | capture | P0 | Request and response bodies | built |
| J-061 | capture | P1 | Pending requests | built |
| J-062 | capture | P1 | WebSocket frames | built |
| J-063 | capture | P2 | Server-sent events | built |
| J-064 | capture | P1 | GraphQL awareness | built |
| J-065 | capture | P2 | CORS error call-out and timing breakdown | built |
| J-066 | capture | P2 | Binary payload placeholder | built |
| J-067 | capture | P0 | Click events | built |
| J-068 | capture | P0 | Typing events | built |
| J-069 | capture | P0 | Navigation events | built |
| J-070 | capture | P0 | Page and device metadata | built |
| J-071 | capture | P0 | Logs from before the capture | built |
| J-073 | capture | P1 | Custom metadata SDK | built |
| J-076 | capture | P2 | Third-party session links | skipped |
| J-185 | capture | P0 | Header secret filtering | built |
| J-186 | capture | P0 | Body secret replacement | built |
| J-187 | capture | P0 | Typed text masking | built |
| J-188 | capture | P0 | Pixels are not masked | built (covered by another row) |
| J-189 | capture | P0 | Nothing leaves before create | built |
| J-192 | capture | P2 | Auto-blur and sanitizers on connected domains | skipped |
| J-194 | capture | P0 | Capture to editor | built (covered by another row) |
| J-195 | capture | P0 | Key to live recording | built (covered by another row) |
| J-196 | capture | P0 | Stop to editor | built (covered by another row) |
| J-201 | capture | P2 | Cancelled share picker | built |
| J-001 | ext-ui | P0 | Toolbar popup with the capture menu | built |
| J-003 | ext-ui | P0 | Area screenshot by drag | built |
| J-005 | ext-ui | P2 | Screenshot delay timer | built |
| J-011 | ext-ui | P2 | Heavy-page guard for instant replay | built (close-out: heavy-page detection and continue in the capture service; e2e `rows`) |
| J-012 | ext-ui | P2 | Replay site lists | built (close-out: list changes reach open pages; e2e `rows`) |
| J-215 | ext-ui | P2 | Replay setting follows the account | built |
| J-013 | ext-ui | P1 | Recording length cap and upsell | built |
| J-015 | ext-ui | P1 | Recording link created from the popup | built |
| J-232 | ext-ui | P2 | Recorder domain status | built |
| J-016 | ext-ui | P2 | Recording link explainer | built |
| J-019 | ext-ui | P2 | Popup adapts to context | built |
| J-023 | ext-ui | P2 | Mac app recorder | skipped |
| J-024 | ext-ui | P2 | iOS app recorder | skipped |
| J-025 | ext-ui | P0 | Screenshot-mode cursor hint | built |
| J-250 | ext-ui | P1 | Capture click is swallowed | built |
| J-026 | ext-ui | P1 | Leave screenshot mode | built |
| J-027 | ext-ui | P0 | Pre-roll countdown | built |
| J-028 | ext-ui | P0 | Recording control bar | built |
| J-238 | ext-ui | P1 | Drag the recording bar | built |
| J-030 | ext-ui | P1 | Live drawing during recording | built |
| J-031 | ext-ui | P1 | Live element blur during recording | built |
| J-033 | ext-ui | P1 | Browser-level recording cues | built |
| J-239 | ext-ui | P1 | Popup during a recording | built |
| J-035 | ext-ui | P1 | Unfinished draft guard | built |
| J-218 | ext-ui | P1 | Local drafts list | built |
| J-036 | ext-ui | P2 | Blur before recording | built |
| J-089 | ext-ui | P2 | Open in new tab setting | built (close-out: e2e `rows` against a real server) |
| J-176 | ext-ui | P1 | Extension settings in the popup | built |
| J-226 | ext-ui | P2 | Limit the sites the extension runs on | built (covered by J-001) |
| J-177 | ext-ui | P2 | Extension utility menu | built (close-out: a recording link of the server admin by default; int `gates`, e2e `rows`) |
| J-179 | ext-ui | P1 | Open the popup by key | built |
| J-180 | ext-ui | P0 | Screenshot mode by key | built |
| J-181 | ext-ui | P0 | Start and stop tab recording by key | built |
| J-182 | ext-ui | P0 | Instant replay by key | built |
| J-183 | ext-ui | P2 | Unbound recording-link command | built |
| J-184 | ext-ui | P1 | Rebind and scope | built |
| J-212 | ext-ui | P2 | Shortcut tooltips in the popup | built |
| J-190 | ext-ui | P1 | Turn off user-event capture | built |
| J-193 | ext-ui | P1 | Popup open time | built (covered by J-001) |
| J-199 | ext-ui | P1 | Restricted page popup | built |
| J-200 | ext-ui | P1 | Missing mic permission | built (close-out: recorder page instructions and record without voice; e2e `rows`) |
| J-004 | editor | P1 | Full viewport kept with an area crop | built |
| J-037 | editor | P0 | In-page screenshot editor | built |
| J-216 | editor | P2 | Editor leaves page scroll unlocked | built (decision D-048: match) |
| J-038 | editor | P0 | Pen | built |
| J-039 | editor | P0 | Rectangle | built |
| J-040 | editor | P0 | Ellipse | built |
| J-041 | editor | P0 | Arrow with bend handle | built |
| J-042 | editor | P1 | Line | built |
| J-043 | editor | P0 | Text callout | built |
| J-044 | editor | P0 | Blur area | built |
| J-045 | editor | P0 | Colour palette | built |
| J-046 | editor | P1 | Select, move, resize, rotate | built |
| J-047 | editor | P1 | Marquee multi-select | built |
| J-048 | editor | P1 | Delete selection | built |
| J-049 | editor | P0 | Undo and redo | built |
| J-050 | editor | P2 | Tool tooltips with key badges | built |
| J-051 | editor | P0 | Annotations flattened into the image | built |
| J-052 | editor | P2 | Copy and paste of shapes | built (deliberate better) |
| J-053 | editor | P2 | No crop, zoom or eraser | built (constraint) |
| J-240 | editor | P1 | No annotation after a recording | built (constraint) |
| J-077 | editor | P0 | Title and description in one field | built |
| J-078 | editor | P2 | Markdown-style input rules | built |
| J-079 | editor | P0 | Destination picker | built, part skipped (skip list: Jira, Linear, ClickUp, Notion, Azure DevOps, Asana) |
| J-080 | editor | P1 | Workspace picker | built |
| J-081 | editor | P1 | Folder picker | built |
| J-082 | editor | P2 | Attach files to the draft | built |
| J-083 | editor | P1 | AI title and repro steps | built |
| J-230 | editor | P1 | Click into the ghost title | built (decision D-049: match) |
| J-084 | editor | P0 | Video preview in the draft | built |
| J-085 | editor | P0 | Trim | built |
| J-086 | editor | P0 | Create and copy link | built |
| J-220 | editor | P1 | Create by key | built |
| J-088 | editor | P1 | Discard the draft | built |
| J-219 | editor | P1 | Save a video draft for later | built (close-out: popup half verified; e2e `rows`) |
| J-197 | editor | P0 | Create to link on clipboard | built (budget of J-086) |
| J-202 | editor | P1 | Clipboard permission prompt | built (covered by J-086) |
| J-054 | server-core | P0 | Tab video file | built |
| J-074 | server-core | P1 | Voice transcript | built |
| J-075 | server-core | P2 | AI chapters | built |
| J-087 | server-core | P1 | Upload during the draft | built (server side) |
| J-227 | server-core | P1 | Trim also cuts logs and events | built |
| J-119 | server-core | P1 | Per-capture general access | built |
| J-237 | server-core | P2 | Private folders and private captures | built (enforcement) |
| J-072 | viewer | P0 | Timeline markers in the video | built |
| J-236 | viewer | P2 | Captions | built |
| J-090 | viewer | P0 | Two-column capture page | built |
| J-091 | viewer | P1 | Hide or show the dev tools panel | built |
| J-092 | viewer | P0 | Video player | built |
| J-093 | viewer | P1 | Player keyboard | built |
| J-094 | viewer | P2 | Seek bar hover preview | built |
| J-095 | viewer | P1 | Marker hover and jump | built |
| J-096 | viewer | P2 | Chapters menu | built |
| J-097 | viewer | P1 | Share at the current time | built |
| J-098 | viewer | P1 | Download media | built |
| J-099 | viewer | P1 | Screenshot view and lightbox | built |
| J-209 | viewer | P1 | Cropped and full image switcher | built |
| J-100 | viewer | P1 | Instant replay playback | built |
| J-229 | viewer | P1 | Replay player controls | built |
| J-101 | viewer | P0 | Info tab | built |
| J-102 | viewer | P0 | Console tab with filters | built |
| J-233 | viewer | P2 | Video paused row | built (covered by J-029) |
| J-103 | viewer | P0 | Click a row to seek | built |
| J-104 | viewer | P1 | Panels follow playback | built |
| J-105 | viewer | P0 | Network tab | built |
| J-224 | viewer | P2 | Tab column on desktop recordings | built |
| J-106 | viewer | P0 | Request detail pane | built |
| J-243 | viewer | P1 | Step through requests by key | built |
| J-107 | viewer | P1 | Copy as cURL | built |
| J-108 | viewer | P1 | Actions tab | built |
| J-109 | viewer | P2 | Tab error dots | built |
| J-110 | viewer | P0 | Inline title and description editing | built |
| J-111 | viewer | P2 | Time links in the description | built |
| J-112 | viewer | P0 | Header actions | built |
| J-113 | viewer | P1 | Move to folder from the capture page | built |
| J-114 | viewer | P0 | Delete a capture | built |
| J-115 | viewer | P2 | Narrow-screen layout | built |
| J-116 | viewer | P2 | Figma embed | built |
| J-117 | viewer | P0 | Copy share link | built |
| J-118 | viewer | P1 | Link with or without dev tools | built |
| J-121 | viewer | P0 | Logged-out viewer | built |
| J-127 | viewer | P0 | Timestamped comments | built |
| J-128 | viewer | P1 | Comment markers on the timeline | built |
| J-129 | viewer | P2 | Comment permalink | built |
| J-130 | viewer | P2 | Reactions | built |
| J-131 | viewer | P1 | Edit and delete own comment | built |
| J-132 | viewer | P2 | Comment attachments | built |
| J-133 | viewer | P2 | Live comment updates | built |
| J-134 | viewer | P1 | Anonymous comments | built |
| J-135 | viewer | P1 | Mentions | built |
| J-154 | viewer | P2 | Agent nudges | built |
| J-198 | viewer | P1 | Viewer load | built (covered by J-090) |
| J-231 | viewer | P2 | Empty dev tools tabs | built |
| J-205 | viewer | P1 | Deleted or unknown capture | built |
| J-206 | viewer | P2 | Recording-link capture without logs | built |
| J-017 | dashboard | P1 | Recorder page for a link recipient | built |
| J-018 | dashboard | P2 | New capture from the dashboard | built |
| J-020 | dashboard | P2 | Upload an existing video | built |
| J-120 | dashboard | P2 | Workspace default link access | built |
| J-122 | dashboard | P1 | Folder sharing | built |
| J-126 | dashboard | P2 | Recording link sharing | built |
| J-136 | dashboard | P1 | Email notification settings | built (close-out: first-view mail added; mention, domain-join and first-view gates in int `gates`) |
| J-137 | dashboard | P1 | Send to tracker at create | built (close-out: editor tracker form; e2e `rows` with a GitHub stand-in and a Slack webhook) |
| J-138 | dashboard | P1 | Send an existing capture to an app | built (close-out: capture page field form and connect items; e2e `rows`) |
| J-139 | dashboard | P1 | Integrations settings page | built |
| J-140 | dashboard | P1 | Tracker field forms | built (close-out: editor and capture page forms, recents, tracker down; e2e `rows`) |
| J-251 | dashboard | P1 | Integrations belong to a workspace | built |
| J-241 | dashboard | P1 | Linked tracker issue on a capture | built |
| J-242 | dashboard | P1 | Body of the filed tracker issue | built |
| J-141 | dashboard | P2 | Slack and embeds | skipped |
| J-142 | dashboard | P1 | Webhooks | built |
| J-143 | dashboard | P2 | Connect your domain for recording links | skipped |
| J-144 | dashboard | P2 | Help-desk flows | skipped |
| J-156 | dashboard | P2 | Workspace AI switch and quotas | built (close-out: int `gates` for ai-draft and chapters) |
| J-158 | dashboard | P0 | Capture grid | built |
| J-159 | dashboard | P1 | Card hover quick actions | built |
| J-160 | dashboard | P1 | Filters | built (part skipped) |
| J-161 | dashboard | P0 | Search palette | built |
| J-228 | dashboard | P1 | Palette finds members | built |
| J-162 | dashboard | P0 | Folders in the sidebar | built |
| J-213 | dashboard | P2 | Collapse the folder list | built |
| J-163 | dashboard | P0 | Create a folder | built |
| J-164 | dashboard | P1 | Rename and delete a folder | built |
| J-165 | dashboard | P1 | Selection mode and bulk actions | built |
| J-166 | dashboard | P2 | Drag a card onto a folder | built |
| J-167 | dashboard | P1 | Recording links page | built |
| J-223 | dashboard | P2 | Rename and retarget a recording link | built |
| J-168 | dashboard | P1 | Workspace switcher | built |
| J-169 | dashboard | P2 | Onboarding checklist | built |
| J-170 | dashboard | P2 | Help menu | built (part skipped) |
| J-171 | dashboard | P1 | Settings layout | built |
| J-172 | dashboard | P1 | Workspace general settings | built |
| J-173 | dashboard | P1 | Members page | built |
| J-249 | dashboard | P1 | Workspace lifecycle | built |
| J-222 | dashboard | P1 | Change a member's seat | built |
| J-174 | dashboard | P2 | Billing and usage | skipped |
| J-175 | dashboard | P2 | Profile | built |
| J-178 | dashboard | P2 | Enterprise admin | built (part skipped) |
| J-191 | dashboard | P0 | Deletion | built |
| J-225 | dashboard | P2 | Delete the account | built |
| J-203 | dashboard | P1 | Empty folder | built |
| J-204 | dashboard | P2 | No filter results and no search results | built |
| J-214 | dashboard | P2 | Unknown app route | built |
| J-207 | dashboard | P2 | Loading states | built |
| J-208 | dashboard | P2 | Plan limit states | skipped |
| J-123 | auth | P1 | Invite members | built |
| J-124 | auth | P1 | Seat roles | built |
| J-125 | auth | P2 | Join by email domain | built |
| J-217 | auth | P0 | Web app sign-in and sign-up | built, part skipped |
| J-221 | auth | P1 | Create a workspace | built |
| J-234 | auth | P2 | Role for invite-link joins | built |
| J-145 | agent | P0 | Agent setup page | built |
| J-146 | agent | P0 | OAuth consent for agents | built |
| J-147 | agent | P1 | Connected agents list | built |
| J-148 | agent | P1 | Personal access tokens | built |
| J-149 | agent | P0 | MCP read tools | built |
| J-150 | agent | P1 | MCP search and list tools | built |
| J-151 | agent | P1 | MCP write tools | built |
| J-152 | agent | P1 | MCP tab on the capture page | built |
| J-153 | agent | P0 | Markdown summary for plain fetches | built |
| J-155 | agent | P1 | Jam CLI and agent skills | built |
| J-244 | agent | P1 | Agent-made annotated screenshot | built |
| J-245 | agent | P1 | Agent-made video with a test trace | built |
| J-246 | agent | P1 | Record an agent-driven browser or a window | built |
| J-247 | agent | P1 | CLI read path to local files | built |
| J-157 | agent | P2 | Chat assistant connectors | skipped |

## Per-area reports

Each area agent wrote these on its branch (`docs/status/<area>.md` before the merge). Notes in them about "the merge step" describe work the merge commits did or left open; the open items are in `PROGRESS.md`.

### server-core: server-core status

Area 0 of the parallel build (`docs/parallel.md`), branch `area/server-core`. Checks: `pnpm --filter @toolbar/server check:server-core [section ...]` (script `apps/server/scripts/check-server-core.ts`, HTTP calls like curl against a running server with the seed loaded) and the unit suite `apps/server/test/server-core.test.ts`.

Second pass (completer, 2026-10-14): every section was run again from a fresh database (`toolbar_server_core` dropped, migrated, `db:push`, seeded) against `pnpm dev` on :3100, and against the production image in a fresh compose project (`docker compose -p nibcheck0` with every host port moved, new volumes, Debian ffmpeg, compose whisper). All sections passed on both. The X-02 restart test was repeated by hand. This area has no UI of its own, so `docs/jam/ergonomics.md` and `flows.md` set no click budget here; the processing notice, quality menu, captions and chapter pill are viewer rows.

| ID | Pri | Status | How verified / what is missing |
|---|---|---|---|
| X-01 | found. | built | check `upload`: 3-chunk video, rrweb and events streams sent out of order; chunk 1 retried (200 duplicate), other bytes for seq 1 (409 hash_mismatch), body not matching x-sha256 (409), list shows the gap, complete with a gap (409 stream_incomplete, missing [1]); finalize returns the same share URL; rrweb chunks concatenate byte-identical to the upload; video.webm has an 8.0 s duration; a chunk after ready gets 409. Assets: multipart upload with the size read from the PNG header. |
| X-02 | found. | built | Repeated by hand: a 60 s 720p capture with chunks in Garage, finalize with trim 2 s to 58 s, server killed with SIGKILL while the job held its lease at progress 0.3. After restart the job ran again (attempt 2) and the capture reached ready with `durationMs` 56 008 and 720p video. Lease 2 min with a 30 s heartbeat; a restart on the same host releases the old lease at once. Handlers: finalize-recording, remux-video, thumbnail, renditions, transcribe, chapters, purge-recording, expire-shares (hourly), sweep-drafts (6-hourly). Known gaps: an ffmpeg child of the killed process keeps running until it ends (in compose the container restart ends it), and under `vite dev` the worker starts with the first HTTP request (SvelteKit runs `init` lazily in dev; adapter-node runs it at start). |
| X-03 | found. | built (server side) | check `share`: 22-char base64url token; signed-out resolve 200; `/s/<token>` responses carry `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow` and `Cache-Control: private, no-store`; Range through `/s/<token>/media/video` gives 206 with 1024 bytes; revoked, expired and unknown tokens give 404 on resolve and media; content-only links refuse dev tools media. The HTML page `s/[token]/+page.server.ts` is the viewer's file and is still the stub on this branch (404); the viewer branch has its own page. |
| X-08 | found. | built | `docker compose -p nibcheck0 up -d --build` on fresh volumes with the host ports moved (3190, 5490, 3990, 8090, 8095, 1095): all five services healthy, `/login` 200, Mailpit UI 200, `/api/health` ok with db, s3 and whisper; image has Debian ffmpeg 5.1, `BODY_SIZE_LIMIT` 210M, AI_* passed through. The compose database needs `db:push` for this area's columns until the merge generates the migration (no migrations in area branches). |
| J-054 | P0 | built | check `renditions`: the 720p fixture gets 480p, 360p and 240p WebM; a generated 1080p source gets 720p, 480p, 360p and 240p; `video-720` and `video-360` serve Range 206; `?download=1` sends an attachment (J-098). The quality menu on the share page is the viewer's. |
| J-074 | P1 | built | check `transcript`: voice stream (`fixtures/voice.webm`, espeak-ng speech) transcribed by whisper.cpp in 3 s into WebVTT with 3 cues; `/media/transcript` serves `text/vtt` for captions (J-236); a capture without a voice stream reports `none` / `no-voice` and gets no transcribe job. |
| J-075 | P2 | built | check `chapters` against a real local model: llama.cpp server (`ghcr.io/ggml-org/llama.cpp:server`, Qwen2.5-1.5B-Instruct Q4_K_M, CPU) with `AI_PROVIDER=openai-compatible`, `AI_BASE_URL=http://localhost:3290/v1`. The 60 s narrated capture got 4 chapters: 0 s Opening Checkout, 4 s Submitting Form, 12 s Syncing, 24 s Details Form, about 40 s after ready. Fixed in this pass: the prompt wrote times as `0:08`, which the small model read as 0.08 s, so every chapter fell in the first second and the list was dropped; times are now whole seconds (`[8s]`), `startSec` also parses `"15s"` and `"1:15"`, and `AI_BASE_URL` works with or without `/v1`. With `AI_PROVIDER=none` no chapters job is queued and nothing errors. |
| J-087 | P1 | built (server side) | Finalize of the 60 s capture answered in 69 ms because the chunks were already stored; finalize may arrive before streams complete (the job waits up to 8 tries for open streams); a trimmed capture stays `processing` (video 404, status SSE) until the trim job ends. The extension uploader and the processing notice belong to capture and viewer. |
| J-227 | P1 | built | check `trim`: trim 3 s to 6 s, which cuts away the 500 at 2.9 s: video re-encoded to 3.0 s; events outside the range dropped (13 of 34 kept, `env` always kept) and no 500 marker in the event index; `durationMs` 3009 matches the draft label. New in this pass: the rrweb stream is cut too. The last Meta and FullSnapshot before the cut and the increments up to it are kept as a lead-in moved to the trim start, then the events of the range follow; the old rrweb chunks are swapped for new ones in one transaction and deleted from Garage. Unit test covers the lead-in, a capture with no snapshot before the cut, and running the trim twice. |
| J-119 | P1 | built | check `access`: access `workspace` makes signed-out resolve and media return 401 (the viewer's page turns that into the sign-in page), a member gets 200, an `x-nib-share` header no longer opens it; back to `anyone` works. Workspace default (J-120) is read from organization metadata `defaultLinkAccess`. |
| J-237 | P2 | built (enforcement) | check `private`: folder made private in `folder_access`: Sam (not invited) gets 404 by URL, Dana (admin and folder creator) and invited members see it; private capture hidden from other creators, shown to its author; `visibleCapturesWhere()` and `visibleFoldersWhere()` hide it from lists and search. The list, search and folder share routes are the dashboard's and must use these helpers. |
| J-189 (support) | | built | check `draft`: before finalize the share URL is 404 and other members cannot reach the capture; DELETE on a draft removes its chunks from Garage and the row. `sweep-drafts` removes drafts never created after 7 days. |
| J-191 (support) | | built | check `delete`: member and share media URLs 404 at once, share link 404, purge job empties the `rec/<id>/` prefix (a second purge pass runs 10 min later for media jobs that were mid-write); a creator cannot delete someone else's capture (403). |

Counts (catalogue rows of this area): P0 1 built; P1 4 built (J-087 server side); P2 2 built (J-237 enforcement). Foundations X-01, X-02, X-03 (server side), X-08 built.

#### For the merge

- `lib/server/share/access.ts` is new on this branch, and the dashboard and agent branches each added a file at the same path: expect add/add conflicts. This branch's copy holds `captureAccess`, `visibleCapturesWhere` and `visibleFoldersWhere`, which the upload, media and share routes use.
- The viewer branch's `s/[token]/+page.server.ts` uses its own `viewer/access.ts`; it should apply the same access rules as `resolveShareFor()` here (workspace access, revoked and expired links, content-only links).
- The editor's AI text should read the same `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`; `aiConfig()` in `jobs/chapters.ts` accepts a base URL with or without `/v1`.

### auth: Auth area status

Branch `area/auth`. One line per task row from `docs/tasks.md` (area auth, plus the foundations X-05 and X-06). Second pass (completer, 2026-10-14): every check below was rerun, including `providers.spec.ts` with `E2E_PROVIDERS=1` against the mock provider, and the web suite twice in a row. Checks ran against the area server on :3101 (`toolbar_auth` database, Mailpit on :8025) and the test build of the extension on Xvfb `:111`.

How to rerun:

- Units and DB integration: `pnpm --filter @toolbar/server test` (`test/auth.unit.test.ts`, `test/auth.int.test.ts`) and `pnpm --filter @toolbar/extension test` (`test/auth-client.test.ts`).
- E2E: `pnpm --filter @toolbar/extension build:test` with `WXT_SERVER_URL` set, then `npx playwright test tests/auth` in `e2e/` with `SERVER_URL` and `E2E_DISPLAY` from `.env`. `tests/auth/providers.spec.ts` also needs `E2E_PROVIDERS=1`, a mock OIDC provider and provider env vars on the server (the file header lists them). `web.spec.ts` J-124 flips auto-approve with `psql` and needs `DATABASE_URL` from `.env`.

| ID | Status | Notes |
|---|---|---|
| X-06 | built | Better Auth with the organization plugin; session or bearer token resolved in `hooks.server.ts`; `apiGate` enforces each route's auth mode, token scope and seat. First sign-in creates a personal workspace with the user as owner (seat admin) and makes it active. Verified: `web.spec.ts` "magic link sign-up, personal workspace as admin" and "/api/v1 without a session is 401"; `auth.int.test.ts` X-06 case; `auth.unit.test.ts` authorize cases. |
| X-05 | built | `/ext/connect` (redirect allowlist `https://<id>.chromiumapp.org/cb`, login hand-off, 60 s single-use code bound to the S256 challenge), `POST /api/v1/ext/token`, `/ext/logout`, `/ext/bootstrap`, the extension client (`lib/auth/client.ts`, `chrome.ts`), worker handlers (`lib/bg/auth.ts`: auth.state, auth.signIn, auth.signOut, bootstrap.get), Settings, Connected browsers with disconnect, and `lib/auth/AccountCard.svelte`, now mounted in the popup under the header (two added lines in ext-ui's `entrypoints/popup/App.svelte`; keep them when ext-ui's popup lands). Signed out, the popup shows a Sign in card; signed in, a line with the account email and Sign out. Verified: `extension.spec.ts` (popup: Sign in card when signed out, click Sign in, log in in the auth window, the popup shows the email, Settings lists the browser, Sign out in the popup brings the card back and removes the browser; already signed in: one-step connect; disconnect from Settings signs the extension out; sign-out revokes the token; signed out: the auth window shows the login page and returns to the extension), `auth-client.test.ts`, `auth.int.test.ts` code exchange. |
| J-217 | built, part skipped | One page for sign-in and sign-up. GitHub, Google and generic OIDC buttons appear only when configured, in that order. The work email field plus Continue mails a one-time link (Mailpit in dev), and "Use a password instead" gives email + password. Apple is skipped (skip list). Extension sign-in uses launchWebAuthFlow (X-05). Verified: `web.spec.ts` (magic link sign-up, single-use link, password sign-up and wrong password), `providers.spec.ts` (button order, no Apple, GitHub and Google hand-off with our callback URL, generic OIDC end to end against `ghcr.io/navikt/mock-oauth2-server`). |
| J-221 | built | Workspace menu (sidebar) leads to "Create or join a workspace" at `/workspaces/new`. The page has a heading, a help line, a letter avatar that follows the name, a name field and a same-domain join box ticked by default. Next stays disabled until a name is typed. Submit creates the workspace and switches to it. Invitations for your address are listed there to join. The form posts with `use:enhance`, so the redirect to the dashboard is a client navigation (a full reload left a window where the menu button was not hydrated yet, which made the e2e flaky). Verified: `web.spec.ts` J-221 (also switches back from the menu). |
| J-123 | built | Header Invite button (hidden for viewers) opens a modal. It shows the copyable invite link, then an email field with a creator or viewer choice. Invite stays disabled until the address is valid. Pending invites can be cancelled. Mail goes out through SMTP (Mailpit), and the join page `/invite/<id>` joins the workspace. Email invites only work for the invited address. `restrictInvites` limits inviting to admins. Verified: `web.spec.ts` J-123 test, `auth.int.test.ts` invites case. |
| J-124 | built | Seats viewer, creator and admin (`owner` acts as admin, `member` as creator) are enforced by `apiGate` for every contract route whose path names a workspace, for routes with a seat role whose JSON body carries `workspaceId` (so `captures.create` is gated before its handler runs), and by `requireSeat()` elsewhere. On `captures.create` the gate looks the seat up through `ensureCanCreate()`, which upgrades a viewer to creator when the workspace auto-approves (the default) and refuses otherwise; the lookup runs only after the token scope passed. Verified: `web.spec.ts` (a viewer gets 403 on invite and link reset and sees no Invite button; with auto-approve off a viewer's `POST /api/v1/recordings` is 403 and the seat stays viewer; with it on the call gets past the gate and the seat becomes creator), `auth.unit.test.ts` seat and body cases, `auth.int.test.ts` auto-upgrade. Server-core's create handler needs no seat code of its own. |
| J-125 | built | When a user signs up with a verified address on a matching domain, they join as viewer and the workspace's admins get an email. Webmail domains and unverified addresses never join. A domain joiner gets no personal workspace. Verified: `web.spec.ts` J-125, `auth.int.test.ts` J-125 cases. The domain-join toggle in workspace settings is a dashboard page; it can call `patchSettings()`. |
| J-234 | built | Joining by invite link adds the user as creator, and an email invite gives the chosen role. Joining again never lowers a seat. Resetting the link stops the old one. Verified: `web.spec.ts` J-123/J-234 test, `auth.int.test.ts` invites case. |

Also built for other areas' rows, on routes this area owns:

| ID | Owner | Status | Notes |
|---|---|---|---|
| J-148 | agent | built (server and settings page) | `/settings/tokens` has a create dialog with name, expiry (7, 30, 90, 365 days or never) and read-only or read-write for CLI and MCP. The secret shows once with the fixed `tb_pat_` prefix; tokens can be revoked. A read-only token gets 403 on a write. Verified: `web.spec.ts` J-148, `auth.unit.test.ts`. Scope checks for the `/mcp` endpoint (`mcp:*`) are the agent area's. |
| J-168 | dashboard | built (menu component) | `lib/components/auth/WorkspaceMenu.svelte` has the current workspace with its seat chip, settings, members, a switch list, create or join, and sign out. It is mounted in `(app)/+layout.svelte`. |
| J-173 | dashboard | API built | Invite link get and reset (29 days, admins reset) and `inviteLinkEnabled` / `restrictInvites` settings honoured. The members page UI is the dashboard area's. |

### capture: Capture area status

Branch `area/capture`. One line per row of `docs/tasks.md` for the capture area, plus X-04. "e2e" names a spec in `e2e/tests/capture/`, run on Xvfb `:112` against the lab app; "unit" names a vitest file. Server routes are not built in this branch, so upload checks run against `e2e/fixtures/mock-upload-server.ts`, which follows the route table and its zod schemas.

Completer pass (second agent, 2026-10-14): every row's check was rerun. Unit suites pass, and the capture e2e suite on `:112` gives 34 passed, with 2 opt-in tests skipped. `real-server.spec.ts` is opt-in (`NIB_E2E_TOKEN`, `NIB_E2E_WORKSPACE`). It was run once on a detached merge of `area/capture` and `area/server-core`, with the server on 3102 and database `toolbar_capture`. A screenshot and a tab video both went through create, upload and finalize to status `ready` on the real upload API, and that merge was not kept.

| ID | Status | How verified, or what is missing |
|---|---|---|
| X-04 | built | Envelope, MAIN/ISOLATED hooks and handshake, Transport, redaction module. Unit: packages/shared `redact.test.ts`, packages/capture `hooks.test.ts`, `isolated.test.ts`, `serialize.test.ts`. e2e `hooks.spec.ts`: lab console calls reach the worker ring with `seq` and `t`. |
| J-002 | built | Worker side: `capture` (screenshot) arms, `screenshot.take` captures, crops, writes the draft at 1x CSS px and sends `ui.editor-open`. e2e `screenshot.spec.ts`: image equals the viewport in CSS px, draft in under 1.3 s. The popup row, armed click and editor are ext-ui and editor work. |
| J-006 | built | Tab recording via tabCapture + offscreen MediaRecorder, 3 s countdown timing in the worker (`ui.countdown`), no picker. e2e `video.spec.ts`: video is the viewport size (VP9 rounds odd sizes down by 1 to 2 px), not the window. The countdown veil is ext-ui. |
| J-007 | built | Desktop and window recording via `getDisplayMedia` in the offscreen document, no countdown; mode comes from `settings.recordMode`. e2e `video.spec.ts` (fake picker). The chevron that stores the mode is ext-ui. |
| J-008 | built | The worker follows tab activation during a desktop recording, attaches the new tab, moves `ui.bar`, and the draft opens in the tab active at stop. e2e `video.spec.ts`: console rows from both tabs, each event stamped with `tab`. |
| J-009 | built | `replay.set` / `replay.trigger`: DOM replay draft from the ring, trim set to the last 30 s. e2e `replay.spec.ts`. The popup rewind row and the replay preview are ext-ui and editor/viewer work. |
| J-010 | built | Rolling window of `replayMinutes`, sliced from the newest rrweb checkout at or before the cut (checkouts every 30 s), pruned every 10 s, never reset to zero, local until create. e2e `replay.spec.ts` (1-minute window held 72 s). Also opt-in replay video in 10 s standalone WebM segments, uploaded at create. |
| J-014 | built | `mic.request` opens `permissions.html` once; `mic.result` stores the grant; no device or a block turns `settings.mic` off. e2e `video.spec.ts`: grant page closes itself, next recording has a `voice` stream (Opus). The no-device branch runs in e2e `video.spec.ts` in the second browser, which has no fake devices: the page closes itself and `micGranted` and `settings.mic` are false. A blocked mic with a device present keeps the page open with its message. The mic pill is ext-ui. |
| J-210 | covered | No camera path exists in capture code (offscreen asks for tab, display and mic only). |
| J-021 | built | e2e `incognito.spec.ts`: with file and incognito access allowed, a `file://` page and a page in a private window both make drafts; the private one has `incognito: true` on the draft and env. |
| J-022 | covered | e2e `pages.spec.ts`: under DevTools-style emulation (390x844, DPR 3, iPhone UA) env reports the screen, DPR, UA and iOS. The lab page has no viewport meta tag, so its layout viewport stays 980 px wide; env records that as the viewport. |
| J-235 | covered | Chromium only on this VM (no Edge or Brave installed); release and test builds load unpacked in Chromium in every e2e run. |
| J-029 | built | Pause and resume in the offscreen recorder; paused time is excluded. e2e `video.spec.ts`: remuxed video length equals recorded time minus the pause within 1.5 s; `media` pause and resume rows (J-233). |
| J-211 | built | `recording.mic` mutes through a gain node (silence keeps the voice timeline) and switches device by swapping the source, without stopping. e2e `video.spec.ts`: `media` mic rows on, muted, on; voice stream continues. |
| J-032 | built | Ports re-attach on every new document, the worker re-sends `ui.bar` with the same start time on port hello and on load complete. e2e `video.spec.ts` (events of both documents in one capture) and `replay.spec.ts` (bar re-sent after reload). |
| J-034 | built | Stop sends `ui.processing`, writes the draft and sends `ui.editor-open`; a 60 s timeout moves the session to `error` (`stop_timeout`), clears the spinner and the bar, and the draft lands in Drafts when processing ends. A new capture, or the new `session.dismiss` request, clears an error session. Before this pass an error blocked every later capture. e2e `video.spec.ts`: ten runs give ten drafts, each over 0.9 s long and each ready in under 5 s. The timeout path is tested with a 1 ms budget. `replay.spec.ts` checks the command order. The open-drafts action on the error is ext-ui. |
| J-055 | built | Every console level, args through `serialize()`. e2e `hooks.spec.ts`. Better than the reference: table, group, trace, assert, count and time are kept. |
| J-056 | built | Call-site stack on every row, extension frames removed. e2e `hooks.spec.ts`. |
| J-057 | built | Uncaught errors with name, message, stack; unhandled rejections too (Better). e2e `hooks.spec.ts`. The marker is the viewer's index. |
| J-058 | built | Page hooks for fetch, XHR, beacon plus webRequest for documents, scripts, styles, fonts, images, sockets, with frame, size, timing. e2e `hooks.spec.ts` (5174 image via webRequest). |
| J-248 | built | webRequest ignores tab -1, extension initiators and the server API; the in-page UI loads nothing remote. e2e `replay.spec.ts`, `hooks.spec.ts`. |
| J-059 | built | Request headers from the page and full ones (cookies included) from webRequest, response headers from both. e2e `hooks.spec.ts`, `pages.spec.ts`. |
| J-060 | built | Text bodies up to 256 KB from `response.clone()` and XHR, never blocking the page; binary and streamed responses keep no body. e2e `hooks.spec.ts`. |
| J-061 | built | A hanging request is a `net.req` with no response or failure. e2e `hooks.spec.ts`. The pending label is viewer work. |
| J-062 | built | WebSocket open (101), every frame both ways with data and length, close. e2e `pages.spec.ts`. |
| J-063 | built | EventSource open, messages (named events the page listens for), close. e2e `pages.spec.ts`. Better: the events are kept. |
| J-064 | built | `net.req.graphql.operationName` and `net.res.graphqlErrors` at any status. e2e `pages.spec.ts` (routed `/graphql`; the lab has no GraphQL fixture and is read-only; adding one to `lab/` is left to the coordinator, since no area owns the lab). |
| J-065 | built | CORS blocks as `net.fail { cors: true }` from webRequest; DNS, connect and TTFB from Resource Timing. e2e `pages.spec.ts` (fetch to :5174). |
| J-066 | built | Binary socket frames and bodies keep only their size. e2e `pages.spec.ts`. |
| J-067 | built | Click rows with a TargetRef: selector, role, name, test id, attrs for the pseudo tag (buttons without type report submit). Better: iframe clicks. e2e `hooks.spec.ts`. |
| J-068 | built | One committed row per field (change, Enter, blur, page hide). e2e `pages.spec.ts`. |
| J-069 | built | pushState, replaceState, popstate, hashchange, bfcache; full loads carry a cause (typed, reload, link, back_forward) and follow a visibility-hidden row. e2e `pages.spec.ts`. |
| J-070 | built | Start URL, time, OS, browser and version, viewport, screen, DPR, locale, zone, connection type and RTT (speed bucket and latency), battery, extension version, incognito. Country comes from the time zone (`env.country`, `countrySource: 'tz'`), using a table generated from tzdata `zone.tab` and its links, which are public domain. The server may replace it from the request IP (`countrySource: 'ip'`). Unit `tz-country.test.ts`. e2e `pages.spec.ts` emulates Africa/Dar_es_Salaam and gets `TZ`, because the VM runs in UTC, which has no country. |
| J-071 | built | Screenshots carry the ring from the previous capture's end (at most the replay window). e2e `screenshot.spec.ts` (the 500 and the TypeError from before the shot; a second shot starts after the first). |
| J-073 | built | `window.toolbar.setMetadata(fn)` and `window.nib.setMetadata(fn)`; objects over 10 KB are rejected with a console warning row; the result goes to `draft.metadata` and the finalize body. e2e `screenshot.spec.ts`. The info-tab row and setup modal are viewer work. |
| J-076 | skipped | Skip list. |
| J-185 | built | Secret headers replaced with `[redacted]` in the isolated world and in the worker, secret query parameters blanked. e2e `pages.spec.ts`, `screenshot.spec.ts` (uploaded NDJSON holds no cookie or token). The shield badge and cURL placeholder are viewer work (`redactHeaders` returns the names). |
| J-186 | built | JSON, form and multipart bodies: secret field names replaced; JWTs, Luhn-valid cards and emails scrubbed (Better). e2e `pages.spec.ts` (/form POST). |
| J-187 | built | Email, password and secret-looking fields typed as eight asterisks; value attributes masked in click targets. e2e `pages.spec.ts`; unit `isolated.test.ts`. |
| J-188 | covered | Pixels are not masked; blur is the editor's. |
| J-189 | built | Screenshot and replay drafts stay in IndexedDB until create; recordings upload video to an unlisted capture; discard deletes it on the server and locally. e2e `screenshot.spec.ts`, `replay.spec.ts`, `video.spec.ts`. The server must keep unfinalized captures out of lists and share URLs (server-core). |
| J-192 | skipped | Skip list. |
| J-194 | covered | e2e: viewport shot to draft under 1.3 s; replay draft under 4.6 s. |
| J-195 | covered | e2e `replay.spec.ts`: the record shortcut (real X input) to recording under 6.4 s, countdown included. |
| J-196 | covered | e2e `video.spec.ts`: stop to draft under 5 s, ten runs, no 0-second drafts. |
| J-201 | built | Picker cancel or failure: session back to idle, `ui.bar` cleared, the unlisted server capture deleted, no draft. e2e `replay.spec.ts` (Escape in Chromium's real picker via xdotool on `:112`). |

#### Counts after the completer pass

| Priority | Built | Covered | Skipped | Partial | Missing |
|---|---|---|---|---|---|
| P0 (24) | 20 | 4 (J-188, J-194, J-195, J-196) | 0 | 0 | 0 |
| P1 (12) | 11 | 1 (J-210) | 0 | 0 | 0 |
| P2 (9) | 5 | 2 (J-022, J-235) | 2 (J-076, J-192) | 0 | 0 |

X-04 is built as well. Known limits:
- J-235 ran in Chromium only, because Edge and Brave are not on this VM.
- The lab has no GraphQL or binary-socket fixture, so the e2e routes `/graphql` and opens its own socket.
- UI parts of these rows (popup rows, bar, countdown veil, editor, viewer badges) belong to ext-ui, editor and viewer.

### ext-ui: ext-ui status

Area 3 (branch `area/ext-ui`). One line per ext-ui row of `docs/tasks.md` plus X-07, after a second, independent pass that ran every check again.

How things were verified:

- **e2e** means a spec in `e2e/tests/ext-ui/` that passed on the private display `:113` (46 tests, `E2E_DISPLAY=:113`). The capture driver in those runs is the test fake in `lib/bg/ui.ts`, so the media side (video file, screenshot image, editor) is not part of them.
- **trial merge** means the second pass merged `area/dashboard` (which already contains `area/auth`) into a throwaway branch, pushed the merged schema to `toolbar_ext_ui`, seeded it, ran the server on 3103 with `MAX_RECORDING_MIN=1`, and drove the real popup against it with the seed token. The throwaway branch is deleted; nothing from it is committed here.
- Unit tests: `packages/shared/test/ext-ui.test.ts`, `apps/extension/test/ui-controller.test.ts`.

Counts (41 rows, after the close-out pass on main): P0 8 built. P1 17 built, 1 covered (J-193). P2 12 built, 2 skipped (J-023, J-024), 1 covered (J-226). X-07 built.

| ID | Pri | Status | How verified, or what is missing |
|---|---|---|---|
| X-07 | - | built | Tokens in place; icons (camera, clock, help, globe, eye, power, logout, keyboard, book, bug, grip, mic-denied), `Switch` and `Segmented`. Token contrast unit test; popup e2e reads the token background in light and dark. |
| J-001 | P0 | built | e2e: screenshot, record, link rows (replay row when on), home and menu icons, rows 370x40 with 8 px gaps. Trial merge: signed in with the seed account, the popup loads and fetches the bootstrap; the menu shows sign out. Screenshots compared with ergonomics.md (header, rows, chevrons, mic pill, menu). |
| J-003 | P0 | built | e2e: tinted box and live `W × H` readout follow the drag; the worker receives exactly the dragged rect. The crop image and the editor are capture (J-002) and editor (J-037). |
| J-005 | P2 | built | e2e: 3 s from the chevron, badge bottom-left counts down, cancel pill bottom-right, shot at zero, setting back to off; cancel leaves no shot. Choices off, 3 s, 6 s (D-044). |
| J-011 | P2 | built | Popup side e2e (heavy badge, in-popup warning, continue calls `replay.set {allowHeavy}`). Close-out: the isolated world reports element count and DOM mutations per second while the ring runs (`packages/capture/src/page-weight.ts`); the capture service pauses the ring and drops what it held when a page passes `LIMITS.heavyPageNodes` (8000) or `heavyPageMutationsPerSec` (600), overridable through `nib:heavy-thresholds`; continue stores an override for that page load (URL plus `performance.timeOrigin`). Verified: unit `packages/capture/test/page-weight.test.ts`; e2e `e2e/tests/rows/rows.spec.ts` (real server, test build) J-011 with the lab threshold (1000 elements): /list with 500 rows is flagged, the ring holds no rrweb, the popup badge opens the warning, continue restarts the ring and later weight reports leave it on, a reload pauses it again, the lab root in the same tab keeps its ring. |
| J-012 | P2 | built | Settings list e2e: 83 default domains, add, trash removes; the replay row reads "Off on this site". The ring check calls `isReplayBlocked(url, settings.replayBlockedSites)`. Close-out: a change to the list now reaches open pages (a newly blocked site stops its ring and drops its rows; an unblocked one starts). Verified: e2e `e2e/tests/rows/rows.spec.ts` (real server, test build) J-012: with `localhost` blocked the lab tab's ring holds no rrweb and the popup shows the blocked badge; unblocking starts the ring without a reload; blocking again stops it. |
| J-215 | P2 | built | e2e against a mock server, and trial merge against dashboard's real `/me/settings`: turning replay on in the popup reaches the account; turning it off on the account turns it off locally on the next popup open. |
| J-013 | P1 | built | e2e: `m:ss / cap`, orange in the last 30 s, red in the last 10 s, stop at the cap with reason `cap`; also from a chord-started recording with no bootstrap cached (the worker fetches `ext.bootstrap`, D-046). Trial merge: auth's bootstrap gives 60000 ms for `MAX_RECORDING_MIN=1`; the timer showed `/ 1:00`, went orange then red, and the recording stopped at 1:00. No upsell (skip list). |
| J-015 | P1 | built | e2e against a mock server, and trial merge: the form lists the seed folder, creates a real link in it on dashboard's route, copies it and shows it with a copy button. |
| J-232 | P2 | built | e2e: recorder-domain picker with the server host and a red dot; its menu has that domain ticked and says it records video and voice only. No green state (skip list). |
| J-016 | P2 | built | e2e: help icon opens three cards, next pages through them, the last offers create. |
| J-019 | P2 | built | e2e: on the server's own origin the record row reads "Record full screen"; on chrome://extensions the J-199 state shows. |
| J-023 | P2 | skipped | Skip list (D-016). |
| J-024 | P2 | skipped | Skip list (D-016). |
| J-025 | P0 | built | e2e: chord arms in under 0.5 s; pill at pointer +5/+20 px after the first move; no dimming; pill names the delay when set. |
| J-250 | P1 | built | e2e: clicking "Save (works)" in screenshot mode takes a full shot; the save counter stays 0 and capture-phase `pointerdown`/`click` listeners on document count 0 (D-043). |
| J-026 | P1 | built | e2e: Escape removes the pill; armed popup shows a red exit row, other rows greyed; clicking it exits. The exit row has no delay chevron. |
| J-027 | P0 | built | e2e: 50 % grey veil, bar counts 3, 2, 1 at bottom centre, live under 6.4 s from the chord; a click on the veil pauses, a second resumes. A countdown cut off by a worker restart is cancelled (D-046). |
| J-028 | P0 | built | e2e: dark pill 40 px tall, about 275 to 300 px wide, centred, 70 px above the bottom: stop, pause, timer, mic, divider, pen, blur, in the shadow root; mute and unmute. At merge: the bar in capture's stored tab video. |
| J-238 | P1 | built | e2e: dragging the timer moves the bar to mid page; it stays and the timer keeps counting. At merge: the new spot in the video. |
| J-030 | P1 | built | e2e: 12 swatches, red first and selected; strokes fade after 2.5 s; the page sees no pointer events; `recording.mark {pen}` reaches the driver. At merge: capture writes the marker event. |
| J-031 | P1 | built | e2e: blur pauses the recording, click blurs, second click unblurs, undo and done work, done resumes, blurs clear when the recording ends. |
| J-033 | P1 | built | e2e: action icon is a red camera while recording, default after stop; the countdown shows on the badge. |
| J-239 | P1 | built | e2e: during recording the popup greys screenshot, shows a red stop row with its mic pill and no record-mode chevron, keeps the link row; stop ends in a draft. |
| J-035 | P1 | built | e2e: with a draft open the header pill counts drafts and is inert, only the link row is live; after `SAVE_FOR_LATER` rows return and the pill opens Drafts. e2e: closing the tab mid-recording ends in the Drafts list with the session idle (D-046). |
| J-218 | P1 | built | e2e: Drafts rows with a 66x50 thumbnail, host, age, view and trash; trash turns into a red confirm, the second click calls `draft.discard`. `draft.open` and `draft.discard` are editor's. |
| J-036 | P2 | built | e2e: blur on the countdown bar holds the count; the element is blurred before the recording starts and stays blurred. At merge: first video frame. |
| J-089 | P2 | built | e2e: the switch saves `openInNewTab` at once. The editor creates with `openTab: false` and asks `editor.openCapture`, which reads `openInNewTab`; it now answers `{opened}` and the in-page toast no longer claims a tab opened. Verified: e2e `e2e/tests/rows/rows.spec.ts` (real server, test build) J-089: switch off, create from the editor: the link is on the clipboard and no tab opens; switch on: the capture page opens beside the source tab. |
| J-176 | P1 | built | e2e: menu, settings screen in place (scrolls at 560 px), switches save at once, shortcuts link, replay with length and site list, error reports, server, reset with an in-place confirm. |
| J-226 | P2 | covered by J-001 | Not run: needs Chrome's site-access control. Script registration and the popup do not depend on all-sites access. |
| J-177 | P2 | built | e2e: menu has docs, report, restart; restart reloads the extension and the new worker reopens the popup. Close-out: `bootstrap.supportRecordingLink` comes from `supportLinkUrl()` (`lib/server/dashboard/links.ts`): `SUPPORT_RECORDING_LINK` when set (`off` falls back to the issue tracker), else a "Problem reports" recording link owned by the server's first account in its first own workspace, made on first use; a link the admin turned off stays off. Verified: int `apps/server/test/gates.int.test.ts` J-177 (override, off, made once, the recipient page works, revoked); e2e `e2e/tests/rows/rows.spec.ts` (real server, test build) J-177: popup menu, Report a problem opens that `/rl/` link and the recorder page loads. |
| J-179 | P1 | built | e2e: real Ctrl+Shift+Y via xdotool on :113 opens the popup. |
| J-180 | P0 | built | e2e: real Ctrl+Shift+S arms in under 0.5 s with no popup. |
| J-181 | P0 | built | e2e: real Ctrl+Shift+Space starts with the countdown and stops. |
| J-182 | P0 | built | e2e: real Ctrl+Shift+X opens a replay draft with no popup (fake driver; the replay itself is capture's J-009). |
| J-183 | P2 | built | e2e: `commands.getAll()` lists `recording-link` with no key; it opens the popup on the link form. |
| J-184 | P1 | built | e2e: the settings link opens chrome://extensions/shortcuts. Rebinding and global scope live on Chrome's own page; not automated. |
| J-212 | P2 | built | e2e: a 2 s hover shows `Ctrl+Shift+S` in a dark pill; it reads `commands.getAll()` on every hover, so a rebinding shows at once (not automated). |
| J-190 | P1 | built | e2e: the switch saves `captureUserEvents`. `area/capture` drops user events when it is false (read, not run). |
| J-193 | P1 | covered by J-001 | e2e: popup painted under 1.7 s. |
| J-199 | P1 | built | e2e: chrome://extensions shows the restricted illustration and line; chords there leave the session idle with no message. |
| J-200 | P1 | built | e2e: a denied mic greys the bar's mic button with a "permission is missing" tooltip and ignores clicks. Close-out: the link recorder asks for the microphone before the screen picker; when the browser blocks it (or there is none) the page shows steps to allow it, a "Record without voice" button and "Try again with voice". Verified: e2e `e2e/tests/rows/rows.spec.ts` (real server, test build) J-200 in a Chromium without the fake-UI flag and the microphone set to denied over CDP: choosing voice shows the steps, trying again with voice is refused and starts nothing, record without voice records the screen only and reaches the preview. |

#### For the merge

1. **Two session stores.** `area/capture` built its own session (`lib/capture/service.ts`, `CaptureService`) and answers `session.get`, `capture`, `screenshot.*`, `countdown.*`, `recording.*` and the keyboard commands in `lib/bg/capture.ts`. ext-ui answers the same requests in `lib/bg/ui.ts` (D-042). With both registered, both run side effects and the first reply wins. The textual conflicts are only `background.ts` and `docs/decisions.md`, so git will not flag this. The fix: capture keeps its media code and implements `CaptureDriver` (`prepareRecording`, `startRecording`, `stopRecording`, `pause/resumeRecording`, `setMic`, `mark`, `takeScreenshot`, `triggerReplay`, `cancelRecording`), installed with `setCaptureDriver()`, and drops its handlers for the requests listed above. Capture keeps `replay.set`, `replay.trigger`, `mic.*`, `clipboard.write`, the port and the offscreen events.
2. **Editor** must call `dispatch()` from `lib/bg/ui.ts` for CREATE, UPLOAD_DONE, UPLOAD_FAILED, DISCARD and SAVE_FOR_LATER, and DRAFT_READY when `draft.open` reopens a draft; `area/editor` sends `ui.editor-open` itself and calls none of them. It must also read `openInNewTab` (J-089).
3. **Auth**: add `supportRecordingLink: process.env.SUPPORT_RECORDING_LINK || null` to the bootstrap (J-177). The popup's signed-out screen calls `auth.signIn` and the menu calls `auth.signOut`; auth's `AccountCard.svelte` is not mounted.
4. **Capture**: heavy-page detection and `replay.set {allowHeavy}` (J-011); `isReplayBlocked()` for the blocked-sites test (J-012).
5. **Dashboard**: the recorder page's denied-mic instructions and record-without-voice (J-200).

### editor: Editor area status

Branch `area/editor`. Unit tests: `packages/ui/test/editor-model.test.ts` (30), `packages/ui/test/editor-replay.test.ts` (2), `apps/server/test/ai.test.ts` (10). E2E: `e2e/tests/editor/*.spec.ts` (31 tests, Playwright on Xvfb `:114`, test build of the extension, lab app on 5173 or `LAB_URL`).

Second pass (completer, 2026-10-14): every check below was rerun on `:114` against a lab served on 5184 (`LAB_URL=http://localhost:5184`), plus a visual pass of screenshot, area, video, replay and dark-mode drafts against `docs/jam/ergonomics.md`. Fixed in this pass:

- Dark mode hid the page: the editor iframe had `color-scheme: normal` while its document is `light dark`, so Chrome painted the frame opaque black. The frame now declares `light dark`; e2e checks the page shows through the backdrop in dark mode.
- Replay drafts showed a "no video" placeholder. They now play as a DOM replay (rrweb Replayer, D-053) with play, seek and the capture area's default 30 s trim; e2e covers it, including create.
- A drag lost its last stretch when the browser coalesced the final pointermove (the release point was dropped in `pointerUp`); trim grips likewise. Unit test added.
- The link copy raced the new capture tab and sometimes left an empty clipboard; the editor now copies first, then opens the tab (`editor.openCapture`, D-054). The in-page toast says "Link copied" only when the copy worked.
- Escape pressed while the draft is still loading was ignored; it now counts (J-088).
- Create used `createdAt` as the capture start; it now uses the capture area's `startedAt` when present.
- Merge seam for the capture area (D-054): `setCaptureBridge({ uploadStreams, draftClosed })`. Without it, create skips the local events and rrweb of screenshots and replays and the capture session stays in `draft`; the capture branch has its own `uploadDraft()` and session transitions to plug in here.

Test fixes: several e2e drags mapped coordinates before the editor's layout settled (a new tab can change size right after it opens), so marquee, blur and trim drags sometimes missed. The helpers now wait for the form field and for the annotator or trim bar to hold still before measuring. The suite then passed 31 of 31 in two consecutive full runs. The J-197 budget held at 0.3 to 2.0 s in this pass. Create-flow e2e runs against `e2e/tests/editor/mock-server.ts`, a stand-in for the server-core routes (`POST /recordings`, `/assets`, `/finalize`) built from the route contracts, until server-core lands. `POST /api/v1/recordings/:id/ai-draft` was checked with curl against the real server on 3104 (seed capture c1): 503 with `AI_PROVIDER=none`, 503 for a screenshot, 404 for an unknown id, 200 with ghost text through a fake OpenAI-compatible endpoint.

- J-004: built. E2E: area draft shows the ticked full-viewport card; create uploads the flattened crop (kind crop) and the full viewport with the marks placed on it (kind screenshot); unticked sends `fullScreenshotAssetId: null` and one asset. The viewer's switcher is J-209 (viewer area).
- J-037: built. E2E: in-page iframe over the dimmed lab page, modal 1380x730 at 1440 px wide, preview pane about 72% with close button and tool pill, form on the right, field focused; a hostile page stylesheet does not reach it.
- J-216: built (decision D-048: match). E2E: five wheel steps over the preview scroll the page more than 100 px; the preview stays put.
- J-038: built. E2E: pen active on open, perfect-freehand stroke is a filled tapered path, pen stays active, V then D reselects it.
- J-039: built. E2E: rounded rectangle, tool returns to select with the shape selected.
- J-040: built. E2E: ellipse in a wide box has a width-to-height ratio above 3.
- J-041: built. E2E: dragging the middle handle turns the shaft into a quadratic curve and the open V head changes with the tangent. Unit test for the bend.
- J-042: built. E2E: line is one straight path with no head.
- J-043: built. E2E: T, click, type gives white bold text on a filled rounded box of the current colour; double-click edits with all text selected. Click elsewhere or Escape commits.
- J-044: built. E2E: blur box moves and its clip follows (live re-blur); create test measures the burned-in band at under a third of the sharpness of an untouched band.
- J-045: built. E2E: six swatches, ink default (our own palette), red recolours the selection and new shapes, a new draft starts on ink again.
- J-046: built. E2E: outline click selects, inside click does not; move, corner resize, rotate from just outside a corner; text resize scales the font. Unit tests for rotated hit tests and fixed anchors.
- J-047: built. E2E: marquee on empty space selects two shapes that then move together.
- J-048: built. E2E: Delete removes both; one Ctrl+Z restores both.
- J-049: built. E2E: create, move, recolour, delete are four steps by button and Ctrl+Z; redo button replays them; both buttons grey when empty. Ctrl+Shift+Z and Ctrl+Y redo as well (deliberate better, D-052).
- J-050: built. E2E: a 600 ms hover shows a dark tooltip naming each tool, with key badges V, D and T only.
- J-051: built. E2E: the uploaded PNG has the ink outline at the rectangle edge and an untouched inside; shapes are flattened client-side from the same primitives as the live layer. The viewer showing only that PNG is the viewer area's part.
- J-052: built (deliberate better). E2E: Ctrl+C, Ctrl+V adds a copy 10 px over, one undo step.
- J-053: built (constraint). No crop, zoom, eraser, highlighter, step badges or stickers in the editor.
- J-240: built (constraint). E2E: video and replay drafts have no tool pill; play and trim take their place.
- J-077: built. E2E: field focused on open; first line renders as a 20 px title and goes to `title`, later lines to `description`; an empty title creates.
- J-078: built. E2E: "- ", "1. " and Ctrl+B become a bullet list, a numbered list and bold; finalize gets Markdown (`**matter**`, `- `, `1. `). Rendering in the viewer is the viewer area's part (format in D-051).
- J-079: built, part skipped (skip list: Jira, Linear, ClickUp, Notion, Azure DevOps, Asana). E2E: menu defaults to share link and lists GitHub (connected), GitLab and Slack (connect), webhook (settings); picking GitHub shows repo and labels and finalize gets the integration destination. Filing the issue is J-137 (dashboard/server).
- J-080: built. E2E: two workspaces in the second dropdown; switching reloads folders and integrations (J-251) and sends the picked `workspaceId` to create and finalize.
- J-081: built. E2E: folder button lists no folder plus each folder; the pick reaches finalize and the next fresh draft preselects it.
- J-082: built. E2E: a PNG and a .txt attached with the paperclip are kept with the draft and upload as `attachment` assets listed in `attachmentAssetIds`. Showing them on the capture page is the viewer area's part.
- J-083: built. E2E (mock provider): ghost title, summary, steps with time links and result within 6 s; time links seek; Tab accepts; `aiAccepted` reaches finalize; the switch is disabled with a reason on screenshots and when the server has no provider; the on or off choice persists. Server: Summarizer interface, curl-verified route, unit tests.
- J-230: built (decision D-049: match). E2E: a click after "Submitting" in the ghost title accepts and typing lands at that point.
- J-084: built. E2E: play starts at the left grip, clicking the video toggles play, clicking the bar seeks, length spelled out ("8 seconds"); a frame becomes the draft thumbnail. Also better than J-034: a MediaRecorder WebM without a duration header shows its real length.
- J-085: built. E2E: both grips grey the cut, scrub the preview and update the length; Ctrl+Z and Ctrl+Shift+Z undo and redo each drag; trim and `durationMs` reach finalize. Cutting events and media on the server is J-227 (server-core); `eventsInRange()` in `@toolbar/ui/editor` is the same cut.
- J-086: built. E2E: create shows a spinner and a toast, the editor closes in about 1 s, the link is on the clipboard, the capture opens in a background tab directly right of the source tab, the draft is deleted. Against the mock server until server-core's routes land.
- J-220: built. E2E: Ctrl+Enter with focus in the title creates.
- J-088: built. E2E: close discards a screenshot draft at once; Escape shows a press-again toast, a second press within 1 s discards, a late second press asks again.
- J-219: built. E2E: a reopened video draft's close button reads "Save for later", closes the editor, shows a toast with a view button that reopens it with trim and AI text intact; the draft is stored with status `saved`, `nib:drafts` says `saved`, and the capture bridge hears `draftClosed(id, 'saved')`. Close-out, the popup half: e2e `e2e/tests/rows/rows.spec.ts` (real server, test build) J-219 opens a saved video draft from the popup's Drafts list (the session goes to `draft`), saves it for later from the editor, and checks the session back at `idle`, the toast with View, the drafts pill enabled, the screenshot, record and link rows live and the draft listed.
- J-197: built (budget of J-086). E2E: create to closed editor with the link copied measured at 0.3 to 2.0 s for a screenshot and 0.3 to 1.8 s for a replay on the mock server; an earlier run under heavy load took 7.7 s. Video create runs in the trim test without a timing assertion.
- J-202: built (covered by J-086). The link is copied from the extension-origin editor frame (`clipboardWrite` permission, `allow="clipboard-write"`), never from the page, so the page gets no clipboard prompt.

Counts (36 rows, after the close-out pass on main): P0 16 built; P1 14 built; P2 6 built. None partial, none missing.

### viewer: Viewer area status (Part 1, step 2)

Branch `area/viewer`. Every row in `docs/tasks.md` under "viewer" is listed. E2E specs live in `e2e/tests/viewer/` and run headless against the area server (`SERVER_URL=http://localhost:3105`); `e2e/tests/viewer/fixtures/extra.ts` adds four captures to the seed (no requests, recording link, desktop with two tabs, instant replay). Unit tests: `packages/ui/test/viewer.test.ts` (models, clock, cURL, markdown) and `apps/server/test/viewer-routes.test.ts` (route table coverage, VTT).

Second pass (completer, 2026-10-14): every row's check rerun against a fresh production build on :3105. The full suite passed 45 of 45 before and after the one change of this pass (menu rows tightened to 24 px, as in `docs/jam/ergonomics.md`). Also checked by hand: layout at 1584x865 (panel 37%, 24 px rows in 12 px mono, dark menus, auto-hiding controls, sticky composer whose send button grows into a time pill), 390 px, dark scheme, signed out; the share token cannot PATCH or DELETE a capture or read another capture; another member gets 403 editing or deleting a comment that is not theirs; player keys are ignored while typing in the composer; click counts match flows F, G, H (capture page path) and K. `pnpm -r build`, `pnpm -r test` and `pnpm -r check` pass.

Totals: P0 14 built, P1 21 built, P2 16 built (including the two covered rows J-233 and J-198); none partial, none missing. Parts that only become complete after other areas merge are named in the rows: quality renditions (J-092, server-core), the Tab column data (J-224, capture), send and new folder (J-112, J-113, dashboard), delete and comment images (J-114, J-132, server-core stand-ins), a server-enforced content-only link (J-118, server-core), and remembering viewer prefs across devices (`/api/v1/me/settings` is dashboard's and 404s here; prefs stay in localStorage meanwhile).

Run: `set -a; . ./.env; set +a`, start the server (`pnpm --filter @toolbar/server build && cd apps/server && PORT=3105 node server.js`, or `pnpm --filter @toolbar/server dev`), then `cd e2e && npx playwright test tests/viewer`. Last run: 45 passed in 3.0 min against the production build; against the dev server the same suite takes about 5 to 7 minutes and can time out while Vite recompiles.

| ID | Status | How verified |
|---|---|---|
| J-072 | built | e2e media.spec "J-072 J-095": 500 badge on the request marker at 2.63/8 s, error marker; unit test groups markers |
| J-236 | built | e2e media.spec "J-236": CC button shows the transcript cue over the video |
| J-090 | built | e2e media.spec "J-090": two columns, right panel 32 to 44%, five tabs, splitter drag widens it; "J-198" first paint |
| J-091 | built | e2e media.spec "J-091": hide, left column centres, show again |
| J-092 | built | e2e media.spec "J-092": controls, back and forward 5 s, mute, speed remembered after reload, quality menu, replay prompt at the end. Quality lists Original and Auto only until server-core makes renditions (the menu lists `video.renditions` as soon as they exist) |
| J-093 | built | e2e media.spec "J-093": k, Space, m, f, arrows, digits; i requests picture-in-picture (headless may refuse, page keeps working) |
| J-094 | built | e2e media.spec "J-094": frame canvas, time and chapter name follow the pointer |
| J-095 | built | e2e media.spec "J-072 J-095": hover pill with count and body error text; click opens the console row |
| J-096 | built | e2e media.spec "J-096": chapter pill list seeks; bar split at the edge. Chapters come from navigations until AI chapters exist (D-056) |
| J-097 | built | e2e media.spec "J-097": copied URL `?t=2.34` opens at 2.34 s, with a toast |
| J-098 | built | e2e media.spec "J-098 J-154": WebM and PNG downloads, toast with the agent button |
| J-099 | built | e2e media.spec "J-099 J-209": lightbox, Escape and outside click close |
| J-209 | built | e2e media.spec "J-099 J-209": two thumbnails, crop selected with accent outline, one click swaps |
| J-100 | built | e2e media.spec "J-100 J-229": loading card with progress bar, then the rrweb replay with a pointer |
| J-229 | built | e2e media.spec "J-100 J-229": play, back and forward 5 s, time, speed, fullscreen, error marker; no download, share-at-time, mute, quality, chapters |
| J-101 | built | e2e devtools.spec "J-101": J-070 fields, zone menu (capture, yours, UTC), custom logs setup |
| J-102 | built | e2e devtools.spec "J-102 J-233": merged rows, text filter, level menu, kind chips present only for kinds present |
| J-233 | built (covered by J-029) | e2e devtools.spec "J-102 J-233": started, paused, resumed, stopped rows |
| J-103 | built | e2e devtools.spec "J-103": gutter triangle seeks and arms the composer pill; row expands; time title has wall clock with ms |
| J-104 | built | e2e devtools.spec "J-104": current row marked within 100 ms of the frame (measured on the 500 row); list keeps the current row in view |
| J-105 | built | e2e devtools.spec "J-105": type chips, filter, errors only, sortable columns, pink failed rows |
| J-224 | built | e2e devtools.spec "J-224": desktop capture shows a Tab column between Type and Frame with 101 and 102; tab capture has none. Needs capture to fill the new optional `net.req.tabId` |
| J-106 | built | e2e devtools.spec "J-106 J-185": list collapses to two columns; headers, payload, response, timing; messages for sockets; status dot; close |
| J-243 | built | e2e devtools.spec "J-243": Up and Down move the selection, response sub-tab stays |
| J-107 | built | e2e devtools.spec "J-107 J-154": multi-line cURL with `<cookie>` placeholder; running it against the lab `/api/fail` returns 500 |
| J-108 | built | e2e devtools.spec "J-108": clicks, typing, navigations, no filter bar, attribute chip expands |
| J-109 | built | e2e devtools.spec "J-109": red dots on console and network, green on actions; last tab reopens on another capture |
| J-110 | built | e2e page.spec "J-110": title Enter saves and the tab title follows; description saves on blur with lists and bold; share viewer cannot edit |
| J-111 | built | e2e page.spec "J-111": `[0:05](t:5000)` link in the description seeks to 5 s |
| J-112 | built | e2e page.spec "J-112 J-113": home, folder chip, three-dot (move, delete), send split, copy split. Sending calls dashboard's `integrations.send` (404 on this branch until dashboard lands) |
| J-113 | built | e2e page.spec "J-112 J-113": move to a folder updates the chip and `folderId`. "New folder" calls dashboard's `folders.create`, so that path works after the merge |
| J-114 | built | e2e page.spec "J-114": confirm modal says permanent, toast, redirect within 3 s, then not found. Uses a stand-in DELETE until server-core's lands |
| J-115 | built | e2e media.spec "J-115": at 390 px one column, Capture / Dev tools toggle, network table scrolls sideways |
| J-116 | built | e2e page.spec "J-116": Figma icon button reveals the embed iframe |
| J-117 | built | e2e page.spec "J-117": clipboard holds `/s/<token>`, label shows Copied for about 2 s, toast |
| J-118 | built | e2e page.spec "J-118": two cards; content-only page has media, title, description, comments, no dev tools (interim `?devtools=0`, D-059). The flag is not enforced on the server yet: a recipient who removes the parameter sees dev tools. Needs a per-link flag from server-core |
| J-121 | built | e2e page.spec "J-121": signed-out share link: every tab, copy cURL, share-at-time, download; header shows sign in and sign up only; title read-only |
| J-127 | built | e2e comments.spec "J-127": pill names 0:05, Enter adds a line, Ctrl+Enter sends, composer clears in under 200 ms |
| J-128 | built | e2e comments.spec "J-128": bubbles above the seek bar, hover shows author and text, time chip seeks and highlights |
| J-129 | built | e2e comments.spec "J-129": copied `?comment=` URL opens with the comment highlighted |
| J-130 | built | e2e comments.spec "J-130": eight drawn glyphs, pill with count, own pill click removes |
| J-131 | built | e2e comments.spec "J-131": inline edit shows (edited); delete after a permanent-warning modal |
| J-132 | built | e2e comments.spec "J-132": removable thumbnail, image-only comment, opens full size in a new tab. Uses a stand-in `POST /api/v1/assets` until server-core's lands |
| J-133 | built | e2e comments.spec "J-133": comment from a second browser appears live (SSE); jump pill scrolls to it |
| J-134 | built | e2e comments.spec "J-134": signed-out comment shows as anonymous with a letter avatar; no edit menu |
| J-135 | built | e2e comments.spec "J-135": @ picker in comment and description; Mailpit receives the mention mails. The draft description belongs to the editor area |
| J-154 | built | e2e media.spec "J-098 J-154" and devtools.spec "J-107 J-154": toast with "Set up your agent" opening /settings/mcp |
| J-198 | built (covered by J-090) | e2e media.spec "J-198": signed-out first contentful paint under 3 s |
| J-231 | built | e2e devtools.spec "J-231": light-hearted line in network and actions |
| J-205 | built | e2e page.spec "J-205": unknown or deleted capture and unknown share token show one centred line, no header or links |
| J-206 | built | e2e devtools.spec "J-206": console and network empty states with a setup link, banner in actions |

### dashboard: dashboard status

Area 6 of the parallel build (`docs/parallel.md`), branch `area/dashboard`. The branch merges `area/server-core` (b9a91f8) and `area/auth` (60747cf) so the dashboard runs on their upload, access, share and workspace code, and takes the viewer's `db/schema/comments.ts` unchanged (for `capture_view`).

#### Counts (completer pass, 2026-10-14)

| Priority | Rows | Built | Built, part skipped | Partial | Skipped |
|---|---|---|---|---|---|
| P0 | 5 | 5 | 0 | 0 | 0 |
| P1 | 24 | 23 | 1 (J-160) | 0 | 0 |
| P2 | 21 | 14 | 2 (J-170, J-178) | 0 | 5 |

Counted plainly after the close-out pass on main: 45 rows to build, 45 built (3 of them with the skipped part left out), 0 partial, 0 missing, 5 skipped. The five rows that were partial here (J-136, J-137, J-138, J-140, J-156) were finished on main; their lines below say how.

The completer pass re-ran every check: `pnpm -r build`, `test` (server 98) and `check` (0 errors, 0 warnings), and the dashboard e2e suite (34 tests) headed on Xvfb `:116` against :3106. It built J-018's extension side, added the SDK page to the settings nav (J-171), and fixed "1 captures" in the palette's folder rows. One earlier e2e failure in J-017 came from a Vite full reload while shared files were being edited during the run; it passed on a clean run.

How the checks ran:

- **int**: `apps/server/test/dashboard.int.test.ts` (14 tests) against a throwaway Postgres database, Garage under `S3_KEY_PREFIX=dashboard/` and Mailpit, with local HTTP servers standing in for a webhook receiver, the GitHub API and a Slack incoming webhook.
- **unit**: `apps/server/test/dashboard.unit.test.ts` and `packages/shared/test/dashboard.test.ts`.
- **e2e**: `e2e/tests/dashboard/*.spec.ts` (33 tests). They ran headed Playwright Chromium on Xvfb `:116` against `pnpm --filter @toolbar/server dev` on :3106, with the seed loaded and fake media for the screen picker. Run them with `set -a; . ./.env; set +a; cd e2e; pnpm exec playwright test tests/dashboard`.

| ID | Status | How verified / what is missing |
|---|---|---|
| J-017 | built | e2e `links` J-017: a signed-out recipient picks screen and voice, records through the browser picker, stops, reviews, adds a note and sends. The capture lands in the link's folder with source `recording-link`, the uses count goes to 1, and Mailpit gets "New recording from ..." containing the note and the capture link. A Document Picture-in-Picture control window opens where the browser offers it; the in-page bar is the fallback. |
| J-018 | built | e2e `extension` J-018 (real test build of the extension, completer pass): the dashboard-owned content script `entrypoints/nib-web.content.ts` marks `<html data-nib-extension>` on the server's own origin only (another origin stays unmarked), and the new-capture click goes through `nib:new-capture` to the worker request `dashboard.newCapture` (`lib/bg/dashboard.ts`), which opens the extension popup with `chrome.action.openPopup()`; the test sees `opened: true`. Without the extension, e2e `shell` J-018: the button explains how to get it and lists the shortcuts. |
| J-020 | built | e2e `folders` J-020: dropping an 8 s 720p MP4 (about 10 MB) on the grid gives a video capture with source `upload` that reaches `ready` and serves WebM with Range 206. A 201 MB drop is refused with "videos are limited to 200 MB". The server refuses it too (int J-020, `too_large`). |
| J-120 | built | int J-120: the default link access saves to the settings. It is mirrored into `organization.metadata`, where server-core's `defaultAccessOf` reads it, and a new capture gets access `workspace`. e2e `settings` J-172 sets it in the UI. |
| J-122 | built | e2e `shell` J-122: the share popover copies the folder link and invites by email (Mailpit gets the mail with the `/f/<id>` link). The who-has-access list shows the invite as pending, general access switches to "Only people listed", and the sidebar shows a lock. int J-122 checks the private-folder visibility through server-core's `visibleFoldersWhere` (`folder_access`, `folder_member`). |
| J-126 | built | Share on a link row copies it, with a "copy with voice on" variant. e2e `links` J-017 opens it with `?title=&mic=1&ref=`: the title shows, voice is preselected, and the ref becomes a linked issue. int checks the `folder` preset by name. The owner email: see J-017. |
| J-136 | built | e2e `settings` J-136: the toggles for first view, shared with me, recording link used, same-domain signup and mentions, plus turn off all, save at once with no toast and survive a reload. Gated mails: recording link used (int J-017/J-136), folder shares (int J-122), mentions (`viewer/comments.ts`), same-domain sign-up (`auth/workspaces.ts` filters admins by `domainSignup`). Close-out: the first-view mail now exists: `POST .../views` calls `notifyFirstView()` (`dashboard/notices.ts`), which mails the author once, on the first view by anyone else, unless `firstView` or turn-off-all says no. Verified: int `apps/server/test/gates.int.test.ts` against Mailpit (first view: author's own view sends nothing, the first other viewer sends one mail, repeat and later viewers none, toggle off and turn-off-all send none; mentions skip a member who turned them off but still store the in-app notice; the domain-join mail reaches only the admin who left it on); e2e `e2e/tests/rows/rows.spec.ts` (real server, test build) J-138 opens a capture through a signed-out share link and finds the author's first-view mail in Mailpit. No plan-limit toggle (skip list). |
| J-137 | built | Server side: `registerDashboard()` hooks `destinationHandler` into finalize; a tracker failure becomes `issueError` while the capture is saved (int J-137). Close-out: the editor's destination menu lists the workspace's GitHub, GitLab and Slack connections and mounts the tracker form (J-140); finalize carries `destination: {type:'integration', integrationId, fields}`; the filed issue opens in a new tab. Verified: e2e `e2e/tests/rows/rows.spec.ts` (real server, test build) J-137/J-140 with a local GitHub API stand-in connected by token and base URL: pick GitHub, repo preset, labels, assignee and milestone picked, create: one issue with those fields and the capture link, opened in a new tab; J-137 Slack: the message and title reach a local incoming webhook. Other trackers are on the skip list. |
| J-138 | built | `POST /recordings/:id/send` files the capture (int J-138: GitHub issue and Slack post). Close-out: the capture page header's send split opens the field form (`TrackerFields.svelte` in a modal) for the picked app or, from the main button, the app used last; with no apps it offers Connect GitHub, GitLab, Slack and Set up a webhook; signed-out viewers do not get it. Verified: e2e `e2e/tests/rows/rows.spec.ts` (real server, test build) J-138: the caret lists the connected GitHub and Slack, the GitHub form files an issue with the picked label and assignee and opens it; a fresh workspace shows the four connect items; a share-link viewer has no send button; e2e `viewer/page.spec.ts` J-112 checks the connect items on the seed. |
| J-139 | built | e2e `settings` J-139: the searchable two-column grid (GitHub, GitLab, Slack, Webhooks, MCP agents, CLI). A failing token test shows the error. Slack connects through an incoming webhook URL and lists under this workspace; members see the connection but cannot connect or remove it. int: tokens are sealed, never returned, and checked against the API. |
| J-140 | built | int J-140: `GET /integrations/:id/options` returns repos, labels, assignees and milestones from the GitHub API (stand-in); filed values are remembered per integration in `editor.recentFields`; a tracker that is down gives `integration_failed` and marks the connection. Close-out: the editor form (`packages/ui/src/editor/Editor.svelte`, data through the new `editor.trackerOptions` worker request) and the capture page form both load options and recents. Verified: e2e `e2e/tests/rows/rows.spec.ts` (real server, test build): repo from the API list, label chips, assignee and milestone selects; the next draft starts from the values filed last; another repo reloads its labels; with GitHub answering 502 the form says it did not answer, create still saves the capture and the page shows "the capture is saved, but filing the issue failed". |
| J-251 | built | int J-251: a connection belongs to its workspace, and sending another workspace's capture through it gives 403. `integrations.list` is per workspace, so the draft's workspace picker (editor) gets the right list. |
| J-241 | built | int: filing stores a linked issue, `org/repo#12` and GitHub or GitLab URLs in the title or description count, and so does a recording link's ticket URL (e2e `links` J-017). `hasIssue` filters in `GET /recordings` and `/search`, and search matches issue keys. The links page shows the ticket number. |
| J-242 | built | unit `issue body` and int J-242: the filed body holds the description, capture link, URL, time, reporter, browser, OS, device, viewport, locale and zone, network speed, console errors (counted) and failing requests. Country is not captured; locale and time zone stand in. |
| J-142 | built | e2e `settings` J-142: add an endpoint, the secret shows once, and the test delivery verifies with HMAC-SHA256 of `t.body`. Against a failing endpoint the log lists a pending retry; the retry goes out after 10 s and is logged as attempt 2 OK. int: `capture.created` reaches the endpoint after the notice sweep and is announced once. |
| J-156 | built | The switch saves (e2e `settings` J-172), and `aiAllowed(db, workspaceId)` reads it. `chapters()` returns early and `transcribe` does not enqueue chapters when it is off; the `ai-draft` route answers 503 "AI is off for this workspace", which the editor shows as no ghost text with a reason. Verified (close-out): int `apps/server/test/gates.int.test.ts` J-156 with a local OpenAI-compatible stand-in: switch off, the ai-draft route answers 503 and the chapters job writes no chapters, with no model call; switch on, both come from the model. No quota (skip list). |
| J-158 | built | e2e `grid` J-158: cards with thumbnail, creator overlay, duration pill, title and relative time, newest first. The foldered capture is left out. Recording-link captures show a chip (e2e `links`). Three columns at desktop width, 2 then 1 as the window narrows. |
| J-159 | built | e2e `grid` J-159: hover lifts the card and shows the checkbox and a round copy button. Copying gives a toast and leaves the page alone. The card is a real link. |
| J-160 | built (part skipped) | e2e `grid` J-160: type, source (extension, recording link, upload, CLI) and creator multi-selects become chips with clear buttons and survive a reload through the URL. No Fin, iOS or Mac sources (skip list). |
| J-161 | built | e2e `grid` J-161: Ctrl+K shows recently viewed rows, grouped live results, a preview with the matched text highlighted, arrows, Ctrl+C copy and Enter to open. The palette sits in the root layout, so capture pages get it too. |
| J-228 | built | e2e `grid` J-161: typing a name gives a Members group above captures, the footer shows the count and the Enter hint "Show their captures", and Enter opens `/?by=<id>` with the creator chip set. |
| J-162 | built | e2e `grid` J-162 and `folders`: the sidebar lists folders alphabetically with icons, the active one shows its count, and URLs are `/f/<4 chars>`. |
| J-213 | built | e2e `folders` J-213: clicking the heading hides the rows and clicking again shows them (remembered per browser). |
| J-163 | built | e2e `folders` J-163: hover the heading, click plus, type, Enter: a toast confirms and you stay on the page. |
| J-164 | built | e2e `folders` J-164: rename opens with the name prefilled and selected. Delete confirms, removes the folder and its captures, and the deleted capture's media 404s at once. |
| J-165 | built | e2e `folders` J-159/J-165: ticking a card shows the selection bar with a count. Clicks toggle more cards. Move greys the current location and moves at once with a toast. Delete confirms. int: creators change only their own captures. |
| J-166 | built | e2e `folders` J-166: while dragging, folders get dashed outlines and the hovered one a solid one; the drop moves the card with a toast. |
| J-167 | built | e2e `links`: the list shows the mosaic, name, creator, uses, folder chip, share, open captures and delete. Status, sort and creator filters work. The new-link popover creates a link and copies it. The red dot means recording on this server is video only. |
| J-223 | built | e2e `links` J-223: the pencil renames in place. The folder chip retargets the link and can create a folder; int shows the next recording lands there. |
| J-168 | built | The workspace menu is the auth area's `WorkspaceMenu` (switch, create, sign out), placed in the dashboard sidebar. e2e `settings` J-171 opens it and goes to settings. |
| J-169 | built | e2e `shell` J-169: four steps as links, done ones ticked (connecting an app ticked it), dismiss hides the card for good. |
| J-170 | built (part skipped) | e2e `shell` J-170: docs, source, issues and install links, shortcut list and theme choice. No chat launcher or pricing (skip list). |
| J-171 | built | e2e `settings` J-171: a separate layout with a back link and nav in three groups (workspace, apps and tools, account) in a centred column of sections with docs links. Apps and tools follow Jam's order: integrations, SDK, MCP, CLI, webhooks, then our API page. The SDK page (completer pass) explains custom metadata (`window.toolbar.setMetadata`, J-073) with a copyable snippet; the e2e opens it and copies. The MCP and CLI pages belong to the agent area; this branch links to them. |
| J-172 | built | e2e `settings` J-172: logo (hover to upload; checked with curl through `POST /assets` kind `logo`), name, SSO state, default link access, domain join, AI switch, auto-delete and the audit log link. Nothing is plan-gated, and non-admins see the controls disabled. |
| J-173 | built | e2e `settings` J-173: invite-link switch, copyable link that expires in 29 days, reset, restrict invites, add members (auth's invite dialog), and a table with name, role, last active and a row menu (leave yourself, remove others). The page also lists pending invites and folder guests. |
| J-249 | built | int J-249: a member who leaves keeps their captures in the workspace. Deleting the sole member's account erases the workspace, its rows and its Garage objects. |
| J-222 | built | e2e `settings` J-173: an admin clicks a member's role and picks viewer, after which the API refuses that member's create with 403. The auto-approve switch is on the members page; enforcement is auth's `ensureCanCreate`. int: the last admin cannot be demoted. |
| J-175 | built | e2e `settings` J-175: first and last name save, the role picker changes the hint line, the email is locked. Avatar upload and remove go through `POST /assets` kind `avatar`. |
| J-178 | built (part skipped) | e2e `settings` J-178 and int: the audit log lists creates, deletes, shares, role changes, settings and apps, filterable. Auto-delete archives captures older than N days every hour. SSO is generic OIDC (auth). No SCIM or forced install (skip list). |
| J-191 | built | e2e `folders` J-164: media 404s at once after a delete. int: bulk and folder deletes archive through server-core's `deleteCapture` (purge job, links revoked) and the captures leave lists and search. Single delete from the capture page is the viewer's and server-core's. |
| J-225 | built | e2e `settings` J-225: the dialog lists the workspaces that go and needs DELETE typed. It is blocked while the user is sole admin of a shared workspace; the member's delete signs them out and drops them from the shared workspace. int: solo workspaces are erased, and in shared ones comments show "Deleted account". |
| J-203 | built | e2e `folders` J-203: an empty folder shows a heading, a help line and a make-a-capture button, with no filter bar. |
| J-204 | built | e2e `grid` J-160 and J-161: a filter with no matches shows two centred lines; an empty palette search shows an icon, heading and hint. The striped empty network table belongs to the viewer. |
| J-214 | built | e2e `grid` J-214: an unknown route shows the drawn not-found page with a button home. |
| J-207 | built | e2e `grid` J-207, `shell` J-207 and `links` J-207 (each with a delayed route): dashboard skeletons, palette skeleton rows and the recording links spinner show. The capture page loader belongs to the viewer. |
| J-141, J-143, J-144, J-174, J-208 | skipped | Skip list. |

Also built (not catalogue rows): Privacy and data settings page (masking defaults, blocked instant-replay sites per user, retention), SDK page (custom metadata), API page (route table), 390 px layouts with a drawer, and dark mode (e2e `grid` 390 px).

### agent: Agent area status

Branch `area/agent`. One line per task row from `docs/tasks.md` (area agent). The checks ran against the area server on :3107 (`toolbar_agent` database, seed data, S3 prefix `agent/`), Playwright on Xvfb `:117`, and Claude Code with a scratch MCP config in `/tmp`. The branch merges `area/auth` and `area/server-core` (it builds on their token scopes, `apiGate`, share access and upload API).

How to rerun:

- Units: `pnpm --filter @toolbar/shared test` (`test/derive.test.ts`), `pnpm --filter @toolbar/cli test`, `pnpm --filter @toolbar/server test` (`test/agent.unit.test.ts`, and `test/agent.int.test.ts` when Postgres answers).
- E2E: `pnpm --filter @toolbar/cli build`, load `.env`, then in `e2e/`: `npx playwright test tests/agent`. `cli-create.spec.ts` also needs `NIB_E2E_TOKEN` (a personal token with CLI write, the seed prints one), ffmpeg and the lab (`LAB_URL`); `tab.spec.ts` skips until the viewer's capture page is merged (it ran green in a scratch merge with `area/viewer` on a throwaway database).
- MCP with Claude Code: a config with `{"mcpServers":{"nib":{"type":"http","url":"http://localhost:3107/mcp","headers":{"Authorization":"Bearer <token>"}}}}`, then `claude -p "..." --mcp-config <file> --strict-mcp-config --allowedTools mcp__nib__<tool>,...`.

| ID | Status | Notes |
|---|---|---|
| J-145 | built | Settings, MCP: server URL with copy, cards for Claude Code, Cursor, Codex, VS Code and other agents; each opens a dialog with a snippet that holds only the URL, a copy button and numbered steps. Verified: `agent.spec.ts` J-145 (snippets equal `claude mcp add --transport http nib <url>/mcp` and Cursor JSON, no token). |
| J-146 | built | First `/mcp` call gets 401 with `resource_metadata`; discovery, dynamic registration, consent page (client's registered name, workspace picker defaulting to the active workspace, two scope bullets, one Allow button, a quiet Cancel), PKCE S256 exchange, tools list. Verified: `agent.spec.ts` J-146 (whole flow in a browser), `agent.int.test.ts` (PKCE failure burns the code, refresh rotation, wrong redirect refused), `nib login` through the browser in `agent.spec.ts` J-155. |
| J-147 | built | MCP page lists connected agents (name, workspace, scope, connected and last-used times) with a row menu, Remove and a confirm; the row goes without a reload and the token's next call gets 401. Verified: `agent.spec.ts` J-147, `agent.int.test.ts` (revoked grant answers 401 with WWW-Authenticate). |
| J-148 | built | Token create dialog and secret-once display are the auth area's (`/settings/tokens`, see `docs/status/auth.md`). This area enforces the scopes on `/mcp`: `mcp:read` gets read tools only and writes are refused with a reason; `cli:*` scopes apply when the CLI calls (`x-nib-client: cli`); a token without the scope gets 403. Verified: `agent.spec.ts` J-148 (a key made in the dialog with the defaults, 30 days and CLI read only, shows once with `tb_pat_` and is gone after a reload; `nib ls` with it lists captures and `nib comment` is refused), `agent.int.test.ts` "checks personal token scopes per surface". |
| J-149 | built | Read tools: `get_capture` (details plus a ranked investigation guide), `get_console_logs`, `get_network_requests` (headers and failure bodies by default, filters on status class, type, method, host, window, text), `get_stream_messages` (WebSocket and SSE), `get_user_events`, `get_events` (raw), `get_metadata`, `get_screenshots`, `get_frames` (overview grid, times, or a range with a count; 360/720/1080), `get_transcript` (says why when there is none), `get_chapters`, `list_comments`, `get_share_link`; lists return `{ items, total, returned, hasMore, nextCursor }`. REST twins: `GET /api/v1/recordings/:id/{events,console,network,network/:rid/frames,actions,frames}`. Verified: Claude Code via MCP on seed capture c1 (found the hidden 500 and its body, described frame 2700) and a second run over transcript, metadata, masked input, screenshot, chapters; curl on the REST routes; `derive.test.ts`. Not built: Jam's AI video analysis tool (needs an AI provider; chapters come from server-core's job when one is set). |
| J-150 | built | `search` (a pasted capture or share URL or id resolves to that capture, else text over titles, descriptions, page URLs, comments and transcripts), `search_captures` (kinds, folder, author, date window, sort, paging), `list_captures`, `list_folders` (with counts), `list_members` (seats), `list_recording_links`, `list_recording_link_captures`. Lists follow the private capture and folder rules. Verified: `agent.int.test.ts` (by URL and by a word from a comment), Claude Code run (search "CSRF" found c3 through its comment). |
| J-151 | built | `create_comment` (markdown up to 2000 characters, `videoMs`, replies, mentions), `edit_comment` and `delete_comment` (own only), `add_reaction` and `remove_reaction` (the viewer's eight reaction keys, stored in its `comment_reaction` table as `u:<userId>`; plain SQL in `lib/server/mcp/reactions.ts`, answers `unavailable` while the table is missing), `update_capture` (title, description, folder; author or admin), `delete_capture`, `create_folder`, `rename_folder`, `delete_folder`, `create_recording_link`, `update_recording_link` (rename, folder, turn off), `delete_recording_link`; writes act as the user and the server log shows each call's intent. Verified: `agent.int.test.ts` (comments, folder move, link create, list, revoke and delete, a viewer seat refused; reactions added twice count once, a second member counts two, remove, unknown key and read-only token refused, a deleted comment is not found), `tab.spec.ts` in a scratch merge with `area/viewer` (an agent's comment at 2630 ms shows on the capture page with the 0:02 time chip and its check reaction pressed). |
| J-152 | built | `lib/components/agent/AgentTab.svelte` (mounted by the viewer's `AgentSlot.svelte` as the fifth dev tools tab): setup prompt with the MCP URL and capture link until the viewer has a connected agent, then Fix it, Summarise and E2E test presets with the capture URL and copy buttons, plus Copy for AI and the CLI hint. `CopyForAi.svelte` is a standalone header button for the viewer to place. Data from `GET /api/v1/mcp/captures/:id/brief` (works for share-link viewers). Verified: `tab.spec.ts` in a scratch merge with `area/viewer` (Sam with no agent sees the setup prompt and no presets; after approving an agent the three presets carry `/c/<id>`; tab, preset, copy is three clicks; copy-for-AI reaches the clipboard; a logged-out link viewer gets the setup prompt with the share URL); the spec skips on this branch alone. |
| J-153 | built | `/s/<token>.md` and `Accept: text/markdown` on `/s/<token>`: front matter (title, URL, type, captured-on page, image, browser, OS, viewport, screen, zone, locale, author, date), a signals line, comments with replies and times, pointers to the MCP server and the CLI; 404 text for unknown tokens; workspace-only links need a member. HTML responses carry the `Link` header. Verified: `agent.spec.ts` J-153, curl. |
| J-155 | built | Settings, CLI: install for macOS and Linux or Windows, `nib login --server <url>` (browser OAuth or `--token`), `nib skill install`, and a first command. The server serves `/cli/install.sh`, `/cli/install.ps1` and `/cli/nib.mjs`. Verified: `agent.spec.ts` J-155 (page, install routes, then `nib login` approved in the browser and `nib ls` listing the seed captures). |
| J-244 | built | `nib create --json payload.json` (image file or data URL, PNG 8 or 16 bit; marks box, arrow, text, redact, blur in image pixels): marks drawn into the stored PNG, boxes and arrows numbered in payload order, notes become numbered description lines; title, description and folder change later with `nib update`. Verified: `cli-create.spec.ts` J-244, and the stored image checked by eye. |
| J-245 | built | `nib create <video> --trace trace.zip [--poster img]`: WebM kept (other formats converted by a local ffmpeg), trace console, page errors, network with headers and bodies, navigations, clicks and typing synced to the video, password, one-time-code and card fields masked. Verified: `cli-create.spec.ts` J-245 on the lab (500 with body, masked password, frame JPEG). Not built: the speed-up of idle spans. |
| J-246 | built | `nib record --cdp <url> -- <command>` (or `record start`, `stop`, `status`): console, uncaught errors, network with headers and small text bodies, WebSocket frames, navigations, screencast video; a CDP proxy (`NIB_CDP_PROXY` for the wrapped command) counts the agent's input commands, and a page listener logs clicks and committed inputs with the element, secrets masked; stop uploads and prints the link. Verified: `cli-create.spec.ts` J-246 with Playwright `connectOverCDP` through the proxy on the lab, and `record start`/`stop` by hand. Not built: recording a window or display without a browser (needs OS screen capture). |
| J-247 | built | `nib get`, `console`, `network` (`--status 5xx` etc., failure bodies by default), `messages`, `actions`, `events` as paged JSON with `--cursor` or `--all`; `frames` writes JPGs (default `./nib-<id>/frames`: overview, `--at` times, or `--from --to --count`); `screenshots` writes PNGs; `pull` writes everything plus `summary.md` (the copy-for-AI bundle) for agents that read files; the skill file states the read order. Verified: `nib network <url> --status 5xx` returned the 500 with its body, `nib frames <url> --at 5000` wrote a JPG, `cli.test.ts` checks the skill text, `cli-create.spec.ts` reads its own captures back. |
| J-157 | skipped | Skip list: directory listings in Claude and ChatGPT need approval for a public service. The MCP URL works as a custom connector. |

#### For the merge step

- `lib/server/mcp/reactions.ts` keeps its own copy of the viewer's `REACTION_KEYS` and reaches `comment_reaction` with plain SQL. After the merge, import the keys from `@toolbar/shared/api` and the table from `db/schema/comments.ts`.
- MCP comment and reaction writes change the rows but do not call the viewer's in-process `publish()` (`lib/server/viewer/comments.ts`), so an open capture page shows them on its next load. Export `publish` there and call it from `create_comment`, `edit_comment`, `delete_comment`, `add_reaction` and `remove_reaction` to make them live.
- The scratch merge with `area/viewer` conflicted in `api/v1/recordings/[id]/+server.ts` (viewer GET and PATCH next to server-core's DELETE), `api/v1/assets`, `recordings/[id]/media/[name]`, `recordings/[id]/share` and `s/[token]/media/[name]` (viewer stand-ins against server-core's handlers), `docs/decisions.md` and `pnpm-lock.yaml`.
