# ext-ui status

Area 3 (branch `area/ext-ui`). One line per ext-ui row of `docs/tasks.md` plus X-07, after a second, independent pass that ran every check again.

How things were verified:

- **e2e** means a spec in `e2e/tests/ext-ui/` that passed on the private display `:113` (46 tests, `E2E_DISPLAY=:113`). The capture driver in those runs is the test fake in `lib/bg/ui.ts`, so the media side (video file, screenshot image, editor) is not part of them.
- **trial merge** means the second pass merged `area/dashboard` (which already contains `area/auth`) into a throwaway branch, pushed the merged schema to `toolbar_ext_ui`, seeded it, ran the server on 3103 with `MAX_RECORDING_MIN=1`, and drove the real popup against it with the seed token. The throwaway branch is deleted; nothing from it is committed here.
- Unit tests: `packages/shared/test/ext-ui.test.ts`, `apps/extension/test/ui-controller.test.ts`.

Counts (41 rows): P0 8 built. P1 16 built, 1 partial (J-200), 1 covered (J-193). P2 8 built, 4 partial (J-011, J-012, J-089, J-177), 2 skipped (J-023, J-024), 1 covered (J-226). X-07 built. Every partial row is complete on the ext-ui side and waits on another area's path.

| ID | Pri | Status | How verified, or what is missing |
|---|---|---|---|
| X-07 | - | built | Tokens in place; icons (camera, clock, help, globe, eye, power, logout, keyboard, book, bug, grip, mic-denied), `Switch` and `Segmented`. Token contrast unit test; popup e2e reads the token background in light and dark. |
| J-001 | P0 | built | e2e: screenshot, record, link rows (replay row when on), home and menu icons, rows 370x40 with 8 px gaps. Trial merge: signed in with the seed account, the popup loads and fetches the bootstrap; the menu shows sign out. Screenshots compared with ergonomics.md (header, rows, chevrons, mic pill, menu). |
| J-003 | P0 | built | e2e: tinted box and live `W × H` readout follow the drag; the worker receives exactly the dragged rect. The crop image and the editor are capture (J-002) and editor (J-037). |
| J-005 | P2 | built | e2e: 3 s from the chevron, badge bottom-left counts down, cancel pill bottom-right, shot at zero, setting back to off; cancel leaves no shot. Choices off, 3 s, 6 s (D-036). |
| J-011 | P2 | partial | Popup side e2e (heavy badge, in-popup warning, continue calls `replay.set {allowHeavy}`). Missing (capture): heavy-page detection. `area/capture` always writes `heavy: false` and has no `allowHeavy` path, so the badge never shows after merge. |
| J-012 | P2 | partial | Settings list e2e: 83 default domains, add, trash removes; the replay row reads "Off on this site". `area/capture` skips the ring for blocked sites (`ringWanted`), read but not run. It compares `URL.host` (with port) against our hostnames; it should call `isReplayBlocked(url, settings.replayBlockedSites)` from `@toolbar/shared/areas/ext-ui`. |
| J-215 | P2 | built | e2e against a mock server, and trial merge against dashboard's real `/me/settings`: turning replay on in the popup reaches the account; turning it off on the account turns it off locally on the next popup open. |
| J-013 | P1 | built | e2e: `m:ss / cap`, orange in the last 30 s, red in the last 10 s, stop at the cap with reason `cap`; also from a chord-started recording with no bootstrap cached (the worker fetches `ext.bootstrap`, D-038). Trial merge: auth's bootstrap gives 60000 ms for `MAX_RECORDING_MIN=1`; the timer showed `/ 1:00`, went orange then red, and the recording stopped at 1:00. No upsell (skip list). |
| J-015 | P1 | built | e2e against a mock server, and trial merge: the form lists the seed folder, creates a real link in it on dashboard's route, copies it and shows it with a copy button. |
| J-232 | P2 | built | e2e: recorder-domain picker with the server host and a red dot; its menu has that domain ticked and says it records video and voice only. No green state (skip list). |
| J-016 | P2 | built | e2e: help icon opens three cards, next pages through them, the last offers create. |
| J-019 | P2 | built | e2e: on the server's own origin the record row reads "Record full screen"; on chrome://extensions the J-199 state shows. |
| J-023 | P2 | skipped | Skip list (D-016). |
| J-024 | P2 | skipped | Skip list (D-016). |
| J-025 | P0 | built | e2e: chord arms in under 0.5 s; pill at pointer +5/+20 px after the first move; no dimming; pill names the delay when set. |
| J-250 | P1 | built | e2e: clicking "Save (works)" in screenshot mode takes a full shot; the save counter stays 0 and capture-phase `pointerdown`/`click` listeners on document count 0 (D-035). |
| J-026 | P1 | built | e2e: Escape removes the pill; armed popup shows a red exit row, other rows greyed; clicking it exits. The exit row has no delay chevron. |
| J-027 | P0 | built | e2e: 50 % grey veil, bar counts 3, 2, 1 at bottom centre, live under 6.4 s from the chord; a click on the veil pauses, a second resumes. A countdown cut off by a worker restart is cancelled (D-038). |
| J-028 | P0 | built | e2e: dark pill 40 px tall, about 275 to 300 px wide, centred, 70 px above the bottom: stop, pause, timer, mic, divider, pen, blur, in the shadow root; mute and unmute. At merge: the bar in capture's stored tab video. |
| J-238 | P1 | built | e2e: dragging the timer moves the bar to mid page; it stays and the timer keeps counting. At merge: the new spot in the video. |
| J-030 | P1 | built | e2e: 12 swatches, red first and selected; strokes fade after 2.5 s; the page sees no pointer events; `recording.mark {pen}` reaches the driver. At merge: capture writes the marker event. |
| J-031 | P1 | built | e2e: blur pauses the recording, click blurs, second click unblurs, undo and done work, done resumes, blurs clear when the recording ends. |
| J-033 | P1 | built | e2e: action icon is a red camera while recording, default after stop; the countdown shows on the badge. |
| J-239 | P1 | built | e2e: during recording the popup greys screenshot, shows a red stop row with its mic pill and no record-mode chevron, keeps the link row; stop ends in a draft. |
| J-035 | P1 | built | e2e: with a draft open the header pill counts drafts and is inert, only the link row is live; after `SAVE_FOR_LATER` rows return and the pill opens Drafts. e2e: closing the tab mid-recording ends in the Drafts list with the session idle (D-038). |
| J-218 | P1 | built | e2e: Drafts rows with a 66x50 thumbnail, host, age, view and trash; trash turns into a red confirm, the second click calls `draft.discard`. `draft.open` and `draft.discard` are editor's. |
| J-036 | P2 | built | e2e: blur on the countdown bar holds the count; the element is blurred before the recording starts and stays blurred. At merge: first video frame. |
| J-089 | P2 | partial | e2e: the switch saves `openInNewTab` at once. Missing (editor): `area/editor` does not read `openInNewTab` when it creates, so a new tab still opens. |
| J-176 | P1 | built | e2e: menu, settings screen in place (scrolls at 560 px), switches save at once, shortcuts link, replay with length and site list, error reports, server, reset with an in-place confirm. |
| J-226 | P2 | covered by J-001 | Not run: needs Chrome's site-access control. Script registration and the popup do not depend on all-sites access. |
| J-177 | P2 | partial | e2e: menu has docs, report, restart; restart reloads the extension and the new worker reopens the popup. Missing (auth): `bootstrap.supportRecordingLink` is null on `area/auth` (trial merge), so report opens the issue tracker. |
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
| J-200 | P1 | partial | e2e: a denied mic greys the bar's mic button with a "permission is missing" tooltip and ignores clicks. Missing (dashboard): the link recorder page on `area/dashboard` has no instructions or record-without-voice choice for a denied mic. |

