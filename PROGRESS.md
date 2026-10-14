# Progress

A new session reads this file first.

## Current step: Part 1, step 1 (use Jam)

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
- Step 2 starting.

### Next
- Step 2: build the replica per `docs/architecture.md`, one agent per area in worktrees.

### Machine notes
- Installed on this machine only via nix profile: xdotool, imagemagick, xvfb, openbox, ffmpeg-headless.
- Owner decisions: D-005 (no steering; Nuru as test target; Agentation and Vercel Toolbar taste), D-016 (no mobile or desktop apps).
