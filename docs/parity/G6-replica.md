# G6 replica results (Nib side)

Raw results of group G6 in `docs/parity/scenarios.md` (S6.1 to S6.3), run on the replica only. The Jam side and the match, better or gap verdicts belong in `docs/parity.md`. Product code was not changed in this step; bugs and loose ends are listed at the end.

Run on 2026-10-15. One full run of all three scenarios passed (8.4 min, 1-minute load 0.4 to 2.1). Before it, S6.1 ran once alone, and S6.2 ran three times alone (see "Runs"). After it, S6.3 ran once more alone, because step 6 had failed on a locator in the full run. The tables give the full run's values for S6.1 and S6.2 and the second S6.3 run for S6.3, with the earlier runs' numbers where they differ. Every timing was taken at load 2.2 or less.

## How to rerun

```sh
pnpm --filter @toolbar/extension build            # release build, closed shadow root
cd e2e && npx playwright test -c playwright.parity.config.ts G6           # all three
cd e2e && npx playwright test -c playwright.parity.config.ts G6 -g S6.2   # one
```

This run used a private copy of the release build (`PARITY_EXT_BUILD=chrome-mv3-g6`, a copy of `chrome-mv3` of 2026-10-14 21:49, the build G4 and G5 used). Evidence lands in `e2e/parity-shots/G6/` (git-ignored): one `<scenario>.json` per scenario with every state, count, click tally and timing, plus `S6.1-run2.json`, `S6.2-run1.json`, `S6.2-run2.json` and `S6.3-run1.json` from the other runs. Screenshots are named `<scenario>-<step>-nib-<width>-<theme>.png`. Logs: `e2e/runs/parity-G6.log` (full run), `parity-G6-s61.log`, `parity-G6-s62.log`, `parity-G6-s62-run2.log`, `parity-G6-s63-run2.log`.

The server was the compose image built 2026-10-14 20:58 EDT (health version 1792025872427). Commit 899c25c (23:44 EDT, workspace menu overflow) is newer and not in it; see bug 3.

## Rig

The G1 rig (`e2e/parity/rig.ts`): Playwright 1.63.0 Chromium, fresh profile, release build unpacked, action pinned, Xvfb `:130` with openbox, compose stack on :3000, owner `parity@example.com` signed in through the popup. Dashboard pages are driven with Playwright, as in G4 and G5. The signed-out recorder-page shots use a second, plain Chromium on `:130` with a fresh context per shot. The link recipient of S6.3 uses a third Chromium (no extension, no profile, no sign-in, no fake media flags) on a private display (`:170`, Xvfb plus openbox, made by `e2e/fixtures/xvfb.ts`), since Chrome's share picker crashes Chromium when other browsers draw on its display (`docs/spikes.md` S2). Chrome's picker got real X clicks through xdotool there. It did not crash in either run.

Rig fix found on the way: in the extension rig, a navigation to a signed-in page drops Playwright's emulated `prefers-color-scheme` (the login page keeps it; a plain browser keeps it everywhere). `openUrl` in `G6.spec.ts` sets the scheme again after `goto`, so every G6 dark shot is dark. G4 and G5 open pages the same way without that second call, so their "dark" shots of signed-in pages are light (checked: `e2e/parity-shots/G5/S5.1-2-popover-nib-390-dark.png`).

Owner scope (`docs/scope.md`): the Mailpit check of S6.3 step 5 was skipped. No row of `docs/parity.md` was changed.

## Deviations from the script

