# Viewer area status (Part 1, step 2)

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
| J-096 | built | e2e media.spec "J-096": chapter pill list seeks; bar split at the edge. Chapters come from navigations until AI chapters exist (D-V02) |
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
| J-118 | built | e2e page.spec "J-118": two cards; content-only page has media, title, description, comments, no dev tools (interim `?devtools=0`, D-V05). The flag is not enforced on the server yet: a recipient who removes the parameter sees dev tools. Needs a per-link flag from server-core |
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
