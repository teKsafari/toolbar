# G2 replica results (Nib side)

Raw results of group G2 in `docs/parity/scenarios.md` (S2.1 to S2.4), run on the replica only. The Jam side and the match, better or gap verdicts belong in `docs/parity.md`. Product code was not changed in this step; bugs are listed at the end.

Run on 2026-10-15. All four scenarios passed in one full run (3.5 min, 1-minute load 1.0 to 2.4). Values below come from that run unless a row says otherwise. Two earlier runs of single scenarios add timing points; their loads are given.

## How to rerun

```sh
pnpm --filter @toolbar/extension build            # release build, closed shadow root
cd e2e && npx playwright test -c playwright.parity.config.ts G2           # all four
cd e2e && npx playwright test -c playwright.parity.config.ts G2 -g S2.4   # one
```

This run used a private copy of the release build (`PARITY_EXT_BUILD=chrome-mv3-g2`, copied from `chrome-mv3` of 2026-10-14 21:49, no extension commits since). Evidence lands in `e2e/parity-shots/G2/` (git-ignored): one `<scenario>.json` per scenario with every shape state, click tally and timing, the screenshots named `<scenario>-<step>-nib-<width>-<theme>.png`, and the stored capture JSON for S2.1 and S2.2.

## Rig

The G1 rig (`e2e/parity/rig.ts`): Playwright 1.63.0 Chromium, fresh profile, release build unpacked, action pinned, Xvfb `:130` with openbox, page viewport 1440x900. Pointer input, every drag on the preview and every key (T, V, Delete, Escape, Ctrl+Z, Ctrl+Shift+Z, Ctrl+End, Ctrl+Enter, and the typed text) go through the X server with xdotool. The shape list is read, never written, from the draft the editor autosaves to the extension's IndexedDB. Timings come from CDP screencast frames (S2.1 step 3) or from polling the X clipboard every 40 ms (create to link).

Setup and deviations from the script:

- S2.1 step 18 needs a second workspace. The account had one ("parity's workspace"), so the spec made a workspace "Parity" through the API with a folder "parity" in it, and set the first workspace back as the active one. Both workspaces now hold a folder "parity". The extension's cached bootstrap (60 s) was dropped from storage after the setup, which equals waiting it out.
- S2.1 step 20: the rig grants clipboard permissions to the lab origins at launch. They were cleared before Ctrl+Enter so that a clipboard prompt would show if the page asked (J-202).
- S2.4 starts from N2 on Jam (made in S1.2). Nib has no capture budget, so the spec records a fresh 19 s tab recording with Submit order clicked 3.0 s after live, stops it from the bar, and restarts the extension from the popup menu to put the draft in the drafts list, as S1.2 step 15 does. The editor frame stayed over the page after the restart (G1 bug 2, seen again), so the page was reloaded before step 1.
- S2.4 step 11 asks for the S1.2 video checks (bar position, blur, pause). The S2.4 prelude does not drag, blur or pause; those checks were made on Nib in G1 (S1.2 after-check).
- Paused rows (docs/scope.md) were not run: S2.1 step 17 (J-079, destination menu) and S2.4 steps 4 and 5 (J-083, J-230, AI ghost text).

## S2.1 Annotated screenshot to a link

