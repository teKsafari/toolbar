# G5 replica results (Nib side)

Raw results of group G5 in `docs/parity/scenarios.md` (S5.1 to S5.3), run on the replica only. The Jam side and the match, better or gap verdicts belong in `docs/parity.md`. Product code was not changed in this step; bugs and loose ends are listed at the end.

Run on 2026-10-15. One full run of all three scenarios passed (12.3 min, 1-minute load 0.4 to 3.0). S5.3 was then run once more on its own (1.1 min, load 1.0 to 1.6) after a fix to the spec's page wait: the full run spent 30 s per dashboard page waiting for a hydration marker that only capture pages carry. The S5.1 and S5.2 values below come from the full run, the S5.3 values from the second run. Both S5.3 runs gave the same states, statuses and lists. Every timing was taken at load 2.7 or less.

## How to rerun

```sh
pnpm --filter @toolbar/extension build            # release build, closed shadow root
cd e2e && npx playwright test -c playwright.parity.config.ts G5           # all three
cd e2e && npx playwright test -c playwright.parity.config.ts G5 -g S5.2   # one
```

This run used a private copy of the release build (`PARITY_EXT_BUILD=chrome-mv3-g5`, a copy of `chrome-mv3` of 2026-10-14 21:49, the same build G4 used). Evidence lands in `e2e/parity-shots/G5/` (git-ignored): one `<scenario>.json` per scenario with every state, list, status and timing; screenshots are named `<scenario>-<step>-nib-<width>-<theme>.png`. The full run's log is `e2e/runs/parity-G5.log`.

## Rig

The G1 rig (`e2e/parity/rig.ts`): Playwright 1.63.0 Chromium, fresh profile, release build unpacked, action pinned, Xvfb `:130` with openbox, compose stack on :3000, owner `parity@example.com` signed in through the popup. Signed-out people and the other members (`mate@`, `creator@`, `viewer@example.com`) use a second, plain Playwright Chromium on the same display, with a fresh context per person and per shot, so no session leaks. Web pages are driven with Playwright, as in G4. The one extension step (S5.2 step 5, the draft) uses real X input through xdotool.

Owner scope (`docs/scope.md`): every Mailpit and email check was skipped. S5.2 step 6 (J-136, notification settings) is paused and was not run. No row of `docs/parity.md` was changed.

Deviations from the script:

