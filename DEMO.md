# open-toolbar demo

Everything here was recorded on Nuru, the online coding course at https://116.nuru.sh (the preview of PR #116), with the release build of the extension and the stack on this machine. Nuru's deployment was not changed.

## The video

[`docs/demo/nuru-demo.mp4`](docs/demo/nuru-demo.mp4), 2 min 44 s, 4.6 MB.

[![The Nuru scenario from start to finish, then Claude Code fixing the bug](docs/demo/nuru-demo.gif)](docs/demo/nuru-demo.mp4)

The GIF above is a preview at three times the speed. The video shows:

1. 0:04 to 1:30. The owner's scenario, with real mouse and keyboard input. The reviewer starts a trace on `/sw`, opens the first lesson, writes a line of Nuru and runs it, highlights the output and comments on it, comments on the lesson title, records a voice note, then carries on through lessons 2, 5 and 8 (a `/n` that should be `\n`, a syntax error, `10 % 0`, a reload while a program waits for input, a 390 px window) and stops the trace. Slow stretches play at 1.25 to 3 times the speed; each caption says what happens.
2. 1:30 to 1:39. The capture on the server, then the feedback folder's README.md as the agent reads it.
3. 1:39 to 2:38. Claude Code (Opus 5.5, no MCP) gets one line, "Fix the problem reported in <share link>". It pulls the folder, reads README.md, opens three images, reads the response body that README names, sees that the deployed database holds an old copy of the lesson module, finds that `seed.ts` skips the module because its slug is taken, adds `seed --adopt`, tests it on a throwaway Postgres and marks the feedback resolved with the re-seed command. The real run took 4 min 51 s; the bar at the top shows real time. The terminal view is rendered from the run's own transcript (`docs/demo/claude-code-lessons.cast`, asciinema format).
4. The result card.

The full results of all three agents (Claude Code, Codex, opencode) on three bugs are in `docs/agent-handoff-results.md`.

## The reviewer toolbar on Nuru

