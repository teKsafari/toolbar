# G1 replica results (Nib side)

Raw results of group G1 in `docs/parity/scenarios.md` (S1.1 to S1.6), run on the replica only. The Jam side and the match, better or gap verdicts belong in `docs/parity.md`. Product code was not changed in this step; bugs are listed at the end.

Run on 2026-10-15. All six scenarios passed in one full run (10.1 min). Timings below come from that run unless a row says otherwise. Earlier runs at other loads are listed where they add a data point.

## How to rerun

```sh
pnpm --filter @toolbar/extension build            # release build, closed shadow root
cd e2e && npx playwright test -c playwright.parity.config.ts G1           # all six
cd e2e && npx playwright test -c playwright.parity.config.ts G1 -g S1.2   # one
```

`PARITY_EXT_BUILD` picks another folder under `apps/extension/.output` (this run used a private copy of the release build, `chrome-mv3-g1`, so a rebuild by another agent could not change it mid-run). `PARITY_DISPLAY` defaults to `:130`. Evidence lands in `e2e/parity-shots/G1/` (git-ignored): one `<scenario>.json` with every count, click tally and timing, and the screenshots named `<scenario>-<step>-nib-<width>-<theme>.png`.

## Rig

- Playwright 1.63.0 Chromium, fresh profile per browser, release build loaded unpacked, action pinned, developer mode on. Xvfb `:130` at 1460x1000 with openbox. Window 1448x991, which gives a page viewport of exactly 1440x900.
- Every pointer and key input a person gives goes through the X server with xdotool: the toolbar icon (found by its pixels, because Chrome moves it when it adds a media control), clicks inside the popup, the in-page cursor pill, the bar, pen, blur, the share picker, Escape and Ctrl+R. Playwright reads the popup and the editor over CDP and types titles.
- The closed shadow root is read, never driven, through CDP `DOM.getDocument` with `pierce`: boxes, texts, states.
- Timings come from CDP screencast frames of the page, each stamped with the compositor's wall clock. The time is the input to the first frame whose result region has come 80 percent of the way to its final look. The ffmpeg on this VM has no x11grab, so the screencast replaces the scenario's screen recording. Precision is one frame (about 16 ms), better than the 0.1 s the scenario asks for. The popup is outside the page, so popup steps are timed by polling (clipboard, session state).
- Load average: another agent drove Jam on `:99` during the run, and the 1-minute load ranged from 1.9 to 19. Every timing carries its load. Timings taken above 6 are marked unreliable and were taken again when the load dropped.

Deviations from the script:

- S1.3: the lab serves only assets on `:5174` (404 at `/`), so tab B is `http://127.0.0.1:5173/`, a second origin with the same page.
- S1.5: Nib made the folder "parity" through the API (S6.2 makes it on Jam). The extension caches its bootstrap, folders included, for 60 s, so the run waits out the cache after making the folder.
- S1.6 step 2: tab capture fails when Chromium runs with fake media devices, so the fake-microphone recording is a desktop one (the fake UI flag answers the picker). The microphone is Chromium's default fake device (a tone), not a speech WAV.
- S1.2 after-check: S2.4 creates the N2 capture on Jam. On Nib the draft is created at the end of S1.2 from the drafts list, and its video is checked there.

## S1.1 Popup, screenshot mode and the swallowed click

| Step | Result |
|---|---|
| 2 popup (J-001) | 400 px wide card. Header: wordmark, home ("Open dashboard"), three-dot menu; an account line with sign out. Rows: Screenshot (chevron), Record this tab (mic pill "Mic off", chevron), Recording link (help icon). The replay row appears only when instant replay is on (S1.4). 1 click. |
| 3 chevron (J-210) | Options: Tab, Window, Screen. No camera entry. A real Escape closes the whole popup, not only the chevron. |
| 4 cursor pill (J-025) | Pill "Click or drag to capture" at +5, +20 px from the pointer (pointer at 700, 400; pill at 705, 420). Page not dimmed: a probe region reads rgb(250, 250, 250) before and after arming. |
| 5 click on Save (J-002, J-250) | Editor opens with the full viewport at 1x (image 1440x900). Capture-phase `pointerdown` and `click` counters 0 and 0, status text "idle" before and after: the click never reached the page. 3 clicks (icon, row, page). Click to editor in the DOM 0.32 s (load 6.1). |
| 6 close | Screenshot draft gone 0.25 s after the close click, no confirm. Session back to idle. |
| 7 Escape (J-026) | Pill gone, session idle. |
| 8 popup while armed (J-026) | Screenshot row is a red "Exit screenshot mode" row; record and link rows greyed. Clicking it ends screenshot mode. 2 clicks to leave. |
| 9 area drag (J-003) | Rectangle 600x300 at (200, 150) during the held drag, live readout "600 × 300" next to the pointer. On release the editor opens with a 600x300 crop and a ticked "Include the full page" box with a 1440x900 thumbnail. Release to editor in the DOM 0.45 s (load 6.8). 2 clicks and one drag. |