| Step | Result |
|---|---|
| 1, 2 pre-roll | Submit order and Log at every level clicked, then 20.0 s of wall time. |
| 3 editor (J-037, J-077) | 3 clicks (icon, screenshot row, page). Click to first editor frame: 0.5 s (load 1.9). Earlier runs: 1.1 s (load 3.8), 2.0 s (load 5.2). Median of the three: 1.1 s. Modal 1380x730 at (30, 85) over the dimmed page; preview side 1007 px (73 percent), form side 373 px (27 percent). The preview shows the 1440x900 image at 931x582. The caret is in the single title-and-description field. Undo and redo both greyed at open. |
| 4 pen (J-038) | Pen active at open; 0 clicks, 1 drag. The stroke is a filled closed outline (65 quadratic segments, no stroke line), which is the perfect-freehand taper. The pen stays active after the stroke. |
| 5 rectangle (J-039) | 1 click and 1 drag. Box 213x37 around the status line; the tool falls back to select with the rectangle selected (8 handles). |
| 6 ellipse (J-040) | 1 click and 1 drag. 147x59 ellipse around Save, ratio 2.5: an ellipse filling the box, not a circle. Tool back to select. |
| 7 arrow (J-041) | 1 click and 2 drags. Arrow from Submit order to the status line; dragging its middle handle bent it (bend offset 43 image px), the head follows. |
| 8 line (J-042) | 1 click and 1 drag. Straight line, 370 image px, no bend, no head. |
| 9 text (J-043) | T selects the text tool; a click opens the callout editor; typed "500 here"; a click on empty space commits it and returns to select. Font 26 image px, filled box in the current colour. Double-click opens it for editing with the whole text selected; Escape ends editing and leaves the draft open. 1 key, 2 clicks, 1 double-click. |
| 10 blur (J-044) | 1 click and 2 drags. Blur box 87x34 over the status text; the inner region differed from the sharp shot by 50.5 grey levels on average. Moved 100 screen px right (155 image px at this preview scale): the old spot is back to the sharp pixels (difference 0.0). |
| 11 colour (J-045) | 1 click to select the rectangle, 2 clicks (dot, swatch). Six swatches: ink (the default, a blue), red, amber, green, sky, black. Red recoloured the selected rectangle and the dot now shows red for new shapes. |
| 12 transform (J-046) | V, a press on the rectangle's top edge and a 40 px drag moved it by exactly 40 image px; a corner drag resized it (+29 x +20); a drag from just outside the top-right corner rotated it by 50 degrees. On the text callout a corner drag scaled the font from 26 to 37 image px. |
| 13 marquee (J-047) | One drag from empty space that touches the ellipse and the line selects exactly those two. |
| 14 delete and undo (J-048) | Delete removed both (7 shapes to 5); one Ctrl+Z brought both back (7, same types). |
| 15 undo and redo buttons (J-049) | Three undo clicks each changed the drawing (rotation, resize and text scale stepped back); three redo clicks replayed them. Neither button greyed: the undo stack was not empty, and one redo step (the Delete undone by Ctrl+Z in step 14) remained. Both buttons were greyed at open (step 3). |
| 16 text | First line became the title "parity S2.1 annotated", second line the description "pre-roll check". |
| 17 | Paused (J-079), not run. The destination stayed on the share link. |
| 18 workspace (J-080) | 2 clicks. The menu lists "parity's workspace" (checked) and "Parity"; picking Parity switches the draft. The capture landed in Parity. |
| 19 folder (J-081) | 2 clicks. Menu: No folder, parity. The chip then reads "parity" in its set style. |
| 20, 21 Ctrl+Enter (J-220, J-086, J-197) | With the caret at the end of the description, Ctrl+Enter created. Link on the clipboard 0.4 s after the chord (load 1.5); earlier run 1.6 s (load 5.6). The capture tab appeared 0.5 s after the chord (earlier run 1.8 s), at index 1, right of the source tab, in the background (the lab tab stayed active). In-page toast "Link copied. The capture opened in a new tab." 0.5 s after the chord, shown for 3.9 s. |
| 22 clipboard prompt (J-202) | No permission bubble and no prompt window, with the lab origin's clipboard grants cleared. |
| 23 capture (J-051) | Kind screenshot, in workspace Parity, folder parity. The capture page shows one 1440x900 PNG with every mark burned in, no shape layer, no tool pill, nothing editable. Shot at 1440 and 390, light and dark, with no sideways overflow in any of the four. |
| 24 fresh draft (J-081, J-045) | The next screenshot draft opened on "parity's workspace" with the folder chip reading "Folder" (none), not "parity". The colour dot is back to the default ink. See bug 1. |

## S2.2 Area screenshot with the full viewport kept

