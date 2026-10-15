# G7 replica results (Nib side)

Raw results of group G7 in `docs/parity/scenarios.md` (S7.1 to S7.4), run on the replica only. The Jam side and the match, better or gap verdicts belong in `docs/parity.md`. Product code was not changed in this step; bugs and loose ends are listed at the end.

Run on 2026-10-15. Each runnable scenario first ran once alone (S7.1, S7.2, S7.4), then G7 ran in full once (5.1 min, 1-minute load 0.4 to 2.3). Every value below comes from the full run; the solo runs gave the same states, counts and texts, with timings within 0.1 s. Every timing was taken at load 2.3 or less.

## How to rerun

```sh
pnpm --filter @toolbar/extension build            # release build, closed shadow root
cd e2e && npx playwright test -c playwright.parity.config.ts G7           # S7.1, S7.2, S7.4 (S7.3 skips)
cd e2e && npx playwright test -c playwright.parity.config.ts G7 -g S7.1   # one
```

S7.4 deletes N7, so run S7.2 before each S7.4 (the full file does). The run used a private copy of the release build (`PARITY_EXT_BUILD=chrome-mv3-g7`, a copy of `chrome-mv3` of 2026-10-14 21:49, the build G4 to G6 used). Evidence lands in `e2e/parity-shots/G7/` (git-ignored): one `<scenario>.json` per scenario with every state, list, status, click count and timing; screenshots are named `<scenario>-<step>-nib-<width>-<theme>.png`. Logs: `e2e/runs/parity-G7.log` (full run), `parity-G7-s71.log`, `parity-G7-s72.log`, `parity-G7-s74.log` (solo runs).

The server was the compose image built 2026-10-14 20:58 EDT (health version 1792025872427), the same one G6 ran against. It predates the owner-scope commits (81bba98 and later), so paused features (Integrations, CLI, Notifications, Audit log, AI and retention settings, "Send to app", magic link) still show in it. See loose end 1.

## Rig

The G1 rig (`e2e/parity/rig.ts`): Playwright 1.63.0 Chromium, fresh profile, release build unpacked, action pinned, Xvfb `:130` with openbox, compose stack on :3000, owner `parity@example.com` signed in through the popup. Web pages are driven with Playwright, as in G4 to G6, with the colour scheme set again after each navigation (the G6 rig fix). The popup (S7.2), the lab page clicks and typing, and the screenshot click use real X input through xdotool. The other people (`creator@`, `viewer@` and a throwaway account) and signed-out visitors use a second, plain Chromium on `:130` with a fresh context each.

Rig change: the sideways-overflow check now compares `scrollWidth` with `clientWidth` and records the overflow in pixels. The G4 to G6 check compared it with `innerWidth`, which counts the 15 px classic scrollbar this Chromium draws, so it missed overflows below 15 px. It caught one here (bug 2).

Owner scope (`docs/scope.md`): S7.3 is paused and was not run. S7.1 step 7's magic link and Mailpit check was skipped. No row of `docs/parity.md` was changed.

## Deviations from the script

