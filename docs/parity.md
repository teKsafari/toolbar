# Parity matrix (Part 1, step 3)

One row per P0 and P1 catalogue ID (73 P0, 106 P1). The scenarios that fill each row are in `docs/parity/scenarios.md` (its row index names the scenario per ID). Columns:

- **capture**: Jam's entries against Nib's for the same lab case (`match`, `better`, `gap`, or `n/a` where the row records nothing).
- **flow**: steps and clicks, and the median time with the load average, Jam then Nib.
- **ergonomics**: the 1440 and 390 px shots in light and dark (popup and in-page UI: 1440, default theme), viewed at 1x.
- **result**: `match`, `better` or `gap`.
- **evidence**: the scenario and the Nib evidence folder under `docs/parity/evidence/`. Jam evidence stays in `research/jam-private/parity/`, outside git.

| ID | area | priority | capture | flow | ergonomics | result | evidence |
|---|---|---|---|---|---|---|---|
| J-001 | ext-ui | P0 | n/a | 1 click both. Jam popup 0.4 s median (load 3.1 to 3.4); Nib popup time is owned by J-193 (G8), not timed here | Card under the icon, 400 px wide both; Nib 223 px tall vs Jam 203 (+10 percent, its signed-in account line); same three rows, chevrons, mic pill, home and menu icons | match | S1.1 step 2; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.1-2-popup-nib-1440-light.png, S1.1.json; Jam: research/jam-private/parity/G1-jam.md |
| J-002 | capture | P0 | match: full viewport image at 1x (Nib 1440x900, Jam 1440x813 at its smaller viewport); click never reaches the page in both | 3 clicks both. Click to editor: Jam 0.8 s median of 2 (load 2.0, 3.4); Nib 0.32 s (load 6.1, just over the limit) | Same modal over a grey veil, preview left, title and create column right, tool pill under the preview | match | S1.1 step 5; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.1-5-editor-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-003 | ext-ui | P0 | match: exact 600x300 crop (Jam does not show the crop size), full viewport kept and ticked in both | 2 clicks and 1 drag both. Release to editor: Jam 1.2 s (load 1.6); Nib 0.45 s (load 6.8, unreliable) | Flat translucent box with no border, page not dimmed, WxH readout below-right of the pointer in both; Nib readout smaller | match | S1.1 step 9; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.1-9-area-drag-nib-1440-light.png, S1.1-9-area-editor-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-004 | editor | P1 | | | | | |
| J-006 | capture | P0 | match: viewport-only video, draft healthy and playable in both | 2 clicks both (icon, record row); key-to-live timing is under J-027 | Same countdown, live bar and editor sequence | match | S1.2 steps 1 and 13; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2.json, S1.2-after-frame-20000ms.jpg; Jam: research/jam-private/parity/G1-jam.md |
| J-007 | capture | P0 | match: whole screen with browser chrome in the video in both. Nib chevron offers tab, window and screen; Jam tab and desktop | 4 clicks plus 2 in Chrome picker both; no countdown. Share to live: Jam 0.7 s (load 7.1, unreliable); Nib 0.35 s (load 5.3). Desktop choice sticks in both | Chevron expands inside the record card as a segmented switch in both; row label and icon change to the desktop mode | match | S1.3 steps 2, 3 and 8; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.3-2-chevron-desktop-nib-1440-light.png, S1.3.json; Jam: research/jam-private/parity/G1-jam.md |
| J-008 | capture | P1 | match: requests from both tabs with a tab id each; console rows only from tab B in both (tab A logs nothing in this case) | Bar follows into tab B with the timer running and the editor opens in tab B in both. Stop to editor: Jam 2.0 s (load 8.5, unreliable); Nib 0.6 s median of 4 (load 2.6 to 5.4) | Bar sits in the same bottom-centre spot in tab B, above Chrome's strip | match | S1.3 steps 4 to 7; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.3-4-bar-tab-b-nib-1440-light.png, S1.3-6-editor-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-009 | capture | P0 | gap: Nib replay draft track has no markers for the hidden 500 or the uncaught error; Jam shows both. DOM replay with pointer glyph in both | 2 clicks both. Row to editor: Jam 1.7 s median (load 4.9 to 5.7); Nib 0.7 s median (load 3.1 to 3.6) | Same replay modal, last 30 s trimmed by default; replay row sits between record and link rows in both | gap | S1.4 step 3; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.4-3-replay-draft-nib-1440-light.png, S1.4.json; Jam: research/jam-private/parity/G1-jam.md |
| J-010 | capture | P0 | match: full span about 2 minutes, above 0 and at most 120 s, after over 150 s on the page; nothing reaches the server before create in both | Handles dragged fully out in both | Same trim handles and length label | match | S1.4 steps 4 and 5; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.4-4-replay-full-span-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-013 | ext-ui | P1 | match: timer gains the cap suffix and turns warn then danger colour before the cap; Nib stops at 60.1 s and opens the draft (Jam: E8, 5:00 free cap, soft while a bar tool is open). Upsell card skipped (scope) | No user steps in either | Suffix inside the timer, bar widens, colour steps amber then red in both | match | S1.6 step 3; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.6-3-timer-warn-nib-1440-light.png, S1.6-3-timer-danger-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md (E8) |
| J-014 | capture | P1 | match with no device: permission tab opens, closes itself in about 0.6 s, pill stays off, no message in both. With a device (Nib only) the voice stream is recorded | gap: on Nib the first grant leaves the pill off because the popup closes when the tab takes focus, so the user opens the popup and clicks the pill again (2 extra clicks) | Same pill in the record row, same permission-tab flow | gap | S1.6 steps 1 and 2; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.6-1-permission-tab-nib-1440-light.png, S1.6-1-pill-after-nib-1440-light.png, S1.6.json; Jam: research/jam-private/parity/G1-jam.md |
| J-015 | ext-ui | P1 | match: short link copied at once and shown with a copy button in both | Without a folder 3 clicks both; with a folder Nib 4 (native select), Jam 5 (folder button, pick). Create to clipboard: Jam 0.5 s (load 6.2, unreliable); Nib 0.15 s median of 3 (load 2.6) | Form replaces the popup body in both: name, recorder domain with a red dot, folder, create bottom-right; Nib shows the folder as a labelled select | better | S1.5; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.5-1-link-form-nib-1440-light.png, S1.5-3-link-done-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-017 | dashboard | P1 | | | | | |
| J-025 | ext-ui | P0 | n/a | Arm in 2 clicks both | gap: Nib pill sits 20 px below the pointer, Jam 5 px (both 5 px right); Nib pill 169x32 vs Jam 201x36 (11 percent lower). Page not dimmed in both | gap | S1.1 step 4; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.1-4-cursor-pill-nib-1440-light.png, S1.1.json; Jam: research/jam-private/parity/G1-jam.md |
| J-026 | ext-ui | P1 | n/a | Escape exits in both; exit through the popup 2 clicks (icon, exit row) in both | gap: while armed Nib greys the recording-link row and drops the exit row's chevron; Jam keeps both active. Exit row red in both, record row greyed in both | gap | S1.1 steps 7 and 8; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.1-8-exit-row-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-027 | ext-ui | P0 | n/a | gap: record-row click to live timer Jam 4.4 s (load 4.6, one take); Nib 5.0 s median of 6 (load 3.4 to 6.0), 5.5 s in the run at load 5.9. Same 3, 2, 1 cadence | Veil plus centred card plus bar counting at bottom centre in both. Jam also blurs the page under the veil and its card is larger (about 345x131 vs 195x100); Nib only greys it | gap | S1.2 step 1; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-1-veil-2-nib-1440-light.png, S1.2-1-first-live-frame-nib-1440-light.jpg, S1.2.json; Jam: research/jam-private/parity/G1-jam.md |
| J-028 | ext-ui | P0 | n/a | Same controls in the same order: stop, pause, timer, mic, divider, pen, blur | gap: Nib bar 275x40 vs Jam 293x46 (height 13 percent lower, width 6 percent narrower). Bottom gap 70 vs 69 px, centred in both. Mic hover tooltip in both | gap | S1.2 step 2; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-2-bar-nib-1440-light.png, S1.2-2-mic-hover-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-029 | capture | P1 | match: timer frozen during the 5 s pause and the video is shorter than wall time by the paused span in both | 2 clicks both | Pause icon flips to resume, pen greyed while paused (Jam); same bar position | match | S1.2 step 6; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-6-paused-nib-1440-light.png, S1.2-6-resumed-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-030 | ext-ui | P1 | match: strokes appear in the recording; 12 colours, red preselected in both | Pen, draw, done: 2 clicks and 2 drags both | gap: Nib fades each stroke 3.2 s after it ends; Jam fades all strokes together about 1.8 s after the last one ends. Palette replaces the bar in both | gap | S1.2 step 7; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-7-pen-colours-nib-1440-light.png, S1.2-7-strokes-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-031 | ext-ui | P1 | match: element blurred in the page and in the video; recording paused while the tool is open in both | 7 clicks both. Nib done leaves the tool; Jam done did not (Escape needed) | Hover outline and blur, unblur and undo in the bar in both; Nib hover outline hugs the card | better | S1.2 step 8; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-8-blur-hover-nib-1440-light.png, S1.2-8-blurred-nib-1440-light.png, S1.2-after-frame-34800ms.jpg; Jam: research/jam-private/parity/G1-jam.md |
| J-032 | capture | P0 | match: one capture across SPA change and reload in both | Bar survives the SPA change in both. Bar back after Ctrl+R: Jam 5 to 6 s (load 7.7, unreliable); Nib 0.5 s (load 5.4), timer counting | Bar returns at bottom centre after reload in both | match | S1.2 steps 10 and 11; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-11-gap-nib-1440-light.jpg, S1.2-11-bar-back-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-033 | ext-ui | P1 | n/a | No user steps | Red camera action icon, Chrome tab indicator, Chrome sharing strip below the bar on desktop in both | match | S1.2 step 3, S1.3 step 3; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-3-toolbar-icon-nib-1440-light.png, S1.2-3-tab-strip-nib-1440-light.png, S1.3-3-sharing-strip-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-034 | capture | P1 | match: draft healthy and playable with a non-zero length in both (Nib 5 of 5) | Stop to editor: Jam 5.2 s (load 11.4, unreliable); Nib 1.4 s median of 5 (load 2.0 to 5.8) | Spinner with a log-gathering label on the bar in both | match | S1.2 step 13; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-13-processing-nib-1440-light.png, S1.2-13-editor-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-035 | ext-ui | P1 | n/a | No user steps | Draft pill in the header, capture rows greyed, link row active in both; Nib pill shows a count without words | match | S1.2 step 14; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-14-draft-pill-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-037 | editor | P0 | | | | | |
| J-038 | editor | P0 | | | | | |
| J-039 | editor | P0 | | | | | |
| J-040 | editor | P0 | | | | | |
| J-041 | editor | P0 | | | | | |
| J-042 | editor | P1 | | | | | |
| J-043 | editor | P0 | | | | | |
| J-044 | editor | P0 | | | | | |
| J-045 | editor | P0 | | | | | |
| J-046 | editor | P1 | | | | | |
| J-047 | editor | P1 | | | | | |
| J-048 | editor | P1 | | | | | |
| J-049 | editor | P0 | | | | | |
| J-051 | editor | P0 | | | | | |
| J-054 | server-core | P0 | | | | | |
| J-055 | capture | P0 | | | | | |
| J-056 | capture | P1 | | | | | |
| J-057 | capture | P0 | | | | | |
| J-058 | capture | P0 | | | | | |
| J-059 | capture | P0 | | | | | |
| J-060 | capture | P0 | | | | | |
| J-061 | capture | P1 | | | | | |
| J-062 | capture | P1 | | | | | |
| J-064 | capture | P1 | | | | | |
| J-067 | capture | P0 | | | | | |
| J-068 | capture | P0 | | | | | |
| J-069 | capture | P0 | | | | | |
| J-070 | capture | P0 | | | | | |
| J-071 | capture | P0 | | | | | |
| J-072 | viewer | P0 | | | | | |
| J-073 | capture | P1 | | | | | |
| J-074 | server-core | P1 | | | | | |
| J-077 | editor | P0 | | | | | |
| J-079 | editor | P0 | - | - | - | paused | docs/scope.md (owner) |
| J-080 | editor | P1 | | | | | |
| J-081 | editor | P1 | | | | | |
| J-083 | editor | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-084 | editor | P0 | | | | | |
| J-085 | editor | P0 | | | | | |
| J-086 | editor | P0 | | | | | |
| J-087 | server-core | P1 | | | | | |
| J-088 | editor | P1 | | | | | |
| J-090 | viewer | P0 | | | | | |
| J-091 | viewer | P1 | | | | | |
| J-092 | viewer | P0 | | | | | |
| J-093 | viewer | P1 | | | | | |
| J-095 | viewer | P1 | | | | | |
| J-097 | viewer | P1 | | | | | |
| J-098 | viewer | P1 | | | | | |
| J-099 | viewer | P1 | | | | | |
| J-100 | viewer | P1 | | | | | |
| J-101 | viewer | P0 | | | | | |
| J-102 | viewer | P0 | | | | | |
| J-103 | viewer | P0 | | | | | |
| J-104 | viewer | P1 | | | | | |
| J-105 | viewer | P0 | | | | | |
| J-106 | viewer | P0 | | | | | |
| J-107 | viewer | P1 | | | | | |
| J-108 | viewer | P1 | | | | | |
| J-110 | viewer | P0 | | | | | |
| J-112 | viewer | P0 | | | | | |
| J-113 | viewer | P1 | | | | | |
| J-114 | viewer | P0 | | | | | |
| J-117 | viewer | P0 | | | | | |
| J-118 | viewer | P1 | | | | | |
| J-119 | server-core | P1 | | | | | |
| J-121 | viewer | P0 | | | | | |
| J-122 | dashboard | P1 | | | | | |
| J-123 | auth | P1 | | | | | |
| J-124 | auth | P1 | | | | | |
| J-127 | viewer | P0 | | | | | |
| J-128 | viewer | P1 | | | | | |
| J-131 | viewer | P1 | | | | | |
| J-134 | viewer | P1 | | | | | |
| J-135 | viewer | P1 | | | | | |
| J-136 | dashboard | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-137 | dashboard | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-138 | dashboard | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-139 | dashboard | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-140 | dashboard | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-142 | dashboard | P1 | | | | | |
| J-145 | agent | P0 | | | | | |
| J-146 | agent | P0 | | | | | |
| J-147 | agent | P1 | | | | | |
| J-148 | agent | P1 | | | | | |
| J-149 | agent | P0 | | | | | |
| J-150 | agent | P1 | | | | | |
| J-151 | agent | P1 | | | | | |
| J-152 | agent | P1 | | | | | |
| J-153 | agent | P0 | | | | | |
| J-155 | agent | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-158 | dashboard | P0 | | | | | |
| J-159 | dashboard | P1 | | | | | |
| J-160 | dashboard | P1 | | | | | |
| J-161 | dashboard | P0 | | | | | |
| J-162 | dashboard | P0 | | | | | |
| J-163 | dashboard | P0 | | | | | |
| J-164 | dashboard | P1 | | | | | |
| J-165 | dashboard | P1 | | | | | |
| J-167 | dashboard | P1 | | | | | |
| J-168 | dashboard | P1 | | | | | |
| J-171 | dashboard | P1 | | | | | |
| J-172 | dashboard | P1 | | | | | |
| J-173 | dashboard | P1 | | | | | |
| J-176 | ext-ui | P1 | | | | | |
| J-179 | ext-ui | P1 | | | | | |
| J-180 | ext-ui | P0 | | | | | |
| J-181 | ext-ui | P0 | | | | | |
| J-182 | ext-ui | P0 | | | | | |
| J-184 | ext-ui | P1 | | | | | |
| J-185 | capture | P0 | | | | | |
| J-186 | capture | P0 | | | | | |
| J-187 | capture | P0 | | | | | |
| J-188 | capture | P0 | | | | | |
| J-189 | capture | P0 | | | | | |
| J-190 | ext-ui | P1 | | | | | |
| J-191 | dashboard | P0 | | | | | |
| J-193 | ext-ui | P1 | | | | | |
| J-194 | capture | P0 | | | | | |
| J-195 | capture | P0 | | | | | |
| J-196 | capture | P0 | | | | | |
| J-197 | editor | P0 | | | | | |
| J-198 | viewer | P1 | | | | | |
| J-199 | ext-ui | P1 | | | | | |
| J-200 | ext-ui | P1 | | | | | |
| J-202 | editor | P1 | | | | | |
| J-203 | dashboard | P1 | | | | | |
| J-205 | viewer | P1 | | | | | |
| J-209 | viewer | P1 | | | | | |
| J-210 | capture | P1 | match: no camera option in popup, chevron, bar or draft in both | n/a | n/a | match | S1.1 step 3, S1.3 step 2; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.1-3-chevron-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-211 | capture | P1 | gap: Nib mutes and unmutes from the bar (silence in the voice stream) but has no control to switch microphones during a recording. Jam: doc only | Mute and unmute 1 click each on Nib | Mic control on the bar | gap | S1.6 step 2; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.6-2-muted-nib-1440-light.png, S1.6.json; Jam: doc |
| J-217 | auth | P0 | | | | | |
| J-218 | ext-ui | P1 | n/a | gap: after Restart extension the editor stayed over the page in 2 of 3 Nib runs (orphan frame until reload); Jam closes it. Popup reopens by itself and the pill opens Drafts in both | Drafts screen in the popup with back arrow, thumbnail, host, age, view and trash in both | gap | S1.2 step 15; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-15-drafts-list-nib-1440-light.png, S1.2-15-after-restart-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-219 | editor | P1 | | | | | |
| J-220 | editor | P1 | | | | | |
| J-221 | auth | P1 | | | | | |
| J-222 | dashboard | P1 | | | | | |
| J-227 | server-core | P1 | | | | | |
| J-228 | dashboard | P1 | | | | | |
| J-229 | viewer | P1 | | | | | |
| J-230 | editor | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-238 | ext-ui | P1 | match: bar at the dragged spot in the video | 1 drag by the timer both; timer keeps counting | Bar stays where dropped in both | match | S1.2 step 5; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-5-dragged-nib-1440-light.png, S1.2-after-frame-20000ms.jpg; Jam: research/jam-private/parity/G1-jam.md |
| J-239 | ext-ui | P1 | n/a | 2 clicks to stop from the popup in both | Screenshot row greyed, record row turns into a red stop row with the mic pill, link row active in both | match | S1.2 step 12; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.2-12-popup-recording-nib-1440-light.png; Jam: research/jam-private/parity/G1-jam.md |
| J-240 | editor | P1 | | | | | |
| J-241 | dashboard | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-242 | dashboard | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-243 | viewer | P1 | | | | | |
| J-244 | agent | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-245 | agent | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-246 | agent | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-247 | agent | P1 | - | - | - | paused | docs/scope.md (owner) |
| J-248 | capture | P1 | | | | | |
| J-249 | dashboard | P1 | | | | | |
| J-250 | ext-ui | P1 | match: capture-phase pointerdown and click counters and the save count unchanged in both | n/a | n/a | match | S1.1 step 5; docs/parity/G1-replica.md; e2e/parity-shots/G1/S1.1.json; Jam: research/jam-private/parity/G1-jam.md |
| J-251 | dashboard | P1 | - | - | - | paused | docs/scope.md (owner) |
