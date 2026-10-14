# What an agent receives from Jam

Tested 2026-10-13 by connecting a Claude Code session to Jam's MCP server through an HTTP-to-stdio proxy with a throwaway token cache, then calling tools on a 1:31 lab recording, a screenshot capture and an instant replay. The client was removed afterwards. Raw outputs sit in `research/jam-private/notes/mcp-raw/`. Catalogue IDs in brackets.

## Ways in

| Path | What the agent gets | Auth |
|---|---|---|
| MCP server (one streamable HTTP URL) [J-145, J-149] | 35 tools covering reads, search and writes | OAuth with dynamic client registration and PKCE on first call, or a personal access token |
| Share URL fetched with curl [J-153] | An empty app shell, plus a header pointing at a markdown summary | None when the link is public |
| Markdown summary (URL plus `.md`, or an Accept header for markdown) | About 1 KB of front matter and signals | None when the link is public |
| Copy cURL in the viewer [J-107] | A runnable curl for one request, secrets replaced | Manual copy |
| Issue filed to a tracker [J-137, J-242] | Per the public docs: console logs, inspectable network requests, URL, timestamp, country, device, OS, browser, viewport and network speed, plus the draft's text. The capture keeps the linked issue, which search can filter on [J-241]. The issue lands in the one tracker site connected to the capture's workspace [J-251]. Not seen: no tracker was connected | The tracker's own access, on that site |
| MCP tab prompts in the viewer [J-152] | A short prompt with the capture URL and a task | Manual copy |
| CLI and agent skills [J-155] | Same data and JSON shapes as MCP from a terminal, plus files on disk: paged event JSON, frames and screenshots written to a folder, and a cached structured summary [J-247]. A skill tells the agent which reads to make first. Public docs only | OAuth or token (not installed in testing) |
| CLI captures made by an agent [J-244, J-245, J-246] | The reverse direction: the agent creates an annotated screenshot, a video with a Playwright trace, or a recording of the browser it drives, and hands the person a share link as proof of a fix. Public docs only | Same CLI login |

There is no copy-for-AI button beyond the MCP tab prompts, and the send-to-app menu lists no agent target.

## Setup and consent

- Settings, MCP page: one card per agent (Claude Code, Cursor, Codex, VS Code) with a snippet; the snippet holds only the URL.
- The first call opens a consent page in the browser: workspace picker, the client's self-registered name, two scope bullets (read; comment and organise), one approve button and no deny button. With a live browser session approval is one click; tokens arrived about 5 s later.
- After connecting, the MCP page lists the client with a remove action; removal revoked the token at once.

## Tool conventions

- Every tool takes an optional `intent` string asking the agent to say why it calls the tool.
- Every capture tool accepts a UUID or a full capture URL.
- Tools carry MCP annotations (read-only, destructive, idempotent) and a human title.
- Descriptions are long and prescriptive: they say which tool to call first and next, warn that deletes are permanent and need user confirmation (per the security doc a deleted capture is archived, not erased [J-191]), and explain mention syntax.
- List-style tools return an envelope with total, returned, has-more, next cursor and events.

## Read tools and what they returned

