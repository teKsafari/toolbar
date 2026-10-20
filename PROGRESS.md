# Progress

A new session reads this file first.

## Current step: Part 2, step 5 (test with real software and show the owner)

All five items of PLAN "Part 2, step 5" are done on main. Gate 5 waits on the owner: they have to see the running instance and the extension (DEMO.md says how). Last updated 2026-10-16.

### Plan for this step
1. The owner's scenario on Nuru with the release extension, no change to Nuru.
2. A second app of the owner's with a different structure.
3. The three experiments of PLAN "Experiments", on Nuru.
4. Real feedback folders handed to Claude Code, Codex and opencode; `docs/agent-handoff-results.md`.
5. Show the owner: a running stack, the extension ready to install, a user README, DEMO.md with screenshots and one screen recording.

### Done
- **Nuru** (`docs/real-world/nuru.md`, D-185): the scenario on https://116.nuru.sh (PR #116 preview of `teKsafari/nuru`), read-only clone at `/home/dev/nuru`. Seven Nuru bugs found; five open-toolbar fixes, the main one being screenshots that need activeTab (the pill now tells the reviewer to press Ctrl+Shift+Y once).
- **Second app** (`docs/real-world/second-app.md`, D-186): the owner's IdrisElectro store (`Heracraft/csds221-pr03`, SvelteKit 1 with Sanity) on `vite dev`, through the extension and through the injector. Five fixes (SvelteKit 1 locator, injector rows kept across page loads, the trace badge, span summaries, load labels). No Next.js app of the owner's ran without paid or private services; Nuru covers Next.js.
- **Experiment 1** (`docs/experiments/rrweb-cost.md`, D-190): ten-minute Nuru lesson, 0.64 MB a minute of rrweb gzipped, a quarter of a core while tracing. Stop trace now retries from its queued chunks.
- **Experiment 2** (`docs/experiments/span-labels.md`, D-188, D-189): 30 hand-labelled actions, 83 % agreement before and 87 % after (90 % on new captures). Prefetched links and implicit submits join their click; Web Worker runs hold their span. The 500 ms, 2.5 s and 10 s windows stay.
- **Experiment 3 and hand-off** (`docs/agent-handoff-results.md`, diffs in `docs/agent-handoff/`, D-187): twelve runs on three real bugs with "Fix the problem reported in <share link>". Each agent pulled the folder and read README.md first; all three found the `+Inf` and Address bugs. Codex guessed on the stale-lesson bug and opencode broke a correct sentence there, which led to text provenance in README.md. Reopening a capture now reopens its pins.
- **Demo** (D-191): README.md rewritten for users; DEMO.md with a 2:44 video (`docs/demo/nuru-demo.mp4`), a GIF and 15 screenshots, covering the Nuru scenario through Claude Code fixing the stale-lesson bug. Stack on :3000 rebuilt; release zips in `dist/` rebuilt.
- **Secrets in e2e traces** (D-192): browser launches in e2e passed the whole environment to Chromium, so Playwright's retained traces of failed tests held `OPENAI_API_KEY` and other tokens. Launches now take `browserEnv()` from `e2e/fixtures/browser-env.ts`, and the leaky trace files on this machine are deleted. D-193: 34 more traces in an agent scratchpad and a saved `docker compose config` still held the key; both deleted, and a scan of `/tmp` and `/home/dev` finds the values only in the 0600 Codex credential file. The demo's share link is revoked and replaced by a placeholder in the cast.
- **Environment clean-up** (D-194): six required values for `docker-compose.yml`, four for the Coolify file (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `ADMIN_EMAILS`); allowed domains, transcription, capture defaults, sharing and limits moved to Settings > Server, project defaults to the workspace. Whisper, dev and mail are opt-in files (`-f docker-compose.whisper.yml`, `-f docker-compose.dev.yml`, `-f docker-compose.mail.yml`); transcription is off by default; on a public URL with no allowed domains only `ADMIN_EMAILS` sign in until an admin exists. The local stack on :3000 runs with the dev and whisper files (docs/dev.md).
- OpenAI spend in step 5: about 2.75 USD of the 3 USD cap (hand-off 2.74, Nuru 0.01, experiments 1 and 2 none). About 0.25 USD is left.