## S1.2 Tab recording with the recording bar

| Step | Result |
|---|---|
| 1 record (J-006, J-027, J-195) | 2 clicks (icon, record row). Grey veil over the page with a centred card (mode, microphone state, "click anywhere to pause") and the bar at bottom centre counting 3, 2, 1; shot taken at 2. Record-row click to first live frame: 5.5 s (load 5.9). Other runs: 4.3 s (3.4), 4.0 s (6.0), 4.9 s (5.8), 5.0 s (5.7), 7.8 s (5.8). Median of the six: 5.0 s. |
| 2 bar (J-028, J-200 bar half) | 275x40 dark pill, bottom edge 70 px above the viewport's bottom, centre 7 px left of the viewport centre (the page scrollbar takes 15 px). Controls: stop, pause, timer, mic, divider, pen, blur. Mic shows its off state with the tooltip "Microphone off" (mic setting off; not the missing-permission state). |
| 3 browser cues (J-033) | Action icon turns into a red camera glyph, title "Recording: click to stop". Chrome draws its capture indicator on the tab. |
| 4 | Submit order clicked (status "saved", the hidden 500). |
| 5 drag (J-238) | Pressed on the timer and dragged to mid page: the bar sits at (607, 430). Timer 0:17, 0:21 two seconds later: it keeps counting. 1 drag. |
| 6 pause (J-029) | Timer frozen at 0:21 for 5.3 s of wall time, then counts on. Session paused time 5.7 s. 2 clicks. |
| 7 pen (J-030) | 12 colour dots, red preselected. Two strokes drawn; each stayed 3.2 s, then faded. 2 clicks and 2 drags. |
| 8 blur (J-031) | Hover outline hugs the card (964x196 around a 960x192 card). Blurred count by click: 1, 0 (unblur), 1, 0 (undo), 1. Done keeps the card blurred. The timer stops while the blur tool is open: it advanced 1 s over 5.7 s of wall time. 7 clicks. |
| 9 | Show profile and Log at every level clicked. |
| 10 SPA change (J-032) | On /form the bar is still there, in its dragged spot, recording, timer 0:34 then 0:35. |
| 11 reload (J-032) | A frame during the reload shows the page with no bar (saved). The bar came back 0.5 s after Ctrl+R with the timer counting (0:35 to 0:38). It returns at bottom centre: the dragged spot does not survive a reload. |
| 12 popup while recording (J-239) | Screenshot row greyed, record row is a red "Stop recording" row, recording-link row active. The stop row ends the recording (state "stopping" 0.37 s after the click). 2 clicks. |
| 13 processing and draft (J-034, J-196) | The bar shows a spinner and "Collecting logs" (shot). Stop click to first editor frame: 0.9 s (load 4.6). Other runs: 2.4 s (5.8), 1.4 s (3.9), 0.7 s (2.0), 2.0 s (4.3). Median of the five: 1.4 s. Draft length "1 minute 3 seconds" (63.2 s); play moved the video to 2.0 s. Healthy in all 5 runs. |
| 14 draft guard (J-035) | Header pill shows 1 unfinished draft, disabled with the title "Finish the open draft first". Screenshot and record rows greyed, recording-link row active. |
| 15 restart (J-218) | Menu, Restart extension. In this run the editor closed 0.55 s later; in 2 of 3 runs it stayed over the page (see bugs). The popup was open again after the restart without a click. The pill (now enabled) opens Drafts: one row with thumbnail, host, age ("just now"), View and trash. 5 clicks (icon, menu, restart, icon, pill). |

After-check on the created capture (Nib only): kind video, 63.3 s long for 72.8 s of wall time from live to stop, 9.6 s shorter. The session counted 10.6 s paused (5.7 s pause plus the time the blur tool was open). Frames at 20 s and 34.8 s show the bar at its dragged spot mid page. At 34.8 s the cross-origin card is blurred. The frames hold the viewport only, no browser chrome.

