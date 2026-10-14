# Jam ergonomics

Positions and sizes were read from screenshots of a 1584x952 browser window whose viewport starts at y=87 and is 1584x865. Treat pixel figures as close estimates. Catalogue IDs in brackets.

## Overall look

- Light theme everywhere. The dashboard and the capture page ignore a dark system preference, and no theme setting exists. The recording bar, menus, tooltips and some toasts are dark on purpose.
- White cards, thin grey borders, radii around 8 px for controls and 16 px for large cards.
- One brand accent for primary buttons, switches that are on and selection highlights, plus a lighter tint of it for capture areas, trim bars and hover outlines. Red is kept for errors, stop and destructive actions. The hues are Jam's brand; pick our own.
- Text is 13 to 14 px in the app UI and 12 px monospace in the dev tools panels. Titles are about 18 to 20 px semibold.

## Extension popup

- Opens under the toolbar icon (icon near x 1434, y 62), right edge aligned with the icon, top at about y 80. About 400 px wide; 210 px tall with three rows, 260 px with four.
- Header row about 40 px: wordmark left, home and three-dot icon buttons right.
- Mode rows are full-width outlined buttons about 370x40, 8 px apart, 16 px line icon on the left, 14 px label. Rows with options carry a chevron in a separate hit area about 40 px wide, split off by a thin rule. Opening a chevron grows the row in place with a segmented control. Several rows can be open at once; none stay open after the popup closes.
- The mic state is a small grey pill (about 55x22) inside the record row.
- Settings, the recording-link form, the help carousel and dialogs replace the popup body in place with a back arrow. Settings grows to about 600 px and scrolls inside the popup.
- Loading: a card with a spinner shows at about 0.9 s and the content at 1.7 s warm, 3 s cold.
- Hovering a row for about 2 s shows a dark tooltip pill above it with the current chord [J-212].
- The popup closes when the window loses focus.

## Screenshot mode

- No overlay, no dimming, no toolbar. The only cue is a grey translucent pill (about 200x36) trailing the pointer by about 5 px right and 20 px down. It appears once the mouse moves.
- The click or drag that takes the shot is consumed: the page under it gets no pointer or click event, so buttons, links and hover-to-click menus stay untouched [J-250].
- Dragging draws a translucent accent-tint rectangle without a border and a size readout pill near the pointer.
- The delay timer shows a round accent-tint badge with the seconds left (about 60 px) at the bottom-left of the viewport and a grey cancel pill at the bottom-right.

## Recording bar

- Dark rounded pill about 295x40 at bottom centre, about 70 px above the viewport's bottom edge. Pressing on the timer area drags the whole pill anywhere in the viewport while recording continues [J-238].
- While recording, the toolbar popup swaps its record row for a stop row; the screenshot row greys out [J-239].
- Left to right: red stop square, pause, elapsed time (mm:ss), mic state, thin divider, pen, blur.
- Countdown: the page under a 50% grey veil, the bar reading a countdown with a red dot; one second per step.
- Tools swap the bar's contents in place: the pen shows 12 colour dots and a done button; blur shows a short instruction, undo and done.
- Near the cap the timer shows the limit and turns orange then red; an upsell card rises above the bar.
- After stop the bar becomes a spinner pill while logs are gathered.
- In desktop mode Jam's bar sits just above Chrome's own sharing strip.

## Draft editor

- Modal about 1378x731 (x 103 to 1481, y 154 to 885), 16 px radius, white, over a 50% grey backdrop. A short fade-in (0.3 to 0.6 s).
- Left media pane about 1005 px wide: a 40x40 bordered close button at the top-left; preview about 960x520; a floating tool pill about 408x48 centred at the bottom with 34 px pitch: colour dot, select, pen, rectangle, ellipse, arrow, line, text, blur, divider, undo, redo. The active tool has a grey pill behind it.
- The area-capture card (thumbnail plus checkbox) floats just above the tool pill.
- The modal does not lock page scroll: the wheel over the preview scrolls the host page behind it and the preview stays put [J-216].
- Video drafts have no drawing tools at all [J-240]: they replace the tool pill with a round play button and a full-width accent-tint trim bar (about 900x28) with grip handles; markers float above the bar; the length is spelled out centred below; trim undo and redo sit at the right below.
- Right form pane about 372 px: destination dropdown (about 178x40) and workspace dropdown (about 74x40) on top, where the workspace also decides which tracker connections the destination menu offers [J-251]; the title and description field with generous whitespace; bottom row of paperclip, folder chip, AI switch and a green create button (about 70x34) in the bottom-right corner.
- Selection: blue outline with square corner handles; arrows show round end and middle handles.
- The palette is a small floating card above the colour dot with 6 swatches in a row.
- Tooltips are dark pills above the button after a 1 to 2 s dwell, with a key badge where a key exists.
- A video draft reopened from the Drafts list swaps the square close button for a wider bordered button with a cross and a save-for-later label [J-219].

## Popup drafts screen

- The unfinished-draft pill sits in the popup header left of the home icon: pale blue, a clock icon and a count. It is a button only once no draft is open or processing [J-035].
- The Drafts screen replaces the popup body: a back arrow and a heading, then rows about 355x70 inside the 400 px popup, each with a 66x50 rounded thumbnail, host on one line and a grey relative age under it, a green view button and a grey trash icon at the right [J-218].

