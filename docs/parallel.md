# Parallel build: areas, ownership, ports

Eight area agents build Part 1 step 2 at the same time, each in its own worktree and branch (`area/<name>`). This page says which files each area owns, which ports and resources it uses, and the rules that keep the merge cheap. The task list per area is in `docs/tasks.md`.

## Contracts to build against

| Contract | Where | What it fixes |
|---|---|---|
| HTTP API | `packages/shared/src/api/*.ts`, imported as `@toolbar/shared/api` | Every endpoint as a `defineRoute()` value: method, path, auth mode, minimum seat role, token scope, zod schemas for params, query, body and response, success status, error codes, owning area, catalogue rows. `ROUTE_LIST` and `ROUTES` (by name) in `routes.ts`; `GET /api/v1` prints the table. |
| Error bodies | `api/common.ts` | `{ error, message?, issues? }`; `ERROR_STATUS` maps each code to its HTTP status. Lists use the paging envelope `{ items, total?, returned, hasMore, nextCursor }`. |
| Capture events | `packages/shared/src/events.ts`, `schemas.ts` | The event envelope (D-008) and `captureEventSchema`; tagged values in console args use `$t` (`SERIALIZED_TAG`). |
| Extension messaging | `packages/shared/src/ext/messages.ts`, imported as `@toolbar/shared/ext` | Port messages, `BgRequestMap` (request to response), sw-to-content commands, broadcasts, offscreen requests and events, editor iframe messages. |
| Capture session | `ext/state.ts` | States `idle`, `arming-screenshot`, `countdown`, `starting`, `recording` (tab, screen, desktop), `stopping`, `draft`, `uploading`, `error`; replay buffer as a separate `ReplayState`. `transition()` is pure and tested. |
| Extension storage | `ext/storage.ts` | `chrome.storage` keys with value types (`STORAGE`, `StorageValues`), the IndexedDB stores (`IDB`: uploads, ring, drafts, blobs), draft shape. |
| Database | `apps/server/src/lib/server/db/schema/*.ts` | One file per area (below); `schema/index.ts` re-exports them. The tables are exactly those of `drizzle/0000_init.sql`. |
| Secrets at rest | `apps/server/src/lib/server/crypto.ts` | `seal()` and `unseal()` (AES-256-GCM, key per purpose from `BETTER_AUTH_SECRET`) for share and recording-link tokens, integration tokens, webhook secrets. |
| Seed data | `apps/server/scripts/seed.ts`, `apps/server/fixtures/` | Two users, a workspace, a folder, a recording link, a personal token and three ready captures with media in S3. |

Naming: the API path says `recordings`; the UI says capture. They are the same row.

Auth modes on routes: `public`, `member` (session or `Bearer tb_dev_`/`tb_pat_`), `viewer` (member, or a share token in the `x-toolbar-share` header for the logged-out viewer), `upload` (member, or the `tb_upl_` token a recording-link recipient gets), `session` (browser session only). Seat roles: viewer, creator, admin; the stored role `owner` acts as admin and Better Auth's `member` as creator (`seatRoleOf()`).

## Areas

| i | Area | Branch | Scope (docs/tasks.md) |
|---|---|---|---|
| 0 | server-core | `area/server-core` | Upload API, Garage storage, jobs (finalize, remux, thumbnail, transcribe, purge, expire), share tokens, media proxy, compose |
| 1 | auth | `area/auth` | Better Auth sign-in, workspaces bootstrap, invites, extension sign-in (PKCE), API tokens |
| 2 | capture | `area/capture` | Page hooks, rrweb, ring buffer and instant replay, screenshots, tab/screen/desktop video, offscreen, webRequest, redaction, extension uploader |
| 3 | ext-ui | `area/ext-ui` | Popup, in-page bar, screenshot and area modes, countdown, drafts list, extension settings, shortcuts, brand tokens |
| 4 | editor | `area/editor` | Annotation editor, video trim, draft form, create, AI draft text |
| 5 | viewer | `area/viewer` | Capture page, player, console/network/actions/info panels, sync, comments, share dialog |
| 6 | dashboard | `area/dashboard` | Grid, filters, search palette, folders, recording links and recorder page, settings, members, integrations, webhooks |
| 7 | agent | `area/agent` | MCP server, CLI, markdown share page, event query endpoints, agent tab |

