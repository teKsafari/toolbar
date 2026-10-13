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
- Scaffolding.
- Lab app in `lab/`, running as the `toolbar-lab` user service on :5173 (and :5174).

### Not done
- Everything else above.

### In flight (2026-10-13)
- Workflow `jam-step1-catalogue`: seven serial browser sessions with Jam (popup and capture, annotation, capture per lab case, viewer and sharing, dashboard, MCP and agent output, flows and speed), public-doc research, owner-taste research (Agentation, Vercel Toolbar), then catalogue writing and an independent review loop for gate 1. Raw notes: `research/jam-private/notes/` (gitignored).
- Architecture design for step 2: `docs/architecture.md`.

### Owner status
- Logged in to Jam; extension installed and pinned. Owner asked for end-to-end execution without steering (D-005).
