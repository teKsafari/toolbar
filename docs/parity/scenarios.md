# Parity scenarios (Part 1, step 3)

Scripted scenarios for the 179 P0 and P1 rows of `docs/jam/catalogue.md` (73 P0, 106 P1). Each scenario runs twice on the lab app: once with Jam, once with the replica (Nib, the working name; D-074 renames it later). Results go into `docs/parity.md`, one row per catalogue ID. Area and check for each row come from `docs/tasks.md`.

## Groups

| Group | Scope | P0 | P1 | Rows | Scenarios |
|---|---|---|---|---|---|
| G1 | Capture modes and in-page recording UI | 11 | 17 | 28 | 6 |
| G2 | Annotation, editor and submit | 15 | 15 | 30 | 4 |
| G3 | Recording contents per lab case | 11 | 7 | 18 | 5 |
| G4 | Viewer and dev tools panels | 10 | 13 | 23 | 3 |
| G5 | Sharing, permissions, comments, notifications | 3 | 10 | 13 | 3 |
| G6 | Dashboard, folders, search, recording links | 4 | 9 | 13 | 3 |
| G7 | Settings, team admin, integrations, privacy, deletion | 8 | 16 | 24 | 4 |
| G8 | Agent hand-off, shortcuts, speed, errors and empty states | 11 | 19 | 30 | 5 |
| **Total** | | **73** | **106** | **179** | **33** |

Each row belongs to exactly one group and is proved by one scenario (the "Row index" at the end). Some scenarios also gather a number for a row owned elsewhere, such as a timing; the index lists those under "Also measured in".

## Jam budget: seven new captures

A Jam draft discarded before create never leaves the machine (J-189), so screenshot and replay drafts cost Jam's service nothing and do not count. A tab or desktop recording uploads while it runs (J-087), so every recording started on Jam counts, even when it is later discarded.

| Capture | Kind | Made in | Reused by | After the run |
|---|---|---|---|---|
| N1 | Tab recording of every lab case, started and stopped by chord (about 2.5 min) | S3.1 | S4.1, S5.1, S5.2, S7.4, S8.1, S8.3, S8.4 | keep |
| N2 | Tab recording that exercises the recording bar, started from the popup | S1.2, finished in S2.4 | S8.4 | keep |
| N3 | Desktop recording across two tabs | S1.3 | S8.4 | keep; set the record chevron back to tab |
| N4 | Visible screenshot with every annotation tool, after pre-roll actions | S2.1 | S3.3, S4.2, S5.2, S6.2 | keep |
| N5 | Area screenshot with the full viewport kept | S2.2 | S4.2, S6.2 | keep |
| N6 | Recording-link submission from a signed-out second browser | S6.3 | S8.5 | keep |
| N7 | Screenshot of `/form` taken with user-event capture off | S7.2 | S7.4 (deleted there), S8.5 | deleted |

Seven new captures, under the limit of ten. Two spares cover a broken draft (J-034) or a reused capture that no longer exists. Nib has no budget: make as many captures as a check needs.

Existing Jam captures that are reused instead of made again. They were made on 2026-10-13 with extension 5.90.0, and the lab has not changed since (`git log -- lab/src` shows one commit). Their links and our notes on them sit in `research/jam-private/notes/`; this file names them by note only, so no Jam URL enters git. Before reusing one, open it in the Jam dashboard (folder `toolbar-annot-test`). If it is gone, make it again and count it against the spares.

| Ref | What it is | Note file | Used by |
|---|---|---|---|
| E1 | Tab recording of `/` buttons, `/form` and `/list`, 1:30 | `capture-lab.md` (rec1) | S3.1 cross-check |
| E2 | Tab recording of `/canvas`, `/live` WebSocket and SSE, 0:54 | `capture-lab.md` (rec2) | S3.2 |
| E3 | Tab recording of `/slow` and `/slow-raw`, 0:55 | `capture-lab.md` (rec3) | S3.2 |
| E4 | Visible screenshot taken 20 s after a series of actions | `capture-lab.md` | S3.3 cross-check |
| E5 | Instant replay capture | `flows-speed.md` ("State left behind") | S4.3 |
| E6 | Tab video with an owner comment at 0:29 | `flows-speed.md` | S5.2 cross-check |
| E7 | Area screenshot with the full viewport kept | `review-r1.md` | S4.2 cross-check |
| E8 | Tab recording that ran into the free-plan cap | `popup-capture.md` | S1.6 |
| E9 | Desktop recording | `popup-capture.md` | S1.3 cross-check |
| E10 | Recording-link submission | `popup-capture.md` | S6.3 cross-check |

## Before the first run

### Lab additions

Three rows need lab behavior that does not exist yet. Add it to `lab/src/routes/+page.svelte`, list it in `lab/README.md`, restart `toolbar-lab`, and do this before N1 so Jam and Nib see the same page.

| Ref | Addition | Rows |
|---|---|---|
| L-1 | A "Load cart (GraphQL)" button (`data-testid="graphql"`) that POSTs `{"operationName":"GetCart","query":"query GetCart { cart { id } }"}` to a new `/api/graphql` route, which answers 200 with `{"data":null,"errors":[{"message":"Cart not found"}]}` | J-064 |
| L-2 | A "Call with auth" button (`data-testid="auth"`) that sets `document.cookie = "lab_session=cookie-secret-value"` and fetches `/api/ok?q=auth` with `Authorization: Bearer header-secret-value` and `X-Api-Key: apikey-secret` | J-059, J-185, J-107 |
| L-3 | A "Set metadata" button (`data-testid="metadata"`) that calls `window.toolbar?.setMetadata?.(() => ({ plan: 'parity', seats: 3 }))` and logs whether the SDK was present | J-073 (Nib side) |

The Jam side of J-073 stops at its setup modal: installing Jam's SDK package would put Jam's JavaScript in the lab, which the clean-room rules forbid.

### Rigs

| | Jam rig | Nib rig |
|---|---|---|
| Browser | The shared Chromium on display `:99`, signed in to the owner's Jam account, extension pinned | Playwright 1.63.0 Chromium, persistent profile, release build `apps/extension/.output/chrome-mv3` (closed shadow root), action pinned, on a private Xvfb display such as `:120` with openbox, as in `e2e/flows/fixture.ts` |
| Page actions | `playwright` or `chrome-devtools` MCP tools | Playwright from a script, or the same MCP tools pointed at the Nib browser's CDP port |
| Icon, popup, chords, share picker, address bar | `scripts/xdrive/` (real X input, D-006); one agent on `:99` at a time | xdotool on the private display, the way `e2e/flows` does it |
| Server | jam.dev | compose stack on http://localhost:3000 (`docker compose up -d` if `curl -s localhost:3000/api/health` fails), account `parity@example.com` with workspace "Parity" |
| Mail | none | Mailpit, http://localhost:8025 |

Size both browser windows so the page viewport is 1440x900 (`resize_page`, or `browser_resize`). For a 390 px shot, emulate a 390x844 viewport on the web page only.

Nib extras for scenarios that need them: `MAX_RECORDING_MIN=1` (S1.6), `AI_PROVIDER=openai-compatible` with `AI_BASE_URL` pointing at a local stand-in such as the one in `apps/server/test/gates.int.test.ts` (S2.4), a speech WAV through `--use-file-for-fake-audio-capture` in a browser started as in the J-014/J-211 test of `e2e/tests/capture/video.spec.ts` (S1.6, S3.5), and the GitHub, Slack and webhook stand-ins of `e2e/fixtures/net.ts` (S7.3). Restart the server after changing an environment variable, and put the default back when the scenario ends.

### Machine rules

- The VM has 4 CPUs and 8 GB of RAM. Run `free -m` before starting a second browser; "available" must stay above 800 MB (10 percent). Close one rig's browser before you start the other's if it would not.
- Run `cat /proc/loadavg` right before each timed step and write the 1-minute value next to the timing, as `2.4 s (load 1.9)`. A timing taken at a load above 6 does not count: wait for the load to drop (up to 5 minutes), then take it again. If it never drops, keep the number and mark it `unreliable`.
- Run the Jam and Nib halves of a timed step one after the other, never at the same time, and do not run builds or e2e suites while timing.

### Clean room

- Use Jam only through its UI, its MCP server and its share links, as any user can. Never open Jam's extension files or bundles, and never read its network traffic: no DevTools network panel, HAR, `list_network_requests` or `get_network_request` on a page where Jam's UI or Jam's site is loaded. Counts of Jam's captured data come from Jam's own viewer and its MCP answers.
- Jam screenshots, screen recordings and raw MCP output go only to `research/jam-private/parity/<scenario>/` (git-ignored). Nothing else in git may hold Jam's text: describe what you saw in your own words.
- Do not create Jam accounts or workspaces, do not send Jam invites, and do not connect Jam integrations. Where a scenario stops short on Jam for these reasons it says so, and the Jam column of `docs/parity.md` records the catalogue observation or the public doc instead.

## How to measure

