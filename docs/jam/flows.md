# Jam user journeys

Measured on 2026-10-13 in the shared Chromium (1584x952 window, viewport 1584x865) on a slow VM, extension 5.90.0, free plan. Times are machine time from an action to the next visible state unless marked wall clock; treat them as upper bounds. Machine load was not logged with them; a later review at a load average near 14 saw times two to ten times longer, so the next speed pass should record load next to each timing. Clicks count pointer actions in Jam's UI only. Catalogue IDs in brackets.

## A. Screenshot with one mark, to a link on the clipboard

Fastest path, keyboard first.

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Press the screenshot chord on the page [J-180] | key | under 0.5 s to armed; the only cue is the pill trailing the pointer |
| 2 | Click anywhere to grab the viewport (or drag for an area) [J-002, J-003]; the page never receives this click, so landing on a live button is safe [J-250] | 1 click | editor fully painted 1.3 s (lab), 3.4 s (Nuru, with a short fade-in); area up to 5.6 s |
| 3 | Pick the rectangle tool [J-039] | 1 click | instant |
| 4 | Drag a box | 1 drag | instant; tool returns to select, box stays selected |
| 5 | Optional: type a title (field already has focus) [J-077] | typing | - |
| 6 | Click create, or press Ctrl+Enter in the form [J-086, J-220] | 1 click or key | editor closes 1.5 s; link on the clipboard 4.2 s; new background tab about 6 s; toast gone about 11 s |

Total: 1 key and 4 pointer actions (3 plus a chord with Ctrl+Enter). A practised user gets from key to copied link in 8 to 10 s. Through the popup instead of the key: add 2 clicks and 1.7 to 3 s for the popup to paint. One slower run took 10 to 12 s from create to a working link.

## B. Tab video with a bug, to a link

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Press the record chord [J-181] | key | veil and countdown at 1.2 s; 3, 2, 1 to 4.0 s; starting spinner to 5.6 s; live at 6.4 s |
| 2 | Reproduce the bug on the page | page clicks | recording length |
| 3 | Optional: drag the bar off the bug area [J-238]; pen or blur from the bar [J-030, J-031]. Marks must be made now, since the draft has no drawing tools [J-240] | 1 drag; 1 + drags | strokes fade after 2 to 3 s |
| 4 | Press the chord again, click the red stop on the bar, or open the popup and click its stop row [J-239] | key, 1 click or 2 clicks | editor at 1.9 s best case; 12 to 17 s typical on lab pages; 25 s on Nuru; once never, see M. About one draft in three opens broken at 0 seconds with nothing playable (5 of 15 tab recordings, 4 of 6 in the later sessions), and the only way on is to close it and record again [J-034] |
| 5 | Wait for the AI draft, press Tab to accept [J-083] | key | ghost text at about 5.8 s after the editor opens; a click inside the ghost title also accepts it and leaves the caret there [J-230] |
| 6 | Optional: drag trim handles [J-085] | 1 drag per end | live |
| 7 | Click create, or press Ctrl+Enter in the form [J-220] | 1 click or key | link on the clipboard 1.6 to 4 s (upload ran during the draft); background tab at about 6 s; video playable for a logged-out viewer about 40 s after create |

Total Jam input: 2 chords, 1 Tab, 1 click. Through the popup: icon and record row replace the first chord (+2 clicks); the red stop on the bar, or icon and stop row in the popup, replace the second.

If you trimmed, the viewer shows a trimming placeholder until the server finishes (about 3 minutes once). Logs and events in the cut part are dropped from the capture, and AI text written before the trim is not rewritten, so trim before accepting the AI draft [J-227].

## C. Instant replay of something that already happened

One-time setup: icon, three-dot menu, settings, enable toggle. 4 clicks, no permission prompt. The popup then has a fourth row.

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Use the page; the bug happens | - | rolling buffer of at most the last 2 minutes, starting at the last page load; shorter on a fresh tab or a page with heavy DOM churn [J-010] |
| 2 | Press the replay chord, or icon and replay row [J-182, J-009] | key or 2 clicks | editor shell 3.2 s; replay loaded 4.6 s; create enabled 5.9 s |
| 3 | Optional: widen the trim (it defaults to the last 30 s) | 1 drag | live |
| 4 | Type a title, click create | 1 click | link on the clipboard 2.5 s |

Total: under 10 s with no reproduction. On pages Jam judges heavy, a warning dialog in the popup adds 2 clicks [J-011].

## D. Desktop recording across tabs

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Open the popup, open the record chevron, switch to desktop (sticky) | 3 clicks | popup paint 1.7 to 3 s |
| 2 | Click the record row | 1 click | Jam's bar shows a waiting state while Chrome's share picker opens |
| 3 | Pick a source and confirm in Chrome's picker | 2 clicks | live about 5 s after confirming; no countdown |
| 4 | Switch tabs as needed [J-008] | - | bar follows into each tab |
| 5 | Click the red stop | 1 click | 5 to 9 s of log gathering, then the editor in the current tab |
| 6 | Click create | 1 click | as in B |

Total: 8 clicks the first time, 6 once the desktop choice is stored. A cancelled picker aborts with no message [J-201].

## E. Ask someone else to record (recording link)

Sender:

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Open the popup, click the recording-link row | 2 clicks | - |
| 2 | Optional name, recorder domain, folder | 0 to 2 clicks | - |
| 3 | Click create | 1 click | about 2 s; link copied automatically |

