# Capture area status

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

## Counts after the completer pass

| Priority | Built | Covered | Skipped | Partial | Missing |
|---|---|---|---|---|---|
| P0 (24) | 20 | 4 (J-188, J-194, J-195, J-196) | 0 | 0 | 0 |
| P1 (12) | 11 | 1 (J-210) | 0 | 0 | 0 |
| P2 (9) | 5 | 2 (J-022, J-235) | 2 (J-076, J-192) | 0 | 0 |

X-04 is built as well. Known limits:
- J-235 ran in Chromium only, because Edge and Brave are not on this VM.
- The lab has no GraphQL or binary-socket fixture, so the e2e routes `/graphql` and opens its own socket.
- UI parts of these rows (popup rows, bar, countdown veil, editor, viewer badges) belong to ext-ui, editor and viewer.