## Feedback after each action

| Action | What you see |
|---|---|
| Click the toolbar icon | Icon pressed; loading card, then the menu |
| Arm screenshot mode | Cursor pill only |
| Capture click or drag | Editor fades in over the dimmed page, title focused |
| Start recording | Veil, countdown in the bar, starting spinner, then a live timer; the icon turns into a red camera; Chrome marks the tab |
| Stop | Bar vanishes or shows a gathering spinner; editor opens |
| Draw a shape | Tool returns to select, shape selected |
| Escape in the editor | A toast asks for a second press |
| Save a reopened video draft for later [J-219] | Editor closes; white toast bottom-right says it went to drafts, with a view button and a small close cross on its corner |
| Delete a draft from the Drafts list [J-218] | The trash icon becomes a red confirm button in the same spot; no dialog |
| Stop hangs [J-034] | The processing pill spins with no timeout, progress or error; only an extension restart clears it |
| Broken video draft [J-034] | The editor opens on time but reads 0 seconds, shows the first frame and ignores play; AI ghost text still appears. No error, no retry; about one tab recording in three |
| Create | Spinner on the button; white toast bottom-right with a spinner, then a green tick saying the link is copied and the capture opened; a background tab appears directly right of the source tab; Chrome's clipboard prompt may appear. Ctrl+Enter in the form does the same [J-220] |
| Copy link anywhere | Button flips to a tick for about 2 s and a toast confirms |
| Copy cURL or download | Toast with an agent-setup button |
| Post a comment | Composer clears at once, a bubble marker appears on the timeline, a jump pill if it landed below the fold; no toast |
| Toggle a setting | Switch moves; no toast, no save button |
| Create, rename, move or delete in the dashboard | Toast naming the result (dark, green tick, a small close button, gone after about 4 s) |
| Delete a capture | Confirm modal that calls it permanent, toast, redirect; the data is archived behind the scenes [J-191] |

## Capture page

- Header about 80 px. Left: home icon, folder chip, three-dot menu. Right: send-to-app split button with stacked app logos and a green copy-link split button.
- Left column about 987 px with the media card (about 836x457, 16 px radius). Right dev tools panel about 580 px (about 37%), resizable with a splitter; at narrower widths the media card loses its radius and runs edge to edge.
- Tabs row near y 190 with 14 px labels (info, console, network, actions, MCP) and small red or green dots.
- An area capture that kept the full viewport shows two thumbnails (about 80x52) centred at the bottom of the media card; the selected one has a blue outline [J-209].
- Panels are dense like browser DevTools: rows 20 to 24 px, monospace 12 px, zebra striping, pink error rows, pale yellow warnings, pale blue navigations, a left time column in m:ss.
- Player overlay controls auto-hide when the pointer leaves or after idle, with dark gradients top and bottom when shown.
- The replay player uses two small dark pills: play, back and forward on the left with the time, speed and fullscreen on the right. Before it plays, a white card with one centred line and a thin dark progress bar fills the media area [J-229].
- Empty network and actions tabs show one centred grey line near the top of the panel, in a light-hearted tone [J-231].
- The composer is sticky at the bottom of the left column; its send button grows from an icon into a green pill naming the current time.
- The request detail pane slides over most of the table and shrinks the list to two columns. Up and Down step through the requests with the pane open and keep the chosen sub-tab [J-243].
- Menus are dark with 24 px rows and leading line icons.
- At phone width the page is one column, the panel hides behind a 32 px toggle, and network filter chips overflow to the right.

## Dashboard

- Left sidebar about 250 px: workspace switcher on top, three nav items, a folders section whose heading collapses the list on click and shows a plus on hover, an onboarding card, then a help button bottom-left and an app-logo stack bottom-right.
- Main header: page title, member avatars, a grey invite button and a green new-capture button. Selection mode swaps this header for a light blue bar in place.
- Filter bar under the header: three filter buttons on the left, a search box with a Ctrl+K hint on the right.
- Three-column card grid with 16:10 thumbnails; title left and relative time right under each.
- Modals are small and centred with an autofocused field, a green focus ring, a grey cancel and a coloured confirm that stays disabled until valid. Enter submits.
- Search palette about 1000 px wide, centred, with a result count bottom-left and an Enter hint naming the action for the highlighted row bottom-right. Group labels (members, then captures) are small grey text; member rows show the email right-aligned. It opens over capture pages as well as the dashboard.
- Settings pages use a centred column about 640 px wide, sections split by thin rules, each with a heading, one line of description and a docs link on the right. Plan-gated settings show a small outlined plan badge and a disabled switch.

## Motion

Kept small: popup loading card, editor fade-in, countdown steps once per second, live strokes fading after 2 to 3 s, toasts sliding in bottom-right (bottom-left for the dashboard delete toast), player controls auto-hiding, AI ghost text appearing in place, filter chips sliding sideways when another filter becomes a chip, drag ghosts while moving a card.

## Density and click budget

- The fastest paths are keyboard first: one chord to arm a mode, one click to capture, one click to create.
- The popup adds 2 clicks and up to 3 s to any capture.
- Common viewer tasks take 0 to 3 clicks (hover a marker, click a row, click a sub-tab).
- Dashboard moves take 3 clicks; destructive actions take 3 including a confirm.
