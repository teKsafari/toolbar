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
| D-007 | 2026-10-13 | pnpm workspace: `apps/extension` (WXT, Svelte 5), `apps/server` (SvelteKit + adapter-node), `packages/{shared,capture,ui,cli,trace}`. Capture code sits behind a `Transport` interface so the Part 2 injector reuses it. Details in `docs/architecture.md`. | Public docs: WXT, SvelteKit |
| D-008 | 2026-10-13 | One event envelope `{v,id,ctx,seq,t,kind,data}` for every captured signal; Part 2 spans and `.feedback/` files derive from it. | Own design, PLAN.md Part 2 |
| D-009 | 2026-10-13 | Uploads: chunked, idempotent, resumable per stream, buffered in IndexedDB; tus rejected (needs XHR, absent in service workers). | Public docs: MDN, tus-js-client |
| D-010 | 2026-10-13 | Postgres 18 + Drizzle; Garage v2 single-node for S3 (AGPL, runs unmodified as a separate container). Postgres job queue with SKIP LOCKED, no Redis. | Public docs: Garage, Drizzle, Better Auth |
| D-011 | 2026-10-13 | Better Auth with Google, Generic OAuth and organization plugins; extension signs in via `launchWebAuthFlow` + PKCE device token; extension ID pinned with manifest `key`. | Public docs: Better Auth, Chrome identity API |
| D-012 | 2026-10-13 | Share tokens: 128-bit base64url; DB stores sha256 for lookup and an AES-GCM copy for redisplay; `no-referrer`, `noindex`, revocable. | PLAN.md Part 2 |
| D-013 | 2026-10-13 | Instant replay: per-tab IndexedDB ring in the service worker, rrweb pruned to the last full snapshot (every 30 s); optional 10 s WebM segments in the offscreen document. | Public docs: Chrome MV3 offscreen, rrweb |
| D-014 | 2026-10-13 | Transcription: whisper.cpp server container behind a `Transcriber` interface, OpenAI-compatible fallback. | Public docs: whisper.cpp |
| D-015 | 2026-10-13 | Tests: vitest units; Playwright 1.63.0 e2e loading the unpacked extension against the lab app. E2E builds open the shadow root; release builds keep it closed. Extension-icon clicks in tests use a private X display `:100`, never the shared `:99`. | Public docs: Playwright extensions |
| D-016 | 2026-10-13 | Owner: no mobile apps and no desktop app. Jam features that exist only in those apps go on the skip list; the browser extension and web app are the whole product. | Owner |
| D-017 | 2026-10-14 | Gate 1 passed after seven independent review rounds (three in the step 1 workflow, four in `jam-gate1` with QA, developer and admin lenses). No round came back fully clean: rounds found 5, 3, 1 and 2 P0/P1 gaps in the last four, all detail refinements, all patched. Strict "no missing P0/P1" is asymptotic for a reviewer told to find gaps; step 3 parity runs against Jam catch the rest. Final catalogue: 251 rows (P0 73, P1 106, P2 72). A clean-room audit paraphrased 20 lines and found no personal data. | Own decision |
