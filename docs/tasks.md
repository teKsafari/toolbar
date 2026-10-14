# Build tasks (Part 1, step 2)

One task per row of `docs/jam/catalogue.md`, with the same ID. Each area goes to one agent. The flows in `docs/jam/flows.md` set the click budget: the same steps or fewer.

How to read a row:

- **Status.** `build`: build it. `build, part skipped`: build it without the part listed in `docs/skip-list.md`. `covered by J-xxx`: nothing of its own to build; the named task carries the behavior, budget or constraint, and the check below still has to pass. `skip`: on `docs/skip-list.md`.
- **Check.** One acceptance check a tester runs on the lab app (http://localhost:5173, second origin :5174) or the web app (http://localhost:3000, Mailpit on :8025). "/" means the lab root page. Where the replica does better than Jam on purpose, the check says "Better".
- **Deps.** Other J tasks, or the foundation tasks X-01 to X-08 below, that must land first.

Proposed decisions for `docs/decisions.md` (owner of that file to record):

- AI text (J-075, J-083, J-149 analysis, J-156) sits behind a `Summarizer` interface like the `Transcriber`: `AI_PROVIDER=none | openai-compatible`. A local Ollama or llama.cpp server satisfies it, so no paid account is needed. With `none`, the AI switch shows disabled with a reason.
- Integrations ship as generic equivalents: GitHub and GitLab issues through a personal access token, Slack through an incoming webhook URL, and signed outgoing webhooks. Trackers that need a registered OAuth app or a paid workspace are on the skip list.
- No plan gates: every feature Jam reserves for paid plans (workspace-only links, private folders, default link access, role changes) is free here, and no billing or quota UI exists (PLAN.md Part 2: no paid tiers).
- J-230: a click in the AI ghost title accepts it, as in Jam. J-216: decide match or scroll-lock during the editor work.

## Counts

### By area and priority (all rows)

| Area | P0 | P1 | P2 | Total | Build | Build, part skipped | Covered | Skip |
|---|---|---|---|---|---|---|---|---|
| capture | 24 | 12 | 9 | 45 | 36 | 0 | 7 | 2 |
| ext-ui | 8 | 18 | 15 | 41 | 35 | 2 | 2 | 2 |
| editor | 16 | 14 | 6 | 36 | 30 | 1 | 5 | 0 |
| server-core | 1 | 4 | 2 | 7 | 7 | 0 | 0 | 0 |
| viewer | 14 | 21 | 16 | 51 | 49 | 0 | 2 | 0 |
| dashboard | 5 | 24 | 21 | 50 | 37 | 8 | 0 | 5 |
| auth | 1 | 3 | 2 | 6 | 5 | 1 | 0 | 0 |
| agent | 4 | 10 | 1 | 15 | 14 | 0 | 0 | 1 |
| **Total** | **73** | **106** | **72** | **251** | **213** | **12** | **16** | **10** |

### By priority and status

| Priority | Build | Build, part skipped | Covered | Skip | Total |
|---|---|---|---|---|---|
| P0 | 66 | 2 | 5 | 0 | 73 |
| P1 | 95 | 6 | 5 | 0 | 106 |
| P2 | 52 | 4 | 6 | 10 | 72 |

No P0 or P1 row is skipped whole. Two P0 rows lose a part: J-079 (tracker entries that need paid OAuth apps) and J-217 (Apple sign-in). `docs/skip-list.md` gives the reasons.

## Foundations (not catalogue rows)

Shared work the rows depend on. Each goes to the agent of its area and lands first.

| ID | Area | Task | Check |
|---|---|---|---|
| X-01 | server-core | Upload API: POST /api/v1/recordings, chunk PUT/list/complete/finalize, assets; Garage storage; extension IndexedDB queue (architecture s5). | curl a 3-chunk upload with one retried chunk: finalize returns a share URL and the stream reassembles byte-identical. |
| X-02 | server-core | Job runner (SKIP LOCKED) with finalize-recording, remux, thumbnail, transcribe, purge, expire-shares. | Kill the server mid-job: on restart the job is retried and the capture reaches ready. |
| X-03 | server-core | Share tokens and media proxy with Range (architecture s8). | GET /s/<token> works signed out with no-referrer and noindex headers; revoked token returns 404; Range request returns 206. |
| X-04 | capture | Event envelope, MAIN/ISOLATED hooks and handshake, Transport, redaction module (architecture s4, s10). | vitest suites in packages/shared and packages/capture pass; lab console call arrives at the service worker with seq and t. |
| X-05 | auth | Extension device sign-in via launchWebAuthFlow + PKCE; popup sign-in state. | Signed-out popup shows sign in; after the flow the popup shows the account and settings lists the device under connected browsers. |
| X-06 | auth | Better Auth with organizations, sessions in hooks.server.ts, workspace bootstrap on first sign-in. | First sign-in creates a workspace with the user as admin; /api/v1 calls without a session return 401. |
| X-08 | server-core | compose.yaml stack: server, Postgres 18, Garage, whisper.cpp, Mailpit; server image with ffmpeg (architecture s13). | On a clean machine `docker compose up` serves http://localhost:3000/login and Mailpit on :8025 with no extra steps. |
| X-07 | ext-ui | Brand and design tokens shared by extension and web app (own name, icons, colours, type; Jam's density). | Toolbar, editor and dashboard render with the shared tokens in light and dark. |

## capture (45: P0 24, P1 12, P2 9)

Scope: page hooks, rrweb, ring buffer and instant replay, screenshots, tab and screen video, offscreen document, webRequest, redaction.

| ID | Feature | Pri | Status | Check | Deps |
|---|---|---|---|---|---|
| J-002 | Visible-area screenshot | P0 | build | Popup, screenshot row, click on /: the editor opens with the full viewport image at 1x CSS pixels in under 1.3 s (J-194). | X-01, J-037 |
| J-006 | Tab video recording | P0 | build | Popup record row on /: 3-2-1 countdown, no Chrome picker, and the stored video contains only the viewport (no browser chrome). | X-01, X-02, J-027, J-028 |
| J-007 | Desktop or window recording | P0 | build | Switch record chevron to desktop, click record, choose a screen in Chrome's picker: recording starts with no countdown; the choice is still desktop on the next popup open. | J-006 |
| J-008 | Desktop recording follows tab switches | P1 | build | Desktop-record, switch from :5173 to :5174: the bar appears in the new tab, the timer continues, and the capture holds console rows from both tabs; the draft opens in the tab active at stop. | J-007, J-224 |
| J-009 | Instant replay (share the past) | P0 | build | Enable replay in popup settings, click Submit order on /, then the rewind row: the draft shows a DOM replay trimmed to the last 30 s including the 500 marker. | J-010, J-176 |
| J-010 | Instant replay is a DOM replay | P0 | build | With replay on, use / for 3 minutes, trigger replay: the replay spans at most 120 s, never resets to 0, starts after the last load, and nothing reaches the server before create. | X-04, J-189 |
| J-014 | Microphone narration toggle | P1 | build | Click the mic pill: a permissions tab asks once; after grant the next recording has a voice stream; with no device the tab closes and the pill shows off. | J-006, J-200 |
| J-210 | No camera in the extension | P1 | covered by J-006 | Constraint: no camera option in popup, chevron, bar or draft. | J-006 |
| J-021 | Incognito and local files | P2 | build | Allow incognito and file access, take a screenshot of file:///.../lab-page.html in a private window: the capture is created and its info tab shows an incognito flag. | J-002, J-070 |
| J-022 | Emulated mobile viewport | P2 | covered by J-070 | With DevTools device mode at 390x844, take a screenshot of /: the info tab shows the emulated viewport and device UA. | J-070 |
| J-235 | Supported browsers | P2 | covered by J-001 | Load the release build unpacked in Chromium and Edge (Brave if installed); popup opens and a screenshot of / creates a capture. | J-001 |
| J-029 | Pause and resume | P1 | build | Pause for 5 s mid-recording, resume, stop: the stored video is about 5 s shorter than wall time and the console tab shows a video-paused row (J-233). | J-006, J-028 |
| J-211 | Mute and switch mic while recording | P1 | build | With narration on, mute then unmute from the bar and switch to a second fake mic: the voice stream has silence for the muted span and continues without stopping. | J-014 |
| J-032 | Recording survives navigation | P0 | build | Record, click a SvelteKit link on /, then reload: the bar survives the SPA change, vanishes during the reload and returns with the timer still counting; events from both documents are in one capture. | J-006 |
| J-034 | Post-stop processing state | P1 | build | Stop a 30 s recording on /: a spinner shows on the bar and the editor opens with a playable video of the right length within 5 s; after 60 s with no editor, an error with a open-drafts action shows (J-196). Ten runs, zero 0-second drafts. | J-006, J-218 |
| J-055 | Console capture by level | P0 | build | Record and click console at every level on /: log, info, debug share one icon, warn yellow, error pink, objects as one-line JSON, each with a time offset. | X-04 |
| J-056 | Call-site stack on every console row | P1 | build | Expand any console row from /: the call-site stack shows function, file, line and column as links. | J-055 |
| J-057 | Uncaught exceptions | P0 | build | Record and click Show profile: an error row with TypeError, message and stack, plus an error marker. Better: Refresh (unhandled rejection) also appears as an error row. | J-055, J-072 |
| J-058 | Network list | P0 | build | Record, click Save and Submit order and load the 5174 image: each request lists method, status, domain, type, frame, size, time and waterfall; the extension's own assets are absent (J-248). | X-04 |
| J-248 | Leaked requests show as false failures | P1 | build | Block the extension's font URL and record /: no extension-owned request appears in network, console, markers or tab dots. | J-058 |
| J-059 | Request and response headers | P0 | build | Open the Save request: general, response and request header groups are complete (redacted per J-185). | J-058, J-185 |
| J-060 | Request and response bodies | P0 | build | Open Submit order: request and response JSON bodies show with line numbers, folding, pretty-print and copy; document and image rows have no body. | J-058 |
| J-061 | Pending requests | P1 | build | Record and click Sync: the row shows blank status and 0 ms. Better: a pending label and elapsed time. | J-058 |
| J-062 | WebSocket frames | P1 | build | Record /live after opening the socket during capture: a 101 row lists every frame with direction, data, length, time, regex and direction filters. | J-058 |
| J-063 | Server-sent events | P2 | build | Record /live SSE: the stream row has headers and duration. Better: the event list is kept. | J-058 |
| J-064 | GraphQL awareness | P1 | build | Lab GraphQL fixture (add to lab) returning errors at HTTP 200: the row shows the operation name and counts as failed. | J-058 |
| J-065 | CORS error call-out and timing breakdown | P2 | build | A cross-origin fetch blocked by CORS (lab fixture) is highlighted as CORS; any row shows DNS, connect and response timing. | J-058 |
| J-066 | Binary payload placeholder | P2 | build | A binary WebSocket frame on /live (lab fixture) shows as a size-only placeholder. | J-062 |
| J-067 | Click events | P0 | build | Record and click Save: an actions row shows a pseudo tag with the test id behind an expand chip. Better: clicks inside the lab iframe are captured. | X-04 |
| J-068 | Typing events | P0 | build | Type in each /form field: one row per field; text and textarea in clear, email and password as asterisks of unrelated length. | J-067, J-187 |
| J-069 | Navigation events | P0 | build | Record: SPA navigation, reload, typed URL and link click on lab each give a navigation row naming the cause, full loads preceded by a tab-hidden row. | X-04 |
| J-070 | Page and device metadata | P0 | build | Info tab of any lab capture lists start URL, timestamp, country, OS, browser and version, viewport and network speed bucket with latency. | X-04 |
| J-071 | Logs from before the capture | P0 | build | Click Submit order, wait 20 s, take a screenshot: the capture includes the 500 and its console row from before the shot. | J-010 |
| J-073 | Custom metadata SDK | P1 | build | Lab page calls window.toolbar.setMetadata(() => ({plan:'x'})): the info tab's custom logs row shows the JSON; objects over 10 KB are rejected. | J-101 |
| J-076 | Third-party session links | P2 | skip | Skip list. | - |
| J-185 | Header secret filtering | P0 | build | Lab request with Cookie and Authorization: the viewer shows masked values with a shield badge and copy cURL has a placeholder. | X-04 |
| J-186 | Body secret replacement | P0 | build | Submit /form: email and password body values are replaced before upload. Better: a JWT and a Luhn-valid card in the textarea are also scrubbed. | J-060 |
| J-187 | Typed text masking | P0 | build | Type in /form email and password: asterisks of unrelated length; click rows mask the value attribute; text fields stay clear. | J-068 |
| J-188 | Pixels are not masked | P0 | covered by J-031 | Observation: pixels are not masked; manual blur (J-031, J-044) is the protection. | J-031, J-044 |
| J-189 | Nothing leaves before create | P0 | build | Before create, no recording is listed or reachable by share URL, and the replay buffer never uploads; discarding a draft deletes uploaded chunks from Garage. | X-01 |
| J-192 | Auto-blur and sanitizers on connected domains | P2 | skip | Skip list. | - |
| J-194 | Capture to editor | P0 | covered by J-002 | Budget in J-002 and J-009: viewport shot to editor under 1.3 s on /, replay loaded under 4.6 s. | J-002, J-009 |
| J-195 | Key to live recording | P0 | covered by J-027 | Budget in J-027: key to live under 6.4 s. | J-027 |
| J-196 | Stop to editor | P0 | covered by J-034 | Budget in J-034: stop to editor under 5 s, no broken drafts. | J-034 |
| J-201 | Cancelled share picker | P2 | build | Cancel Chrome's share picker on a desktop recording: the bar disappears and no draft is left. | J-007 |

## ext-ui (41: P0 8, P1 18, P2 15)

Scope: popup, in-page recording bar, screenshot and area modes, shortcuts, drafts list, extension settings, sign-in state.

| ID | Feature | Pri | Status | Check | Deps |
|---|---|---|---|---|---|
| J-001 | Toolbar popup with the capture menu | P0 | build | Click the pinned icon on http://localhost:5173: a card lists screenshot, record, recording link (and replay when enabled) with home and three-dot header icons; full content in under 1.7 s warm (J-193). | X-05 |
| J-003 | Area screenshot by drag | P0 | build | In screenshot mode, drag a box on /: a translucent rectangle with a live WxH readout follows the pointer and the editor opens with exactly that crop. | J-002, J-025 |
| J-005 | Screenshot delay timer | P2 | build | Pick 3 s on the screenshot chevron, click the row, click the page: a bottom-left countdown and cancel pill run, the shot fires at zero, the choice is off next time. | J-002 |
| J-011 | Heavy-page guard for instant replay | P2 | build | On /list with 500 rows flagged heavy (lab threshold), the replay row shows a disabled badge; clicking opens an in-popup warning; continue enables replay for this page load only. | J-009 |
| J-012 | Replay site lists | P2 | build | In settings with replay on, the blocked-sites list ships with the default domains, accepts a new domain, and deletes one by trash icon; a blocked domain gets no ring buffer. | J-176 |
| J-215 | Replay setting follows the account | P2 | build | Turn replay on in profile A, sign the same account into a second Chromium profile: replay is on there after the next popup open. | J-009, X-05 |
| J-013 | Recording length cap and upsell | P1 | build, part skipped | Set MAX_RECORDING_MIN=1 on the server: the timer shows the cap, turns orange then red before 1:00 and the recording stops at the cap. No upsell card (skip list). | J-028 |
| J-015 | Recording link created from the popup | P1 | build | Popup, recording-link row, name it, pick a folder, create: a short link is on the clipboard and shown with a copy button. | J-167 |
| J-232 | Recorder domain status | P2 | build, part skipped | The recording-link form shows the recorder domain with a red dot (no console or network capture) and a menu with that domain ticked. No green connected-domain state (J-143 on the skip list). | J-015 |
| J-016 | Recording link explainer | P2 | build | Click the help icon on the recording-link row: a three-card carousel shows inside the popup and pages with next. | J-015 |
| J-019 | Popup adapts to context | P2 | build | Open the popup on http://localhost:3000: the record row offers desktop instead of tab; on chrome://extensions the J-199 state shows. | J-199 |
| J-023 | Mac app recorder | P2 | skip | Skip list (D-016). | - |
| J-024 | iOS app recorder | P2 | skip | Skip list (D-016). | - |
| J-025 | Screenshot-mode cursor hint | P0 | build | Press Ctrl+Shift+S on /: a grey pill trails the pointer about 5 px right and 20 px below, the page is not dimmed; with a delay set the pill names the timer. | J-180 |
| J-250 | Capture click is swallowed | P1 | build | Arm screenshot mode and click Save (works) on /: the save counter does not change and capture-phase pointerdown and click listeners on document count zero. | J-002 |
| J-026 | Leave screenshot mode | P1 | build | Arm screenshot mode, press Escape: the pill disappears; arm again, open the popup: the screenshot row is a red exit row, other rows greyed, clicking it exits. | J-025 |
| J-027 | Pre-roll countdown | P0 | build | Start a tab recording on /: a grey veil and a 3, 2, 1 count at bottom centre run, then live in under 6.4 s from the key (J-195); a click on the veil pauses the count. | J-028 |
| J-028 | Recording control bar | P0 | build | While recording /: a dark pill about 295x40 at bottom centre holds stop, pause, timer, mic state, pen and blur, inside a closed shadow root, and it is visible in the stored video. | X-07 |
| J-238 | Drag the recording bar | P1 | build | Drag the bar by its timer to mid page: it stays there, the timer keeps counting, and the video shows it at the new spot. | J-028 |
| J-030 | Live drawing during recording | P1 | build | Click pen on the bar, draw on /: 12 colour dots (red preselected), each stroke fades after 2 to 3 s, and a pen marker sits on the capture's timeline. | J-028, J-072 |
| J-031 | Live element blur during recording | P1 | build | Click blur on the bar, click the profile card on /: it blurs in the page and the video; click again unblurs; undo and done work; recording pauses while blurring. | J-028, J-029 |
| J-033 | Browser-level recording cues | P1 | build | While recording, the action icon is a red camera and resets after stop. | J-006 |
| J-239 | Popup during a recording | P1 | build | Click the icon during a recording: screenshot row greyed, record row is a stop row, recording-link row active; the stop row ends the recording and opens the video draft. | J-006, J-001 |
| J-035 | Unfinished draft guard | P1 | build | With a draft open, the popup header shows an unfinished-draft pill and only the recording-link row is enabled; after save-for-later the capture rows re-enable and the pill opens Drafts. | J-218 |
| J-218 | Local drafts list | P1 | build | Click the draft pill: Drafts screen with thumbnail, host, age, view and trash per draft; view reopens the editor with trim and AI text; trash turns into confirm, second click deletes. | J-035, J-219 |
| J-036 | Blur before recording | P2 | build | During the 3-2-1 countdown click blur on the bar and blur an element: it is blurred from the first frame of the video. | J-031, J-027 |
| J-089 | Open in new tab setting | P2 | build | Turn off open-in-new-tab in popup settings, create: no new tab opens, link still copied. | J-176, J-086 |
| J-176 | Extension settings in the popup | P1 | build | Popup three-dot, settings: scrollable screen with open-in-new-tab, capture user events, shortcuts link, instant replay and site lists, send error logs, reset; toggles apply at once. | J-001 |
| J-226 | Limit the sites the extension runs on | P2 | covered by J-001 | No build. Set Chrome site access to localhost:5173 and localhost:3000 only: screenshot and recording still work on the lab. | J-001 |
| J-177 | Extension utility menu | P2 | build | Three-dot menu opens docs and support, restarts the extension (popup reopens), and starts a bug report through a recording link to the server admin. | J-176, J-015 |
| J-179 | Open the popup by key | P1 | build | Ctrl+Shift+Y on / opens the popup. | J-001 |
| J-180 | Screenshot mode by key | P0 | build | Ctrl+Shift+S on / arms screenshot mode in under 0.5 s with no popup. | J-025 |
| J-181 | Start and stop tab recording by key | P0 | build | Ctrl+Shift+Space starts with countdown and the same chord stops. | J-006 |
| J-182 | Instant replay by key | P0 | build | Ctrl+Shift+X opens the replay draft with no popup. | J-009 |
| J-183 | Unbound recording-link command | P2 | build | chrome://extensions/shortcuts lists a recording-link command with no default key. | J-015 |
| J-184 | Rebind and scope | P1 | build | Settings shortcuts link opens chrome://extensions/shortcuts; rebinding takes effect and screenshot, replay and record allow global scope. | J-176 |
| J-212 | Shortcut tooltips in the popup | P2 | build | Hover the screenshot row 2 s: a pill shows its current chord, and a rebinding shows at once. | J-184 |
| J-190 | Turn off user-event capture | P1 | build | Turn off capture user events in settings, record /form: no click or typing rows. | J-176, J-067 |
| J-193 | Popup open time | P1 | covered by J-001 | Budget in J-001: popup full content under 1.7 s warm, 3 s cold. | J-001 |
| J-199 | Restricted page popup | P1 | build | Open the popup on chrome://extensions: an illustration and a line asking for a normal site; shortcuts do nothing there. | J-001 |
| J-200 | Missing mic permission | P1 | build | Deny the mic: the bar's mic button is greyed with a missing-permission tooltip; the link recorder shows instructions and record-without-voice. | J-014, J-017 |

## editor (36: P0 16, P1 14, P2 6)

Scope: annotation tools on screenshots, video trim, draft and submit form, AI title fields.

| ID | Feature | Pri | Status | Check | Deps |
|---|---|---|---|---|---|
| J-004 | Full viewport kept with an area crop | P1 | build | Area-capture /: the draft shows a ticked full-viewport thumbnail; created capture shows crop and full; unticked creates crop only. | J-003, J-209 |
| J-037 | In-page screenshot editor | P0 | build | Screenshot /: an in-page modal about 1380x730 over a dimmed page, left 70% preview with close and tool pill, right 30% form; page CSS does not leak into it. | X-07 |
| J-216 | Editor leaves page scroll unlocked | P2 | covered by J-037 | Observation only. With the editor open, wheel over the preview: decide match (page scrolls) or lock; record the choice in decisions.md. | J-037 |
| J-038 | Pen | P0 | build | Editor opens with pen active: drag draws a smoothed tapered stroke (perfect-freehand), pen stays active; D reselects it. | J-037 |
| J-039 | Rectangle | P0 | build | Pick rectangle, drag: rounded outline in the current colour, tool returns to select with the shape selected. | J-037 |
| J-040 | Ellipse | P0 | build | Pick ellipse, drag a wide box: an ellipse fills the box (not a circle) and the tool returns to select. | J-037 |
| J-041 | Arrow with bend handle | P0 | build | Draw an arrow, select it, drag the middle handle: the arrow bends into a curve with the open V head following the tangent. | J-037 |
| J-042 | Line | P1 | build | Pick line, drag: a straight thick stroke with no head. | J-037 |
| J-043 | Text callout | P0 | build | Press T, click, type: white bold text in a filled rounded box of the current colour; double-click edits with all text selected. | J-037 |
| J-044 | Blur area | P0 | build | Draw a blur box over text, then move it: the old spot is sharp and the new spot blurred; the created image has the blur burned in. | J-037, J-051 |
| J-045 | Colour palette | P0 | build | Open the colour dot: 6 swatches, purple default; picking red recolours the selected shape and new shapes; a new draft resets to purple. | J-037 |
| J-046 | Select, move, resize, rotate | P1 | build | Press V, click a shape outline: move, resize from corners and rotate from just outside a corner each work; resizing a text callout scales its font. | J-039 |
| J-047 | Marquee multi-select | P1 | build | Drag a marquee across two shapes on empty space: both join one selection and move together. | J-046 |
| J-048 | Delete selection | P1 | build | Select two shapes, press Delete: both go; Ctrl+Z restores both in one step. | J-047, J-049 |
| J-049 | Undo and redo | P0 | build | Create, move, recolour and delete one shape: four undo steps by button and Ctrl+Z; redo button replays them; buttons grey when empty. | J-037 |
| J-050 | Tool tooltips with key badges | P2 | build | Hover each tool 1 s: a dark tooltip names it, with key badges on pen (D), text (T) and select (V). | J-037 |
| J-051 | Annotations flattened into the image | P0 | build | Create a screenshot with a rectangle: the viewer shows one PNG with the mark flattened in; no shape layer is editable. | J-086 |
| J-052 | Copy and paste of shapes | P2 | build | Select a shape, Ctrl+C, Ctrl+V: a copy appears offset by 10 px and is one undo step (Jam's version did nothing; this is a deliberate better). | J-046 |
| J-053 | No crop, zoom or eraser | P2 | covered by J-037 | Constraint: the editor has no crop, zoom, eraser, highlighter, step badges or stickers. | J-037 |
| J-240 | No annotation after a recording | P1 | covered by J-084 | Constraint: a video or replay draft shows play and trim only, no tool pill. | J-084 |
| J-077 | Title and description in one field | P0 | build | Editor opens with focus in one rich-text box: typed first line renders as the title, later lines as description; an empty title creates fine. | J-037 |
| J-078 | Markdown-style input rules | P2 | build | Type '- ' and '1. ' and Ctrl+B in the description: bullet list, numbered list and bold, all kept in the viewer. | J-077 |
| J-079 | Destination picker | P0 | build, part skipped | Destination menu defaults to share link and lists GitHub, GitLab, Slack (incoming webhook) and webhook; Jira, Linear, ClickUp, Notion, Azure DevOps and Asana are not offered (skip list). | J-137 |
| J-080 | Workspace picker | P1 | build | With two workspaces, the second dropdown switches the target; the capture lands in the picked workspace. | J-221 |
| J-081 | Folder picker | P1 | build | After a folder exists, the folder button lists no folder plus each folder; pick one, create; the next fresh draft preselects it. | J-163 |
| J-082 | Attach files to the draft | P2 | build | Attach a PNG and a .txt with the paperclip: both show on the capture page as attachments (Jam's version lost them). | X-01 |
| J-083 | AI title and repro steps | P1 | build | With AI on and a provider set, a video draft shows grey ghost title, summary, steps with time links and result within 6 s; Tab accepts; on screenshots the switch is disabled with a tooltip; the choice persists. | J-075, J-084 |
| J-230 | Click into the ghost title | P1 | build | Click inside the ghost title: it becomes real text with the caret at the click point (decision: match Jam, logged in decisions.md). | J-083 |
| J-084 | Video preview in the draft | P0 | build | Video draft: play starts at the left trim handle, clicking the video toggles play, clicking the bar seeks, length spelled out under the bar. | J-006 |
| J-085 | Trim | P0 | build | Drag both trim grips inward: the cut greys, preview scrubs, length updates; Ctrl+Z and Ctrl+Shift+Z undo and redo each drag. | J-084 |
| J-086 | Create and copy link | P0 | build | Click create on a screenshot draft: spinner, toast, link on clipboard within 4 s (J-197), capture opens in a background tab right of the source tab, no page clipboard prompt (J-202). | X-01, X-03 |
| J-220 | Create by key | P1 | build | With focus in the title, Ctrl+Enter creates exactly as the button does. | J-086 |
| J-088 | Discard the draft | P1 | build | Close button discards a screenshot draft at once; Escape shows a press-again toast and a second Escape within 1 s discards. | J-037 |
| J-219 | Save a video draft for later | P1 | build | Reopen a video draft from Drafts, click save-for-later: editor closes, toast with a view button, popup shows the draft pill with capture rows enabled. | J-218 |
| J-197 | Create to link on clipboard | P0 | covered by J-086 | Budget in J-086: create to clipboard under 4 s for screenshot, video and replay. | J-086 |
| J-202 | Clipboard permission prompt | P1 | covered by J-086 | Covered by J-086: the link is copied from the extension, so no page clipboard prompt appears. | J-086 |

## server-core (7: P0 1, P1 4, P2 2)

Scope: upload API, storage, jobs (ffmpeg finalize, transcription, thumbnails), share links, permissions.

| ID | Feature | Pri | Status | Check | Deps |
|---|---|---|---|---|---|
| J-054 | Tab video file | P0 | build | Record 20 s of /: the share page plays a WebM of the viewport and the quality menu offers original plus 720p to 240p renditions produced by the ffmpeg job. | X-02, J-006 |
| J-074 | Voice transcript | P1 | build | Record with the fake mic (voice.wav): within 2 minutes the capture has a timestamped WebVTT transcript from whisper.cpp; with no mic no transcribe job runs. | X-02, J-014 |
| J-075 | AI chapters | P2 | build | With AI_PROVIDER set (local OpenAI-compatible endpoint), a 60 s narrated capture gets two to four chapters with start times; with none set, no chapters and no error. | X-02, J-074 |
| J-087 | Upload during the draft | P1 | build | Create a 60 s video 1 s after stop: link returns in under 2 s because chunks uploaded during recording; a trimmed capture shows a processing notice until the trim job ends. | X-01, X-02 |
| J-227 | Trim also cuts logs and events | P1 | build | Trim away the 500 on a /: recording, create: console, network and actions omit events outside the kept range and viewer length matches the draft label. | J-087, J-085 |
| J-119 | Per-capture general access | P1 | build | Set a capture to workspace only: a signed-out browser gets a sign-in page, a member sees it. Free for all, no plan gate. | X-03, J-124 |
| J-237 | Private folders and private captures | P2 | build | Mark a folder private: non-members of that folder no longer see it or its captures in lists, search or by URL. | J-119, J-162 |

## viewer (51: P0 14, P1 21, P2 16)

Scope: capture page: media, console, network, actions and info tabs, sync, comments, share dialog, downloads, copy cURL.

| ID | Feature | Pri | Status | Check | Deps |
|---|---|---|---|---|---|
| J-072 | Timeline markers in the video | P0 | build | On a /: recording with the 500 and the TypeError: markers sit above the seek bar and trim bar at their times; the failed-request badge shows 500. | J-090, J-092 |
| J-236 | Captions | P2 | build | On a narrated capture, the CC control shows the transcript as captions over the video. | J-074, J-092 |
| J-090 | Two-column capture page | P0 | build | Open a capture at http://localhost:3000/r/<id>: left media, title, description, creator, comments; right panel about 38% with info, console, network, actions and agent tabs; splitter drags. Logged-out first paint under 3 s (J-198). | X-03 |
| J-091 | Hide or show the dev tools panel | P1 | build | Click the panel toggle: the panel hides and the left column centres; click again restores. | J-090 |
| J-092 | Video player | P0 | build | Video card: play, back and forward 5 s, mute, time, chapter pill, speed 0.5x to 2x (remembered per viewer), quality, fullscreen; replay prompt at the end. | J-054 |
| J-093 | Player keyboard | P1 | build | k and Space toggle play, m mute, f fullscreen, i picture-in-picture, arrows jump 5 s, 0 to 9 seek to tenths. | J-092 |
| J-094 | Seek bar hover preview | P2 | build | Hover the seek bar: a frame thumbnail with the time and chapter name follows the pointer. | J-092, J-075 |
| J-095 | Marker hover and jump | P1 | build | Hover the 500 marker: a pill with count and the error text from the body; click opens the console tab at that row. | J-072 |
| J-096 | Chapters menu | P2 | build | Chapter pill opens a list; picking one seeks; the seek bar is split at chapter edges. | J-075, J-092 |
| J-097 | Share at the current time | P1 | build | Click the time pill on a video at 12.34 s: copied URL opens the capture at 12.34 s, with a toast. | J-092 |
| J-098 | Download media | P1 | build | Download on a video saves a WebM, on a screenshot the PNG; toast shows with an agent setup button (J-154). | J-092, J-099 |
| J-099 | Screenshot view and lightbox | P1 | build | Click a screenshot: a lightbox opens; Escape and an outside click close it; tall images scroll in the card. | J-090 |
| J-209 | Cropped and full image switcher | P1 | build | An area capture with the full viewport shows two thumbnails, crop selected with blue outline; one click swaps the image. | J-004, J-099 |
| J-100 | Instant replay playback | P1 | build | Open a replay capture: a loading card with a progress bar, then the DOM replay with a pointer glyph in the media card. | J-009, J-229 |
| J-229 | Replay player controls | P1 | build | Replay bar has play, back and forward 5 s, time, speed, fullscreen and error markers; no download, share-at-time, mute, quality or chapters. | J-100 |
| J-101 | Info tab | P0 | build | Info tab lists J-070 fields, a custom logs row with setup button, and a timestamp menu switching capture zone, your zone and UTC. | J-070 |
| J-102 | Console tab with filters | P0 | build | Console tab merges console, failed requests, navigations, clicks, typing and video start/pause/stop; text filter, level multi-select and kind chips filter it. | J-055, J-069 |
| J-233 | Video paused row | P2 | covered by J-029 | Covered by J-029: a pause leaves a video-paused row between started and stopped. | J-029, J-102 |
| J-103 | Click a row to seek | P0 | build | Hover a console row: gutter triangle; click seeks the video and arms a timestamped comment; row click expands; hovering the time shows wall-clock ms. | J-102, J-127 |
| J-104 | Panels follow playback | P1 | build | Play a / recording: console and network lists scroll to the current row, marked with a triangle and left bar; the lab flash test highlights within 100 ms. | J-102, J-105 |
| J-105 | Network tab | P0 | build | Network tab: DevTools-style table with type chips, text filter, errors-only checkbox, sortable columns; failed rows pink. | J-058 |
| J-224 | Tab column on desktop recordings | P2 | build | A desktop recording across two tabs adds a Tab column between type and frame with each tab id; tab recordings do not have it. | J-008, J-105 |
| J-106 | Request detail pane | P0 | build | Click a row: list collapses to two columns, pane with headers, request, response (websocket for sockets), coloured status dot and close. | J-105 |
| J-243 | Step through requests by key | P1 | build | With a row selected and the response sub-tab open, Up and Down move the selection and the pane stays on response. | J-106 |
| J-107 | Copy as cURL | P1 | build | Copy as cURL on Submit order: a multi-line curl with method, headers, body and a cookie placeholder; running it against the lab reproduces the 500. | J-106, J-185 |
| J-108 | Actions tab | P1 | build | Actions tab lists clicks, typing and navigations with no filter bar; the attribute chip expands to a list. | J-067 |
| J-109 | Tab error dots | P2 | build | Tabs holding errors show a red dot, others with data a green dot; the last used tab is reopened on the next capture. | J-102, J-105 |
| J-110 | Inline title and description editing | P0 | build | Click the title, type, Enter: saved and the browser tab title updates; description saves on blur; a logged-out viewer cannot edit. | J-090 |
| J-111 | Time links in the description | P2 | build | Click a blue time link in an AI-written step: the player seeks to it. | J-083 |
| J-112 | Header actions | P0 | build | Header shows home, folder chip, three-dot (move, delete), send-to-app split button and copy-link split button. | J-090 |
| J-113 | Move to folder from the capture page | P1 | build | Three-dot, move, pick a folder or new folder: the folder chip updates and the dashboard shows the capture there. | J-112, J-162 |
| J-114 | Delete a capture | P0 | build | Three-dot, delete, confirm: toast and redirect to the dashboard within 3 s; the URL then shows J-205. | J-112, J-191 |
| J-115 | Narrow-screen layout | P2 | build | At 390 px wide the page is one column, a toggle swaps to the dev tools view, and the network table scrolls sideways. | J-090 |
| J-116 | Figma embed | P2 | build | A description holding a public figma.com link shows a Figma icon; click reveals the embed iframe. | J-110 |
| J-117 | Copy share link | P0 | build | Click copy in the header: clipboard holds the share URL, label shows a tick about 2 s, toast confirms. | X-03 |
| J-118 | Link with or without dev tools | P1 | build | Caret beside copy: two cards, full link and content-only link; the content-only page has media, title, description and comments, no dev tools. | J-117 |
| J-121 | Logged-out viewer | P0 | build | Open a share link signed out: every dev tools tab, copy cURL, share-at-time and download work; header shows only sign-in; title is read-only. | J-090, X-03 |
| J-127 | Timestamped comments | P0 | build | Seek to 0:05, type, Ctrl+Enter: send pill names 0:05, comment pinned there; Enter adds a line; composer clears in under 0.2 s. | J-090 |
| J-128 | Comment markers on the timeline | P1 | build | A timed comment shows a bubble above the seek bar; hover shows author and text; its time chip seeks and highlights the comment. | J-127, J-072 |
| J-129 | Comment permalink | P2 | build | Hover a comment, click link: the copied URL opens the capture with that comment highlighted. | J-127 |
| J-130 | Reactions | P2 | build | Hover, smiley, pick one of 8 emoji: pill with a count; clicking your own pill removes it. | J-127 |
| J-131 | Edit and delete own comment | P1 | build | Edit own comment inline (shows edited) and delete it after a permanent-warning modal. | J-127 |
| J-132 | Comment attachments | P2 | build | Attach an image in the composer: removable thumbnail, posts as thumbnail, opens full size; image-only comment allowed. | J-127, X-01 |
| J-133 | Live comment updates | P2 | build | Two browsers on one capture: a comment from one appears in the other without reload; below the fold a jump pill with avatars appears. | J-127 |
| J-134 | Anonymous comments | P1 | build | Signed out, post a comment: it shows as anonymous with a letter avatar. | J-127, J-121 |
| J-135 | Mentions | P1 | build | Type @ in a comment, the viewer description or the draft description: member picker opens; picking one sends that member a Mailpit email. | J-127, J-136 |
| J-154 | Agent nudges | P2 | build | After copy cURL or download a toast offers agent setup with a button that opens the MCP page. | J-107, J-098 |
| J-198 | Viewer load | P1 | covered by J-090 | Budget in J-090: signed-out first paint under 3 s, video playable under 40 s after create. | J-090, J-054 |
| J-231 | Empty dev tools tabs | P2 | build | A capture with no requests shows a light-hearted heading in network; one with no user events a line in actions. | J-105, J-108 |
| J-205 | Deleted or unknown capture | P1 | build | Open /r/unknown or a deleted capture: one centred not-found line. | J-090 |
| J-206 | Recording-link capture without logs | P2 | build | A recording-link capture shows console and network empty states about logs not available and a banner in actions. | J-017 |

## dashboard (50: P0 5, P1 24, P2 21)

Scope: lists, search, filters, folders, recording links, settings, members and roles, workspace, integrations and webhooks, privacy, deletion.

| ID | Feature | Pri | Status | Check | Deps |
|---|---|---|---|---|---|
| J-017 | Recorder page for a link recipient | P1 | build | Open a recording link in a signed-out browser, pick screen plus voice, record, stop, add a note, submit: the capture lands in the link's folder and the sender gets a Mailpit email. | J-167, J-126, X-01 |
| J-018 | New capture from the dashboard | P2 | build | Click new capture in the dashboard header with the extension installed: the extension popup or capture menu opens for the page. | J-001 |
| J-020 | Upload an existing video | P2 | build | Drag a 10 MB MP4 onto the dashboard grid: a video capture with no logs appears and plays; a 201 MB file is refused with a message. | X-01, X-02 |
| J-120 | Workspace default link access | P2 | build | Set workspace default link access to members only: new captures default to workspace access. | J-119, J-172 |
| J-122 | Folder sharing | P1 | build | Folder page share: copy folder link, invite by email (Mailpit receives it), who-has-access list with roles, general access. | J-162, J-123 |
| J-126 | Recording link sharing | P2 | build | Share on a recording link row copies it; ?title=&folder=&ref=&mic=1 preset the recorder page; using the link sends the owner an email. | J-167, J-017 |
| J-136 | Email notification settings | P1 | build, part skipped | Account notifications page: toggles for first view, shared with me, recording link used, same-domain signup and turn-off-all save at once and gate the emails. No plan-limit toggle (skip list). | J-171 |
| J-137 | Send to tracker at create | P1 | build, part skipped | Pick GitHub in the draft destination with a saved token, fill repo and labels, create: an issue is filed and opens in a new tab; Slack destination posts to the incoming webhook. Other trackers on the skip list. | J-139, J-140, J-242 |
| J-138 | Send an existing capture to an app | P1 | build | On a capture page, send-to-app lists connected GitHub, GitLab, Slack and webhook (connect items when none); filing works; hidden when signed out. | J-137 |
| J-139 | Integrations settings page | P1 | build, part skipped | Settings integrations: searchable grid of GitHub, GitLab, Slack webhook, webhooks, MCP agents; connect stores a token or URL per workspace. Paid-account apps on the skip list. | J-171 |
| J-140 | Tracker field forms | P1 | build, part skipped | GitHub form: repo, labels, assignee, milestone from the API, remembered last values and recents; with GitHub unreachable the capture is saved anyway with a notice. | J-139 |
| J-251 | Integrations belong to a workspace | P1 | build | Two workspaces with different GitHub tokens: switching the draft's workspace changes the destination list to that workspace's connection. | J-139, J-080 |
| J-241 | Linked tracker issue on a capture | P1 | build | A capture filed to GitHub, or with 'org/repo#12' in its text, is filterable as having a linked issue in search, MCP and CLI; a recording link with a ticket URL shows the number and links its captures. | J-137, J-150 |
| J-242 | Body of the filed tracker issue | P1 | build | The filed GitHub issue body holds title, description, console errors, failing requests, URL, time, country, device, OS, browser, viewport, speed and the capture link. | J-137 |
| J-141 | Slack and embeds | P2 | skip | Skip list. | - |
| J-142 | Webhooks | P1 | build | Add a webhook endpoint (lab echo or a local listener) in settings: create a capture; a capture.created payload with HMAC signature arrives; a failing endpoint retries and the log lists attempts. | J-171, X-02 |
| J-143 | Connect your domain for recording links | P2 | skip | Skip list. | - |
| J-144 | Help-desk flows | P2 | skip | Skip list. | - |
| J-156 | Workspace AI switch and quotas | P2 | build, part skipped | Workspace AI switch off: no ghost text, chapters or analysis for anyone. No quota (skip list). | J-172, J-083 |
| J-158 | Capture grid | P0 | build | Dashboard: three-column card grid newest first with thumbnail, creator overlay, duration pill, recording-link chip, title or fallback, relative time; foldered captures excluded. | X-01 |
| J-159 | Card hover quick actions | P1 | build | Hover a card: it lifts, shows a checkbox and a copy-link button (toast); the card is a real link. | J-158 |
| J-160 | Filters | P1 | build, part skipped | Type, source (extension, recording link, upload, CLI) and creator multi-select filters become chips with clear; state survives reload via the URL. No Fin, iOS or Mac source values (skip list). | J-158 |
| J-161 | Search palette | P0 | build | Ctrl+K on the dashboard and a capture page: palette with recent items, grouped live results, preview, arrows, Enter opens, Ctrl+C copies the link. | J-158 |
| J-228 | Palette finds members | P1 | build | Type a member's name in the palette: a members group above captures; Enter opens all captures filtered by that author with the chip set. | J-161, J-160 |
| J-162 | Folders in the sidebar | P0 | build | Sidebar lists folders alphabetically with icons; the active folder shows its count; folder URLs use a 4-character id. | X-06 |
| J-213 | Collapse the folder list | P2 | build | Click the folders heading: rows hide; click again: rows show. | J-162 |
| J-163 | Create a folder | P0 | build | Hover the heading, click plus, type, Enter: folder created with a toast and you stay on the page. | J-162 |
| J-164 | Rename and delete a folder | P1 | build | Folder three-dot: rename with a selected prefilled input; delete after confirm removes the folder and its captures. | J-163 |
| J-165 | Selection mode and bulk actions | P1 | build | Tick a card: blue selection bar with count, move and delete; move to a folder works at once; delete confirms. | J-159, J-191 |
| J-166 | Drag a card onto a folder | P2 | build | Drag a card over the sidebar: folders get dashed outlines, the hovered one solid; drop moves it. | J-162 |
| J-167 | Recording links page | P1 | build | Recording links page lists links with mosaic, name, creator, uses, folder chip, share, open-captures and delete; status, sort and creator filters; new-link popover. | X-06 |
| J-223 | Rename and retarget a recording link | P2 | build | Pencil renames a link in place; the folder chip menu retargets it (and creates a folder); the next recording lands there. | J-167 |
| J-168 | Workspace switcher | P1 | build | Workspace button opens current workspace, settings, switch or create, log out. | J-221 |
| J-169 | Onboarding checklist | P2 | build | A sidebar card shows four setup steps as links, ticks done steps, and can be dismissed. | J-158 |
| J-170 | Help menu | P2 | build, part skipped | Help button opens docs, source repo, issue tracker and extension install links. No chat launcher or pricing link (skip list). | J-158 |
| J-171 | Settings layout | P1 | build | Settings layout: back link, left nav grouped workspace (general, members), apps and tools (integrations, MCP, CLI, webhooks, SDK), account (profile, notifications). | X-06 |
| J-172 | Workspace general settings | P1 | build | General: logo upload, name, access (default link access, domain join), data (AI switch, auto-delete days, audit log); nothing is plan-gated. | J-171 |
| J-173 | Members page | P1 | build | Members: invite-link toggle with copyable link expiring in 29 days and reset, restrict-invites toggle, add members, table with name, role, last active, row menu. | J-123, J-234 |
| J-249 | Workspace lifecycle | P1 | build | A member who leaves keeps their captures in the workspace; deleting the sole member's account purges that workspace and its media from Garage. | J-225 |
| J-222 | Change a member's seat | P1 | build | Admin clicks a member's role and picks viewer, creator or admin; the auto-approve switch decides whether a viewer who creates becomes creator. | J-124, J-173 |
| J-174 | Billing and usage | P2 | skip | Skip list. | - |
| J-175 | Profile | P2 | build | Profile: avatar upload and delete, first and last name, role picker hint, locked email, delete-account button. | J-171 |
| J-178 | Enterprise admin | P2 | build, part skipped | Audit log lists create, delete, share and role changes; auto-delete deletes captures older than N days; SSO via generic OIDC (J-217). No SCIM directory sync or forced install (skip list). | J-172 |
| J-191 | Deletion | P0 | build | Delete a capture: gone from lists, search and URL (J-205), and its media URL returns 404 at once; purge job removes the Garage prefix. No export. | X-02 |
| J-225 | Delete the account | P2 | build | Profile delete: dialog lists workspaces that go and needs DELETE typed; solo workspaces are erased; in shared ones comments show as deleted account; blocked when sole admin of a shared workspace. | J-175 |
| J-203 | Empty folder | P1 | build | Open an empty folder: heading, help line and a make-a-capture button. | J-162 |
| J-204 | No filter results and no search results | P2 | build | A filter with no matches shows two centred lines; an empty palette search shows icon, heading and hint; an emptied network filter shows the striped table. | J-160, J-161 |
| J-214 | Unknown app route | P2 | build | Open http://localhost:3000/nope: illustrated not-found with a button home. | X-06 |
| J-207 | Loading states | P2 | build | Throttle to Slow 3G: dashboard skeletons, palette skeleton rows, capture page branded loader and recording links spinner each show. | J-158, J-161 |
| J-208 | Plan limit states | P2 | skip | Skip list. | - |

## auth (6: P0 1, P1 3, P2 2)

Scope: Better Auth sign-in options, workspaces, invites, extension sign-in.

| ID | Feature | Pri | Status | Check | Deps |
|---|---|---|---|---|---|
| J-123 | Invite members | P1 | build | Dashboard invite: modal with copyable invite link and email plus role (creator or viewer); invite disabled until the email is valid; Mailpit gets the email and the link joins the workspace. | X-06 |
| J-124 | Seat roles | P1 | build | Admin, creator and viewer roles enforced by the API: a viewer can view and comment but gets 403 on create; auto-upgrade to creator per workspace setting. | X-06 |
| J-125 | Join by email domain | P2 | build | Turn on domain join; a new user with the same email domain signs in and lands in the workspace as viewer; admins get an email. | J-124, J-217 |
| J-217 | Web app sign-in and sign-up | P0 | build, part skipped | http://localhost:3000/login: GitHub, Google and generic OIDC buttons (each shown when configured), work email with continue (magic link via Mailpit); sign-in from the extension uses launchWebAuthFlow. No Apple button (skip list). | X-06 |
| J-221 | Create a workspace | P1 | build | Workspace menu, switch, create: name field with a letter avatar that follows it, domain-join box ticked by default, next disabled until a name is typed; submit creates the workspace and switches to it. | X-06 |
| J-234 | Role for invite-link joins | P2 | build | Joining via the members-page invite link adds the user as creator; the email invite respects the chosen role. | J-123 |

## agent (15: P0 4, P1 10, P2 1)

Scope: MCP server, CLI, markdown share page, agent tab and prompts.

| ID | Feature | Pri | Status | Check | Deps |
|---|---|---|---|---|---|
| J-145 | Agent setup page | P0 | build | Settings, MCP page: cards for Claude Code, Cursor, Codex and VS Code plus other; each modal copies a snippet with only the server URL. | J-171, J-146 |
| J-146 | OAuth consent for agents | P0 | build | First MCP call from a client: browser consent page with workspace picker, client name, two scopes, approve; DCR and PKCE complete and tools list. | X-06 |
| J-147 | Connected agents list | P1 | build | After connecting, the MCP page lists the client; remove revokes its token and the next call gets 401. | J-146 |
| J-148 | Personal access tokens | P1 | build | Create a key with name, 30-day expiry and read-only CLI scope: shown once with a fixed prefix; a write with it is refused. | X-06 |
| J-149 | MCP read tools | P0 | build | MCP getDetails, console, network (with headers, an improvement), user events, metadata, screenshots, frames, transcript, chapters on the / recording return paged envelopes with filters. | J-146, X-02 |
| J-150 | MCP search and list tools | P1 | build | MCP search finds a capture by pasted URL and by a word from a comment or transcript; list tools return captures, folders, members. | J-149 |
| J-151 | MCP write tools | P1 | build | MCP createComment with a playback time shows on the capture page with a time chip; updateTitle, folder ops and deleteComment work as the user. | J-149 |
| J-152 | MCP tab on the capture page | P1 | build | Agent tab shows a copyable setup prompt until a client connects, then fix, summarise and E2E presets embedding the capture URL with copy buttons. | J-145, J-090 |
| J-153 | Markdown summary for plain fetches | P0 | build | curl the share URL with Accept: text/markdown or .md: front matter, signal counts, comments and pointers to MCP and CLI; HTML response carries a Link header to it. | X-03 |
| J-155 | Jam CLI and agent skills | P1 | build | Settings CLI page shows install, login (OAuth or token) and skill install; `toolbar login` then `toolbar ls` lists captures. | J-148 |
| J-244 | Agent-made annotated screenshot | P1 | build | `toolbar create --json payload.json` with an image and box, arrow, text, redact and blur marks: a screenshot capture with numbered badges and a share link. | J-155, J-051 |
| J-245 | Agent-made video with a test trace | P1 | build | `toolbar create video.mp4 --trace trace.zip`: a video capture with console, network and typing from the Playwright trace synced, passwords masked. | J-155, J-087 |
| J-246 | Record an agent-driven browser or a window | P1 | build | `toolbar record --cdp http://localhost:9300` around a Playwright run on the lab: stop returns a link with console, errors, network and screencast video; clicks through the proxy are logged. | J-155, J-245 |
| J-247 | CLI read path to local files | P1 | build | `toolbar network <url> --status 5xx` returns paged JSON with the 500 body; `toolbar frames <url> --at 5000` writes a JPG; the skill file states the read order. | J-155, J-149 |
| J-157 | Chat assistant connectors | P2 | skip | Skip list. | - |