## Ownership

An area may create and change anything in the paths it owns. Paths marked "shared" may be edited by any area, additively only (see Rules).

| Area | Owns |
|---|---|
| server-core | `apps/server/src/lib/server/{upload,storage,jobs,media,share,transcribe}/**`, `s3.ts`, `crypto.ts`, `health.ts`, `lib/server/event-index.ts` (counts and markers for `captureDetailSchema.index`, computed at finalize); routes `api/v1/recordings/+server.ts` (POST), `api/v1/recordings/[id]/streams/**`, `.../finalize`, `.../status`, `.../media/**`, `.../share/**`, `.../share-links`, `.../transcript`, `DELETE api/v1/recordings/[id]`, `api/v1/assets`, `api/v1/share/**`, `api/v1/share-links/**`, `s/[token]/media/**`, `api/health`; `db/schema/captures.ts`, `db/schema/core.ts`; `docker-compose.yml`, `apps/server/Dockerfile`, `deploy/` |
| auth | `apps/server/src/lib/server/auth.ts`, `tokens.ts`, `env.ts` (auth entries); routes `login/`, `logout/`, `invite/**`, `ext/connect/`, `api/v1/ext/**`, `api/v1/me/+server.ts` (GET), `api/v1/me/active-workspace`, `api/v1/workspaces/+server.ts` (list, create), `api/v1/workspaces/[workspaceId]/invites/**`, `.../invite-link/**`, `api/v1/invites/**`, `api/v1/tokens/**`, `(app)/settings/{browsers,tokens}/`; `db/schema/auth.ts`; extension `apps/extension/lib/auth/**` |
| capture | `packages/capture/**`; extension `entrypoints/capture-main.content.ts`, `entrypoints/capture.content/index.ts` (bridge and port only), `entrypoints/offscreen/**`, `entrypoints/permissions/**`, `lib/{capture,upload,idb,ring,crop,registration}*`, `lib/bg/capture.ts`; `packages/shared/src/redact.ts` (new) |
| ext-ui | extension `entrypoints/popup/**`, `entrypoints/options/**`, `entrypoints/capture.content/*.svelte` and `entrypoints/capture.content/ui/**` (in-page UI except the editor), `lib/bg/ui.ts`, `lib/flags.ts`, `wxt.config.ts` (manifest and commands); `packages/ui/src/{tokens.ts,tokens.css,icons.ts,lib/*}` (X-07) |
| editor | `packages/ui/src/editor/**`; extension `entrypoints/editor/**` (if an iframe page) or `entrypoints/capture.content/editor/**`, `lib/bg/drafts.ts`; server `lib/server/ai/**`, route `api/v1/recordings/[id]/ai-draft` |
| viewer | `apps/server/src/routes/(app)/c/[id]/**`, `s/[token]/+page.*`, `packages/ui/src/viewer/**`, `apps/server/src/lib/components/viewer/**`; routes `GET`/`PATCH api/v1/recordings/[id]`, `api/v1/recordings/[id]/comments/**`, `.../views`, `api/v1/comments/**`; `db/schema/comments.ts` |
| dashboard | `apps/server/src/routes/(app)/+page.*`, `(app)/f/**`, `(app)/links/**`, `(app)/settings/**` except browsers and tokens, `rl/[token]/**`, `apps/server/src/lib/components/dashboard/**`, `lib/server/{integrations,webhooks,search,mail-templates}/**`; routes `GET api/v1/recordings` (list), `api/v1/recordings/bulk`, `.../send`, `.../issues`, `api/v1/folders/**`, `api/v1/workspaces/[workspaceId]/{+server.ts,folders,recording-links,members,audit,integrations,webhooks}/**`, `api/v1/recording-links/**`, `api/v1/rl/**`, `api/v1/search/**`, `api/v1/integrations/**`, `api/v1/webhooks/**`, `PATCH`/`DELETE api/v1/me`, `api/v1/me/settings`; `db/schema/dashboard.ts`, `db/schema/integrations.ts` |
| agent | `packages/cli/**` (new), `apps/server/src/routes/mcp/**`, `s/[token].md/**`, `api/v1/mcp/**`, `api/v1/recordings/[id]/{events,console,network,actions,frames}/**`, `apps/server/src/lib/server/mcp/**`, `packages/shared/src/derive/**` (new: network merge, console rows, action rows from events; the viewer moves to it after merge), `apps/server/src/lib/components/agent/**` (the viewer mounts the agent tab from here), `(app)/settings/{mcp,cli}/`; `db/schema/agent.ts` |

