# Status: locator packets and source location (Part 2, step 4)

Branch `p4/locator`. Decisions D-128 (locator packets) and D-129 (source maps).

## What is built

| Part | Where | What it does |
|---|---|---|
| Packet shape | `packages/shared/src/locator.ts`, schema `locatorPacketSchema` in `schemas.ts` | The `annotations/aNN.locator.json` document: kind (element, text, area, page), URL, route without the base path, title, masking preset, framework (`sveltekit` or `svelte`, dev or not, route id), candidate route files with their source, dev `source` (file, line, column, depth) and Svelte block chain, the TargetRef fields flattened (selector, tag, role, accessible name, text, test id, id, classes, attrs, landmarks, nearest heading), page rect, viewport, selected text, crop size, recent errors with mapped frames. `locatorFiles()` and `locatorFileName()` give the folder paths (`a01.locator.json`, crop `a01.png`). |
| Route files | `locator.ts`: `parseRouteDictionary`, `matchRoutes`, `guessRouteIds`, `candidateRouteFiles` | Three sources, best first: Svelte dev meta (exact), the app's own SvelteKit route table (read from the entry module the HTML names, prod and dev; groups, optional and rest params, matchers; a server load adds `+page.server.ts`), and guesses from the URL where id-looking segments become `[param]`. |
| Page side | `packages/capture/src/locator.ts` (isolated), `locator-main.ts` (MAIN) | Resolves the target from a point (looking through the toolbar host), a selector, the text selection or an area. The MAIN world reads `__svelte_meta` (Svelte 5, and Svelte 3/4 with 0-based lines) when the isolated world dispatches a private DOM event on the element; the page never sees the event and no attribute is written. Production preset drops text, name, heading, title and selection. |
| Source maps | `packages/shared/src/sourcemap.ts` | `createStackMapper()` on `@jridgewell/trace-mapping`: V8 and Firefox stacks, map from the `SourceMap` header or the last `sourceMappingURL` comment (data URLs included), one fetch per script, size caps, original source line as `snippet`, `reason` when nothing maps. |
| Extension | `apps/extension/lib/bg/locator.ts`, contract `packages/shared/src/ext/areas/locator.ts` | Request `locator.capture` (`{ at | selector | rect | selection, tabId?, crop?, errorsSinceMs? }` -> `{ locator, crop }`): page part from the content script (`locator.describe`), route table fetched by the worker, errors of the last 60 s from the ring with mapped stacks, crop at 1x CSS pixels through the shared captureVisibleTab queue. Every error event and console error with a stack gets a follow-up `stackmap` event (new event kind) when its frames map. Test hook `__tb.locator`. |
| Server | migration `0006_annotation_locator.sql`, `upload/service.ts`, `viewer/detail.ts` | Annotations accept and return `locator`; the server sets `crop.assetId` to the annotation's asset. MCP `get_events` accepts the `stackmap` kind. |
| Lab | `lab/src/routes/items/[id]/+page.svelte` | A route with a parameter, for route candidate tests. |

## How it was verified

- Unit: `packages/shared/test/locator.test.ts` (17 tests: prod and dev route tables, route matching, guesses, candidates, stack parsing, project paths, source map lookup by comment, header and data URL, caching, failure reasons, folder names), `packages/capture/test/locator.test.ts` (8 tests with happy-dom: Svelte 5 and 4 meta, the MAIN-world event round trip, production masking, page fallback, entry discovery), `events.test.ts` sample for `stackmap`.
- E2E: `e2e/tests/locator/locator.spec.ts`, 5 tests, all passing on display `:182` against three lab builds and the dev server on :3302:
  1. production build without maps (:5173): element packet, route file from the route table, crop equal to the element's covering CSS pixels on a page with a scrollbar, the TypeError attached with `reason: no_map`;
  2. source-mapped build (:5186): `/items/42` matches `/items/[id]` with `params.id`, text selection and area packets, `/slow` lists `+page.server.ts`, `/form` (actions only) does not;
  3. source-mapped build: the uncaught TypeError's `stackmap` event and the packet's frames point at `src/routes/+page.svelte` and the exact line of `return user.profile.name`, with the snippet; a `console.error` with an Error maps too;
  4. vite dev server (:5184): `__svelte_meta` gives `src/routes/+page.svelte` at the button's line and column, the layout in the component chain, mapped stacks through vite's inline maps, and `src/routes/items/[id]/+page.svelte` for the param route;
  5. the server stores a packet with its annotation through finalize and returns it with `crop.assetId`.
- `pnpm -r --workspace-concurrency=2 build`, `test` and `check` pass. The capture area specs `hooks`, `screenshot` and `pages` ran against this build: 18 of 19 pass; `pages.spec.ts:41` (J-069 tab-hidden row) fails the same way on main without these changes.

## What is not built

- Wired after the gate 4 review (D-164): the reviewer toolbar asks `locator.capture` for every note and stores the packet on `feedback_item.locator`; the injector's page bundle builds the packet in the page for each comment. Proof: `e2e/tests/reviewer` (production build and the vite dev server), the injector compose test, `apps/server/test/feedback.int.test.ts`. Jam-style editor annotations stay burned into the screenshot with no locator.
- The hand-off folder writer is not here; it gets `annotations/aNN.locator.json` from `locatorFiles(detail.annotations)` and mapped frames from `stackmap` events by `ref`.
- Elements inside iframes are described from the top document only (the iframe element itself).
- Layout files (`+layout.svelte`) are not listed from the route table: SvelteKit's table holds layout node numbers, not their paths. Dev meta names them when the dev server runs.
- Source maps are fetched by the worker with the browser's credentials for origins the extension may reach; a map behind a different login, or one served only to a VPN the browser is not on, gives `reason: map_fetch_failed`.
- Next.js and other frameworks get URL guesses in SvelteKit form only.

## Notes for the merge

- `background.ts` now reads `registerLocator(setupCapture())`; `p4/trace` changes the same line to `registerTrace(setupCapture())`. Merge as `const capture = setupCapture(); registerTrace(capture); registerLocator(capture);`.
- `p4/trace` also adds an event kind (`canvas.sample`) and uses D-117 to D-122; renumber this branch's D-117 and D-118 (and the `D-117`/`D-118` references in code comments) at merge.
- Migration `0006_annotation_locator` is the only schema change.
- `apps/server/test/auth.int.test.ts` (D-114 allowlist test) fails when a worktree `.env` sets `ALLOWED_EMAIL_DOMAINS=test`, as the work-package `.env` files do; it passes without that file. Not caused by this branch.

## How to run it

```sh
cd lab && pnpm install && npx vite dev --port 5184 &                    # dev server for __svelte_meta
cd lab && npx vite build --sourcemap && PORT=5186 node server.js &      # a build that serves maps (in a worktree)
pnpm --filter @toolbar/extension build:test
cd e2e && E2E_DISPLAY=:182 SERVER_URL=http://localhost:3302 npx playwright test tests/locator
```