| Step | Result |
|---|---|
| 1 area | 2 clicks and 1 drag over the button row (946x107). Release to editor in the DOM 0.40 s (load 1.1); earlier run 0.30 s (load 2.3). |
| 2 thumbnail (J-004) | Below the preview, left of the tool pill: a 66x42 thumbnail of the full 1440x900 viewport with a ticked box, labelled "Include the full page". |
| 3 toggle | One click unticks, a second ticks again (2 clicks). |
| 4 create | Title typed, Create button (1 click). The capture holds the 946x107 crop and the 1440x900 full viewport. A second capture made with the box left unticked holds the crop only. |

## S2.3 Discard a screenshot draft

| Step | Result |
|---|---|
| 1 | 3 clicks to the editor, 1 tool click and 1 drag for the rectangle. |
| 2 close (J-088) | Editor gone 0.18 s after the close click, no confirmation; the draft is deleted and the session is idle. |
| 3 Escape once | Toast inside the editor: "Press Escape again to discard this draft". After 2 s the toast is gone and the draft is still open. |
| 4 Escape twice | Two presses 0.25 s apart: editor gone 0.54 s after the first press, draft deleted. The second press must come within 1 s. |
| 5 popup | No draft pill; screenshot, record and link rows enabled; no drafts stored. |

## S2.4 Video draft: preview, trim, save for later, create

| Step | Result |
|---|---|
| prelude | 19.1 s tab recording, Submit order at 3.0 s, Save and Log at every level later; stop on the bar; draft "20 seconds"; extension restarted from the popup menu; page reloaded (see deviations). |
| 1 reopen (J-218) | 3 clicks (icon, pill "1", View). The editor reopens in the tab with the video; its close button now reads "Save for later". |
| 2 no tools (J-240) | No tool pill. Only the play button, the trim track and its two grips. |
| 3 preview (J-084) | Play starts at 0.0 s (the left grip) and plays (1.9 s after 1.5 s). A click on the video pauses it at 2.0 s and it stays paused. A click at the middle of the bar seeks to 9.7 s of 19.4 s. The length under the bar is spelled out: "20 seconds". 3 clicks. |
| 4, 5 | Paused (J-083, J-230), not run. |
| 6 save for later (J-219) | 1 click. The editor closes; toast "Saved to your drafts" with a View button at the bottom right of the page; the draft is stored as saved. The popup shows the pill with 1 draft, enabled, and the screenshot, record and link rows enabled. |
| 7 not listed (J-189) | The draft's capture id is absent from `GET /api/v1/recordings` while the draft sits saved. |
| 8 trim (J-085) | Reopened (3 clicks). Dragging the left grip to 4.2 s (just after the Submit order click) hatches the cut part grey and changes the length to "15 seconds". Ctrl+Z and Ctrl+Shift+Z did nothing: the focus was still in the title field, which takes the chord (bug 2). The undo button under the bar put the grip back ("20 seconds") and the redo button moved it again ("15 seconds"). |
| 9 create (J-086, J-087, J-197) | Title typed, Ctrl+Enter: link on the clipboard 0.2 s after the chord (load 1.3); earlier run 0.3 s (load 1.6). |
| 10 processing (J-087) | The capture tab shows "Still processing. This page updates by itself when the capture is ready." 0.3 s after it opened, then plays 3.6 s after it opened (3.9 s after Ctrl+Enter, load 1.3); earlier run 3.4 s. |
| 11 trimmed capture (J-227) | Stored length 15.4 s against the label "15 seconds" and a kept range of 15.4 s; the player reports 15.4 s. The 500 is gone: the network panel lists one request (`/api/ok?q=works`, 200), no 500 anywhere in the events. Counts: 17 console rows (15 console events), 1 network request in the panel (2 request and 2 response events), 2 user events (the Save and Log clicks; the Submit order click is cut). |

## Per-row summary

