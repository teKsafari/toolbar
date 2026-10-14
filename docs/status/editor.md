# Editor area status

Branch `area/editor`. Unit tests: `packages/ui/test/editor-model.test.ts` (29), `apps/server/test/ai.test.ts` (10). E2E: `e2e/tests/editor/*.spec.ts` (29 tests, Playwright on Xvfb `:114`, test build of the extension, lab app on 5173). Create-flow e2e runs against `e2e/tests/editor/mock-server.ts`, a stand-in for the server-core routes (`POST /recordings`, `/assets`, `/finalize`) built from the route contracts, until server-core lands. `POST /api/v1/recordings/:id/ai-draft` was checked with curl against the real server on 3104 (seed capture c1): 503 with `AI_PROVIDER=none`, 503 for a screenshot, 404 for an unknown id, 200 with ghost text through a fake OpenAI-compatible endpoint.

- J-004: built. E2E: area draft shows the ticked full-viewport card; create uploads the flattened crop (kind crop) and the full viewport with the marks placed on it (kind screenshot); unticked sends `fullScreenshotAssetId: null` and one asset. The viewer's switcher is J-209 (viewer area).
- J-037: built. E2E: in-page iframe over the dimmed lab page, modal 1380x730 at 1440 px wide, preview pane about 72% with close button and tool pill, form on the right, field focused; a hostile page stylesheet does not reach it.
- J-216: built (decision D-E02: match). E2E: five wheel steps over the preview scroll the page more than 100 px; the preview stays put.
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
- J-049: built. E2E: create, move, recolour, delete are four steps by button and Ctrl+Z; redo button replays them; both buttons grey when empty. Ctrl+Shift+Z and Ctrl+Y redo as well (deliberate better, D-E06).
- J-050: built. E2E: a 600 ms hover shows a dark tooltip naming each tool, with key badges V, D and T only.
- J-051: built. E2E: the uploaded PNG has the ink outline at the rectangle edge and an untouched inside; shapes are flattened client-side from the same primitives as the live layer. The viewer showing only that PNG is the viewer area's part.
- J-052: built (deliberate better). E2E: Ctrl+C, Ctrl+V adds a copy 10 px over, one undo step.
- J-053: built (constraint). No crop, zoom, eraser, highlighter, step badges or stickers in the editor.
- J-240: built (constraint). E2E: a video draft has no tool pill; play and trim take its place.
- J-077: built. E2E: field focused on open; first line renders as a 20 px title and goes to `title`, later lines to `description`; an empty title creates.
- J-078: built. E2E: "- ", "1. " and Ctrl+B become a bullet list, a numbered list and bold; finalize gets Markdown (`**matter**`, `- `, `1. `). Rendering in the viewer is the viewer area's part (format in D-E05).
- J-079: built, part skipped (skip list: Jira, Linear, ClickUp, Notion, Azure DevOps, Asana). E2E: menu defaults to share link and lists GitHub (connected), GitLab and Slack (connect), webhook (settings); picking GitHub shows repo and labels and finalize gets the integration destination. Filing the issue is J-137 (dashboard/server).
- J-080: built. E2E: two workspaces in the second dropdown; switching reloads folders and integrations (J-251) and sends the picked `workspaceId` to create and finalize.
- J-081: built. E2E: folder button lists no folder plus each folder; the pick reaches finalize and the next fresh draft preselects it.
- J-082: built. E2E: a PNG and a .txt attached with the paperclip are kept with the draft and upload as `attachment` assets listed in `attachmentAssetIds`. Showing them on the capture page is the viewer area's part.
- J-083: built. E2E (mock provider): ghost title, summary, steps with time links and result within 6 s; time links seek; Tab accepts; `aiAccepted` reaches finalize; the switch is disabled with a reason on screenshots and when the server has no provider; the on or off choice persists. Server: Summarizer interface, curl-verified route, unit tests.
- J-230: built (decision D-E03: match). E2E: a click after "Submitting" in the ghost title accepts and typing lands at that point.
- J-084: built. E2E: play starts at the left grip, clicking the video toggles play, clicking the bar seeks, length spelled out ("8 seconds"); a frame becomes the draft thumbnail. Also better than J-034: a MediaRecorder WebM without a duration header shows its real length.
- J-085: built. E2E: both grips grey the cut, scrub the preview and update the length; Ctrl+Z and Ctrl+Shift+Z undo and redo each drag; trim and `durationMs` reach finalize. Cutting events and media on the server is J-227 (server-core); `eventsInRange()` in `@toolbar/ui/editor` is the same cut.
- J-086: built. E2E: create shows a spinner and a toast, the editor closes in about 1 s, the link is on the clipboard, the capture opens in a background tab directly right of the source tab, the draft is deleted. Against the mock server until server-core's routes land.
- J-220: built. E2E: Ctrl+Enter with focus in the title creates.
- J-088: built. E2E: close discards a screenshot draft at once; Escape shows a press-again toast, a second press within 1 s discards, a late second press asks again.
- J-219: partial. E2E: a reopened video draft's close button reads "Save for later", closes the editor, shows a toast with a view button that reopens it with trim and AI text intact; the draft is stored with status `saved`. Missing here: the popup's draft pill and enabled capture rows (ext-ui, J-035, reads `nib:drafts` which this area keeps in sync).
- J-197: built (budget of J-086). E2E: create to closed editor with the link copied measured at 0.6 to 1.5 s on the mock server; one run under heavy machine load took 7.7 s.
- J-202: built (covered by J-086). The link is copied from the extension-origin editor frame (`clipboardWrite` permission, `allow="clipboard-write"`), never from the page, so the page gets no clipboard prompt.
