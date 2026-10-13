# Owner taste: Agentation and the Vercel Toolbar

The owner likes the ergonomics of two tools: Agentation and the Vercel Toolbar (decision D-005). This file records how each one feels to use and lists the moves `toolbar` should take from them in Part 2.

Sources, all public:

- Agentation: the docs site (agentation.dev, now agentation.com): Overview, Install, Features, Output, Schema (AFS 1.1), MCP, API, FAQ, Changelog, the "Introducing Agentation 2.0" post, and the public README. I also opened the live toolbar on the site's own overview page for a few minutes, in a separate tab, and noted its size and position.
- Vercel Toolbar: vercel.com/docs pages for the toolbar, Comments (overview, using, managing, enabling, integrations), managing the toolbar, the browser extension, the interaction timing and accessibility tools, `vercel comments` in the CLI docs, the screenshots inside those pages, and five Vercel changelog entries about the toolbar.

Clean-room note: Agentation is under PolyForm Shield 1.0.0, which forbids use in a competing product. Nobody on this project read its source code. Everything below comes from its docs and from using its UI on its own site. Copy no names, icons, text or colors from either tool.

## Agentation

### Interaction model

| Aspect | What it does |
|---|---|
| Install | A React component that the developer adds to the app, usually behind a development-only check. React 18 or later, desktop browsers only. |
| Resting state | A dark round button, 44 px across, in the bottom-right corner, with a small icon of lines and a sparkle. |
| Activate | Click the button, or press Cmd+Shift+F (Ctrl+Shift+F). That shortcut and Esc also work while the toolbar is closed. |
| Toolbar when open | The button expands to the left into a dark pill, about 300 px wide and 44 px tall, with seven 34 px icon buttons: pause animations, layout mode, hide markers, copy, clear, settings, and close (X) at the right end. A Send button appears only when a webhook is set and auto-send is off. Every button gets a tooltip at once on hover. |
| Position | Drag the toolbar anywhere. The position persists in localStorage. |
| Pick an element | With feedback mode on, hovering shows the element's readable name. Buttons and links get their text as a name, headings their content, images their `alt`. A click opens the comment popup at that element. "Block page interactions" is on by default, so the click does not trigger the app. |
| Other pick modes | Select text (the quote goes in the output). Cmd/Ctrl-click several elements, or drag a box over them, for one group note. Drag over empty space for an area note. Pause animations (P) to annotate one frame. |
| Comment popup | A small dark card next to the element. Top row: the element's name with a chevron that expands its computed CSS. Then a text box with the placeholder "What should change?", then Cancel and a blue Add. Enter submits and Esc cancels. |
| Pins | A numbered circle, about 20 px, at the point you clicked. Single elements and text get the accent color (blue by default). Groups and areas get green, with a dashed green outline around the selection. Hover a pin to preview the note. Click it to edit, or set clicks to delete in settings. Right-click always edits. H hides all pins. |
| Keyboard | Cmd/Ctrl+Shift+F toggles, Esc closes or cancels, L layout mode, P pause, H hide pins, C copy, S send, X clear. Single keys work only while the toolbar is open, and never while you type in a field. |
| Density | Very high. One icon row, one compact popup, numbered dots. No sidebar and no list view. You see the page, the pins and the pill. |
| Settings | One small panel: output detail (Compact, Standard, Detailed, Forensic), React component detection, marker color (seven presets), clear on copy or send, block page interactions, light or dark theme, MCP and webhook setup. |
| Output for agents | Copy puts Markdown on the clipboard: per note, the page URL, a CSS selector path, element name, classes, the quoted text, source file and line in development, the React component tree, and the comment. Four detail levels trade length for context. Copy can also return only source paths, only class names, or one attribute such as `data-testid`. |
| Agent sync | An optional local MCP server (port 4747) stores notes in SQLite. Agents get tools to list sessions, get pending notes, acknowledge, resolve with a summary, dismiss with a reason, reply in a thread, and wait for new notes in a blocking loop ("watch"). A resolved note fades out of the page in real time over SSE. |
| Schema | A published annotation format (AFS 1.1): required id, comment, selector path, timestamp, x as percent of viewport width, y in document pixels, and tag name. Optional: bounding box, classes, styles, accessibility, nearby text, selected text, `intent` (fix, change, question, approve), `severity` (blocking, important, suggestion), `kind`, `status` (pending, acknowledged, resolved, dismissed) and a thread of human and agent messages. |
| Multiplayer | Thin. Without the server, notes live in one browser's localStorage for 7 days, keyed by path. With the server, several people and agents share one store. Threads hold human and agent turns. There are no accounts, avatars or mentions. |
| Limits (from its docs) | No screenshots. The output is text only. No session capture: no console, no network. React only. |