### Not done
- Gate 5: the owner has not seen the product yet. Notify them with `repose-notify` once they can attach (ports 3000 and 3311 forward), or point them at DEMO.md.
- Not pushed to `origin`; push when the owner asks.

## Earlier steps (all gates passed)

- **Part 1, step 1** (gate 1, D-017): Jam catalogue in `docs/jam/` (251 rows), lab app in `lab/` (user service `toolbar-lab` on :5173 and :5174), raw notes in `research/jam-private/` (gitignored).
- **Part 1, step 2** (gate 2, 2026-10-14): 241 rows built, 10 skipped; journeys in `e2e/flows/`; status in `docs/status.md`.
- **Part 1, step 3** (gate 3, 2026-10-15): `docs/parity.md`, 115 match, 48 better, 0 gap, 16 paused.
- **Part 2, step 4** (gate 4, 2026-10-15, `d48418c`): every Part 2 specific built (`docs/status.md`, "Part 2, step 4"; area reports in `docs/status/p4-*.md`). After the gate: the teksafari.org design pass (D-174 to D-182), bulk feedback export (D-183) and card images for every capture kind (D-184).

## Machine notes
- Installed on this machine only via nix profile: xdotool, imagemagick, xvfb, openbox, ffmpeg-headless.
- Owner decisions: D-005 (no steering; Nuru as test target; Agentation and Vercel Toolbar taste), D-016 (no mobile or desktop apps).
- Never use X display :99 (the shared browser). Run e2e on a private Xvfb display with openbox.
- Off git, on this machine: `/home/dev/nuru` (Nuru clone), `/home/dev/nuru-run/`, `/home/dev/second-app-review/`, `/home/dev/handoff-run/` (agent transcripts and clones), `/home/dev/demo-raw/` (raw screen recordings).

## Deployment and release (2026-10-16)
- Coolify: project Lab, application open-toolbar, branch main, domain https://toolbar.teksafari.com; running and healthy. Waiting on DNS (Cloudflare) for the domain.
- Extension: GitHub release v0.1.0 on teKsafari/toolbar (Chrome unpacked zip, Web Store zip, Firefox zip, SHA256SUMS), default server https://toolbar.teksafari.com.
- Gate 5: waits on the owner seeing the product.
- No backwards compatibility (D-196): the manifest key is the Web Store item's public key (id `laobpjhffglefallhhojihfdbdkoendk` for every build and the server default); old variable names, the `nib` storage and localStorage moves, the `nib-*` HKDF labels and the other compatibility code are gone. Local stack on :3000 rebuilt and reseeded.
- Settings > MCP agent picker: cards of a row share one height and labels stay on one line ("Other agent"); `e2e/tests/dashboard/overflow.spec.ts` checks it at 1600 to 390 px in both themes.
- Firefox sign-in (D-197): the server accepts the `extensions.allizom.org` redirect for `EXTENSION_GECKO_IDS`. Not yet run in a real Firefox; screenshots (editor page) and video stay Chrome-only.

## State on 2026-10-17
- Production: open-toolbar on Coolify (Lab), https://toolbar.teksafari.com, Google OIDC, builds from main via the GitHub app webhook (never deploy through the API).
- Extension: store item laobpjhffglefallhhojihfdbdkoendk, private to teKsafari; 0.1.0 published, 0.1.4 (required all-sites access, managed serverUrl policy) in review with auto-publish. GitHub releases up to v0.1.4.
- Site access: all sites by default with automatic per-origin projects and merging; strict mode is an admin setting (D-200, D-202).
- Injector: cancelled and removed from the repo (D-210). Delivery 2 is the embed: a script tag or npm package with a public project key (D-211), the extension's reviewer toolbar shared through a platform adapter (D-212).
- Docs: concise reference style (owner preference).