- **Steps** are the numbered steps of a scenario. **Clicks** count pointer clicks and drags in the product's own UI; key chords are counted apart; typing is not counted (the catalogue's rule).
- **Timings**: record the display with `ffmpeg -f x11grab -framerate 10 -i :<display>` during the timed step, then read the frame of the input and the first frame that shows the result. Precision is 0.1 s. Take the same timing three times where the step costs Jam nothing (popup, drafts, replay), once where it needs a new Jam capture, and give the median.
- **Counts**: entries per lab case from each product's viewer, with the panel's filters cleared. For Nib, also check the number against `GET /api/v1/recordings/<id>/events`. Write them into the S3.1 count table.
- **Screenshots**: web pages (dashboard, capture page, share page, settings, sign-in, consent, recorder page) at 1440 and 390 px wide, in light and dark. Dark comes from emulating `prefers-color-scheme: dark`; when Jam ignores it, note "Jam: no dark theme" and judge Nib's dark shot on its own (no sideways overflow, text readable). The extension popup and the in-page UI (cursor pill, countdown, recording bar, editor, toasts) are shot at 1440 only, in the browser's default theme; the popup lives outside the page, so take it from the display (`scripts/xdrive/shot.sh`, or `import -window root` on the Nib display) and crop. View every pair at 1x.
- **File names**: `<scenario>-<step>-<jam|nib>-<1440|390>-<light|dark>.png`. Jam files go to `research/jam-private/parity/<scenario>/`, Nib files to `docs/parity/evidence/<scenario>/`, with a `notes.md` beside them holding counts, clicks and timings.

## How to judge a row

- **Capture**: match when Nib holds every entry Jam holds for the same lab case. Extra entries that `docs/tasks.md` lists as "Better" make it better. Entries Jam never captures do not count against Nib.
- **Flow**: the same number of steps and clicks or fewer, and the same or a shorter median time. A difference under 0.2 s is within the frame resolution and counts as the same.
- **Ergonomics**: the same position on screen, sizes within 10 percent, the same density and the same feedback after each action. Brand, colours, icons and words differ on purpose (D-019) and are not judged.
- **Result**: `match`, `better` or `gap`. A row with no observation on Jam (public doc only, `docs/jam/untested.md`) is judged against the catalogue's description; put "doc" in its Jam evidence.

## G1. Capture modes and in-page recording UI

Rows: J-001, J-002, J-003, J-006, J-007, J-008, J-009, J-010, J-013, J-014, J-015, J-025, J-026, J-027, J-028, J-029, J-030, J-031, J-032, J-033, J-034, J-035, J-210, J-211, J-218, J-238, J-239, J-250

### S1.1 Popup, screenshot mode and the swallowed click

Jam capture: none (drafts are discarded). Proves J-001, J-002, J-003, J-025, J-250, J-026, J-210.

1. Load http://localhost:5173/ fresh. In the page, add counters: `window.__pd = 0; window.__cl = 0; document.addEventListener('pointerdown', () => __pd++, true); document.addEventListener('click', () => __cl++, true);`.
2. Click the pinned extension icon. Shoot the popup when its content is complete. Note the rows shown and the header icons (J-001).
3. Open the record row's chevron. Shoot it and list every option: no camera entry may appear (J-210). Close it with Escape.
4. Click the screenshot row. Move the pointer to (700, 400) and shoot the cursor pill; measure its offset from the pointer in pixels and check that the page is not dimmed (J-025).
5. Click on the Save (works) button. The editor opens (J-002). Read `__pd`, `__cl` and the "saved N times" text: all three unchanged (J-250). Shoot the editor and check that the preview is the full viewport at 1x.
6. Close the editor with its close button (screenshot draft, discards at once).
7. Arm screenshot mode from the popup again, press Escape: the pill disappears (J-026).
8. Arm it once more, click the icon: the screenshot row is now an exit row and the other rows are greyed. Shoot it, click the exit row (J-026).
9. Arm screenshot mode, press at (200, 150) and drag to (800, 450) without releasing; shoot the rectangle and its live size readout. Release. The editor opens with a 600x300 crop (J-003). Discard the draft.

Evidence: popup shot, chevron shot, cursor pill shot with its offset, editor shot, the counter values before and after step 5, area drag shot, crop size in pixels, clicks per step (J-002: 3; J-003: one drag after arming).

### S1.2 Tab recording with the recording bar (N2)

Jam capture: NEW N2. Proves J-006, J-027, J-028, J-238, J-029, J-030, J-031, J-032, J-033, J-239, J-034, J-035, J-218. Also measures J-195, J-196 and the bar half of J-200. The draft goes on to S2.4, which creates it.

1. Load `/`. Click the icon, click the record row (2 clicks, J-006). Shoot the veil while it reads 2 (J-027). Note the time from the record-row click to the first live frame of the timer.
2. Once live, shoot the bar. Measure its box (about 295x40 at bottom centre) and list its controls (J-028). Hover the mic control and shoot its state and tooltip: no microphone on this machine (J-200, bar half).
3. Shoot the browser toolbar from the display: the action icon has changed into its recording state, and Chrome shows its own capture indicator on the tab (J-033).
4. Click Submit order (hidden 500). This is the event that S2.4 trims away.
5. Wait 10 s. Press on the bar's timer and drag the bar to the middle of the page. Shoot it. The timer keeps counting (J-238).
6. Click pause, wait 5 s by the wall clock, click resume. Shoot both states (J-029).
7. Click the pen. Shoot the colour row. Draw two strokes over the button row. Note how long each stroke stays (J-030). Click done.
8. Click blur. Hover the "Cross-origin image" card (shoot the outline), click it to blur, click again to unblur, click it once more, then undo, then click it again and click done (J-031). Note whether the timer stops while blur is active.
9. Click Show profile (throws) and Log at every level.
10. Click the "Form" link in the lab header (SPA change). The bar and timer stay (J-032).
11. Reload with Ctrl+R. Shoot the gap while the document loads and the bar coming back with the timer still counting (J-032).
12. Wait until the timer reads at least 1:00. Click the action icon: shoot the popup (screenshot row greyed, record row turned into stop, recording-link row active), then click the stop row (J-239).
13. Time stop to editor (J-196). Shoot the processing state on the bar. When the editor opens, check that the length label is above 0 and that play moves the video (J-034). If it reads 0 seconds, write it down, discard, and use a spare capture to run this scenario again.
14. Click the icon: shoot the unfinished-draft pill and the disabled capture rows (J-035).
15. Restart the extension from the popup's three-dot menu; the editor closes. Click the icon again: the pill now opens the Drafts list (J-218). Shoot it. Leave the draft in the list for S2.4.

Evidence: shots of steps 1 to 3, 5 to 8, 11, 12, 14 and 15; key-to-live and stop-to-editor timings with load; whether the draft opened healthy; the bar's measured box and position; stroke fade time; click count per step. After S2.4 creates the capture, check in its video: the bar is at its dragged spot from step 5 on, the blurred card is blurred in the frames after step 8, and the video is about 5 s shorter than the wall time (J-029, J-031, J-238).

### S1.3 Desktop recording across tabs (N3)

Jam capture: NEW N3. Proves J-007, J-008. Also J-210 (desktop chevron) and J-033 (sharing strip), and one more stop-to-editor timing (J-196). E9 is a cross-check of the viewer.

1. Open `/` on :5173 in tab A and `/` on :5174 in tab B. Go to tab A.
2. Click the icon, open the record chevron, switch the area to desktop (shoot the chevron), click the record row (J-007; 5 clicks the first time).
3. In Chrome's picker, choose the entire screen and click Share. Recording starts with no countdown. Shoot Chrome's sharing strip (J-033).
4. In tab A click Submit order. Switch to tab B. The bar shows there and the timer keeps going (J-008). Shoot it.
5. In tab B click Save (works) and Log at every level.
6. Stop with the bar in tab B. Time stop to editor. The editor opens in tab B (J-008).
7. Create with the create button. On the capture, count console rows and network requests per tab and check that the video shows browser chrome.
8. Click the icon: the record row still offers desktop (sticky). Switch it back to tab so later scenarios start from the default.

Evidence: chevron shot, picker step count, timings, the per-tab counts, capture-page shots at 1440 and 390, light and dark.

### S1.4 Instant replay

Jam capture: none (the replay draft is discarded; S4.3 reuses E5 for the viewer). Proves J-009, J-010. Also checks J-189 for the replay buffer.