- Workspaces. The owner has two: "parity's workspace" (active; holds N1, N5, the folder "parity" and the six recording links of S1.5's three runs, named "parity link", "parity link 2" and "parity link 3") and "Parity" (holds N4 in its own folder "parity"; G2 made it). S6.1, S6.2 steps 1 to 4 and S6.3 work in "parity's workspace". The spec sets it active through `PUT /api/v1/me/active-workspace` before each scenario.
- S6.2 step 4 needs N4 and N5 on one grid, and N4 sits in the other workspace. The S3.3 pre-roll screenshot (`parity S3.3 pre-roll`, a visible screenshot of the lab, like N4) stood in for N4 on the grid. Step 5 used the real N4, on its own capture page.
- S6.2 setup, for repeatable runs: folders a broken run left behind (`parity-s1`, `parity-tmp`, `parity-tmp2`, `parity-warn`) are deleted through the API, and N5 and the stand-in are moved back to no folder through `POST /api/v1/recordings/bulk`.
- S6.2 step 1. The script makes "parity", which S1.5 needs first; G1 made it through the API. In the first complete S6.2 run the folder did not exist (see the incident below), so step 1 made "parity" through the sidebar as scripted. Later runs find it and make "parity-s1" with the same flow; the spec deletes "parity-s1" through the API at the end.
- S6.2 step 3 warning shots at 390 and in dark: the scripted warning (for "parity-tmp2") is shot at 1440 light and then confirmed. For the other three variants the spec made an empty folder "parity-warn" through the API, opened the same warning on it, cancelled and deleted the folder through the API.
- S6.3 step 2: the copied link is the newest "parity link" (`/rl/B26b...`, made by S1.5's first run). The recipient had a lab tab open before opening the link, so "the lab tab" of step 4 exists. Tab switches went through Playwright's `bringToFront` and count as one click each.
- S6.3 step 3: "Continue without voice" in Nib is the "Record without voice" button, which starts the recording at once. The script's separate "Start" click of step 4 does not exist; the picker opens straight after it.
- Shots: grid, hover, filter chips, both palette states, the member palette, the folder page, the selection bar, the delete warning, N4's capture page, the links page, the recorder page, the landed capture and the workspace menu at 1440 and 390, light and dark (390 sidebar shots open the drawer first). Transient states (heading hover, the unfocused input, menus, pickers, toasts, the mic notice, Chrome's picker, the review) at 1440 light. No sideways page overflow in any 4-way shot (but see bug 3).

### Incident: the spec deleted the folder "parity" of "parity's workspace"

The first S6.2 attempt failed at step 1 (bug 1: typing went nowhere), so the rename of step 3 never opened "parity-tmp". Step 3's delete then ran on the page still open, the folder "parity", and confirmed. The folder was empty (0 captures, checked in the database: no capture deleted), but the six "parity link" recording links lost their target folder (`ON DELETE SET NULL`). The spec now checks the folder title before every delete. The next run made "parity" again through the sidebar (short id `qk9s`; the old one was `z8ct`), and the six links were pointed back at it with one SQL update on `recording_link.folder_id`. Evidence from earlier groups that names `/f/z8ct` now points at a folder that no longer exists.

## S6.1 Grid, hover, filters and the palette

| Step | Row | Result |
|---|---|---|
| 1 | J-158 | "All captures" with a count (33). 3 columns at 1440 (cards at x 274, 656, 1039), 1 at 390. Newest first, filled row by row. Card parts on the 30 loaded cards: thumbnail 28 (the two instant replays show a video icon instead), creator overlay 30 (avatar letter and name), duration pill 21 (videos and replays; none on screenshots), title 30 (no fallbacks needed), relative time 30 ("1 h ago"). No card had a link chip at that point; S6.3 shows one ("parity link") on the recipient's capture. The workspace holds 35 ready captures; the 2 in "parity" (N5 and the stand-in, left there by the earlier S6.2 run) are absent: grid total 33 = API `folderId=none` total, and 0 filed ids on the grid. Captures still "uploading" (13 old tab recordings) are not listed. |
| 2 | J-159 | Hover: the card rises 2 px and gains a shadow; the checkbox (opacity 0 to 1) takes the creator overlay's place (1 to 0); a round copy-link button shows top right. Copy link (1 click): toast "Link copied" after 0.07 s; the clipboard holds `/c/<id>` (the member page link, full URL). Middle-click opens `/c/<id>` in a new tab and leaves the grid in place: the card is a real `<a href>`. |
| 3 | J-160 | Type, Source and Creator are buttons with a popover of options; 2 clicks each plus Escape to close. Video, Extension and parity give three chips "Video", "Extension", "By parity" and the URL `/?type=video&source=extension&by=<id>`; with the creator set to yourself the heading reads "Created by me". Reload: same URL, same 3 chips, same total (22). Each chip has a clear button: 3 clicks clear all three, the URL drops one parameter per click, total back to 33. Option click to results: 0.4, 0.4 and 0.4 s (load 1.6, 1.6, 1.5); first run 0.4, 0.3 and 0.5 s (load 0.7). |
| 4 | J-161 | Ctrl+K opens a centred palette. Empty: "Recently viewed", 8 rows (thumbnail, title, creator and time), footer "8 results", "Ctrl C Copy link", "Enter Open capture". Typing "S3.1 lab" (60 ms per key): one group "Captures" with both "parity S3.1 lab" rows, a preview at the right (thumbnail with 1:22, title, creator, time, page URL, and the matched field "Title" with "S3.1 lab" highlighted), footer "2 results". Last key to results: 0.1, 0.1 and 0.2 s (load 2.1; 112, 122 and 158 ms, median 0.1 s); first key to results 0.6 to 0.7 s. Down moves the selection to row 2, Up back to row 1. Ctrl+C toasts "Link copied" (0.03 s) and copies `/c/<id>` of the selected row. Enter opens that capture and closes the palette. At 390 the preview pane is hidden. |
| 5 | J-228 | On N1's capture page Ctrl+K opens the same palette. "parity" gives three groups in this order: "Members", "Folders", "Captures"; the member row is selected; footer "37 results" and "Enter Show their captures". Enter opens `/?by=<id>`: heading "Created by me", one chip "By parity". |

## S6.2 Folders

| Step | Row | Result |
|---|---|---|
| 1 | J-163 | The plus beside "Folders" is hidden (opacity 0) until the heading is hovered (1). One click on it shows a field "Folder name" at the top of the list, but the plus keeps the focus, so typed text goes nowhere (bug 1). With a click into the field (2 clicks in all), "parity" and Enter toast `Folder "parity" created` after 0.17 s and list it after 0.25 s (load 0.8); later runs 0.07 s and 0.04 s to the toast. The page stays on `/`. |
| 2 | J-162 | "parity-tmp" the same way (2 clicks, toast after 0.03 to 0.09 s). The sidebar lists "parity", "parity-s1", "parity-tmp": alphabetical, each with a folder icon. Opening "parity" (1 click) gives `/f/qk9s` (4-character id), the title "parity" with its count beside it, and the count (0 at that point) beside the active sidebar row. |
| 3 | J-164 | The folder page's three-dot menu holds "Rename" and "Delete folder". Rename opens a dialog with the field prefilled ("parity-tmp"), focused and fully selected (0 to 10). "parity-tmp2" and Enter: toast `Renamed to "parity-tmp2"` (0.03 to 0.08 s), title and sidebar follow (2 clicks). Delete: a warning dialog `Delete "parity-tmp2"?` saying it permanently deletes the folder and every capture in it and that their share links stop working, with Cancel and "Delete folder". Confirmed: toast `Deleted "parity-tmp2"`, back to `/`, gone from the sidebar (3 clicks). |
| 4 | J-165 | Ticking N5's checkbox (shown on hover) turns the header into a selection bar: a clear button, "1 selected", Move and Delete. A plain click on the stand-in's card adds it ("2 selected"). Move opens a folder list (No folder (all captures), the folders, New folder); "parity" moves both at once: toast "Moved 2 captures to parity" after 0.16 to 0.20 s, both cards gone after 0.21 to 0.23 s (load 1.2 to 1.5). 4 clicks for two cards, 3 for one. Inside "parity", both ticked again and Delete: a dialog "Delete 2 captures?" saying it is permanent, share links stop working and the media is erased; Cancel closes it, both captures still answer 200, and the selection stays ("2 selected"). |
| 5 | J-113 | N4's capture page: the folder chip reads "parity". Three-dot, "Move to folder", "No folder" (3 clicks): toast "Moved out of the folder" (0.08 to 0.15 s), chip "All captures". Three-dot, "Move to folder", "parity" (3 clicks): toast "Moved to parity" (0.05 to 0.14 s), chip "parity". The submenu lists No folder, parity, New folder; the current place is disabled. The chip links to `/f/<folder uuid>`, which opens (200). |

Click counts: move one card from the grid 3 (tick, Move, folder), two cards 4.

## S6.3 Recording links, a recipient's recording (N6), the workspace menu

| Step | Row | Result |
|---|---|---|
| 1 | J-167 | "Recording links" with a lead line and "New link" top right. Filters: a segmented status control (Active, Turned off, All), a Creator button, a Sort select (Newest, Oldest, Most used, Name). One row per link, newest first (6 rows, 3 names twice). The "parity link" row: a 2x2 mosaic (empty in run 1; one thumbnail after run 1's recording), the name with a rename pencil, the creator (avatar, "parity"), the use count ("0 recordings", then "1 recording"), "made 3 h ago" or "last 5 min ago", a folder chip "parity" with a caret (retargets the link), Share, "Captures" (`/?link=<id>`) and a three-dot menu with "Turn off" and "Delete". "New link" opens a form: name, "Save recordings in" (All captures, parity), ticket URL, a line saying the recorder records video and voice only, and "Create and copy". |
| 2 | J-167 | Share, "Copy link" (2 clicks): toast "Link copied" (0.09 to 0.13 s); the clipboard holds `http://localhost:3000/rl/B26b...`, the link the API lists. Opened in the recipient's fresh Chromium: the product mark, "parity at parity's workspace asked you to record", the heading "parity link", one line on what happens, two choices ("Screen only", selected, and "Screen and voice"), "Start recording", and a footer line saying only video and voice are recorded. |
| 3 | J-200 (link half) | "Screen and voice", then "Start recording": no microphone exists, so a notice "No microphone was found" says to plug one in and try again, with "Record without voice"; the start button becomes "Try again with voice". The notice came without a permission prompt in between. The step-by-step instructions only show for a refused microphone (a lock icon, Allow, reload, macOS privacy settings), which this rig cannot produce. |
| 4 | J-017 | "Record without voice" starts at once and Chrome's picker opens (shot `S6.3-4-picker`): Entire Screen tab, the screen, Share (3 real X clicks). Recording shows after 4.8 to 5.0 s from opening the link. Lab tab, "Submit order (hidden 500)", back to the recorder, Stop: a review with the video player, a note field, "Record again" and "Send recording". Note "parity recipient", Send: "Sent. Thank you. parity got your recording and your note." after 0.25 to 0.28 s. 11 steps and 12 clicks from opening the link: choose voice, start, record without voice, 3 in the picker, lab tab, Submit order, recorder tab, Stop, the note field, Send. Open to sent: 9.7 s (load 1.1) and 10.1 s (load 0.7), with about 4 s of recording. |
| 5 | J-017 | As the owner: the capture (kind `link`, about 4.0 s, ready, description "parity recipient", no title) is in "parity", listed with a "parity link" chip and the guest creator ("Guest", title fallback "A guest's recording"). The link's use count went from 0 to 1 (run 1) and 1 to 2 (run 2); the links page shows "1 recording", then "2 recordings". Mailpit: skipped (scope). |
| 6 | J-168 | The workspace button (avatar, "parity's workspace", a three-dot glyph) opens a menu: the current workspace with "2 members" and an "Admin" chip, Settings, Members, "Switch workspace" with "Parity" (Admin), "Create or join a workspace", the signed-in address and "Sign out" (1 click). Escape closes it. At 390 the menu is wider than the drawer (bug 3). |

N6: two recipient captures exist, `01a13e7b-2446-7e8a-ac23-e8308f117034` (run 1) and `01a13e7f-df2b-7b3f-9ce9-94706e847625` (run 2), both in "parity" of "parity's workspace".

## Runs

| Run | Scenarios | Outcome |
|---|---|---|
| A | S6.1 alone | All steps passed. Dark shots were light (rig fix above); the shots were taken again in run D. |
| B | S6.2 alone | Step 1 and 2 failed (bug 1, no click into the field); the incident above. |
| C1, C2 | S6.2 alone | C1 made "parity" in step 1; its step 4 delete-cancel failed on a locator (two confirm dialogs in the page). C2 passed. |
| D | G6 in full | S6.1 and S6.2 passed with every check; S6.3 passed except step 6 (a stale class selector; the deployed menu is older than the source). |
| E | S6.3 alone | Passed, step 6 included. |

## Bugs and loose ends (not fixed in this step)

1. New folder from the sidebar (J-163): after the plus click, the field shows but does not take the focus, so the name a person types goes nowhere until they click into the field. The field relies on the `autofocus` attribute, which Svelte 5 applies only while nothing else has the focus, and the plus button keeps it. One extra click (2 instead of 1). Other fields that open from a button with `autofocus` likely behave the same: the new-link name, the folder picker's "New folder" field, the move menu's new-folder dialog. Those were not measured.
2. Instant replay cards on the grid have no thumbnail; they show a video icon on grey (2 of the 30 loaded cards).
3. At 390, the workspace menu (J-168) is wider than the 270 px drawer: the drawer scrolls sideways and the seat chips ("Admin") are cut off. Commit 899c25c addresses this in the source, but the running image predates it. The page itself does not overflow.
4. Scope loose end: the links page lead says "you get an email" when a recording lands, and mail is paused (`FEATURE_EMAIL`). Same kind as G5 bug 3.
5. The recipient's capture has no title; the grid and the palette show "A guest's recording". The link's name ("parity link") shows only as the chip. A title preset (`?title=`) exists on the recorder page but the plain link carries none.
6. Cancelling a bulk delete keeps the selection ("2 selected"). Not a fault, noted for the Jam comparison.
7. Rig: G4 and G5 dark shots of signed-in pages are light (see "Rig"). Those shots need taking again with the `openUrl` change before their dark ergonomics can be judged.