## For the merge

1. **Two session stores.** `area/capture` built its own session (`lib/capture/service.ts`, `CaptureService`) and answers `session.get`, `capture`, `screenshot.*`, `countdown.*`, `recording.*` and the keyboard commands in `lib/bg/capture.ts`. ext-ui answers the same requests in `lib/bg/ui.ts` (D-034). With both registered, both run side effects and the first reply wins. The textual conflicts are only `background.ts` and `docs/decisions.md`, so git will not flag this. The fix: capture keeps its media code and implements `CaptureDriver` (`prepareRecording`, `startRecording`, `stopRecording`, `pause/resumeRecording`, `setMic`, `mark`, `takeScreenshot`, `triggerReplay`, `cancelRecording`), installed with `setCaptureDriver()`, and drops its handlers for the requests listed above. Capture keeps `replay.set`, `replay.trigger`, `mic.*`, `clipboard.write`, the port and the offscreen events.
2. **Editor** must call `dispatch()` from `lib/bg/ui.ts` for CREATE, UPLOAD_DONE, UPLOAD_FAILED, DISCARD and SAVE_FOR_LATER, and DRAFT_READY when `draft.open` reopens a draft; `area/editor` sends `ui.editor-open` itself and calls none of them. It must also read `openInNewTab` (J-089).
3. **Auth**: add `supportRecordingLink: process.env.SUPPORT_RECORDING_LINK || null` to the bootstrap (J-177). The popup's signed-out screen calls `auth.signIn` and the menu calls `auth.signOut`; auth's `AccountCard.svelte` is not mounted.
4. **Capture**: heavy-page detection and `replay.set {allowHeavy}` (J-011); `isReplayBlocked()` for the blocked-sites test (J-012).
5. **Dashboard**: the recorder page's denied-mic instructions and record-without-voice (J-200).