1. Popup three-dot menu, settings, turn instant replay on (count the clicks; this is one-time setup). Close the popup.
2. Reload `/`. Click Submit order and Show profile, wait 10 s.
3. Click the icon, click the rewind row. Time it to the editor. The draft shows a DOM replay with a pointer glyph, trimmed by default to the last 30 s, with markers for the 500 and the error (J-009). Shoot it. Discard it.
4. Reload `/`. Click Save (works) every 10 s for 150 s. Trigger the replay again. Its full span (handles dragged fully out) is at most 120 s and above 0 (J-010). Discard it.
5. Before and after steps 3 and 4, check that no new capture appears in the dashboard (Jam) or in `GET /api/v1/recordings` (Nib) (J-189).
6. Turn instant replay off again on Jam (the owner's setting stays as it was).

Evidence: settings click count, replay draft shot, its span in seconds, capture counts before and after.

### S1.5 Recording link from the popup

Jam capture: none (a link is made, no capture). Proves J-015. S6.3 uses the link.

1. Click the icon, click the recording-link row. Shoot the form.
2. Type the name "parity link", keep the default recorder domain, pick the folder "parity" (made in S6.2; run S6.2 first or pick no folder), click create.
3. The short link is on the clipboard at once and shown with a copy button. Read the clipboard (`xclip -o -selection clipboard`) and time create to clipboard.

Evidence: form shot, clicks (2 to 4), the clipboard value (Nib only; for Jam write "copied" without the link), time.

### S1.6 Microphone and the recording cap

Jam capture: none new (the cap uses E8 and its notes). Proves J-014, J-013, J-211.

1. Jam: click the icon, click the mic pill in the record row. Shoot the permission tab that opens and closes with no device here; the pill stays off (J-014). Nib: the same click on a machine with no device must end the same way.
2. Nib only, in the fake-microphone browser: click the mic pill, grant once, start a tab recording, mute and unmute from the bar, switch to the second fake microphone, stop. The voice stream has silence for the muted span and continues after the switch (J-211; Jam: public doc only).
3. Nib only, with `MAX_RECORDING_MIN=1`: start a recording and wait. Shoot the timer when it changes colour and again before the cap. The recording stops at 1:00 and opens the draft (J-013). Jam: compare against E8 and the cap screenshots in `research/jam-private/` (timer colour steps near the cap). The upsell card is on the skip list.

Evidence: permission tab shots, voice stream check (Nib), timer shots (Nib) next to Jam's E8 shots.

## G2. Annotation, editor and submit

Rows: J-004, J-037, J-038, J-039, J-040, J-041, J-042, J-043, J-044, J-045, J-046, J-047, J-048, J-049, J-051, J-077, J-079, J-080, J-081, J-083, J-084, J-085, J-086, J-087, J-088, J-219, J-220, J-227, J-230, J-240

### S2.1 Annotated screenshot to a link (N4)

Jam capture: NEW N4. Proves J-037, J-038, J-039, J-040, J-041, J-042, J-043, J-044, J-045, J-046, J-047, J-048, J-049, J-051, J-077, J-079, J-080, J-081, J-220, and J-086 for screenshots. Steps 1 and 2 are the pre-roll of S3.3 (J-071); step 22 measures J-197 and J-202.

1. Load `/`. Click Submit order, then Log at every level.
2. Wait 20 s by the wall clock.
3. Arm screenshot mode from the popup and click the page. Time click to editor. Shoot the editor; measure the modal box and the 70/30 split (J-037). Check that the caret sits in the title field (J-077).
4. Drag a stroke on the preview: the pen is active from the start, and the stroke is smoothed and tapered (J-038).
5. Pick the rectangle, drag a box around the status line. The tool falls back to select with the box selected (J-039).
6. Pick the ellipse, drag a wide box around the Save button: an ellipse, not a circle (J-040).
7. Pick the arrow, drag from the Submit order button to the status line. Drag its middle handle sideways: the arrow bends (J-041).
8. Pick the line, drag a straight stroke under the console card (J-042).
9. Press T, click above the modal card, type "500 here", click elsewhere. Double-click the label: its text is selected for editing; press Escape (J-043).
10. Pick blur, drag a box over the status text, then drag the box 100 px right: the old spot is sharp again (J-044).
11. Select the rectangle, open the colour dot, pick red: the rectangle turns red and the next shape will be red (J-045). Shoot the palette.
12. Press V. Click the rectangle's outline, move it by 40 px, resize it from a corner, rotate it from just outside a corner. Do the same resize on the text label: its font scales (J-046).
13. Drag a marquee over empty space that touches the ellipse and the line: both are selected (J-047).
14. Press Delete: both go. Press Ctrl+Z once: both come back (J-048).
15. Click undo three times and redo three times with the buttons; check that each button greys when its stack is empty (J-049).
16. Type the title "parity S2.1 annotated" and a second line "pre-roll check".
17. Open the destination menu and shoot it (J-079). Leave it on the share link.
18. Open the workspace menu and shoot it (J-080). Jam has one workspace in this account, so on Jam the menu holds one entry; Nib runs this step with a second workspace and picks "Parity".
19. Open the folder button, pick "parity" (made in S6.2) and shoot the chip (J-081).
20. With the caret in the description, press Ctrl+Enter (J-220).
21. Shoot the toast; time Ctrl+Enter to the link on the clipboard and to the background tab (J-086, J-197). Check the new tab sits right of the source tab.
22. Note whether Chrome asks the page for clipboard access (J-202).
23. Open the capture: the marks are burned into one image and nothing is editable (J-051). Shoot it at 1440 and 390, light and dark.
24. Start a fresh screenshot draft: the folder picker shows "parity" again (J-081). Discard it.

Evidence: one shot per tool step, the modal box size, click counts per tool (catalogue: pen 0, shapes 2, text 2 plus typing, palette 2), timings with load, clipboard and tab position.

### S2.2 Area screenshot with the full viewport kept (N5)

Jam capture: NEW N5. Proves J-004. S4.2 uses the capture for J-209; S8.4 times area capture to editor.

1. Load `/`, arm screenshot mode, drag a box over the button row.
2. The draft shows a small full-viewport thumbnail with a ticked box. Shoot it (J-004).
3. Untick and tick the box again (the untick path is checked on Nib by a second capture with the box unticked; on Jam it is observed in the draft only).
4. Title it "parity S2.2 area", create with the button.

Evidence: draft shot, created capture with both images (S4.2).

### S2.3 Discard a screenshot draft

Jam capture: none. Proves J-088.

1. Arm screenshot mode, click the page, draw one rectangle.
2. Click the close button: the draft goes at once, with no confirmation.
3. Take another screenshot. Press Escape once: a toast asks for a second press. Shoot it. Wait 2 s: the draft stays.
4. Press Escape twice within 0.5 s: the draft goes.
5. Click the icon: no draft pill.

Evidence: toast shot, clicks and keys, the popup after discard.

### S2.4 Video draft: preview, trim, AI text, save for later, create (N2 continued)

Jam capture: N2 from S1.2 (no new capture). Proves J-240, J-084, J-085, J-083, J-230, J-219, J-087, J-227. Also measures J-086 for video and checks J-189 before create.

1. Click the icon, the draft pill, then view on the N2 draft. The editor reopens with the video.
2. Check that no annotation tool pill appears, only play and trim (J-240).
3. Click play: playback starts at the left trim handle. Click the video: it pauses. Click the bar halfway: it seeks. Read the length spelled out under the bar (J-084).
4. Nib only: run this step with the AI stand-in on. Turn the AI switch on if it is off. Within 6 s grey ghost text shows a title, a summary, steps with time links and a result. Shoot it. Jam: the same on its own AI (J-083).
5. Click inside the ghost title at its third word: the ghost becomes real text and the caret lands where you clicked (J-230). Press Ctrl+Z to restore the ghost if the product allows; note what happens.
6. Click the close button, which on a reopened video draft saves for later. Shoot the toast with its view button (J-219). Click the icon: the pill shows and the capture rows are enabled.
7. While the draft sits saved, check that N2 is not listed in the dashboard (Jam) or in `GET /api/v1/recordings` (Nib) (J-189).
8. Reopen the draft from the pill. Drag the left trim handle to just after the Submit order click of S1.2 step 4. The cut part greys and the length updates (J-085). Press Ctrl+Z (handle returns), Ctrl+Shift+Z (handle comes back), and note what each does.
9. Title it "parity S1.2 bar", press Ctrl+Enter. Time Ctrl+Enter to the link on the clipboard (J-087, J-086, J-197).
10. Open the capture at once: shoot the processing notice while the trim runs, and time it to playable (J-087).
11. When it plays, compare the stored length with the draft's label, and check that the 500 from step 4 of S1.2 is gone from console, network and markers (J-227). Then make the S1.2 video checks (bar position, blur, pause).

Evidence: editor shots of steps 2 to 6 and 8, AI ghost timing, trim lengths, create-to-link time, processing time, the three counts (console, network, user events) on the trimmed capture.

## G3. Recording contents per lab case

Rows: J-054, J-055, J-056, J-057, J-058, J-059, J-060, J-061, J-062, J-064, J-067, J-068, J-069, J-070, J-071, J-073, J-074, J-248

### S3.1 Every lab case in one tab recording (N1)

Jam capture: NEW N1. Proves J-054, J-055, J-056, J-057, J-058, J-248, J-059, J-060, J-061, J-064, J-067, J-068, J-069, J-070. Steps 3 and 19 also prove J-181 for S8.3, and the recording gives one key-to-live and one stop-to-editor timing. Needs L-1 and L-2. Wait 3 s between steps so each case owns its own stretch of the timeline.

1. Load `/` fresh and wait 5 s.
2. Check the lab is idle: status reads idle, saved 0 times.
3. Press Ctrl+Shift+Space. Time the chord to the first live frame (J-195).
4. Click Save (works).
5. Click Export (does nothing).
6. Click Sync (never returns).
7. Click Submit order (hidden 500).
8. Click Show profile (throws).
9. Click Refresh (unhandled rejection).
10. Click Log at every level.
11. Click Open modal, then Delete in the modal.
12. Click the button inside the iframe.
13. Click Load cart (GraphQL) (L-1).
14. Click Call with auth (L-2).
15. Press Ctrl+R (full load; the :5174 image loads inside the capture).
16. Click the Form link in the lab header (SPA change). Type "Ada Lovelace" in Name, "ada@example.com" in Email, "hunter2hunter2" in Password, "token sk_live_51Hparity0000 card 4242 4242 4242 4242" in Notes. Click Create account.
17. Click the Long list link. Click row 3. Scroll to the bottom with the wheel.
18. Press Ctrl+L, type `localhost:5173/canvas`, press Enter (typed navigation). Click Redraw once.
19. Press Ctrl+Shift+Space. Time it to the editor (J-196). Title it "parity S3.1 lab" and click create.

Fill one count table per product from its viewer, filters cleared, plus the API for Nib. "Lab truth" is what the page does.

| Step | Case | Lab truth: console | Lab truth: network | Lab truth: user events | Jam c / n / u | Nib c / n / u | Notes |
|---|---|---|---|---|---|---|---|
| 4 | Save | 0 | GET /api/ok?q=works 200, JSON body | 1 click | | | |
| 5 | Export | 0 | 0 | 1 click | | | |
| 6 | Sync | 0 | GET /api/hang, never answers | 1 click | | | pending shown how |
| 7 | Submit order | 0 from the page | POST /api/fail 500, JSON request and response bodies | 1 click | | | marker badge |
| 8 | Show profile | 1 log, 1 uncaught TypeError | 0 | 1 click | | | stack shown |
| 9 | Refresh | 1 unhandled rejection | 0 | 1 click | | | Jam missed it (Nib better if kept) |
| 10 | Log at every level | 15 calls: log, info, warn, error, debug, table, group, log inside, groupEnd, trace, assert, count twice, time, timeEnd | 0 | 1 click | | | rows per level |
| 11 | Modal | 1 warn | 0 | 2 clicks | | | |
| 12 | Iframe button | 1 log inside the iframe | GET /api/ok?q=iframe | 1 click inside the iframe | | | frame id |
| 13 | GraphQL | 0 | POST /api/graphql 200 with errors | 1 click | | | counted as failed, operation name |
| 14 | Auth | 0 | GET /api/ok?q=auth with Authorization, X-Api-Key, Cookie | 1 click | | | header masking (S7.4) |
| 15 | Reload | 0 | document, scripts, styles, badge.svg from :5174, iframe document and its fetches | 0 | | | nav row cause reload, tab-hidden row |
| 16 | Form | 0 | route data, POST /form | clicks per field, 4 typing rows, 1 submit click | | | masking (S7.4) |
| 17 | List | 0 | route data | 2 clicks, scroll | | | SPA nav row |
| 18 | Canvas | 0 | document and assets | 1 click | | | nav row cause typed |
| all | Extension's own requests | 0 | 0 | 0 | | | must be 0 for Nib (J-248) |

Then, on each capture:

- Console tab: rows per level, the icon and colour per level, objects as one-line JSON, every row expandable to its call-site stack with links (J-055, J-056); the TypeError row with class, message and stack, and its marker (J-057).
- Network tab: the columns method, status, domain, type, frame, size, time, waterfall (J-058); the Sync row's status and time (J-061); the GraphQL row's operation name and failure state (J-064); no request owned by the extension (J-248).
- Request detail for Save and for the auth call: general, response and request header groups complete (J-059). Detail for Submit order: both JSON bodies with line numbers, folding, pretty-print, copy; the document and image rows have no body (J-060).
- Actions: the Save click shows a pseudo tag with its test id behind an expand chip (J-067); one typing row per field (J-068); navigation rows naming history, reload and typed, with a tab-hidden row before each full load (J-069).
- Info tab: start URL, creation time, country, OS, browser and version, viewport, network speed bucket and latency (J-070).
- Player: the quality menu lists original, auto and 720p down to 240p; the download is a WebM of the viewport only (J-054).

Evidence: both count tables, shots of each tab at 1440 and 390 in light and dark, chord timings with load. E1 is a cross-check for steps 4 to 17 (it predates L-1 and L-2).

### S3.2 Sockets, streams and slow pages

Jam capture: none new. Reuses E2 and E3. Proves J-062.

1. Read the step order of rec2 and rec3 in `research/jam-private/notes/capture-lab.md`.
2. Nib: make two tab recordings that repeat those steps on `/canvas`, `/live` and `/slow`, `/slow-raw`, with the same waits. Connect the WebSocket after the recording starts.
3. Open the WebSocket row in each product: a 101 row whose socket sub-tab lists every frame with direction, data, length and time, a regex filter, a direction filter and a pretty-printed pane (J-062). Count the frames: E2 held 16.
4. Record what each product shows for the SSE row and the slow pages (P2 rows, noted only).

Evidence: frame counts, socket sub-tab shots at 1440 (web page, so also 390, light and dark).

### S3.3 Logs from before a screenshot

Jam capture: N4 from S2.1 (its steps 1 and 2 are the pre-roll). Proves J-071. Also checks J-057 on a screenshot.

1. Open N4 on each product.
2. Console and network hold the 500 and the error rows from before the shot, ending with a screenshot-taken row (J-071).
3. Note how far back the first row reaches against the previous capture's end; E4 is the Jam cross-check.

Evidence: console and network counts, the time of the first row.

### S3.4 Custom metadata

Jam capture: none (N1's info tab). Proves J-073.

1. Jam: on N1's info tab, open the custom-logs setup and count the clicks through its two steps. Shoot each step. Do not install the SDK (clean room).
2. Nib: load `/`, click Set metadata (L-3), take a screenshot capture. The info tab's custom logs row shows `{"plan":"parity","seats":3}`. Then call `setMetadata` with an object over 10 KB: it is refused.
3. Nib: open the same setup path from the info tab and count its clicks.

Evidence: setup shots and clicks for both; the Nib info row.

### S3.5 Voice transcript

Jam capture: none (no microphone on this machine; Jam's row is public doc). Proves J-074.

1. Nib only, in the fake-microphone browser: record 30 s of `/` with narration on, create.
2. Within 2 minutes the capture shows a timestamped transcript.
3. Record again with the microphone off: no transcribe job runs (`GET /api/v1/recordings/<id>/transcript` returns none).

Evidence: transcript shot, time to transcript with load.

## G4. Viewer and dev tools panels

Rows: J-072, J-090, J-091, J-092, J-093, J-095, J-097, J-098, J-099, J-100, J-101, J-102, J-103, J-104, J-105, J-106, J-107, J-108, J-110, J-112, J-209, J-229, J-243

Run these as a signed-in member at 1440x900. Shoot every page state named below at 1440 and 390, light and dark.

### S4.1 Video capture page (N1)

Jam capture: N1. Proves J-090, J-091, J-092, J-093, J-072, J-095, J-097, J-098, J-101, J-102, J-103, J-104, J-105, J-106, J-243, J-107, J-108, J-110, J-112.

1. Open N1. Shoot the page. Measure the right panel's share of the width (about 38 percent), list its tabs, drag the splitter 100 px (J-090).
2. Click the panel toggle: the panel hides and the left column centres. Click it again (J-091).
3. Hover the player: list every control. Set speed to 1.5x, reload, check that 1.5x is kept. Open the quality menu. Play to the end: the replay prompt shows (J-092).
4. With the player focused press k, Space, m, f (then Escape), i (then close picture-in-picture), Right, Left, and 5. Note what each does (J-093).
5. Check the markers above the seek bar: the 500, the TypeError, the failed GraphQL call. The 500 badge shows the status (J-072).
6. Hover the 500 marker: a pill with the count and the error text from the body. Click it: the console tab opens at that row (J-095).
7. Pause at about 12 s and click the share-at-time pill. Open the copied URL in a new tab: the player starts at that second (J-097).
8. Click download: a WebM file and a toast (J-098). Note the file size.
9. Open the info tab: the J-070 fields, a custom logs row with its setup button, and the timestamp menu with the capture's zone, your zone and UTC (J-101).
10. Open the console tab. Type "profile" in the filter; clear it. Pick only errors in the level menu; clear it. Toggle each kind chip (J-102).
11. Hover a console row: a play triangle in the gutter. Click it: the video seeks and the composer arms a timed comment. Click the row body: it expands. Hover the time: wall-clock time with milliseconds (J-103).
12. Play from 0:00 for 20 s with the console tab open, then with the network tab open: the list scrolls to the current row, marked with a triangle and a left bar (J-104).
13. Open the network tab. Try each type chip, the errors-only box, sorting by status and by time, and the text filter "api" (J-105).
14. Click the Submit order row: the list collapses to two columns and the detail pane shows headers, request and response sub-tabs and a status dot (J-106).
15. Open the response sub-tab, press Down three times and Up once: the selection moves and the pane stays on response (J-243).
16. Click copy as cURL on Submit order. Run the copied command against the lab: it returns the 500. Check the cookie is a placeholder (J-107).
17. Open the actions tab: user events and navigations only, no filter bar; expand an attribute chip (J-108).
18. Click the title, type " edited", press Enter: saved, and the browser tab title follows. Click the description, add a line, click outside: saved (J-110).
19. Shoot the header and open each of its controls: home, folder chip, three-dot menu, send-to-app split, copy-link split (J-112). Close each without acting.

Evidence: shots per step, click counts for steps 2, 6, 7, 14 and 16, the speed kept after reload, the curl result.

### S4.2 Screenshot captures (N4, N5)

Jam capture: N4 and N5. Proves J-099, J-209.

1. Open N4. Shoot the media card. Click the image: a lightbox opens. Close it with Escape, open it again, close it with a click outside (J-099).
2. Open N5. Two thumbnails sit under the image, crop first and selected. Click the second: the full viewport shows. Click the first again (J-209). E7 is the Jam cross-check.

Evidence: shots of both captures, the lightbox and both switcher states.

### S4.3 Replay capture

Jam capture: none new (E5). Proves J-100, J-229.

1. Nib: with instant replay on, click Submit order and Show profile on `/`, trigger a replay, create it.
2. Open the replay capture on each product (E5 on Jam). Shoot the loading card with its progress bar, then the replay with its pointer glyph (J-100).
3. List the replay bar's controls: play, back and forward 5 s, time, speed, fullscreen; no download, share-at-time, mute, quality or chapters. Check that error markers sit over its seek bar (J-229).

Evidence: loading and playing shots, time from open to first frame, the control list.

## G5. Sharing, permissions, comments and notifications

Rows: J-117, J-118, J-119, J-121, J-122, J-123, J-124, J-127, J-128, J-131, J-134, J-135, J-136

### S5.1 Share links and the logged-out viewer (N1)

Jam capture: N1. Proves J-117, J-118, J-119, J-121. Also measures J-198 for S8.4.

1. On N1, click copy link in the header: the label shows a tick for about 2 s, a toast confirms, and the clipboard holds the link (J-117).
2. Click the caret beside copy. Shoot the popover. Click the content-only card and open that link: media, title, description and comments, no dev tools (J-118).
3. In the same popover, open the general-access control and shoot the choices (J-119). Jam: members-only is a paid choice here, so shoot it and leave it. Nib: set members-only, open the link in a signed-out context (sign-in page), set it back to anyone.
4. Open the full link in a signed-out browser context. Time first contentful paint and load, three times (J-198). Shoot the page.
5. Signed out, check: every dev tools tab opens, copy as cURL works, share-at-time works, download works, the header shows only sign-in and sign-up, and the title cannot be edited (J-121).

Evidence: popover shots, the signed-out page at 1440 and 390 in light and dark, load timings with load average.

### S5.2 Comments and notifications

Jam capture: N1 and N4. Proves J-127, J-128, J-131, J-134, J-135, J-136.

1. On N1 seek to 0:05. Click the composer: the send button names 0:05. Type two lines with Enter between them, send with Ctrl+Enter. Time the composer clearing (J-127).
2. A bubble sits above the seek bar at 0:05; hover it for author and text. Click the comment's time chip: the player seeks, the page scrolls up and the comment is highlighted (J-128). E6 holds an older timed comment on Jam for a cross-check.
3. Hover your comment, open its menu, edit it, save: an edited label shows. Open the menu again, delete, shoot the warning, confirm (J-131).
4. On N4, signed out, post "anonymous parity note". It shows as anonymous with a letter avatar. Signed in as the owner, check that no delete is offered (J-134). This leaves one comment on N4 that nobody can remove, which is Jam's own behavior.
5. Type @ in a comment, in the viewer description and in a fresh draft's description (J-135). Jam: the workspace has one member, so record whether a picker opens. Nib: with a second member, pick them and check Mailpit for the mention mail.
6. Open account settings, notifications. Shoot the toggles. Turn one off and on again: it saves with no toast (J-136). Nib: with "first view" off, a first view of a new capture sends no mail; with it on, Mailpit gets one.

Evidence: comment shots, composer clear time, notification page at 1440 and 390 in light and dark, Mailpit messages (Nib).

### S5.3 Folder sharing, invites and roles

Jam capture: none. Proves J-122, J-123, J-124. On Jam nothing is sent: no invites, per the account rule.

1. Open the "parity" folder, click its share button. Shoot the popover: copy folder link, invite field, who-has-access list, general access (J-122). Nib: invite `viewer@example.com`; Mailpit receives it.
2. Click the invite button in the dashboard header. Shoot the modal; type an invalid email (invite stays disabled), then `creator@example.com` (it enables). Pick each role and shoot the menu (J-123). Jam: close without sending. Nib: send, open the mail's link in a fresh context, join.
3. Roles (J-124). Jam: shoot the role labels on the members page. Nib: as the viewer from step 1, view and comment work and `POST /api/v1/recordings` returns 403; with auto-upgrade on, a create upgrades the viewer to creator.

Evidence: popover and modal shots (web pages: 1440 and 390, light and dark), Mailpit messages and API statuses (Nib).

## G6. Dashboard, folders, search and recording links

Rows: J-017, J-113, J-158, J-159, J-160, J-161, J-162, J-163, J-164, J-165, J-167, J-168, J-228

Run S6.2 steps 1 and 2 before S1.5 and S2.1, which pick the "parity" folder.

### S6.1 Grid, hover, filters and the palette

Jam capture: none (uses what the account holds). Proves J-158, J-159, J-160, J-161, J-228.

1. Open the dashboard home. Shoot it. Note the column count, the order, the card parts (thumbnail, creator, duration pill, link chip, title or fallback, relative time), and that captures inside folders are absent (J-158).
2. Hover a card: it lifts, a checkbox replaces the creator, a copy-link button shows. Click copy-link: toast (J-159). Middle-click the card: it opens in a new tab, so it is a real link.
3. Set the type filter to video, the source filter to extension, the creator filter to yourself. Shoot the chips. Reload: the filters stay (URL). Clear each chip (J-160). Time filter to results with load.
4. Press Ctrl+K on the dashboard. Shoot the empty palette (recent items). Type two words of "parity S3.1 lab": grouped results with a preview. Press Down, Up, then Ctrl+C (link copied), then Enter (opens) (J-161). Time typing to results.
5. On a capture page press Ctrl+K: the palette opens there too. Type your own first name: a members group sits above the captures, and the footer shows a count and an Enter hint. Press Enter on the member: the all-captures list opens with the creator chip set (J-228).

Evidence: grid, hover, filter and palette shots at 1440 and 390 in light and dark, clicks and times.

### S6.2 Folders

Jam capture: none (moves N4 and N5). Proves J-162, J-163, J-164, J-165, J-113.

1. Hover the sidebar's folders heading, click the plus, type "parity", press Enter: toast, and you stay on the page (J-163).
2. Make "parity-tmp" the same way. The sidebar lists folders alphabetically with icons; open "parity": it shows its count, and its URL ends in a 4-character id (J-162).
3. Open "parity-tmp", three-dot menu, rename: the input is prefilled and selected; rename to "parity-tmp2", Enter. Three-dot, delete, shoot the warning, confirm (J-164). The folder is empty, so nothing else goes.
4. On the dashboard, tick N5's checkbox: the header turns into a selection bar with a count. Click N4's card to add it. Click move, pick "parity": both move at once (J-165). Tick both again inside "parity", click delete, shoot the confirmation, click cancel.
5. Open N4, three-dot menu, move, pick no folder; then move it back into "parity" (J-113). The folder chip updates.

Evidence: shots of each step at 1440 and 390 in light and dark, click counts (move one card: 3).

### S6.3 Recording links page, a recipient's recording, the workspace menu

Jam capture: NEW N6. Proves J-167, J-017, J-168. Also the link-recorder half of J-200.

1. Open the recording links page. Shoot it: "parity link" from S1.5 with its mosaic, name, creator, use count, folder chip, share, open-captures and delete; the status, sort and creator filters; the new-link control (J-167).
2. Copy "parity link". In a second browser with no extension and no sign-in (a fresh Playwright Chromium, never the shared profile), open it. Shoot the recorder page.
3. Pick screen plus voice. No microphone exists: shoot the instructions and the record-without-voice offer (J-200, link-recorder half). Continue without voice.
4. Start, pick the entire screen in Chrome's picker, Share. On the lab tab click Submit order. Stop. Review, add the note "parity recipient", submit (J-017). Count steps and clicks.
5. Back as the owner: the capture lands in "parity" with the link chip; the link's use count went up. Nib: Mailpit holds the "new recording" mail.
6. Click the workspace button at the top of the sidebar. Shoot the menu: current workspace, settings, switch or create, log out (J-168). Close it.

Evidence: links page and recorder page at 1440 and 390 in light and dark, recipient clicks and time, the landed capture.

## G7. Settings, team admin, integrations, privacy and deletion

Rows: J-114, J-137, J-138, J-139, J-140, J-142, J-171, J-172, J-173, J-176, J-185, J-186, J-187, J-188, J-189, J-190, J-191, J-217, J-221, J-222, J-241, J-242, J-249, J-251

### S7.1 Settings pages, members, workspaces and sign-in

Jam capture: none. On Jam this scenario only looks: no workspace is created and no role or setting is changed. Proves J-171, J-172, J-173, J-222, J-221, J-249, J-217.

1. From the dashboard open settings through the workspace menu (2 clicks). Shoot the layout: back link, the nav groups and their order (J-171).
2. Open general: logo, name, access settings, data settings (J-172). Shoot it.
3. Open members: invite-link toggle, link and expiry line, reset, restrict-invites toggle, add-members button, the table and your row's menu (J-173). Shoot it. Note that your own row offers only leave, and that no control closes the workspace (J-249).
4. Seat change (J-222). Jam: shoot the role cell; there is no second member to change. Nib: with the members from S5.3, set the viewer to creator and back.
5. Workspace menu, switch, create (J-221). Shoot the form: letter avatar that follows the name, domain-join box ticked, next disabled until a name is typed. Jam: stop here. Nib: submit "Parity 2"; it becomes active.
6. Workspace lifecycle, Nib only (J-249): the S5.3 creator leaves "Parity"; their captures stay. Delete a throwaway account that is the sole member of its workspace; its workspace and media are gone from Garage. Jam: public doc.
7. In a signed-out context open each product's sign-in page. Shoot it. List the providers and the work-email path; Nib: the magic link arrives in Mailpit and signs in (J-217).

Evidence: each settings page at 1440 and 390 in light and dark, clicks to each page.

### S7.2 Extension settings and user-event capture off (N7)

Jam capture: NEW N7. Proves J-176, J-190.

1. Popup three-dot menu, settings (2 clicks). Shoot the screen, scroll it, list every setting (J-176).
2. Turn off user-event capture. Close the popup.
3. Load `/form`, click Name, type "no events", click Email, type "x@example.com".
4. Take a visible screenshot, title "parity S7.2 no events", create.
5. Open it: the actions tab has no click or typing rows; console and network still fill (J-190).
6. Turn user-event capture back on.

Evidence: settings shots (popup, 1440 only), the actions tab of N7.

### S7.3 Integrations

Jam capture: none. On Jam nothing is connected (account rule; `docs/jam/untested.md`), so its column holds the menus and pages it shows and its public docs. Nib runs every check against the stand-ins in `e2e/fixtures/net.ts`. Proves J-137, J-138, J-139, J-140, J-251, J-241, J-242, J-142.

1. Open settings, integrations. Shoot the grid and its search (J-139). Nib: connect the GitHub stand-in with a token and the Slack stand-in with a webhook URL.
2. Take a screenshot draft. Open the destination menu and shoot it. Nib: pick GitHub; the form lists repo, labels, assignee and milestone; fill them; create. The issue is filed and opens in a new tab (J-137, J-140). Check the filed body for title, description, console errors, failing requests, URL, time, country, device, OS, browser, viewport, speed and the capture link (J-242).
3. Nib: a second draft with GitHub's stand-in stopped: the capture is saved and a notice says filing failed; the next draft remembers the last repo and labels (J-140).
4. Nib: with "Parity 2" connected to a second GitHub stand-in, switching the draft's workspace switches the destination list (J-251).
5. On N1, open the send-to-app split. Shoot it. Nib: send N1 to GitHub. Signed out, the control is absent (J-138).
6. Nib: put "org/repo#12" in a capture's description. Search, MCP and CLI find it as having a linked issue (J-241).
7. Open settings, webhooks. Shoot it. Nib: add a local listener, create a capture: a `capture.created` payload with a valid HMAC signature arrives. Stop the listener: the log lists retry attempts (J-142).

Evidence: page and menu shots at 1440 and 390 in light and dark, the filed issue body, the webhook payload and signature check.

### S7.4 Privacy and deletion (N1, N7)

Jam capture: N1 and N7 (N7 is deleted here). Proves J-185, J-186, J-187, J-188, J-189, J-191, J-114. Also the deleted-capture half of J-205.

1. On N1, open the auth request from S3.1 step 14: Cookie, Authorization and X-Api-Key are masked with a badge. Copy it as cURL: the secrets are placeholders (J-185).
2. Open the POST /form request: email and password values in the body are replaced. Note whether the key-like string and the card number in Notes stay in clear (Jam: they do; Nib: scrubbed is better) (J-186).
3. Open the actions tab: the email and password typing rows are asterisks of unrelated length; click rows mask the value attribute; Name and Notes are in clear (J-187).
4. Play N1 to the form step: the typed email is readable in the video on both products (J-188).
5. J-189: the checks in S1.4 step 5 and S2.4 step 7 prove it; copy their results here.
6. Open N7, three-dot menu, delete, shoot the warning, confirm (3 clicks). Time confirm to toast and to the dashboard (J-114).
7. N7 is gone from the grid, from its folder and from Ctrl+K search. Its URL shows the not-found line (J-191, J-205). Nib: `GET /api/v1/recordings/<id>` returns 404 and its media URL returns 404 at once. Jam: note how long the image URL from the viewer keeps answering, using only a plain browser load of that URL.

Evidence: masked header and body shots, typing rows, the video frame, delete timings with load, the not-found page at 1440 and 390 in light and dark.

## G8. Agent hand-off, shortcuts, speed, errors and empty states

Rows: J-145, J-146, J-147, J-148, J-149, J-150, J-151, J-152, J-153, J-155, J-179, J-180, J-181, J-182, J-184, J-193, J-194, J-195, J-196, J-197, J-198, J-199, J-200, J-202, J-203, J-205, J-244, J-245, J-246, J-247

### S8.1 MCP, markdown and copy for AI (N1)

Jam capture: N1. Proves J-145, J-146, J-147, J-148, J-149, J-150, J-151, J-152, J-153. Raw Jam MCP answers go to `research/jam-private/parity/S8.1/` only.

1. Open settings, the MCP page (3 clicks from the dashboard). Shoot it. Open the Claude Code card and copy its snippet: it holds the server URL and no token (J-145).
2. In a scratch folder, give Claude Code a throwaway `--mcp-config` with that URL (never the user's global config). Its first call opens the consent page in the browser: shoot it (workspace picker, client name, two scopes), approve with one click (J-146).
3. Ask the agent to fetch N1's details, console, network (5xx only) and user events. Count the entries each tool returns and compare them with the S3.1 count table (J-149). Note which fields come back (headers, frames).
4. Ask the agent to find N1 by pasting its URL and by searching for "parity", and to list folders and members (J-150).
5. Ask the agent to add the comment "agent parity check" at 0:10 on N1 and to set N1's title to "parity S3.1 lab (agent)". Check both on the capture page, then set the title back and delete the comment through the agent (J-151).
6. On N1, open the dev tools panel's agent tab (MCP on Jam). Shoot it. Copy each preset prompt and check that it embeds N1's URL (J-152).
7. Fetch N1's share URL with `curl -s -H 'Accept: text/markdown'` and with `.md` appended: front matter, counts, comments and pointers to the agent tools. Plain `curl -sI` shows the Link header to the markdown (J-153). This is the share page any agent fetches, not the extension's traffic.
8. Back on the MCP page: the client is listed. Remove it; the agent's next call fails (J-147). Jam: the row may need a reload to go; note it.
9. Personal tokens (J-148). Jam: open the create-key modal and shoot it; close without creating. Nib: create a 30-day read-only CLI token; it shows once with its prefix; a write with it is refused.

Evidence: page and consent shots at 1440 and 390 in light and dark, entry counts per tool next to the viewer counts, the markdown (Nib in git, Jam private), click counts.

### S8.2 CLI

Jam capture: none. Jam's CLI is public doc only and installing it would bring Jam's code onto this machine, so the Jam side is its settings page plus the docs. Proves J-155, J-244, J-245, J-246, J-247.

1. Open settings, CLI on each product. Shoot it (J-155).
2. Nib: install from `/cli/install.sh`, `nib login --token <token>`, `nib ls` lists captures (J-155).
3. Nib: `nib create --json payload.json` with an image of `/` and a box, an arrow, text, a redact and a blur: a screenshot capture with numbered badges and a link (J-244).
4. Nib: `nib create video.mp4 --trace trace.zip` with a Playwright trace of a lab run: console, network and typing synced, the password masked (J-245).
5. Nib: `nib record --cdp` around a Playwright run on `/` that clicks Submit order: stop returns a link with console, the error, network and screencast video; the clicks through the proxy are logged (J-246).
6. Nib: `nib network <N1 url> --status 5xx` returns paged JSON with the 500 body; `nib frames <N1 url> --at 5000` writes a JPG; the skill file states the read order (J-247).

Evidence: CLI page shots, command output, the created captures.

### S8.3 Shortcuts

Jam capture: none new (J-181 comes from N1). Proves J-179, J-180, J-181, J-182, J-184.

1. On `/` press Ctrl+Shift+Y: the popup opens (J-179). Close it.
2. Press Ctrl+Shift+S and time it to the cursor pill (under 0.5 s on Jam). Click the page; discard the draft (J-180).
3. J-181: S3.1 steps 3 and 19 start and stop N1 by chord; copy their result and timings here.
4. With instant replay on (S1.4 step 1), press Ctrl+Shift+X: the replay draft opens with no popup. Time it. Discard (J-182). Turn replay off again on Jam.
5. Popup settings, the shortcuts link: `chrome://extensions/shortcuts` opens in a new tab (3 clicks). Shoot the commands and their scope menus. Nib only: rebind the screenshot command, check the new chord works and the popup tooltip shows it, then set it back (J-184). Jam: no rebinding, so the owner's keys stay as they are.

Evidence: timings with load for steps 2 and 4, the shortcuts page shot (1440, default theme).

### S8.4 Speed

Jam capture: none new; recording timings come from N1, N2 and N3. Proves J-193, J-194, J-195, J-196, J-197, J-198. Run this on a quiet machine: load below 6 for every number, three runs per step where it costs Jam nothing.

| Row | Step | Runs | Source |
|---|---|---|---|
| J-193 | Icon click to the popup's first card and to full content, warm and cold (cold: first open after a browser start) | 3 warm, 1 cold | here |
| J-194 | Screenshot click to editor on `/`; area drag release to editor; replay key to editor shell and to loaded | 3 each | here (drafts discarded) |
| J-195 | Chord or record click to the first live frame | 1 per recording | S1.2 step 1, S3.1 step 3 |
| J-196 | Stop to editor, plus how many drafts opened healthy | 1 per recording | S1.2 step 13, S1.3 step 6, S3.1 step 19 |
| J-197 | Create to link on the clipboard, and to the background tab | 1 per capture | S2.1 step 21, S2.2, S2.4 step 9, S3.1 step 19 |
| J-198 | Signed-out first contentful paint and load of the share page; create to playable video | 3 | S5.1 step 4 |

Evidence: one table per product with the median, each run, and the load average beside it. Compare medians.

### S8.5 Errors and empty states

Jam capture: none new (uses N6 and N7). Proves J-199, J-200, J-202, J-203, J-205.

1. Open `chrome://extensions`. Click the icon: the restricted-page state. Press Ctrl+Shift+S: nothing happens and nothing says why (J-199). Shoot the popup.
2. J-200: copy the results of S1.2 step 2 (bar mic state) and S6.3 step 3 (link recorder) here.
3. J-202: copy S2.1 step 22. Jam asked the page for clipboard access; Nib copies from the extension, so no prompt is better.
4. Make an empty folder "parity-empty", open it: heading, help line and a make-a-capture button. Shoot it. Delete the folder (J-203).
5. Open N7's URL after S7.4 (the deleted capture) and a made-up capture URL on each product: one centred not-found line (J-205). Shoot both.

Evidence: popup shot (1440, default theme), empty folder and not-found pages at 1440 and 390 in light and dark.

## Run order

1. S6.2 steps 1 and 2 (folders "parity" and "parity-tmp").
2. S1.1, S1.4, S1.5, S1.6, S2.3, S8.3 steps 1, 2, 4 and 5 (no Jam capture).
3. S3.1 (N1), then S2.1 (N4), S2.2 (N5), S1.2 (N2) and S2.4, S1.3 (N3).
4. S3.2 to S3.5, S4.1 to S4.3, S5.1, S5.2, S6.1, the rest of S6.2.
5. S6.3 (N6), S7.2 (N7), S5.3, S7.1, S7.3, S7.4.
6. S8.1, S8.2, S8.4 (on a quiet machine), S8.5.
7. Fill `docs/parity.md`, then fix every gap and run the scenarios of the rows that changed again (PLAN.md step 3, item 3).

## Row index

One line per P0 and P1 row, in ID order. "Proved by" is the one scenario that settles the row; "Also measured in" names scenarios that collect part of its evidence.

| ID | Feature | Pri | Area | Group | Proved by | Also measured in |
|---|---|---|---|---|---|---|
| J-001 | Toolbar popup with the capture menu | P0 | ext-ui | G1 | S1.1 | - |
| J-002 | Visible-area screenshot | P0 | capture | G1 | S1.1 | - |
| J-003 | Area screenshot by drag | P0 | ext-ui | G1 | S1.1 | - |
| J-004 | Full viewport kept with an area crop | P1 | editor | G2 | S2.2 | - |
| J-006 | Tab video recording | P0 | capture | G1 | S1.2 | - |
| J-007 | Desktop or window recording | P0 | capture | G1 | S1.3 | - |
| J-008 | Desktop recording follows tab switches | P1 | capture | G1 | S1.3 | - |
| J-009 | Instant replay (share the past) | P0 | capture | G1 | S1.4 | - |
| J-010 | Instant replay is a DOM replay | P0 | capture | G1 | S1.4 | - |
| J-013 | Recording length cap and upsell | P1 | ext-ui | G1 | S1.6 | - |
| J-014 | Microphone narration toggle | P1 | capture | G1 | S1.6 | - |
| J-015 | Recording link created from the popup | P1 | ext-ui | G1 | S1.5 | - |
| J-017 | Recorder page for a link recipient | P1 | dashboard | G6 | S6.3 | - |
| J-025 | Screenshot-mode cursor hint | P0 | ext-ui | G1 | S1.1 | - |
| J-026 | Leave screenshot mode | P1 | ext-ui | G1 | S1.1 | - |
| J-027 | Pre-roll countdown | P0 | ext-ui | G1 | S1.2 | - |
| J-028 | Recording control bar | P0 | ext-ui | G1 | S1.2 | - |
| J-029 | Pause and resume | P1 | capture | G1 | S1.2 | - |
| J-030 | Live drawing during recording | P1 | ext-ui | G1 | S1.2 | - |
| J-031 | Live element blur during recording | P1 | ext-ui | G1 | S1.2 | - |
| J-032 | Recording survives navigation | P0 | capture | G1 | S1.2 | - |
| J-033 | Browser-level recording cues | P1 | ext-ui | G1 | S1.2 | S1.3 |
| J-034 | Post-stop processing state | P1 | capture | G1 | S1.2 | S1.3, S3.1 |
| J-035 | Unfinished draft guard | P1 | ext-ui | G1 | S1.2 | - |
| J-037 | In-page screenshot editor | P0 | editor | G2 | S2.1 | - |
| J-038 | Pen | P0 | editor | G2 | S2.1 | - |
| J-039 | Rectangle | P0 | editor | G2 | S2.1 | - |
| J-040 | Ellipse | P0 | editor | G2 | S2.1 | - |
| J-041 | Arrow with bend handle | P0 | editor | G2 | S2.1 | - |
| J-042 | Line | P1 | editor | G2 | S2.1 | - |
| J-043 | Text callout | P0 | editor | G2 | S2.1 | - |
| J-044 | Blur area | P0 | editor | G2 | S2.1 | - |
| J-045 | Colour palette | P0 | editor | G2 | S2.1 | - |
| J-046 | Select, move, resize, rotate | P1 | editor | G2 | S2.1 | - |
| J-047 | Marquee multi-select | P1 | editor | G2 | S2.1 | - |
| J-048 | Delete selection | P1 | editor | G2 | S2.1 | - |
| J-049 | Undo and redo | P0 | editor | G2 | S2.1 | - |
| J-051 | Annotations flattened into the image | P0 | editor | G2 | S2.1 | - |
| J-054 | Tab video file | P0 | server-core | G3 | S3.1 | - |
| J-055 | Console capture by level | P0 | capture | G3 | S3.1 | - |
| J-056 | Call-site stack on every console row | P1 | capture | G3 | S3.1 | - |
| J-057 | Uncaught exceptions | P0 | capture | G3 | S3.1 | S3.3 |
| J-058 | Network list | P0 | capture | G3 | S3.1 | - |
| J-059 | Request and response headers | P0 | capture | G3 | S3.1 | - |
| J-060 | Request and response bodies | P0 | capture | G3 | S3.1 | - |
| J-061 | Pending requests | P1 | capture | G3 | S3.1 | - |
| J-062 | WebSocket frames | P1 | capture | G3 | S3.2 | - |
| J-064 | GraphQL awareness | P1 | capture | G3 | S3.1 | - |
| J-067 | Click events | P0 | capture | G3 | S3.1 | - |
| J-068 | Typing events | P0 | capture | G3 | S3.1 | - |
| J-069 | Navigation events | P0 | capture | G3 | S3.1 | - |
| J-070 | Page and device metadata | P0 | capture | G3 | S3.1 | - |
| J-071 | Logs from before the capture | P0 | capture | G3 | S3.3 | S2.1 |
| J-072 | Timeline markers in the video | P0 | viewer | G4 | S4.1 | - |
| J-073 | Custom metadata SDK | P1 | capture | G3 | S3.4 | - |
| J-074 | Voice transcript | P1 | server-core | G3 | S3.5 | - |
| J-077 | Title and description in one field | P0 | editor | G2 | S2.1 | - |
| J-079 | Destination picker | P0 | editor | G2 | S2.1 | - |
| J-080 | Workspace picker | P1 | editor | G2 | S2.1 | - |
| J-081 | Folder picker | P1 | editor | G2 | S2.1 | - |
| J-083 | AI title and repro steps | P1 | editor | G2 | S2.4 | - |
| J-084 | Video preview in the draft | P0 | editor | G2 | S2.4 | - |
| J-085 | Trim | P0 | editor | G2 | S2.4 | - |
| J-086 | Create and copy link | P0 | editor | G2 | S2.1 | S2.4 |
| J-087 | Upload during the draft | P1 | server-core | G2 | S2.4 | - |
| J-088 | Discard the draft | P1 | editor | G2 | S2.3 | - |
| J-090 | Two-column capture page | P0 | viewer | G4 | S4.1 | - |
| J-091 | Hide or show the dev tools panel | P1 | viewer | G4 | S4.1 | - |
| J-092 | Video player | P0 | viewer | G4 | S4.1 | - |
| J-093 | Player keyboard | P1 | viewer | G4 | S4.1 | - |
| J-095 | Marker hover and jump | P1 | viewer | G4 | S4.1 | - |
| J-097 | Share at the current time | P1 | viewer | G4 | S4.1 | - |
| J-098 | Download media | P1 | viewer | G4 | S4.1 | - |
| J-099 | Screenshot view and lightbox | P1 | viewer | G4 | S4.2 | - |
| J-100 | Instant replay playback | P1 | viewer | G4 | S4.3 | - |
| J-101 | Info tab | P0 | viewer | G4 | S4.1 | - |
| J-102 | Console tab with filters | P0 | viewer | G4 | S4.1 | - |
| J-103 | Click a row to seek | P0 | viewer | G4 | S4.1 | - |
| J-104 | Panels follow playback | P1 | viewer | G4 | S4.1 | - |
| J-105 | Network tab | P0 | viewer | G4 | S4.1 | - |
| J-106 | Request detail pane | P0 | viewer | G4 | S4.1 | - |
| J-107 | Copy as cURL | P1 | viewer | G4 | S4.1 | - |
| J-108 | Actions tab | P1 | viewer | G4 | S4.1 | - |
| J-110 | Inline title and description editing | P0 | viewer | G4 | S4.1 | - |
| J-112 | Header actions | P0 | viewer | G4 | S4.1 | - |
| J-113 | Move to folder from the capture page | P1 | viewer | G6 | S6.2 | - |
| J-114 | Delete a capture | P0 | viewer | G7 | S7.4 | - |
| J-117 | Copy share link | P0 | viewer | G5 | S5.1 | - |
| J-118 | Link with or without dev tools | P1 | viewer | G5 | S5.1 | - |
| J-119 | Per-capture general access | P1 | server-core | G5 | S5.1 | - |
| J-121 | Logged-out viewer | P0 | viewer | G5 | S5.1 | - |
| J-122 | Folder sharing | P1 | dashboard | G5 | S5.3 | - |
| J-123 | Invite members | P1 | auth | G5 | S5.3 | - |
| J-124 | Seat roles | P1 | auth | G5 | S5.3 | - |
| J-127 | Timestamped comments | P0 | viewer | G5 | S5.2 | - |
| J-128 | Comment markers on the timeline | P1 | viewer | G5 | S5.2 | - |
| J-131 | Edit and delete own comment | P1 | viewer | G5 | S5.2 | - |
| J-134 | Anonymous comments | P1 | viewer | G5 | S5.2 | - |
| J-135 | Mentions | P1 | viewer | G5 | S5.2 | - |
| J-136 | Email notification settings | P1 | dashboard | G5 | S5.2 | - |
| J-137 | Send to tracker at create | P1 | dashboard | G7 | S7.3 | - |
| J-138 | Send an existing capture to an app | P1 | dashboard | G7 | S7.3 | - |
| J-139 | Integrations settings page | P1 | dashboard | G7 | S7.3 | - |
| J-140 | Tracker field forms | P1 | dashboard | G7 | S7.3 | - |
| J-142 | Webhooks | P1 | dashboard | G7 | S7.3 | - |
| J-145 | Agent setup page | P0 | agent | G8 | S8.1 | - |
| J-146 | OAuth consent for agents | P0 | agent | G8 | S8.1 | - |
| J-147 | Connected agents list | P1 | agent | G8 | S8.1 | - |
| J-148 | Personal access tokens | P1 | agent | G8 | S8.1 | - |
| J-149 | MCP read tools | P0 | agent | G8 | S8.1 | - |
| J-150 | MCP search and list tools | P1 | agent | G8 | S8.1 | - |
| J-151 | MCP write tools | P1 | agent | G8 | S8.1 | - |
| J-152 | MCP tab on the capture page | P1 | agent | G8 | S8.1 | - |
| J-153 | Markdown summary for plain fetches | P0 | agent | G8 | S8.1 | - |
| J-155 | Jam CLI and agent skills | P1 | agent | G8 | S8.2 | - |
| J-158 | Capture grid | P0 | dashboard | G6 | S6.1 | - |
| J-159 | Card hover quick actions | P1 | dashboard | G6 | S6.1 | - |
| J-160 | Filters | P1 | dashboard | G6 | S6.1 | - |
| J-161 | Search palette | P0 | dashboard | G6 | S6.1 | - |
| J-162 | Folders in the sidebar | P0 | dashboard | G6 | S6.2 | - |
| J-163 | Create a folder | P0 | dashboard | G6 | S6.2 | - |
| J-164 | Rename and delete a folder | P1 | dashboard | G6 | S6.2 | - |
| J-165 | Selection mode and bulk actions | P1 | dashboard | G6 | S6.2 | - |
| J-167 | Recording links page | P1 | dashboard | G6 | S6.3 | - |
| J-168 | Workspace switcher | P1 | dashboard | G6 | S6.3 | - |
| J-171 | Settings layout | P1 | dashboard | G7 | S7.1 | - |
| J-172 | Workspace general settings | P1 | dashboard | G7 | S7.1 | - |
| J-173 | Members page | P1 | dashboard | G7 | S7.1 | - |
| J-176 | Extension settings in the popup | P1 | ext-ui | G7 | S7.2 | - |
| J-179 | Open the popup by key | P1 | ext-ui | G8 | S8.3 | - |
| J-180 | Screenshot mode by key | P0 | ext-ui | G8 | S8.3 | - |
| J-181 | Start and stop tab recording by key | P0 | ext-ui | G8 | S8.3 | S3.1 |
| J-182 | Instant replay by key | P0 | ext-ui | G8 | S8.3 | - |
| J-184 | Rebind and scope | P1 | ext-ui | G8 | S8.3 | - |
| J-185 | Header secret filtering | P0 | capture | G7 | S7.4 | - |
| J-186 | Body secret replacement | P0 | capture | G7 | S7.4 | - |
| J-187 | Typed text masking | P0 | capture | G7 | S7.4 | - |
| J-188 | Pixels are not masked | P0 | capture | G7 | S7.4 | - |
| J-189 | Nothing leaves before create | P0 | capture | G7 | S7.4 | S2.4, S1.4 |
| J-190 | Turn off user-event capture | P1 | ext-ui | G7 | S7.2 | - |
| J-191 | Deletion | P0 | dashboard | G7 | S7.4 | - |
| J-193 | Popup open time | P1 | ext-ui | G8 | S8.4 | - |
| J-194 | Capture to editor | P0 | capture | G8 | S8.4 | S2.1, S2.2 |
| J-195 | Key to live recording | P0 | capture | G8 | S8.4 | S1.2, S3.1 |
| J-196 | Stop to editor | P0 | capture | G8 | S8.4 | S1.2, S1.3, S3.1 |
| J-197 | Create to link on clipboard | P0 | editor | G8 | S8.4 | S2.1, S2.2, S2.4, S3.1 |
| J-198 | Viewer load | P1 | viewer | G8 | S8.4 | S5.1 |
| J-199 | Restricted page popup | P1 | ext-ui | G8 | S8.5 | - |
| J-200 | Missing mic permission | P1 | ext-ui | G8 | S8.5 | S1.2, S6.3 |
| J-202 | Clipboard permission prompt | P1 | editor | G8 | S8.5 | S2.1 |
| J-203 | Empty folder | P1 | dashboard | G8 | S8.5 | - |
| J-205 | Deleted or unknown capture | P1 | viewer | G8 | S8.5 | S7.4 |
| J-209 | Cropped and full image switcher | P1 | viewer | G4 | S4.2 | - |
| J-210 | No camera in the extension | P1 | capture | G1 | S1.1 | S1.3 |
| J-211 | Mute and switch mic while recording | P1 | capture | G1 | S1.6 | - |
| J-217 | Web app sign-in and sign-up | P0 | auth | G7 | S7.1 | - |
| J-218 | Local drafts list | P1 | ext-ui | G1 | S1.2 | - |
| J-219 | Save a video draft for later | P1 | editor | G2 | S2.4 | - |
| J-220 | Create by key | P1 | editor | G2 | S2.1 | - |
| J-221 | Create a workspace | P1 | auth | G7 | S7.1 | - |
| J-222 | Change a member's seat | P1 | dashboard | G7 | S7.1 | - |
| J-227 | Trim also cuts logs and events | P1 | server-core | G2 | S2.4 | - |
| J-228 | Palette finds members | P1 | dashboard | G6 | S6.1 | - |
| J-229 | Replay player controls | P1 | viewer | G4 | S4.3 | - |
| J-230 | Click into the ghost title | P1 | editor | G2 | S2.4 | - |
| J-238 | Drag the recording bar | P1 | ext-ui | G1 | S1.2 | - |
| J-239 | Popup during a recording | P1 | ext-ui | G1 | S1.2 | - |
| J-240 | No annotation after a recording | P1 | editor | G2 | S2.4 | - |
| J-241 | Linked tracker issue on a capture | P1 | dashboard | G7 | S7.3 | - |
| J-242 | Body of the filed tracker issue | P1 | dashboard | G7 | S7.3 | - |
| J-243 | Step through requests by key | P1 | viewer | G4 | S4.1 | - |
| J-244 | Agent-made annotated screenshot | P1 | agent | G8 | S8.2 | - |
| J-245 | Agent-made video with a test trace | P1 | agent | G8 | S8.2 | - |
| J-246 | Record an agent-driven browser or a window | P1 | agent | G8 | S8.2 | - |
| J-247 | CLI read path to local files | P1 | agent | G8 | S8.2 | - |
| J-248 | Leaked requests show as false failures | P1 | capture | G3 | S3.1 | - |
| J-249 | Workspace lifecycle | P1 | dashboard | G7 | S7.1 | - |
| J-250 | Capture click is swallowed | P1 | ext-ui | G1 | S1.1 | - |
| J-251 | Integrations belong to a workspace | P1 | dashboard | G7 | S7.3 | - |