Shared (additive edits only): `packages/shared/src/{constants,events,schemas,ids}.ts`, `packages/shared/src/api/*.ts` (base contract files), `packages/shared/src/ext/{messages,state,storage}.ts`, `packages/shared/package.json`, `apps/server/src/hooks.server.ts`, `apps/server/src/app.d.ts`, `(app)/+layout.*`, `(app)/settings/+layout.svelte` (nav), `apps/extension/entrypoints/background.ts` (one import and one registration line per area), every `package.json` (add dependencies; do not bump others), `.env.example`, `docs/decisions.md` (append rows; the merge step renumbers).

Area-named files that exist already, so no area needs to touch a neighbour's file to add a contract:

| Add | Put it in | Wired by |
|---|---|---|
| a route | `packages/shared/src/api/areas/<area>.ts` (`<area>AreaRoutes`) | `routes.ts` spreads every area list |
| a worker request or content command | `packages/shared/src/ext/areas/<area>.ts` (`<Area>BgRequests`, `<Area>ContentCommand`) | `BgRequestMap extends` each, `ContentCommand` unions each |
| other shared types | `packages/shared/src/areas/<area>.ts` | import `@toolbar/shared/areas/<area>` |
| a table | `apps/server/src/lib/server/db/schema/<file>.ts` of the area | `schema/index.ts` re-exports every file |

Worker request handlers: each area writes `apps/extension/lib/bg/<area>.ts` exporting handlers for its `BgRequestMap` keys; `background.ts` gets one import line per area. Changing an existing route or message shape needs agreement from the areas that call it: say so in your final report instead of changing it alone.

## Ports and resources

Area index `i` from the table above. `scripts/area-setup.sh <area>` writes these into the worktree's `.env`, creates the database and applies the migrations (`--seed` also loads the seed data). Load the file in each shell with `set -a; . ./.env; set +a`.

| i | Area | Server (`DEV_PORT`, `PUBLIC_URL`) | WXT dev (`WXT_DEV_PORT`) | Xvfb (`DISPLAY`, `E2E_DISPLAY`) | Database | S3 key prefix |
|---|---|---|---|---|---|---|
| 0 | server-core | 3100 | 3200 | :110 | `toolbar_server_core` | `server-core/` |
| 1 | auth | 3101 | 3201 | :111 | `toolbar_auth` | `auth/` |
| 2 | capture | 3102 | 3202 | :112 | `toolbar_capture` | `capture/` |
| 3 | ext-ui | 3103 | 3203 | :113 | `toolbar_ext_ui` | `ext-ui/` |
| 4 | editor | 3104 | 3204 | :114 | `toolbar_editor` | `editor/` |
| 5 | viewer | 3105 | 3205 | :115 | `toolbar_viewer` | `viewer/` |
| 6 | dashboard | 3106 | 3206 | :116 | `toolbar_dashboard` | `dashboard/` |
| 7 | agent | 3107 | 3207 | :117 | `toolbar_agent` | `agent/` |