![The extension's popup on 116.nuru.sh after Allow: signed in, project Nuru, staging masking](docs/demo/01-popup-on-nuru.png)

The popup on Nuru after sign-in and Allow. The extension knows the site belongs to the project Nuru and records with the staging masking preset. Besides its own server, it asked Chrome for `https://116.nuru.sh/*` only.

![A trace running on lesson 1, with the program's output in the terminal and the toolbar pill at the bottom right](docs/demo/02-trace-running.png)

A trace running on lesson 1. The pill at the bottom right holds the tools and shows the trace's elapsed time.

![The terminal output highlighted, with the comment box open beside it](docs/demo/03-highlight-comment.png)

Highlight the output and press `t`: the comment box names the selected text and its element, and takes a type (fix) and a priority.

![The comment box on the lesson title, which is in English on the Swahili site](docs/demo/04-element-comment.png)

Press `c` and click an element to comment on it. Here the lesson title, which is in English on `/sw`.

![The page with two numbered pins, one on the output and one on the title](docs/demo/05-pins.png)

The notes stay on the page as numbered pins until the trace stops and takes them along.

## The capture page

![The capture page: replay on the left, notes below it, the console tab on the right](docs/demo/06-capture.png)

The owner's scenario trace on the server: the DOM replay, the reviewer's notes with the highlighted text, and the tabs Info, Console, Network, Actions and Agent.

![The Network tab of the same capture, with RSC requests and their sizes and times](docs/demo/07-capture-network.png)

The Network tab: every request of the trace, with the Next.js RSC loads of each lesson.

![The Agent tab, with a prompt to copy for an agent with MCP](docs/demo/08-capture-agent.png)

The Agent tab gives a prompt to paste into an agent that has the MCP server, or the whole capture as Markdown.

![The capture page in dark mode](docs/demo/09-capture-dark.png)

![The Agent tab in dark mode](docs/demo/10-capture-agent-dark.png)

The same page with the system set to dark.

## The feedback folder

![README.md of the feedback folder, rendered, with the folder's files on the left](docs/demo/13-folder-readme.png)

The top of `.feedback/01a1451c.../README.md`, the file the agent reads first: who, which app, browser and masking preset, then the reviewer's words in fenced blocks marked `captured`. Under two of the notes, README.md names the response whose body held the marked text, with the `jq` line to read it. That line sent all three agents to the stale database copy. Rendered here from the Markdown; the agent reads the plain file.

![The timeline of interaction spans and the search hints](docs/demo/14-folder-readme-timeline.png)

Further down: "What did not happen" (nothing, in this trace), the timeline of interaction spans with their outcomes and the image to open for each, and search hints for the JSONL files.

![The element crop a02.png: the lesson title, cropped at 1x](docs/demo/15-folder-annotation-a02.png)

`annotations/a02.png`, the crop of the element the reviewer marked, at 1x CSS pixels.

## The dashboard

![The dashboard: All captures, a grid of Nuru traces and reviewer notes with thumbnails](docs/demo/11-dashboard.png)

All captures of the workspace, with filters by type, source and creator, folders, and the setup checklist.

![The dashboard in dark mode](docs/demo/12-dashboard-dark.png)

## Try it yourself

A running instance and the extension are ready on this repose machine (project `toolbar`).

1. **The server.** While you are attached (`repose attach toolbar`), every port here appears on your laptop: open http://localhost:3000. Sign in with "Sign in with Dev SSO". The mock provider asks for a user name and claims; to see the Nuru captures, use the user name `sub-amani@nuru.test` and the claims `{"email": "amani@nuru.test", "email_verified": true, "name": "Amani Reviewer"}`. Any `*.test` address gets in. The seeded account `dana@toolbar.test` with password `toolbar-dev-password` works too. Dev SSO needs port 3311 as well, so use attach. `repose open 3000` forwards only one port, which is enough for the password sign-in.

   The stack runs with the development and whisper files (`docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.whisper.yml`, `docs/dev.md`). `dana@toolbar.test`, the first account, is the instance admin: Settings > Server shows where allowed domains, transcription and the rest are set. Allowed domains are pinned to `test` here. Transcription starts off, so for transcripts of new voice notes sign in as Dana once and pick "Local whisper.cpp" under Settings > Server, Transcription.

2. **The extension.** Copy the release zip to your laptop and load it unpacked:

   ```sh
   repose cp toolbar:/home/dev/toolbar/dist/open-toolbar-extension-0.0.1-chrome.zip .
   unzip open-toolbar-extension-0.0.1-chrome.zip -d open-toolbar-extension
   ```

   In Chrome, open `chrome://extensions`, turn on Developer mode, click Load unpacked and pick `open-toolbar-extension`. It points at http://localhost:3000, so keep the session attached while you use it.
3. **Review Nuru.** Sign in from the popup as Amani (above), open https://116.nuru.sh/sw, open the popup and click Allow. Press Ctrl+Shift+. to wake the toolbar and `x` to start a trace.
4. **The video and screenshots**, if your editor is not on the checkout: `repose cp -r toolbar:/home/dev/toolbar/docs/demo .`

`git fetch repose` brings the commits, these files included.

## How this was made

- Screenshots: Playwright 1.63.0's Chromium on its own Xvfb display at 1440 by 900, with the release extension from `dist/` loaded unpacked; the toolbar was driven with xdotool. Scripts: `docs/demo/scripts/shots.mjs` (toolbar), `srv.mjs` (server pages, light and dark through `prefers-color-scheme`), `render.py` (README.md to HTML).
- Video: `docs/demo/scripts/edit.py` cuts the scenario recording from the Nuru real-world test (`docs/real-world/nuru.md`) and the terminal replay into one file with ffmpeg. `cast.py` turns Claude Code's stream-json transcript into the asciicast, and agg renders it.