- Captures reused: N1 is the S3.1 tab recording `parity S3.1 lab` (2:14) in the owner's workspace "parity's workspace". N4 is the S2.1 annotated screenshot, in the "parity" folder of the workspace "Parity". Ids come from `e2e/parity-shots/G3/S3.1.json` and `G2/S2.1-23-recording.json` (or `PARITY_N1`, `PARITY_N4`).
- S5.1 step 3: the capture page has no general-access control (bug 1). The spec sets members-only through the same API the page would call (`PATCH /api/v1/recordings/:id/share`) and sets it back to anyone the same way.
- S5.1 step 4: first contentful paint and load come from the page's own Performance API (paint and navigation entries) in a fresh signed-out context per run. No screen recording was taken.
- S5.2 step 5 needs a second member in N1's workspace. `mate@example.com` joined "parity's workspace" through the workspace invite link once, and stays a member. The mention comment was sent, checked in the API, then deleted.
- S5.2 step 4 cannot be undone (nobody can delete an anonymous comment, Jam's behaviour too). Each run leaves one more "anonymous parity note" on N4: there are 3 after this session's runs.
- S5.3 works in N4's workspace "Parity" and its "parity" folder. The spec makes "Parity" the owner's active workspace and puts "parity's workspace" back at the end. To make reruns repeatable it first removes `creator@` and `viewer@` from "Parity", cancels their pending invites and turns auto-approve off.
- S5.3 step 2 and step 3, "open the mail's link": mail is paused, so the spec opens the `/invite/<id>` page the mail would carry, with the id the inviter gets from `GET /api/v1/workspaces/:id/invites`.
- S5.3 step 3: a folder invite does not give a workspace seat. The viewer was first checked as a folder guest (bug 2), then got a Viewer seat through the header's invite modal and its invite page. Auto-upgrade was switched on with the members page switch and off again the same way. The capture the viewer created was a bare create (`POST /api/v1/recordings`), deleted right after.
- Shots: the share popover, the signed-out page, the folder share popover, the invite modal and the members page at 1440 and 390, light and dark. Transient states (copied label, menus, hovers, warnings, the native seat menu) at 1440 light. No sideways overflow in any 4-way shot.

## S5.1 Share links and the logged-out viewer (N1)

| Step | Row | Result |
|---|---|---|
| 1 | J-117 | 1 click on "Copy link": the label changes to a tick and "Copied" after 0.16 s and stays 2.0 s. The toast reads "Link copied". The clipboard holds the full share link `/s/<token>`. |
| 2 | J-118 | The caret opens a 360x291 popover under the button, right-aligned: a heading, two cards ("Full link", with every dev tools tab; "Without dev tools", with media, title, description and comments), and an access line with a globe ("Anyone with the link can view and comment"). The content-only card (2 clicks in all) copies a second link and toasts "Link without dev tools copied". Opened signed out, that link shows the media, title, description and comments, with 0 dev tools tabs and no dev tools toggle. Opened by the owner, the same link goes to the member page `/c/<id>` with the dev tools (5 tabs). |
| 3 | J-119 | No control in the popover: 0 selects, radios or menu buttons. The access line is plain text. After the API set members-only, the line reads "Only members of this workspace can open the link" with a lock, and the full link opened signed out lands on `/login?next=/s/<token>` ("Sign in to Nib"). Set back to anyone: the link opens the share page again. |
| 4 | J-198 | Full link, signed out, fresh context each time. First contentful paint 0.17, 0.27 and 0.22 s; load event 0.20, 0.30 and 0.25 s (load 1.9, 2.2, 2.2). Median: FCP 0.2 s, load 0.3 s. The page settled (network idle) about 1.3 s after navigation start. |
| 5 | J-121 | Signed out, every tab opens: Info (15 rows), Console (45), Network (17), Actions (25), Agent. Copy as cURL on `POST /api/fail` works (toast "cURL copied", a POST command with the body). Share at time works (`?t=12` on the clipboard, toast "Link to 0:12.00 copied"). Download works (`parity-S3.1-lab.webm`, 1.98 MB). The header holds only the product mark, "Sign in" and "Sign up". A click on the title opens no input, and neither title nor description is editable. The composer stays, with the placeholder "Leave a comment as a guest". |

## S5.2 Comments and notifications

| Step | Row | Result |
|---|---|---|
| 1 | J-127 | One seek-bar click to 0:05. One click in the composer: the send button is already a pill "at 0:05" (label "Comment at 0:05"). Two lines with Enter between them, then Ctrl+Enter. The composer clears in 0.1 s (first screencast frame at 145 ms, DOM 142 ms, load 2.7). The comment is listed at 150 ms and saved at 153 ms. |
| 2 | J-128 | One bubble above the seek bar at 5.1 s. Hovering it shows the author and both lines. With the video at 0:40, one click on the comment's "0:05" chip seeks to 0:05.0 and highlights the comment. The page did not scroll at 1440 or at 390: the player was already in view at both widths (media top 72 px and 101 px, comment top 476 px at 390), so the scroll-up could not be seen. |
| 3 | J-131 | The comment's menu button shows on hover. The menu holds Edit and Delete. Edit: inline field, " edited" typed, Save: the "(edited)" label shows (3 clicks). Delete: a warning dialog "Delete this comment?" with "This is permanent. The comment and its replies cannot be brought back.", then Cancel or Delete. Confirmed: the comment goes, the toast reads "Comment deleted", and the API no longer lists it (3 clicks). |
| 4 | J-134 | N4 signed out: the composer reads "Leave a comment as a guest". "anonymous parity note" and Ctrl+Enter post it as "Anonymous" with an "anonymous" tag and a letter avatar "A". As the owner (an admin): the comment shows with no menu, and `DELETE /api/v1/comments/:id` answers 403. |
| 5 | J-135 | Comment composer: "@" opens a picker with both members (mate, parity: avatar letter, name, email); "mat" filters to mate; Enter picks "@mate ". Sent, it is stored as a mention token with 1 mention id and renders as "@mate". Viewer description: "@" opens the same picker; Escape left it unsaved. Fresh screenshot draft (extension editor): "@" typed at the end of the field opens nothing (bug 4). Mailpit: skipped (scope). |
| 6 | J-136 | Paused (`docs/scope.md`, `FEATURE_EMAIL`). Not run. |

## S5.3 Folder sharing, invites and roles

| Step | Row | Result |
|---|---|---|
| 1 | J-122 | The folder page's "Share" button (1 click) opens a 380 px popover: title and "Copy link", an email field with a Viewer or Creator select and "Invite" (disabled until the address is valid), "People with access" with roles, and "General access" (a select: "Everyone in the workspace" or "Only people listed"). "Copy link" toasts "Folder link copied" and copies `/f/kbu7`. Inviting `viewer@example.com` as Viewer toasts "Invited viewer@example.com" and lists the address as "Invited". Mailpit: skipped. |
| 2 | J-123 | The header's "Invite" (1 click) opens "Invite people to Parity": the workspace invite link with Copy (joins as creator, works until 2026-11-13, "Reset link" for admins), then "Invite by email" with a seat select (Creator first, then Viewer) and a hint line per seat. "not-an-email" leaves Invite disabled; `creator@example.com` enables it. Sending (1 click) toasts "Invitation sent to creator@example.com" and lists it under Pending. The invite page reads "Join Parity" with the seat; after sign-in, one click on "Join Parity" gives `creator@` the Creator seat and makes Parity their active workspace. At 390 the header hides "Invite"; the same modal opens from the members page's "Add members". |
| 3 | J-124 | Members page: rows with avatar, name, email, a role button (Admin with an "owner" tag, Creator, Viewer) and last active. The role menu offers Viewer ("Views and comments"), Creator ("Makes captures and recording links") and Admin ("Manages the workspace, members and apps"). `viewer@` as a folder guest only (no seat): the folder page, the N4 page and the N4 API all answer 404 (bug 2). With a Viewer seat: N4 opens (200), commenting works, and `POST /api/v1/recordings` answers 403 ("This needs the creator seat or higher."). Auto-approve switched on: the same create answers 201 and the seat becomes Creator. The switch was turned off again. |

Click counts for the script's named steps: S5.1 step 1 = 1, step 2 = 2; S5.2 step 1 = 2 and a chord, step 3 = 3 for an edit and 3 for a delete; S5.3 step 1 = 1 to open, step 2 = 2 (Invite, Invite).

## Bugs and loose ends (not fixed in this step)

1. No general-access control on the capture page (J-119). The share popover shows the access as a line of text. Members-only is only reachable through `PATCH /api/v1/recordings/:id/share`. The server side works: signed-out visitors go to the sign-in page, and the popover's line follows the setting.
2. Folder guests get no access (J-122). Inviting an address to a folder adds a `folder_member` row, but nothing gives that person access: as a signed-in guest with no workspace seat, the folder page, the capture page and the capture API all answer 404. The row made for an address with no account keeps its empty user id after that person signs up, so the popover keeps showing "Invited". Inviting the same address again after sign-up adds a second row, and the popover then lists the address twice ("Invited" and "Viewer").
3. With mail paused, email invites have no delivery path, yet the UI still offers "Invite by email" in the invite modal and the folder popover, and toasts "Invitation sent". The invitee can only join through the workspace invite link (creator seat), or through an `/invite/<id>` page whose id only the inviter's API can see. Same kind of scope loose end as G4 bug 3.
4. The extension editor's description field has no @ mention picker. The comment composer and the viewer description have one.
5. Under 520 px the dashboard header hides "Invite". The modal is still reachable from Settings, Members, "Add members".
6. Someone with only a Viewer seat sees "Send to app" (a paused tracker feature) and the three-dot menu with "Move to folder" in the capture header. This was not exercised.

S5.2 step 2's scroll-up has no result to report: at 1440 and at 390 the player and the comment fit on the first screen. Showing it needs a longer comment list or a shorter viewport.