## S1.3 Desktop recording across tabs

| Step | Result |
|---|---|
| 2 chevron (J-007, J-210) | Tab, Window, Screen; Screen selected turns the row into "Record full screen". 4 clicks (icon, chevron, Screen, record row). No camera entry. |
| 3 picker (J-007, J-033) | Chrome's picker on the first try (no crash), 2 clicks (screen thumbnail, Share). Live 0.35 s after Share with no countdown (states seen: starting, recording). Chrome's sharing strip shows at the bottom ("Nib is sharing your screen", stop, hide) and the action icon turns red. |
| 4 tab switch (J-008) | Tab B selected by its tab: the bar shows in tab B, timer 0:02 in A, 0:03 in B. |
| 6 stop (J-008, J-196) | Stop on the bar in tab B; the editor opens in tab B, not in A. Stop to first editor frame 0.5 s (load 5.4). Other runs: 1.1 s (2.6), 0.6 s (2.8), 0.6 s (3.2); 17.8 s at load 13.7 (unreliable, dropped). Median of the four: 0.6 s. |
| 7 capture (J-008, J-224) | Create button, 1 click. Kind screen. Network: 2 requests, one per tab (the 500 from tab A, the save from tab B), each with its own tab id. Console: 15 console events, all from tab B (tab A's hidden 500 logs nothing); the console panel lists 19 rows. The video shows the whole screen with browser chrome. Capture page shot at 1440 and 390, light and dark, with no sideways overflow in any of the four. |
| 8 sticky (J-007) | Next popup: the record row still reads "Record full screen"; set back to Tab ("Record this tab"). |

## S1.4 Instant replay

| Step | Result |
|---|---|
| 1 setup | 4 clicks (icon, menu, Settings, switch). The switch follows the account: a later run on a fresh profile found it already on. |
| 3 replay (J-009, J-194) | Replay row "Instant replay" above the link row. Row click to first editor frame: 0.7, 0.8, 0.5 s (load 3.6, 3.2, 3.1), median 0.7 s. Earlier run at load 1.9 to 2.7: 0.4, 0.4, 0.3 s. The draft is a DOM replay (an iframe) with a pointer glyph, 14 s long (the page was loaded 14 s before). The trim track holds two cuts, the playhead and two grips, and no markers for the 500 or the error (see bugs). |
| 4 span (J-010) | After 158 s on the page with a save every 10 s: default length 30 s, handles dragged fully out: 2 minutes. |
| 5 nothing sent (J-189) | Captures in `GET /api/v1/recordings`: 9 before, 9 after. |
| 6 | Instant replay turned off again. |

## S1.5 Recording link from the popup

| Step | Result |
|---|---|
| 1 form (J-015) | Form inside the popup: name, recorder domain `localhost:3000` with a status dot, folder select (No folder, parity). |
| 2 and 3 create | 4 clicks plus typing (icon, link row, folder select, create); 3 without a folder. The link (`http://localhost:3000/rl/...`) is on the clipboard 0.15 s, 0.15 s and 0.22 s after create (load 2.6), median 0.15 s. The popup shows the same link with a copy button. |

## S1.6 Microphone and the recording cap

| Step | Result |
|---|---|
| 1 no device (J-014) | A click on the mic pill opens the permission tab, which closes itself 0.67 s later. The pill stays "Mic off", the setting stays off, no message. |
| 2 fake microphone (J-014, J-211) | The permission tab opens and closes itself (granted). The pill still reads "Mic off": the popup closed when the tab took the focus, before it could switch the mic on. A second click on the pill turns it on. Recording: the bar's mic control goes on, muted, on; the capture's events hold mic on at 0.9 s, muted at 3.2 s, on at 6.1 s, and the capture has a voice stream (audio/webm). No control anywhere switches to a second microphone during the recording. |
| 3 cap at 1 min (J-013) | The timer reads "0:30 / 1:00" in orange from 30 s and turns red at 50 s; the recording stops by itself at 60.1 s and the draft opens ("1 minute 1 second"). No upsell card (skip list). The server went back to no cap afterwards. |

## Per-row summary

| ID | Scenario | Nib result |
|---|---|---|
| J-001 | S1.1 | Popup rows and header as listed; 1 click. |
| J-002 | S1.1 | 3 clicks; full 1440x900 viewport at 1x in the editor. |
| J-003 | S1.1 | Live rectangle and WxH readout; exact 600x300 crop; full viewport kept. |
| J-006 | S1.2 | 2 clicks; viewport-only video; draft healthy. |
| J-007 | S1.3 | 4 clicks plus 2 in Chrome's picker; no countdown; choice sticks. |
| J-008 | S1.3 | Bar follows to tab B, timer continues, editor opens in tab B, requests from both tabs. |
| J-009 | S1.4 | DOM replay with pointer, last 30 s by default, 0.7 s to the draft; no 500 or error markers on the track. |
| J-010 | S1.4 | Full span 2 minutes after 158 s on the page. |
| J-013 | S1.6 | Orange at 0:30, red at 0:50, stops at 1:00 and opens the draft. |
| J-014 | S1.6 | No device: tab opens and closes, pill off, silent. With a device, the first grant leaves the pill off; a second click turns it on. |
| J-015 | S1.5 | Link on the clipboard 0.15 s after create, copy button shown; 4 clicks with folder. |
| J-025 | S1.1 | Pill at +5, +20 px; no dimming. |
| J-026 | S1.1 | Escape exits; exit row in the popup with the others greyed. |
| J-027 | S1.2 | Veil with card and 3, 2, 1 on the bar; live 5.0 s median after the click (6 runs, load 3.4 to 6.0). |
| J-028 | S1.2 | 275x40, 70 px above the bottom, centred; stop, pause, timer, mic, pen, blur. |
| J-029 | S1.2 | Timer frozen for the 5 s pause; video shorter than the wall time by the paused time. |
| J-030 | S1.2 | 12 colours, red first; strokes fade after 3.2 s. |
| J-031 | S1.2 | Blur, unblur, undo and done work; blurred in the video; recording paused while the tool is open. |
| J-032 | S1.2 | Survives the SPA change and the reload; bar back 0.5 s after Ctrl+R with the timer counting. |
| J-033 | S1.2, S1.3 | Red camera action icon; Chrome's tab indicator; sharing strip on desktop. |
| J-034 | S1.2 | Spinner with "Collecting logs"; stop to editor 1.4 s median; 5 of 5 drafts healthy. |
| J-035 | S1.2 | Draft pill with count, disabled while the draft is open; only the link row active. |
| J-210 | S1.1, S1.3 | No camera in the chevron, the bar or the draft. |
| J-211 | S1.6 | Mute and unmute from the bar work and show in the capture; no way to switch microphones. |
| J-218 | S1.2 | Drafts list with thumbnail, host, age, view, trash; the editor did not close on restart in 2 of 3 runs. |
| J-238 | S1.2 | Dragged by the timer, stays there and in the video; back to bottom centre after a reload. |
| J-239 | S1.2 | Screenshot greyed, stop row, link row active; stop opens the draft. |
| J-250 | S1.1 | Page counters unchanged by the capture click. |

Timings for rows owned by other groups: J-195 key to live 5.0 s median (S1.2); J-196 stop to editor 1.4 s median for tab (S1.2) and 0.6 s for desktop (S1.3); J-194 replay to editor 0.7 s median (S1.4); J-189 no capture before create (S1.4).

## Bugs and oddities noted (not fixed in this step)

1. J-009: the replay draft's trim track has no markers for the hidden 500 or the uncaught error. `docs/tasks.md` expects the 500 marker in the draft.
2. J-218: after Restart extension from the popup menu, the editor frame stayed over the page in 2 of 3 runs. It is an orphan of the old content script and stays until the page reloads. In the third run it closed in 0.55 s. In all three runs the popup was open again after the restart without a click. In a separate check, View in the drafts list then loaded the draft into the leftover frame.
3. J-014: on the first grant, the permission tab takes the focus and Chrome closes the popup before the popup code turns the mic on, so the pill still reads "Mic off". The user has to open the popup and click the pill a second time.
4. J-211: there is no control to pick another microphone during a recording. The bar only mutes and unmutes. The worker accepts a device id (`recording.mic`), but no UI sends one.
5. J-238: the dragged bar position is kept across a SPA change but not across a reload; after Ctrl+R the bar is back at bottom centre.
6. The first video frames show the bar's "Starting" state (seen in the S1.3 frame at 2 s and in the S1.2 draft's first frame).
7. S1.5: the popup's folder list comes from a bootstrap cached for 60 s, so a folder made in the last minute is missing from the link form.
8. Rig note, not a product bug: on a profile with developer mode off, Restart extension leaves an unpacked extension disabled ("turn on developer mode"). Anyone who loads it unpacked has developer mode on, so the rig turns it on.