| ID | Scenario | Nib result |
|---|---|---|
| J-004 | S2.2 | Ticked full-viewport thumbnail in the draft; capture keeps crop and full; unticked keeps crop only. |
| J-037 | S2.1 | Modal 1380x730 over a dimmed page, 73/27 split; 0.5 s to the editor (median of three runs 1.1 s). |
| J-038 | S2.1 | Pen active at open, tapered filled stroke, stays active; 0 clicks. |
| J-039 | S2.1 | Rectangle, back to select with it selected; 1 click, 1 drag. |
| J-040 | S2.1 | Ellipse fills a wide box (ratio 2.5); 1 click, 1 drag. |
| J-041 | S2.1 | Arrow bends by its middle handle. |
| J-042 | S2.1 | Straight line, no head. |
| J-043 | S2.1 | T, click, type; double-click edits with all text selected. |
| J-044 | S2.1 | Blur hides the text; moved box leaves the old spot sharp. |
| J-045 | S2.1 | Six swatches; red recolours the selection and new shapes; a new draft resets to the default. |
| J-046 | S2.1 | Move 40 px, corner resize, rotate outside a corner; text resize scales the font. |
| J-047 | S2.1 | Marquee that touches two shapes selects both. |
| J-048 | S2.1 | Delete removes the selection; one Ctrl+Z restores both. |
| J-049 | S2.1 | Buttons undo and redo step by step; both grey at open; neither greyed in the scripted sequence because neither stack was empty. |
| J-051 | S2.1 | One flattened PNG on the capture page, nothing editable. |
| J-077 | S2.1 | Caret in the one field at open; first line title, second line description. |
| J-079 | S2.1 | paused (not run). |
| J-080 | S2.1 | Workspace menu with both workspaces; the capture lands in the picked one; 2 clicks. |
| J-081 | S2.1 | Folder menu and chip work; the next fresh draft did not preselect "parity" (bug 1). |
| J-083 | S2.4 | paused (not run). |
| J-084 | S2.4 | Play from the left grip, click pauses, bar click seeks, length spelled out. |
| J-085 | S2.4 | Grip drag greys the cut and updates the length; Ctrl+Z and Ctrl+Shift+Z do nothing while the title field has the focus (bug 2); the buttons undo and redo. |
| J-086 | S2.1, S2.4 | Toast, link on the clipboard 0.4 s (screenshot) and 0.2 s (video), background tab right of the source, no prompt. |
| J-087 | S2.4 | Link 0.2 s after Ctrl+Enter; processing notice, playable 3.6 s after the tab opened. |
| J-088 | S2.3 | Close discards at once; one Escape toasts, two within 1 s discard; no pill after. |
| J-219 | S2.4 | Save for later closes, toast with View, pill shows, capture rows enabled. |
| J-220 | S2.1 | Ctrl+Enter from the description creates like the button. |
| J-227 | S2.4 | Trimmed capture drops the 500 from console, network and events; stored length matches the label. |
| J-230 | S2.4 | paused (not run). |
| J-240 | S2.4 | Video draft shows play and trim only. |

Timings for rows owned by other groups: J-197 create to link 0.4 s (screenshot, load 1.5; 1.6 s at load 5.6) and 0.2 s (video, load 1.3; 0.3 s at load 1.6); J-202 no prompt; J-189 the saved draft's capture is not listed before create.

## Bugs and oddities noted (not fixed in this step)

1. J-081: after a capture made in the second workspace ("Parity") with its folder "parity", the next fresh draft opened on the first workspace with no folder. The editor's remembered workspace and folder were not applied, likely because a new draft carries the active workspace, and the remembered folder belongs to the other workspace. With one workspace this may not show; the scenario's second workspace exposes it.
2. J-085: Ctrl+Z and Ctrl+Shift+Z after a trim-grip drag do nothing. Dragging a grip does not move the focus, and the editor opens with the focus in the title field, which keeps the chords for text editing. The trim undo and redo buttons work.
3. J-218 (seen again from G1 bug 2): after Restart extension the editor frame stayed over the page, and the popup reopened without a click.
4. J-049: the scripted button sequence cannot show both buttons greying, since step 14's Ctrl+Z leaves one redo step and the undo stack is never empty. Not a product bug; the buttons were greyed at open.
5. The capture page shows a "Send to app" button in its header although the tracker integrations are paused (`FEATURE_TRACKERS`, docs/scope.md). Seen on the S2.1 capture; not a G2 row.
6. S2.1 step 10: the moved blur box landed on plain page background, so the new spot looks the same blurred or not; only the old spot's return to sharp was measured.
