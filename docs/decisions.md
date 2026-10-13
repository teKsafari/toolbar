# Decisions

Each entry names the decision, the source (Jam observation, public doc, or owner), and the date.

| ID | Date | Decision | Source |
|---|---|---|---|
| D-001 | 2026-10-13 | MIT license, `LICENSE` at the repo root from the first commit. | Owner (PLAN.md) |
| D-002 | 2026-10-13 | Jam screenshots go in `research/jam-private/`, ignored by git. | Owner (PLAN.md, clean-room rules) |
| D-003 | 2026-10-13 | The lab app is SvelteKit with `adapter-node`, so it can serve WebSocket, SSE and streamed HTML from one process. | Public doc: SvelteKit adapter-node |
| D-004 | 2026-10-13 | The lab app runs from `lab/server.js` (build output plus `ws`) on port 5173, with a second origin on 5174 for the cross-origin image. It runs as the systemd user unit `toolbar-lab`. | Public docs: SvelteKit adapter-node custom server, `ws` |
| D-005 | 2026-10-13 | Owner input: the owner likes the ergonomics of Agentation and the Vercel Toolbar. Part 1 still replicates Jam as Jam is; Part 2 moves the in-page toolbar toward those two (learned from their public docs and use only, no Agentation code). The owner also named Nuru (https://116.nuru.sh) as a test target from step 1 on, and asked for end-to-end execution without steering. | Owner |
| D-006 | 2026-10-13 | Extension UI that page automation cannot reach (toolbar icon, popup, screen picker) is driven with real X input via `scripts/xdrive/` on display `:99`. One agent drives the shared browser at a time. | Own decision |