- S7.1 works in the workspace "Parity" (the S5.3 members live there). The spec makes it active first, puts the owner back in "parity's workspace" at the end, and for repeatable runs sets `viewer@` back to the Viewer seat through the API (S5.3's auto-approve check had left it Creator), rejoins `creator@` through the workspace invite link when an earlier run made them leave, and deletes the "Parity 2" an earlier run of step 5 made, with SQL (nothing in the product closes a workspace, J-249).
- S7.1 step 6: the creator needed a capture in "Parity" to show that captures stay. The spec made one as `creator@` through the upload API (`parity S7.1 creator capture`, a ready screenshot) just before they left. The throwaway account (`g7-throwaway-<ms>@example.com`) got its capture the same way, so Garage held its media before the delete.
- S7.1 step 7: the signed-out shot is of `/login`. The sign-up path (`/login?mode=signup`) shows the same page.
- S7.2 step 4: the screenshot click went to (1200, 600) on `/form`, an empty part of the page.
- S7.4 step 4: the video frames were read by pausing N1's player at 59.8 s, 63.8 s and 68.4 s (the S3.1 form step runs from 54.8 s to 70.4 s), not by playing through.
- Shots: every settings page of the script (layout with the nav, general, members), the create-workspace form, the sign-in page and N7's not-found page at 1440 and 390, light and dark. At 390 the layout shot opens the settings drawer. Transient states (menus, toasts, dialogs, the popup) at 1440 light.

## S7.1 Settings pages, members, workspaces and sign-in

| Step | Row | Result |
|---|---|---|
| 1 | J-171 | Dashboard, workspace menu, "Settings": 2 clicks to `/settings/workspace`. A 240 px nav column on the left: a "Back to captures" link with an arrow at the top (to `/`), the workspace name ("Parity"), then three groups in this order: Workspace (General, Members, Privacy and data, Audit log), Apps and tools (Integrations, SDK, MCP, CLI, Webhooks, API), Account (Profile, Notifications, API tokens, Connected browsers). Content in a centred 680 px column. Audit log and Webhooks show for admins only. At 390 the nav becomes a drawer behind a menu button in a top bar with a back arrow and "Settings". |
| 2 | J-172 | General: three sections. Workspace: a logo button (upload) and the name field ("Parity", saved on blur or Enter). Access: single sign-on line (no OIDC provider configured on this server), default link access (Anyone with the link, Workspace members only), join by email domain (on, domain example.com). Data: AI features switch (on), delete captures automatically (Never, 30, 60, 90, 180 days, a year), a link to the audit log. No control closes the workspace. |
| 3 | J-173, J-249 | Members (3 clicks from the dashboard). "Add members" top right. Invite link section: the switch (on), the link field `/invite/lQdK...` with Copy and Reset, the line "Expires in 29 days", "Only admins can invite" (off), "Approve new creators automatically" (off). Copy toasts "Invite link copied" and puts the link on the clipboard. A "3 members" table: Name (avatar, name, "you" tag, email), Role, Last active, a row menu. Your own row shows "Admin" with an "owner" tag as plain text (no seat menu), and its menu holds only "Leave workspace". Other rows' menus hold "Remove from workspace". A Guests section follows. No "delete" or "close workspace" button on General, Members or Privacy. |
| 4 | J-222 | Viewer's role button opens a menu: Viewer "Views and comments" (current, ticked), Creator "Makes captures and recording links", Admin "Manages the workspace, members and apps". Creator: toast "viewer is now creator" after 0.1 s (72 ms, load 2.3); the cell and the API say creator. Back to Viewer: toast "viewer is now viewer" after 0.1 s (51 ms, load 2.2). 2 clicks each way. |
| 5 | J-221 | The workspace menu lists "parity's workspace" (Admin) under "Switch workspace", and "Create or join a workspace" (2 clicks to the form). The form: heading, one line on what a workspace holds, a 56 px letter avatar ("?" while empty, "P" after typing), the name field, a ticked box "Let anyone with an @example.com email join this workspace" with the line "They join as viewers, and admins get an email", and "Next", disabled until a name is typed. "Parity 2" and Next: `/?created=1` after 0.1 s (load 2.2); "Parity 2" is the active workspace with the Admin seat, and the sidebar shows it. |
| 6 | J-249 | Leave: as `creator@`, their own row's menu holds only "Leave workspace". A dialog "Leave Parity?" says they lose access and that captures they made stay; "Leave" toasts "You left Parity" and lands on `/` (3 clicks). Their workspaces after: only "creator's workspace"; their capture answers 404 to them and 200 to the owner, still in "Parity", author "creator". Delete account: a throwaway account, sole member of its own workspace, with one screenshot (1 object in Garage under `rec/<id>/`). Profile, "Delete account": a dialog "Delete your account?" names the workspace that gets erased with its captures, folders, links and comments, and "Delete my account" stays disabled until DELETE is typed. Confirmed: back at `/login` after 0.2 s (load 2.2). After: 0 workspace rows, 0 user rows, 0 recording rows, 0 Garage objects under the capture's prefix; the old session gets 401. |
| 7 | J-217 | Signed out, `/login`: the product mark, "Sign in to Nib", the line "New here? The same steps create your account.", a "Work email" field, "Continue" and "Use a password instead". No provider buttons: no OIDC provider is configured on this server, and the image predates the scope change. The password path swaps in a password field and offers "Email me a sign-in link instead". Sign-up shows the same page. Magic link in Mailpit: skipped (scope). |

Clicks to each page from the dashboard: General 2, Members 3, the create-workspace form 2.

## S7.2 Extension settings and user-event capture off (N7)

| Step | Row | Result |
|---|---|---|
| 1 | J-176 | Icon, three-dot menu, Settings (2 clicks after the icon). The screen swaps into the popup (415x600) with a back arrow and "Settings", and scrolls (655 px of content in 564). Settings, in order: Open captures in a new tab (on), Capture clicks and typing (on, hint: password fields are never kept), Keyboard shortcuts ("Change", opens Chrome's shortcuts page), Instant replay (on in this fresh profile although the local default is off; the account holds extension settings, and G1 S1.4 turned replay on), Replay length (2 min), Blocked sites (opens a list; 83 sites), Send error reports (on), Server (`http://localhost:3000`, "Change"), Reset extension ("Reset", confirms on a second click). Each switch applies at once; there is no save button. |
| 2 | J-190 | "Capture clicks and typing" off (1 click); the stored setting is false. Escape closes the popup. |
| 3 | | `/form`: Name "no events", Email "x@example.com", typed through the X server. |
| 4 | | Visible screenshot (icon, Screenshot row, a click on the page), title "parity S7.2 no events", Create: ready 1.4 s after Create. Kind screenshot, no folder. N7 = `01a13e90-313b-75a9-95e8-2dc923da7874` (deleted in S7.4). |
| 5 | J-190 | Actions tab: 4 rows, none a click or typing row: "Loaded /" and "Loaded /embed" (from the earlier load of `/` before `/form`) and two "Tab hidden". The API agrees (4 actions, types navigation and visibility). Console: 2 rows. Network: 22 rows (the lab document, its scripts and the rest). |
| 6 | | Capture clicks and typing back on (icon, menu, Settings, switch: 4 clicks); stored true. |

## S7.3 Integrations

Paused by owner scope (`docs/scope.md`, `FEATURE_TRACKERS` and `FEATURE_SLACK`). Not run. Rows J-137, J-138, J-139, J-140, J-142, J-241, J-242, J-251 stay "paused" in `docs/parity.md`. The spec holds a skipped test for it.

## S7.4 Privacy and deletion (N1, N7)

| Step | Row | Result |
|---|---|---|
| 1 | J-185 | N1, Network, the `/api/ok?q=auth` request, Headers: Authorization, X-Api-Key and Cookie each show a shield badge "masked" in place of the value; none of the three secret values shows anywhere in the detail. "Copy as cURL" gives `-H 'authorization: <authorization>'`, `-H 'x-api-key: <x-api-key>'` and `-H 'cookie: <cookie>'`, with no secret value. |
| 2 | J-186 | POST `/form`, Payload: `name=Ada%20Lovelace&email=[redacted]&password=[redacted]&notes=token%20sk_live_51Hparity0000%20card%20[redacted]`. Email and password replaced, the card number replaced inside Notes, the `sk_live_` key-like string in clear, the name in clear. |
| 3 | J-187 | Actions tab (25 rows); the form part: "Navigated to /form" (0:56), "Click on input Name" (0:58), "Click on input" (the Email field, 1:00), "Typed masked text into textarea Notes" (1:08). The Notes typing row is masked as a whole because it holds a card number; its stored value is the text with the card number replaced. The click rows hold no value attribute at all (attributes: selector, role, name, landmarks; the API keeps type and name). Typing rows for Name, Email and Password are missing, and so are the Password and Create account clicks (G3 bug 1), so the asterisk rule for email and password rows could not be seen. Name typing does not show in clear either, since that row is missing. |
| 4 | J-188 | Frames of N1's video at 59.8, 63.8 and 68.4 s: the Email field reads "ada@example.com", the Name field "Ada Lovelace"; the password shows as dots (the browser's own masking); at 68.4 s Notes shows the `sk_live_` token and the card number "4242 4242 4242 4242" in clear. The video is not masked. |
| 5 | J-189 | From G1 S1.4 step 5: captures in `GET /api/v1/recordings` 9 before and 9 after the two replay drafts. From G2 S2.4 step 7: the saved draft's capture id is not listed while the draft sits saved (15 listed). |
| 6 | J-114 | N7, three-dot ("Move to folder", "Delete"), Delete: a centred 420x164 dialog "Delete this capture?" saying it is permanent, that the image or video, the logs and the comments go and that every share link stops working, with Cancel and Delete. Confirm: toast "Capture deleted" after 0.2 s (151 ms), dashboard URL after 0.2 s, dashboard settled after 0.7 s (load 1.5). Solo run: 0.1 s, 0.2 s and 0.7 s (load 1.3). 3 clicks. |
| 7 | J-191, J-205 | Within 21 ms of the delete: `GET /api/v1/recordings/<id>` 404, the screenshot media URL 404 (200 before), the thumbnail URL 404. Not on the grid, not in the list API. N7 was in no folder, so the folder check has nothing to show. Ctrl+K "S7.2 no events": 0 results, with "Nothing matches" and a hint line. `/c/<id>`: title "Not found", one line "This capture could not be found." The share link `/s/<token>` answers 404 with the same line. No sideways overflow in the four not-found shots. |

## Bugs and loose ends (not fixed in this step)

1. The running image predates the owner-scope commits. Paused features still show: the settings nav lists Integrations, CLI, Notifications and Audit log; General has the AI switch and auto-delete (retention); the capture header has "Send to app"; the sign-in page offers the magic link ("Email me a sign-in link instead"); the create-workspace form says admins "get an email". Rebuild the image before the Jam comparison of these rows.
2. Members page at 390: the page overflows sideways by 4 px (light and dark); the bottom of the shot shows a horizontal scrollbar. The member table's columns are tight (Last active wraps to three lines). The G4 to G6 overflow check could not catch an overflow this small (see "Rig").
3. J-187: the user-event capture still drops most form rows (G3 bug 1): no typing rows for Name, Email or Password, no Password or Create account click. Masking of email and password typing rows could not be checked on N1.
4. J-188: the video shows the typed email, the card number and the key-like token in clear. That is the same as Jam per the script; the network body and the actions already mask the card number.
5. J-186: the `sk_live_` key-like string stays in clear in the request body and in the Notes typing row, while the card number in the same field is replaced.
6. S7.2: with user-event capture off, the actions tab has no row for the `/form` load, yet it lists "Loaded /" and "Loaded /embed" from the earlier page and two "Tab hidden" rows. It shows no empty state, since navigation rows count as content there.
7. J-217: with no OIDC provider configured, the sign-in page offers email only. The provider list of the scope (one generic OIDC button) could not be seen on this server.
8. The dark sign-in page's "Continue" button (disabled while the field is empty) has a dark label on a muted indigo fill, hard to read.
9. S7.1 leaves test data behind: "Parity 2" (the owner's, from the full run), two "parity S7.1 creator capture" screenshots in "Parity" (one per run), and `creator@` no longer a member of "Parity" (S5.3's setup and this spec's setup both handle that). Both throwaway accounts deleted themselves.