- Run the server with `pnpm --filter @toolbar/server dev` once `.env` is loaded (it reads `DEV_PORT`). `PUBLIC_URL` must match the port, or Better Auth rejects the origin.
- Extension builds point at your server with `WXT_SERVER_URL` (read it as `import.meta.env.WXT_SERVER_URL`, falling back to `DEFAULT_SERVER_URL`). Build-only is fine if you need no HMR; `.output/` is per worktree.
- Databases live on the shared compose Postgres at `localhost:5432` (user and password `toolbar`). There is no `createdb` binary on this VM; the script uses `psql ... -c 'create database ...'`.
- Storage: the shared Garage bucket `toolbar` at `localhost:3900`; `S3_KEY_PREFIX` puts every key under your prefix (`keys.*` in `s3.ts` apply it).
- Chromium profiles: `/tmp/tb-<area>-profile`. Remote debugging, if you need it: port `9310 + i`. Never `:99`, never ports 9224 to 9226, never the chrome-devtools or playwright MCP tools (the shared browser).
- Shared and read-only for everyone: the lab app on 5173 and 5174, Mailpit on 8025 and 1025 (search by recipient; seed users are `dana@toolbar.test` and `sam@toolbar.test`), whisper on 8080 (one job at a time).
- Never use port 3000, 3001 or the database `toolbar`: the compose stack and the main checkout own them.

## Rules

1. **No migrations in area branches.** Do not run `db:generate` and do not commit files under `apps/server/drizzle/`. Add tables or columns to your schema file and run `pnpm --filter @toolbar/server db:push` against your own database. The merge step generates one migration from the merged schema.
2. **Shared files change additively.** Add exports, fields (optional, or with a default), enum values, routes and messages. Do not rename, remove or retype what exists; other areas build against it today.
3. **New shared types go in area-named files** (table above), not in the base contract files, unless the type extends an existing base schema in place (an added optional field).
4. **Stay in your paths.** If you need a change in a path another area owns, write it down in your final report with the exact change; the merge step applies it.
5. **Use the contract at runtime.** Server handlers parse with the route's zod schemas; clients build URLs with `buildPath(ROUTES[name].path, params)`. A test that walks your routes against `ROUTES` catches drift early.
6. **Seed, do not depend on another area.** Viewer, dashboard and agent build against the seed captures (`--seed`) until capture and server-core land.
7. Commit on your branch only. Do not push; the coordinator merges.

## Seed data

`pnpm --filter @toolbar/server db:seed` (or `scripts/area-setup.sh <area> --seed`) creates, with fixed ids so links stay stable:

- users Dana Reviewer (`dana@toolbar.test`, workspace owner) and Sam Developer (`sam@toolbar.test`, creator), password `toolbar-dev-password`; a personal token for Dana, printed by the script (dev only; the script refuses a non-localhost `PUBLIC_URL`);
- workspace Lab shop, folder Checkout bugs, recording link Support inbox;
- capture `...c1`, tab video of `/checkout` (8 s WebM): console at five levels, a hidden 500 on `POST /api/orders` with a JSON error body, a request that never returns, a cross-origin image seen by webRequest, WebSocket frames, an uncaught TypeError with stack, a SPA navigation, masked email and password typing, a pen marker, device and browser info;
- capture `...c2`, area screenshot in the folder: crop with flattened annotations, the full viewport kept, annotation shapes and locator, logs from 20 s before the shot;
- capture `...c3`, tab video of `/form`: a 403 form action, SSE, an unhandled rejection, a pause, a transcript, and four comments (a timed thread with a reply, an anonymous comment, a mention, an edited comment);
- one `anyone` share link per capture.

Media lands in S3 as the finalize job would write it: `rec/<id>/events.json.gz` (time-sorted JSON array), `video.webm`, `thumb.webp`, and `rec/<id>/assets/<assetId>`. `apps/server/fixtures/generate.sh` rebuilds the media; `fixtures/events.ts` builds the events and `test/fixtures.test.ts` checks them against the schema.
