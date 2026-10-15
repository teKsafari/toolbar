# Lab app

The test target for capture tools. Each behavior is deliberate.

Run: `pnpm install && pnpm lab` (builds, then serves http://localhost:5173 and a second origin on 5174).

| Route | Behavior |
|---|---|
| `/` | Save (works), Export (no handler), Sync (request never returns), Submit order (500 hidden by the UI), Show profile (uncaught TypeError), Refresh (unhandled rejection), Load cart (GraphQL: POST `/api/graphql` answers 200 with an `errors` array), Call with auth (sets cookie `lab_session`, sends `Authorization` and `X-Api-Key` to `/api/ok?q=auth`), Set metadata (calls `window.toolbar.setMetadata` when present and logs whether it was), console at every level, modal, cross-origin image, iframe |
| `/form` | Text, email, password, textarea; SvelteKit form action with a validation error |
| `/list` | 500 rows, long scroll, selectable rows |
| `/canvas` | Text drawn on a canvas; the button redraws only the canvas |
| `/live` | WebSocket (`/ws`, echo plus a tick every 3 s) and SSE (`/api/sse`, 20 ticks) |
| `/slow` | SvelteKit streamed load (late data after 3 s) |
| `/items/[id]` | A route with a parameter and one button (`item-buy`), for source location (route file candidates) |
| `/slow-raw` | Plain HTML streamed in 8 chunks over 4 s |
