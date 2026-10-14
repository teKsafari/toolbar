# What Jam captured from the lab app and Nuru

Tested 2026-10-13 with extension 5.90.0 against the lab app (`lab/README.md`) and one Nuru lesson. Four tab recordings, one screenshot taken after a series of actions, one instant replay, one desktop recording. Page actions came from real X input and from CDP clicks and key events; Jam logged both as ordinary user events.

"Video" below means the tab video. Catalogue IDs in brackets.

## Lab app, route `/`

| Case | Captured | Form | Missed |
|---|---|---|---|
| Save (works) | Yes | Click row with the button's test id; GET 200 with headers and JSON body, size and time | Nothing |
| Export (no handler) | Click only | A click row with nothing after it | No hint that the click did nothing; an agent reading the data missed it too |
| Sync (never returns) | Yes, weakly | Network row with blank status and 0 ms; detail has no headers and no body | No pending label, no elapsed time, nothing in the console |
| Submit order (500, hidden by the UI) | Yes, fully | Red console row naming the method, status and URL; red marker labelled with the status on the seek bar; pink network row; request and response JSON bodies pretty-printed; marker hover shows the error text from the body | Nothing. The strongest case |
| Show profile (uncaught TypeError) | Yes | The log line before it, then a red error row with message and expandable stack; error marker on the timeline; error class and fingerprint over MCP | Source-mapped frames; only minified bundle positions |
| Refresh (unhandled rejection) | No | Nothing in console, timeline or MCP | The whole rejection |
| Console at every level | Partly | log, info, debug as grey info rows; warn yellow; error pink; every row expands to its call-site stack; objects as one-line JSON with dates as ISO strings | console.table, group label (the inner line appears without indent), trace, assert, count, time and timeEnd; expandable object trees; the Error object's own stack (only the call site is shown) |
| Modal | Indirectly | Clicks on the open and delete buttons and the warning they log | No open or close event; the dialog shows only in the video |
| Cross-origin image (port 5174) | Only if loaded during capture | SVG row, 200, timing, the other origin as domain | Absent when it loaded before the capture started |
| Iframe | Partly | The iframe's fetch, with a frame id | The click inside the iframe and the iframe's console line |

## Lab app, other routes

| Case | Captured | Form | Missed |
|---|---|---|---|
| `/form` text and textarea | Yes | One typed row per field with the text in clear; click rows for focus | Last character missing in the MCP keystroke value (viewer showed it) |
| `/form` email | Masked in logs | Asterisks of unrelated length in the typed row; value attribute masked; value swapped for a placeholder in the request body | The email was readable in the video |
| `/form` password | Masked | Asterisks in the typed row; placeholder in the body; dots in the video (browser masking) | Nothing |
| `/form` secret-looking text in the textarea | Not masked | An API-key-like string and a test card number stayed in clear in the typed row and the body | Content-based redaction does not exist |
| `/form` submit (403 from the form action) | Yes | Button click, POST with redacted body, JSON response | The submit is not its own event, only the button click |
| SPA route change | Yes | Navigation row naming the history API, pale blue, with a filter chip | The info tab keeps the start URL; MCP tagged some events with the previous route |
| Full loads (reload, typed URL, back link) | Yes | Navigation rows naming the cause, a tab-hidden row before each, document rows with duration | Document bodies |
| `/list` long scroll | No scroll | Row clicks are recorded | Scroll events and positions |
| `/canvas` redraw | Video only | Three click rows | The drawn text; canvas content exists only as pixels |
| `/live` WebSocket | Yes, if opened during capture | 101 row with upgrade headers; a socket sub-tab lists all 16 frames with direction, data, length, time, a regex filter and a detail pane | Sockets opened before the capture began; MCP shows only the 101 row, no frames |
| `/live` SSE | Partly | Row typed as XHR, 200, 20 s duration, event-stream headers | The events (body tabs disabled) |
| `/slow` (streamed SvelteKit load) | Partly | The data request and the late streamed part at 3.8 s | The late body; the viewer's reason for the missing body is wrong |
| `/slow-raw` (chunked HTML) | Partly | Document row, 4.1 s | Body and chunk timing; the recording bar vanished during the load and came back after it |

## Screenshot taken after actions

Clicked log-every-level, show profile, save and submit order, waited 20 s, then took a visible screenshot. The screenshot capture carried the same console, network and actions data as a video would, ending with a screenshot-taken row. Times start about 18 s before the first click, close to when the previous capture finished, so the background buffer seems to restart after each capture. Page-load requests were not included. The info URL is the page at capture time.

## Instant replay

The replay draft rebuilt the page from DOM snapshots at the preview's width (the lab's button row wrapped differently) with a pointer glyph. The buffer covered about 29 s, from the last reload. The trim defaulted to the last 30 s. The 500 and the error showed as markers. MCP treats it as a replay type with no duration; frame and video tools refuse it. On the capture page the replay loads behind a progress card and plays with a reduced control bar (no download, share-at-time, mute, quality or chapters) [J-229].

## Desktop recording

The video includes browser chrome. The URL field is the tab where recording started. Logs came from the tabs touched, and the network table adds a Tab column with each request's source tab id [J-224]. The draft opened in the tab that was active at stop.

## Nuru lesson (https://116.nuru.sh/sw)

| Item | Captured | Form | Missed |
|---|---|---|---|
| Navigation into the course and lesson | Yes | Three history navigations | - |
| Lesson data requests | Yes | JSON fetches with sizes and bodies | - |
| Analytics beacons | Yes | POSTs with 204 | - |
| Progress save at the end | Yes | POST row | - |
| Clicks in the code editor, typing code, run and submit clicks | No | After the third history navigation Jam stopped logging user events; even the stop chord is missing | Every interaction after that point; on the lab app the same kinds of clicks were logged |
| Program output | Video only | Pixels | Text of the output |
| AI | Yes | Three chapters, an AI title and description written at creation | - |

Ergonomic notes from Nuru: Chrome's translate bubble held focus and swallowed the screenshot chord with no feedback. The editor took 3.4 s to appear on this heavier page, and stop to editor took about 25 s.

## Applies to every capture

- Jam's own UI fonts and a locale file, loaded from a public CDN by the injected bar and editor, appear in the page's network list as if the page had asked for them.
- The first frames of every tab video show Jam's own bar in its starting state, and the bar stays visible for the whole video.
- Metadata: start URL, creation time, country, OS, browser and version, viewport size, network speed bucket and latency in the viewer; battery, connection and extension version via MCP. No device pixel ratio, language or zone.
- Headers are complete in the viewer and absent over MCP.
- Trimming a video drops console, network and user-event rows outside the kept range; a trim past the 500 left the console with only video started and stopped [J-227]. A pause adds a video-paused row [J-233].