| Tool | Input | Returned for the lab recording |
|---|---|---|
| getDetails (and its alias fetch) | capture id | 4.4 KB. IDs, type, origin, author name and email, duration, system info (browser, OS, screen, extension version, battery, connection RTT and downlink), timestamps, integrations, title, folder, comments with playback times, metadata (country, incognito, custom-metadata flag), an events summary (network counts by status, method, content type, host, size; console counts by level; clicks and keystrokes; navigations by source), post-processing jobs with status (chapters ready, transcript skipped because the mic was off). Then a markdown investigation guide: a headline with error counts and a ranked list of next calls with pre-filled filters |
| getConsoleLogs | level list, limit, cursor | 9 events, 4.8 KB. Each: index, timestamp, elapsed ms, page URL, error flag, level, message (objects inlined as JSON), two-frame minified trace, error class, fingerprint, source file and line. The unhandled rejection was absent |
| getNetworkRequests | status classes, content types, hosts, methods, bodies (errors or all), limit, cursor | 15 events, 11 KB. URL split into host, path and query keys; method; status, class and text; duration; MIME; initiator; XHR and GraphQL flags; error flag with category and message parsed from the body; request and response bodies (failures only by default, 4 KB cap, truncation flags); sizes. No headers at all. Secrets in bodies replaced. The hanging request has no status or duration. WebSocket shows only the 101 row; SSE shows one row with no body. Jam's own CDN fetches appear as page traffic |
| getUserEvents | limit, cursor | 25 events, 17 KB. Clicks with tag, type, visible text, value, data attributes, a weak CSS selector (the same for every submit button), flags for hitting Jam's own UI and for anonymised values. Keystrokes with the field value (last character missing) and raw key list; email and password masked. Navigations with source. Page URL on events lagged one route behind |
| getMetadata | capture id | Said there was no custom metadata, though getDetails flagged some |
| getScreenshots | screenshot capture | One PNG image (68 KB base64) |
| getFrames | overview, a list of ms, or a range with a count; size 360, 720 or 1080p | Overview: one line of text and a 4x3 grid of labelled frames as one JPEG (160 KB base64). A single moment at 1080p: one JPEG with a time label (88 KB base64). Frames show the typed email unmasked. Screenshot and replay captures get a not-a-video error |
| getVideoChapters | capture id | Status, three chapters with start and end ms, a sentence title each, public thumbnail URLs, language |
| getVideoTranscript | capture id | Internal error twice (no mic was used; the error does not say so) |
| analyzeVideo | capture id | 13 KB: three segments, each with summary, detail, user goal, success flag, blockers, error indicators, evidence references in ms, findings (type, impact low to critical, description, video and event evidence), key actions (target, selector, event type, coordinates, outcome, confidence), categories, page URL and title, start and end |

## Search and list tools

| Tool | Notes |
|---|---|
| search | Pulls a UUID out of any text or URL; at most one video result. Returned the first comment as the title (bug) |
| searchJams | Structured search over titles, descriptions, comments, linked issues, reporter and transcripts, with where clauses, a time window, sort and paging. Result URLs carry a source marker for MCP |
| listJams (deprecated), listFolders, listMembers | Lists with legacy filters (type, nine origins), folder counts and short ids, member roles |
| listRecordingLinks, getRecordingLink, listRecordingLinkJams, listRecordingUrls | Recording links, the captures made through each, and connected domains |

## Write tools

createComment (markdown up to 2000 characters, optional playback time), editComment, deleteComment (own only), addReaction and removeReaction (8 fixed emoji), updateJam (title, description, folder), deleteJam, createFolder, updateFolder, deleteFolder (deletes its captures), create, update and delete recording links, getRecordingUrlVerifyLink (a human must open it), and submitFeedback, which asks the agent to report problems with Jam's own tools.

Round trip tested: createComment took 4.2 s including proxy start and returned the id, capture id, body, creation time and playback time. The comment appeared on the capture page under the owner's name with rendered markdown and a time chip. deleteComment removed it.

## Instant replay and screenshot captures over MCP

Replay: type replay, no duration, the guide skips video steps, frames refused. Screenshot: getScreenshots returns the image, frames refused with a pointer to getScreenshots.

## Share link content via curl

- The capture URL returns 200 HTML, about 3.2 KB in 0.26 s, no-store and noindex, title only, no Open Graph tags and no capture data.
- A `Link` response header names a markdown alternate. The content-only URL has the same.
- The markdown (about 1 KB) has front matter with title, a public image URL (fetchable without auth), URL, captured-on page URL, type, browser, OS, screen, country, zone, author and date. Then one signals line (console error count, failed requests, 5xx count, interaction count), the comments with author and ISO time, and a closing note that this is a summary and the MCP server, details tool and CLI give more.
- An unknown id returns 404 plain text.

## MCP tab and nudges in the viewer

The viewer labels this dev tools tab MCP.

- Before an agent is connected: a card with a copyable setup prompt naming the server URL and docs.
- After: three preset chips (fix it, summarise, end-to-end test), each swapping a two to three line prompt that embeds the capture URL. The fix prompt asks for a root cause, a fix and a closing comment on the capture.
- Toasts after copy cURL and download offer a button to set up the agent connection.

## How well an agent did with it

Given only the MCP tools, a Claude Code run (91 s, 13 turns) diagnosed the hidden 500, the TypeError, the hanging request and the 403 from the form correctly. It missed the dead button and the unhandled rejection, which leave no trace in the data.

## Gaps worth fixing in a replica

- No headers over MCP although the viewer has them.
- WebSocket frames and SSE events are not exposed.
- Event page URLs can lag a route; keystroke values can drop the last character.
- Video frames are not redacted while the event log is.
- Jam's own failed font loads reach the agent's data as network errors in the page's name [J-248].
- Errors on transcript and metadata tools do not explain the cause.
