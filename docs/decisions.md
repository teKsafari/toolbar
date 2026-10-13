# Decisions

Each entry names the decision, the source (Jam observation, public doc, or owner), and the date.

| ID | Date | Decision | Source |
|---|---|---|---|
| D-001 | 2026-10-13 | MIT license, `LICENSE` at the repo root from the first commit. | Owner (PLAN.md) |
| D-002 | 2026-10-13 | Jam screenshots go in `research/jam-private/`, ignored by git. | Owner (PLAN.md, clean-room rules) |
| D-003 | 2026-10-13 | The lab app is SvelteKit with `adapter-node`, so it can serve WebSocket, SSE and streamed HTML from one process. | Public doc: SvelteKit adapter-node |
| D-004 | 2026-10-13 | The lab app runs from `lab/server.js` (build output plus `ws`) on port 5173, with a second origin on 5174 for the cross-origin image. It runs as the systemd user unit `toolbar-lab`. | Public docs: SvelteKit adapter-node custom server, `ws` |
