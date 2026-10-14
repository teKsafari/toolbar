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
- Step 2: foundation done and checked (Nib, D-018..D-027). The eight area branches (`area/*`, kept) are merged into main (D-073); worktrees removed. One migration `0001_area_merge`. Status per row: `docs/status.md` (P0 73 built; P1 101 built, 5 partial; P2 61 built, 1 partial, 10 skipped).
- Open after the merge (each a call or mount in another area's file, from the area reports):
  - J-137, J-140: the editor's destination menu does not list integrations or mount dashboard's `TrackerFields`; finalize never sends `destination: {type:'integration'}`.
  - J-138: the capture page header has the viewer's own send menu; dashboard's `SendToApp` (field form, J-140) is not mounted.
  - J-136: no first-view email is sent at all yet (the mention and domain-join mails are gated).
  - J-011: heavy-page detection and `replay.set {allowHeavy}` in the capture service.
  - J-200: the recording-link recorder page has no denied-microphone instructions or record-without-voice choice.
  - The viewer's share page checks revoked and expired links itself; folder privacy (`memberCanSee`) is applied only by server-core's routes.
  - Capture e2e drives the product flows through `__tb.flow` (ext-ui's handlers over the capture driver); the bar and countdown UI checks live in the ext-ui suite.

### Next
- Step 2: build the replica per `docs/architecture.md`, one agent per area in worktrees.

### Machine notes
- Installed on this machine only via nix profile: xdotool, imagemagick, xvfb, openbox, ffmpeg-headless.
- Owner decisions: D-005 (no steering; Nuru as test target; Agentation and Vercel Toolbar taste), D-016 (no mobile or desktop apps).