Recipient, no extension:

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Open the link, keep screen only or pick screen plus voice | 0 to 1 click | - |
| 2 | Click start, pick a source in Chrome's picker, confirm | 3 clicks | recording starts on confirm; a small always-on-top control window opens |
| 3 | Click stop | 1 click | review page with player |
| 4 | Optional note, click submit | 1 click | success state; the sender gets an email |

Sender total 3 to 5 clicks; recipient about 5. The resulting capture has video only unless the site has Jam's scripts.

## F. Open a received link and find the failing request

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Open the link (logged out) | - | first contentful paint 6.5 s, load 8.2 s, branded loading screen until then |
| 2a | Hover the red status marker above the seek bar | 0 clicks | the pill shows the error text from the response body |
| 2b | Or click the network tab, then the pink failing row | 2 clicks | detail opens on headers with a red status dot |
| 3 | Click the response sub-tab | 1 click | JSON body in the code viewer |
| 4 | Optional: copy as cURL | 1 click | toast confirms |
| 5 | Optional: press Up or Down to step to the neighbouring requests; the pane follows and stays on the response sub-tab [J-243] | keys | instant |

Total: 0 clicks to see the cause, 3 to read the body. Trap: a marker can also stand for Jam's own failed font loads, which look like real failures and read xhr instead of a status [J-072, J-248].

## G. Comment at a moment in the video

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Seek: click a time link in the description, a gutter triangle in a panel, or the seek bar | 1 click | instant |
| 2 | Click the composer, type | 1 click | send button becomes a pill naming the time |
| 3 | Press Ctrl+Enter | key | composer clears in 0.2 s; timeline bubble at 0.8 s; a jump pill if the comment lands below the fold |

Total: 2 clicks and 1 chord. Without step 1 the comment has no time.

## H. File captures into a folder

| Path | Steps | Input | Time |
|---|---|---|---|
| Create a folder | Hover the sidebar heading, click plus, type, Enter | 1 click | under 1 s; toast |
| At create time | Folder button in the draft, pick a folder (sticks for later drafts) | 2 clicks | - |
| From the grid | Hover card, tick checkbox, move, pick folder | 3 clicks | 1.5 to 2 s to the toast |
| Drag | Drag a card onto a sidebar folder | 1 drag | list refreshes 2 to 4 s later |
| From the capture page | Three-dot, move submenu, pick folder | 3 clicks | - |

## I. Find an old capture

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Press Ctrl+K on the dashboard or a capture page | key | palette with recently viewed rows after about 1.5 s of skeletons |
| 2 | Type a few words | typing | results in 1 to 2 s, grouped as members, folders and captures, with a count in the footer [J-228] |
| 3 | Arrow to the row, Enter to open (or Ctrl+C to copy its link) | keys | - |

Filters instead: 1 click to open a filter, 1 per value, results in 1 to 3 s. Or type a teammate's name in the palette and press Enter on the member row: the all-captures list opens filtered by that author (key, typing, key).

## J. Hand a capture to a coding agent

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Workspace menu, settings, MCP page | 3 clicks | - |
| 2 | Click connect on your agent's card, copy the snippet | 2 clicks | - |
| 3 | Run the snippet in a terminal, make the first tool call | - | consent page opens in the browser |
| 4 | Click approve | 1 click | tokens and tool list about 5 s later |
| 5 | On a capture page, open the MCP tab, pick a preset, copy the prompt, paste it to the agent | 2 to 3 clicks | the agent run in our test took 91 s and 13 turns |

CLI route, per the public docs and not tried: install the CLI and log in from its settings page, install the skill, then the agent pulls details, failing requests, errors and frames at the failure time into local files, fixes the code and comments on the capture [J-155, J-247]. The agent can send proof back the other way: an annotated screenshot, a video with a Playwright trace, or a recording of the browser it drove, each landing as a normal capture with a link [J-244, J-245, J-246].

## K. Delete a capture

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Three-dot menu in the capture header, delete | 2 clicks | modal |
| 2 | Confirm | 1 click | toast at 1.3 s, redirect to the dashboard at 4.9 s |

The image file stayed reachable on the CDN for at least 30 s afterwards. The modal calls the delete permanent, but per Jam's security doc the capture is archived: gone from lists and search, kept in storage, with no trash to restore from [J-191].

## L. Invite a teammate

Dashboard header invite button, type an email, keep or change the role, click invite: 2 to 4 clicks. Or copy the team invite link from the same modal: 2 clicks. (Not sent during research.)

## M. Recover a recording stuck after stop

Seen in a review session at a load average near 2: the post-stop pill spun for over 3 minutes and the editor never opened [J-034].

| Step | Action | Input | Time |
|---|---|---|---|
| 1 | Open the popup, three-dot menu, restart the extension | 3 clicks | popup reopens itself after about 4 s |
| 2 | Click the unfinished-draft pill in the popup header [J-035] | 1 click | Drafts screen with one row per draft [J-218] |
| 3 | Click view on the draft | 1 click | the editor reopens in the current tab with trim and AI text; the folder chip came back empty [J-081] |
| 4 | Create, or close to save it for later [J-219] | 1 click | saving shows a toast with a view button |

Total: 5 clicks to get the draft back, 6 to a link. Deleting a draft from the list takes 2 clicks on the same spot (trash, then confirm).

## N. Create a workspace

Workspace menu, switch workspace, join or create workspace, type a name, keep or untick the same-domain join box, click next: 4 clicks and typing for the first step [J-221]. Not submitted during research, so later steps are unknown.

## O. Sign in

Open the sign-in page [J-217]: one click on Apple, GitHub or Google hands off to that provider; or type a work email and continue. Not completed during research (the owner's session was already signed in).
