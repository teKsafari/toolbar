# ext-ui status

Area 3 (branch `area/ext-ui`). One line per ext-ui row of `docs/tasks.md` plus X-07. "e2e" means a spec in `e2e/tests/ext-ui/` that passed on the private display `:113` (44 tests); the capture driver in those runs is the test fake in `lib/bg/ui.ts`, so the media side (video file, screenshot image, editor) is not part of them. Unit tests: `packages/shared/test/ext-ui.test.ts`, `apps/extension/test/ui-controller.test.ts`.

| ID | Status | How verified, or what is missing |
|---|---|---|
| X-07 | built | Tokens already in place; added icons (camera, clock, help, globe, eye, power, logout, keyboard, book, bug, grip, mic-denied), `Switch` and `Segmented`. Token contrast unit test; popup e2e reads the token background in light and dark. |
| J-001 | built | e2e `popup.spec` J-001: screenshot, record, link rows (replay row when on), home and menu icons, rows 370x40 with 8 px gaps. |
| J-003 | built | e2e `screenshot.spec` J-003: amber tint box and live `300 × 200` readout follow the drag; the worker receives exactly `{x:100,y:150,w:300,h:200}`. The crop image and the editor come from capture (J-002) and editor (J-037). |
| J-005 | built | e2e: 3 s from the chevron, badge bottom-left counts down, cancel pill bottom-right, shot at zero, setting back to off; cancel leaves no shot. Choices are off, 3 s and 6 s (`screenshotDelaySec` gained the literal 6). |
| J-011 | partial | Popup side built and e2e'd (heavy badge, in-popup warning, continue calls `replay.set {allowHeavy}`), with `replay.set` stubbed. Missing: capture's heavy detection (`page-weight`) and the `replay.set` handler with `heavyOverride`. |
| J-012 | partial | Settings list built and e2e'd: 83 default domains (`DEFAULT_REPLAY_BLOCKED_SITES`), add by domain, trash removes; replay row reads "Off on this site". Missing: the ring must skip blocked sites; capture calls `isReplayBlocked(url, settings.replayBlockedSites)` from `@toolbar/shared/areas/ext-ui`. |
| J-215 | partial | Client built and e2e'd against a mock server: popup open pulls `GET /me/settings` (replay on, minutes, video), every toggle `PATCH`es `{extension}`. Missing: dashboard's `/me/settings` routes. |
| J-013 | partial | Bar shows `m:ss / cap`, orange in the last 30 s, red in the last 10 s, worker stops at the cap; e2e with a 13 s cap from `bootstrap.limits.maxRecordingMs`. Missing: auth fills `maxRecordingMs` from `MAX_RECORDING_MIN` in `ext.bootstrap`. No upsell (skip list). |
| J-015 | partial | Form built and e2e'd against a mock server: name, folder, create, link copied and shown with a copy button that flips to a tick. Missing: dashboard's `POST /workspaces/:id/recording-links` and `GET .../folders`. |
| J-232 | built | e2e: recorder-domain picker shows the server host with a red dot; its menu has that domain ticked and a line saying it records video and voice only. No green state (skip list). |
| J-016 | built | e2e: help icon opens three cards, next pages through them, the last offers create. |
| J-019 | built | e2e: on the server's own origin the record row reads "Record full screen"; on chrome://extensions the J-199 state shows. Unit test on `ui.context`. |
| J-023 | skipped | Skip list (D-016). |
| J-024 | skipped | Skip list (D-016). |
| J-025 | built | e2e: chord arms in under 0.5 s; pill at pointer +5/+20 px after the first move; overlay transparent (no dimming); pill names the delay when set. |
| J-250 | built | e2e: clicking "Save (works)" in screenshot mode takes a full shot, the save counter stays 0 and capture-phase `pointerdown`/`click` listeners on document count 0. Window capture-phase guard installed at document_start (`ui/guard.ts`). |
| J-026 | built | e2e: Escape removes the pill; armed popup shows a red exit row, other rows greyed; clicking it exits. |
| J-027 | built | e2e: grey veil (50 %), bar counts 3, 2, 1 at bottom centre, live under 6.4 s from the chord; a click on the veil pauses, a second resumes. |
| J-028 | built | e2e: dark pill 40 px tall, about 300 px wide, centred, 70 px above the bottom: stop, pause, timer, mic, divider, pen, blur, in the shadow root; mute and unmute. At merge: check the bar in capture's stored tab video. |
| J-238 | built | e2e: dragging the timer moves the bar to mid page; it stays and the timer keeps counting. At merge: check the new spot in the video. |
| J-030 | built | e2e: 12 swatches, red first and selected; perfect-freehand strokes fade after 2.5 s; page sees no pointer events; `recording.mark {pen}` reaches the worker and `driver.mark()`. At merge: capture writes the marker event the viewer shows. |
| J-031 | built | e2e: blur pauses the recording, click blurs (CSS filter on the page element), second click unblurs, undo and done work, done resumes, blurs clear when the recording ends. |
| J-033 | built | e2e: action icon is a red camera while recording (drawn with OffscreenCanvas), default after stop; the countdown shows on the badge. |
| J-239 | built | e2e: during recording the popup greys screenshot, shows a red stop row with its mic pill, keeps the link row; stop ends in a draft. |
| J-035 | built | e2e: with a draft open the header pill counts drafts and is inert, only the link row is live; after `SAVE_FOR_LATER` rows return and the pill opens Drafts. |
| J-218 | built | e2e: Drafts rows 70 px with a 66x50 thumbnail (IndexedDB `blobs`, read-only), host, age, view and trash; trash turns into a red confirm and the second click calls `draft.discard`. `draft.open` and `draft.discard` themselves are editor's. |
| J-036 | built | e2e: blur on the countdown bar holds the count, the element is blurred before the recording starts and stays blurred. At merge: first video frame. |
| J-089 | built | e2e: the switch saves `openInNewTab` at once. At merge: editor's `draft.create` must read it. |
| J-176 | built | e2e: menu, settings screen in place (scrolls at 560 px), switches save at once, shortcuts link, replay with length and site list, error reports, server, reset with an in-place confirm. |
| J-226 | covered by J-001 | Not run: needs Chrome's site-access control. Runtime script registration and the popup do not depend on all-sites access. |
| J-177 | partial | e2e: menu has docs, report, restart; restart reloads the extension and the new worker reopens the popup (own browser with developer mode). Missing: auth fills `bootstrap.supportRecordingLink` from an env value; until then report opens the issue tracker. |
| J-179 | built | e2e `keys.spec`: real Ctrl+Shift+Y via xdotool on :113 opens the popup. |
| J-180 | built | e2e: real Ctrl+Shift+S arms in under 0.5 s with no popup. |
| J-181 | built | e2e: real Ctrl+Shift+Space starts with the countdown and stops. |
| J-182 | built | e2e: real Ctrl+Shift+X opens a replay draft with no popup (fake driver; the replay itself is capture's J-009). |
| J-183 | built | e2e: `commands.getAll()` lists `recording-link` with no key; it opens the popup on the link form. |
| J-184 | built | e2e: settings link opens chrome://extensions/shortcuts. Rebinding and global scope are Chrome's own page; not automated. |
| J-212 | built | e2e: 2 s hover shows `Ctrl+Shift+S` in a dark pill; it reads `commands.getAll()` on every hover, so a rebinding shows at once (not automated). |
| J-190 | built | e2e: switch saves `captureUserEvents`. At merge: capture stops user events when it is false. |
| J-193 | covered by J-001 | e2e: popup painted under 1.7 s (popup reads storage directly; no zod in the popup bundle). |
| J-199 | built | e2e: chrome://extensions shows the restricted illustration and line; chords there leave the session idle with no message. |
| J-200 | partial | e2e: denied mic greys the bar's mic button with a "permission is missing" tooltip and ignores clicks. Missing: the link recorder's instructions and record-without-voice modal (dashboard's recorder page, J-017). |