### What makes it pleasant

- You reach the first note in two clicks: the launcher, then the element. Typing and Enter finish it.
- The hover label teaches the tool. You see what the agent will see ("Submit button", `.sidebar > button.primary`) before you commit.
- The page stays usable and safe. Clicks go to the toolbar while it is open, so you never submit a form by mistake.
- Numbers on pins match numbers in the output. "Fix 3" means something to both you and the agent.
- One keystroke per action, and none of them fire while you type.
- The output is short and greppable. Selectors, quoted text and file paths give the agent strings it can search for.
- The agent can talk back in the same thread and close the loop. The pin vanishes when the agent resolves it, so you watch your list shrink.
- The UI is calm: one dark pill, one accent color, nothing else on screen.

## Vercel Toolbar

### Interaction model

| Aspect | What it does |
|---|---|
| Install | Present on every preview deployment by default with no change to the app. For production or localhost the app adds a package. The browser extension (Chrome, Firefox) adds screenshots, faster sign-in detection, and the "Always Activate" and "Start Hidden" preferences. |
| Resting state | "Sleeping": a small circle with a menu icon and a small Vercel mark over it. It runs no tools and shows no comments until you activate it. It wakes on its own when you arrive from a link to a comment thread, a draft or a flag override. |
| Activate | Click the circle. With the extension, "Always Activate" wakes it on every page where you are signed in. |
| Toolbar when open | Compact. When idle it shrinks to three icons: comment, share (or flags) and menu. It shows the full bar on hover. After you use a tool, its icon stays next to the menu, and recent tools pin to the top of the menu. |
| Position | Drag it to any side or corner. It snaps there and stays for you across deployments. Your position does not change it for anyone else. Drag it onto an X at the bottom of the screen to hide it. |
| Menu | The Ctrl key opens a searchable command menu on Mac and Windows (Vercel moved it off Cmd/Ctrl+K in April 2025 to avoid clashing with apps' own menus). It holds: search, current branch and commit, switch branch, comments, inbox, layout shift, interaction timing, accessibility audit, Open Graph preview, share, links to the team, project and deployment dashboards, hide, disable for session, preferences, log out. |
| Comment | Press `c` for a placement cursor, or pick Comment from the menu, then click a spot on the page. Selecting text shows a small comment indicator next to the selection; click it to comment on that text, and the text stays highlighted. With the extension, click-drag draws a region and attaches a screenshot of it to a new comment. |
| Composer | One reply box with `+` (attach a file), a camera (screenshot the page), `Aa` (formatting) and a send arrow. Markdown and the usual shortcuts (Cmd+B, Cmd+I, Cmd+E). `@` mentions people. `:` opens emoji search. Emoji reactions on each message. |
| Pins | A round avatar of the author at the anchor point. Several threads close together stack into one pin with a count. Text comments also keep the selection highlighted on the page. |
| Threads | Every comment starts a thread. The thread opens in a panel on the right with Back (to the inbox), up and down arrows to step through threads, and close. The first message quotes the selected text and shows a card with the page title and path. Each message has react, resolve, a menu (copy link, follow or unfollow) and a small monitor icon. Hover the timestamp to see browser, window size, pixel ratio and which deployment the author saw. Click the monitor icon to copy that as JSON. |
| Inbox | All open threads, with a badge for new activity. Filter by page (this page or all) and by status (resolved, unresolved). Drag the inbox panel to the left or right side. Selecting a thread puts its anchor in the URL, so the link opens that thread. |
| Keyboard | The menu key, `.` with Cmd or Ctrl to hide or show the toolbar, `c` to comment, custom shortcuts per tool set in Preferences (record a key combination). |
| Density | Medium. The toolbar is tiny, and the thread panel is roomy, close to a chat app. |
| Multiplayer | Full. Accounts, avatars, mentions, reactions, follow and unfollow, notifications to the dashboard, email (batched) and Slack, a two-way Slack thread per comment, convert a thread to a Linear, Jira or GitHub issue, a pull-request check that counts unresolved comments, and a prompt to refresh when a newer deployment exists. |
| Output for agents | `vercel comments` in the CLI lists unresolved threads for the current Git branch, shows each thread with its element selector, page path and title, and replies, resolves, reopens and edits. `--format json` exists for scripts and agents. Vercel suggests one prompt: "Process the comments I left on the site. Run `vercel comments` to get started." |
| Automation | The `x-vercel-skip-toolbar` header removes the toolbar for end-to-end tests. |
| Other tools | Interaction timing shows a toast for any interaction over 200 ms and a timeline per interaction (input delay, handlers, render). The accessibility audit runs axe rules in the background, puts a count badge on the menu item, and can record issues while you interact. |

### What makes it pleasant

- It stays out of your way. Asleep by default, shrunk when idle, hidden with one key, and its position is yours alone.
- Links carry state. A link to a thread opens the page, wakes the toolbar and opens that thread.
- One key (`c`) and one click place a comment. Text selection keeps working as normal and gets a small offer to comment on it.
- Threads feel like chat: avatars, mentions, reactions, resolve with one checkbox, arrows to step through.
- Each comment remembers the reviewer's browser, window size and deployment, one hover away.
- Background tools announce themselves with badges and quiet toasts instead of panels you did not ask for.
- The comment loop reaches places you already work: Slack, the issue tracker, the pull request, and now the terminal.

## Ergonomic moves for Part 2

Each move names the Part 2 item in PLAN.md that it serves. "Part 2" items are the headings under "Part 2 specifics". Where a move changes Part 1 behavior copied from Jam, record the change in `docs/decisions.md` as step 4 requires.

### Toolbar shell

| # | Move | Source | Serves |
|---|---|---|---|
| M-01 | A resting launcher: one dark round button, 40 to 44 px, bottom-right by default. Click expands it into a single horizontal icon pill (about 34 px buttons) with close at the end. | Both | What the reviewer can do (all items); Zero integration (the UI the extension and injector put on the page) |
| M-02 | Asleep until clicked: no pins, no overlays and no hover listeners until the reviewer wakes it. Capture keeps running in the background, since the 60-second ring buffer must exist before the first comment. | Vercel | What the reviewer can do: "Comment without a trace" (ring buffer) |
| M-03 | Drag the toolbar to any edge or corner, snap there, and remember the spot per reviewer, not per project. Drag onto a bottom X to hide it. | Both | What the reviewer can do |
| M-04 | Shrink when idle to three icons: comment, start or stop trace, menu. Show the full pill on hover. Keep the last used tool next to the menu. | Vercel | What the reviewer can do: comment, "Start trace" and "Stop trace" |
| M-05 | A recording state that you can read at a glance: while a trace runs, the pill shows a red dot and the elapsed time, and the stop button replaces the start button in the same place. | Own addition, in the style of both | What the reviewer can do: "Start trace" and "Stop trace"; What a trace is |
| M-06 | A searchable command menu on one key, holding the rare actions (inbox, settings, masking preset, sign out, disable for session) so the pill stays short. | Vercel | Self-hosted, with any OIDC provider (sign-in, sign-out); Privacy (preset shown in the menu) |
| M-07 | Render everything inside the closed shadow root with its own font stack and reset, so page typography never leaks in. | Agentation (its changelog lists this fix) | Zero integration |
| M-08 | Hide the toolbar for automated runs: the injector honors `x-review-skip`, and the extension honors the same header name when a test sets it. | Vercel (`x-vercel-skip-toolbar`) | Zero integration: injector requirement `x-review-skip` |

### Picking and commenting

| # | Move | Source | Serves |
|---|---|---|---|
| M-09 | Comment mode on one key (`c`), plus one global chord that wakes or hides the toolbar from anywhere (Agentation uses Cmd/Ctrl+Shift+F, Vercel Cmd/Ctrl+period). Single-key shortcuts only while the toolbar is awake, never while the reviewer types in a field, and Esc always backs out one level. Let reviewers rebind keys in settings. | Both | What the reviewer can do: comment on an element |
| M-10 | Hover label before the click: outline the element and show the name the agent will get (accessible name and role, then a short selector, then the SvelteKit route file when known). | Agentation | Source location without app integration: locator packet |
| M-11 | Block page clicks while picking, so a click on "Delete" or "Submit" opens a comment and does nothing else. Make it a setting that is on by default. | Agentation | What the reviewer can do: comment on an element |
| M-12 | A compact comment card anchored to the element: the element name on top with an expandable details row (locator, styles), then the text box, then the voice button, then Cancel and Add. Enter adds, Shift+Enter makes a new line, Esc cancels. | Agentation (layout), Vercel (attach row) | What the reviewer can do: comment on an element; voice note attached to a comment; Source location (details row) |
| M-13 | Text selection stays native. After a selection, show a small comment chip beside it. The comment quotes the text and keeps a highlight on the page. | Vercel (chip, highlight), Agentation (quote in output) | What the reviewer can do: "Highlight text" |
| M-14 | Drag on empty space draws a region, takes a screenshot of it and opens the comment card with the crop attached. Cmd/Ctrl-click adds elements to one group note. | Vercel (drag to screenshot), Agentation (multi-select, area) | What the reviewer can do: draw a rectangle; "Take a screenshot of one DOM element and write a comment on it" |
| M-15 | A camera button in the comment card that captures the picked element only, cropped at 1x CSS pixels, with drawing tools (rectangle, arrow, freehand) on top of the crop. | Vercel (camera in composer) | What the reviewer can do: element screenshot, rectangle, arrow, freehand; Hand-off: `annotations/a01.png` |
| M-16 | Pause page motion with one key (`p`): CSS and Web Animations, videos, timers and animation frames. The note records that the page was paused. | Agentation | What the reviewer can do: comment on an element (moving targets) |
| M-17 | Tag a note with intent (fix, change, question, approve) and severity (blocking, important, suggestion) through two small optional selectors, defaulting to fix and important. | Agentation (AFS fields) | Hand-off to the agent: `feedback.json` annotations; README "what did not happen" ordering by severity |

### Pins on the page

| # | Move | Source | Serves |
|---|---|---|---|
| M-18 | Numbered pins, about 20 px, placed where the reviewer clicked, in one accent color. Group and area notes use a second color with a dashed outline. The number on the pin is the number in `README.md` and the `aNN` file names. | Agentation | Hand-off: `annotations/a01.*`, README timeline |
| M-19 | Hover a pin to preview the note. Click to open its thread. One key (`h`) hides all pins. | Agentation | What the reviewer can do |
| M-20 | When several pins overlap, stack them into one pin with a count. In shared views, show the author's avatar or initials on the pin. | Vercel | Self-hosted: "Every record stores who left it" |
| M-21 | Anchor pins to the element through the locator, with percent-x and document-y as a fallback, and follow fixed and sticky elements correctly. | Agentation (AFS coordinates, fixed handling) | Source location: locator packet; Hand-off: `a01.shapes.json` in page coordinates |
| M-22 | A link to one note opens the page, wakes the toolbar and opens that note. | Vercel | Hand-off: share URL; Privacy: share URLs |

### Threads, status and the agent loop

| # | Move | Source | Serves |
|---|---|---|---|
| M-23 | Each note is a thread with a status: pending, acknowledged, resolved, dismissed. Resolving takes one click. Dismissing needs a reason. | Agentation (states), Vercel (one-click resolve) | Hand-off: Agent Skill "mark the feedback resolved when done" |
| M-24 | The CLI covers the triage loop from the terminal: `pull` the folder, then `list`, `reply`, `resolve --message`, `dismiss --reason`, with `--format json`. Resolving from the CLI removes the pin live in any open review tab. | Vercel (`vercel comments`), Agentation (live removal) | Hand-off: CLI `npx <cli> pull <url>`; Agent Skill (mark resolved) |
| M-25 | Ship a one-line prompt in the README and in the share page's Markdown first line, so a reviewer can paste it to any agent: pull this, read `README.md` first, fix, resolve. | Vercel (suggested agent prompt) | Hand-off: share URL Markdown response; Experiments 3 (same one-line prompt) |
| M-26 | Agent replies show in the note's thread on the page, marked as agent turns. Keep those replies fenced as data in the next pull. | Agentation (threads with human and agent roles) | Hand-off; Privacy and prompt injection (fence every captured string with source and author) |
| M-27 | A "watch" command later, with the remote MCP server: block until new notes arrive, return them as a batch. | Agentation (`watch_annotations`) | Hand-off: remote MCP server, after the folder works |
| M-28 | An inbox panel on one side: open notes for this page or all pages, filter by status, up and down arrows to step through, draggable to the other side. | Vercel | What the reviewer can do (review own notes); Self-hosted (team view) |

### Context the reviewer never types

| # | Move | Source | Serves |
|---|---|---|---|
| M-29 | Store the reviewer's session facts with each note: browser and version, OS, window size, pixel ratio, the deployed commit, the masking preset. Show them on hover over the note's time, and write them into the folder header. | Vercel (session info JSON) | Hand-off: README header (who, app, browser, masking preset); `feedback.json` deploy commit |
| M-30 | Show a quiet badge on the comment icon when the ring buffer holds console errors or failed requests from the last 60 seconds, and show a count in the comment card ("2 errors, 1 failed request will be attached"). | Vercel (badges and toasts from background tools) | What the reviewer can do: comment without a trace (ring buffer); Privacy (the reviewer sees what goes out) |
| M-31 | During a trace, show a small toast for a `dead`, `stuck` or `silent` span right after it closes, with a one-click "comment on this". A setting turns toasts silent. | Vercel (interaction timing toasts, "On (Silent)") | What a trace is: span outcomes; Experiments 2 (labeling real actions) |
| M-32 | Prompt to reload when a newer deployment of the same app is live, so reviewers do not comment on old builds. | Vercel | Hand-off: `feedback.json` deploy commit |

### Output shape

| # | Move | Source | Serves |
|---|---|---|---|
| M-33 | Copy for a quick paste: one key (`C` in the pill) copies a short Markdown block of the current notes with selector, quoted text, route file and comment, for reviewers who skip the server. The folder stays the full hand-off. | Agentation (copy) | Hand-off; Source location (locator in each entry) |
| M-34 | Lead each note with strings an agent can grep: a short selector, `data-testid`, visible text, route file. Put long details (styles, ancestors, nearby elements) in `a01.locator.json`, not in the README. | Agentation (detail levels, greppable output) | Source location: locator packet; Hand-off: README under 8k tokens |
| M-35 | A versioned, published JSON Schema for `feedback.json` and `spans.jsonl`, with `kind`, `intent`, `severity`, `status` and `thread` fields. | Agentation (AFS) | Hand-off: `feedback.json`; remote MCP server later |

## Where the owner's tools disagree with Part 2

- Agentation ships inside the app as a package. Part 2 forbids any change to the app. Take its in-page feel and deliver it through the extension and the injector.
- Agentation has no accounts. Part 2 requires a signed-in reviewer on an allowlist for every record. Use Vercel's identity cues (avatars on pins, author on each message) instead.
- Agentation keeps notes in localStorage by default. Part 2 keeps them on the self-hosted server. Keep an unsent note locally as a draft only.
- Vercel converts comments into Linear, Jira and GitHub issues and posts to Slack. These are optional in Part 2, since the folder and the CLI are the hand-off. Put any of them on the skip list with a reason if they are not built.
- Neither tool records a session. Their moves shape the comment and pin layer, while trace capture keeps the Jam baseline from Part 1.
