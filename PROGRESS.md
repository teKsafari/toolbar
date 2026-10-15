# Progress

A new session reads this file first.

## Current step: Part 1, step 2 (replicate Jam): built, merged, journeys pass end to end

### Plan for this step
1. Repo scaffolding: `LICENSE`, `.gitignore` (with `research/jam-private/`), `docs/decisions.md`, this file.
2. Build the lab app in `lab/` (SvelteKit) with every behavior listed in PLAN.md step 1.
3. Owner logs in to Jam in the shared Chromium browser and installs the extension.
4. Drive Jam on the lab app and public sites; write `docs/jam/*.md`.
5. Second agent reviews the catalogue against Jam (gate 1).

### Done
- Scaffolding, lab app (`lab/`, user service `toolbar-lab` on :5173 and :5174).
- Seven browser sessions with Jam plus public-doc research; raw notes in `research/jam-private/notes/` (gitignored).
- `docs/jam/`: catalogue (251 rows: P0 73, P1 106, P2 72) after seven review rounds; gate 1 passed (D-017). Clean-room audit done.
- `docs/research/owner-taste.md` (Agentation and Vercel Toolbar ergonomics, for Part 2).
- `docs/architecture.md` (step 2 design) and `docs/spikes.md` (capture spikes S1, S2 and extras: all work, with caveats).

### In flight (2026-10-14)
- Step 2 done, gate 2 passed (2026-10-14): 241 rows built, 10 skipped; clean-clone verification passed. Area branches area/* kept for history.
- Next: step 3 parity against Jam (docs/parity.md), then step 4 including the owner's branding change (D-074, docs/research/branding.md).
- Open after the merge (each a call or mount in another area's file, from the area reports):
  - J-137, J-140: the editor's destination menu does not list integrations or mount dashboard's `TrackerFields`; finalize never sends `destination: {type:'integration'}`.
  - J-138: the capture page header has the viewer's own send menu; dashboard's `SendToApp` (field form, J-140) is not mounted.
  - J-136: no first-view email is sent at all yet (the mention and domain-join mails are gated).
  - J-011: heavy-page detection and `replay.set {allowHeavy}` in the capture service.
  - J-200: the recording-link recorder page has no denied-microphone instructions or record-without-voice choice.
  - The viewer's share page checks revoked and expired links itself; folder privacy (`memberCanSee`) is applied only by server-core's routes.
  - Capture e2e drives the product flows through `__tb.flow` (ext-ui's handlers over the capture driver); the bar and countdown UI checks live in the ext-ui suite.

### End-to-end pass on main (2026-10-14)
- `e2e/flows/` scripts the journeys of `docs/jam/flows.md` against the compose stack from empty volumes, the lab, and the release build of the extension: sign in through the popup (O), screenshot with a box (A), tab video of the lab errors (B), instant replay (C), the logged-out link and the failing request (F), a timed comment (G), folders (H), Ctrl+K (I), MCP consent and reads, plus an opt-in real Claude Code run (J), `nib pull` (CLI), draft recovery after the tab closes (M), and a visual pass at 1440 and 390 px, light and dark. Run: `pnpm --filter @toolbar/extension build && pnpm --filter @toolbar/e2e flows` (display `:120` by default). All 13 pass; results and gaps in `docs/status.md`, section "User journeys on main".
- Fixed on the way: tab recording never started outside the fake driver (stream id expired during the countdown), the popup's tab came from the wrong window, tabs open before install had no in-page UI, a closed editor tab left the session busy, the countdown flashed 4, the MCP URL wrapped at 390 px.

### Next
- Step 2 gate: notify the owner; then step 3 (parity matrix against Jam).
- Flows not scripted yet: D (desktop recording through Chrome's picker), E (recording link recipient), K (delete), L (invite), N (create workspace).

### Machine notes
- Installed on this machine only via nix profile: xdotool, imagemagick, xvfb, openbox, ffmpeg-headless.
- Owner decisions: D-005 (no steering; Nuru as test target; Agentation and Vercel Toolbar taste), D-016 (no mobile or desktop apps).
