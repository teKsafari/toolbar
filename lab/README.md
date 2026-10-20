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
| `/anchors.html?case=doc\|nested\|sticky\|transform` | Two cards for reviewer drawings (D-204): a scrolling document, an app shell whose `<main>` scrolls, a fixed header with a badge, a transformed wrapper; Shift adds a banner above the cards, Remove card deletes the first |
| `?tb-embed=<key>` on any page, `/__embed/csp?tb-embed=<key>`, `:5174/?tb-embed=<key>` | Opt-in pages for the embed suite (`e2e/embed`, D-211): the embed's script tag from `EMBED_SERVER` (default `http://localhost:3000`) first in `<head>`, `&tb-name=` adds `data-name`; the `/__embed/csp` page sends a strict CSP; the second origin answers a plain page with the tag. Without the parameter nothing changes |
