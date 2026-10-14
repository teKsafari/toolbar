# Developing Nib

How to run each part of the repo on this machine or a fresh one. Nib is the working product name (D-018); the repo and package scope stay `toolbar`.

## Layout

| Path | Package | What it is |
|---|---|---|
| `apps/server` | `@toolbar/server` | SvelteKit 3 app (adapter-node): dashboard, share pages, `/api/v1`, Better Auth, job worker |
| `apps/extension` | `@toolbar/extension` | WXT + Svelte 5 MV3 extension |
| `packages/shared` | `@toolbar/shared` | Event envelope and kinds, zod schemas, constants, ids; `/api` endpoint contracts and route table; `/ext` extension messaging, session state machine, storage keys |
| `packages/capture` | `@toolbar/capture` | Page-side capture: `Transport`, MAIN/ISOLATED bridge, hook installers |
| `packages/ui` | `@toolbar/ui` | Design tokens, icons, Svelte primitives (Button, Icon, Popover, Toaster) |
| `e2e` | `@toolbar/e2e` | Playwright 1.63.0 suite that loads the unpacked extension |
| `lab` | (own project) | The capture test target; not in the workspace, own lockfile |

Internal packages ship TypeScript source (`exports` point at `src/*.ts`); Vite and WXT compile them. Their `build` script is a type check.

## Requirements

Node 24, pnpm 11.27 (`corepack enable` picks it up from `packageManager`), Docker with compose. For e2e: Xvfb, and openbox if you want the screen picker (on this VM: `nix profile add nixpkgs#xorg.xvfb nixpkgs#openbox`).

## Ports

| Port | Service |
|---|---|
| 3000 | Server (compose `server`, or `pnpm dev:server`; not both) |
| 3001 | WXT dev server (extension HMR) |
| 3100 to 3107, 3200 to 3207 | Area worktree servers and WXT dev servers (`docs/parallel.md`) |
| 5432 | Postgres 18 |
| 3900 | Garage S3 API |
| 8080 | whisper.cpp server |
| 8025 | Mailpit inbox UI (all dev mail lands here) |
| 1025 | Mailpit SMTP |
| 5173, 5174 | Lab app (user service `toolbar-lab`), second origin |
| `:101` | Xvfb display for e2e (`E2E_DISPLAY`); `:99` is the shared browser, never use it |

## Full stack in Docker

```sh
docker compose up --build          # or -d; first run builds the server image and downloads the whisper model
curl -s localhost:3000/api/health  # {"ok":true,"checks":{"db":{"ok":true},"s3":{"ok":true},"whisper":...}}
```

Open http://localhost:3000, sign in with any email and a password of 8+ characters (the account is created on first sign-in, with a personal workspace). Mail goes to http://localhost:8025.

Compose works with no `.env`: every variable has a dev default. For anything beyond localhost, run `scripts/gen-secrets.sh https://your.host` to write `.env` with random secrets (`.env.example` lists every variable). The server refuses to start on a non-localhost `PUBLIC_URL` with dev secrets.

`docker compose down -v` wipes the database, the bucket and the whisper model.

## Dev mode

```sh
pnpm install
pnpm stack                      # docker compose up -d postgres garage mailpit whisper
docker compose stop server      # only if the compose server holds port 3000
pnpm dev                        # server on :3000 (vite dev) and the extension watch build, in parallel
pnpm dev:server                 # or one at a time
pnpm dev:extension
```

The server reads the repo root `.env` when present, and falls back to the same defaults as compose (`postgres://toolbar:toolbar@localhost:5432/toolbar`, Garage on `localhost:3900`). Migrations run at startup (`MIGRATE_ON_START=1`); the job worker runs in the same process (`WORKER=1`).

Database schema changes: tables live in `apps/server/src/lib/server/db/schema/<area>.ts`, re-exported by `schema/index.ts`.

```sh
pnpm --filter @toolbar/server db:migrate      # apply drizzle/ to DATABASE_URL
pnpm --filter @toolbar/server db:push         # area worktrees: push schema changes to your own database
pnpm --filter @toolbar/server db:generate     # main branch only (merge step): writes drizzle/NNNN_*.sql
pnpm --filter @toolbar/server db:seed         # two users, a workspace, three captures with media
```

Area worktrees run side by side on their own ports, databases and S3 prefixes: `scripts/area-setup.sh <area> --seed`, then see `docs/parallel.md`.

Production-style server without Docker: `pnpm --filter @toolbar/server build && cd apps/server && node server.js`. Use `server.js`, not `node build` (D-023).

## Build, test, check

```sh
pnpm -r build      # every package: type checks, the server build, the release extension build
pnpm -r test       # unit tests (vitest); the server's DB test runs when Postgres on :5432 answers, else skips
pnpm -r check      # svelte-check / tsc
pnpm e2e           # test build of the extension, then the Playwright suite (needs compose server + lab)
```

## The extension

Builds:

| Command | Output | Notes |
|---|---|---|
| `pnpm --filter @toolbar/extension dev` | `apps/extension/.output/chrome-mv3-dev` | watch + HMR via :3001 |
| `pnpm --filter @toolbar/extension build` | `apps/extension/.output/chrome-mv3` | release: closed shadow root |
| `pnpm --filter @toolbar/extension build:test` | `apps/extension/.output/chrome-mv3-test` | open shadow root, `globalThis.__tb` in the worker |
| `WXT_OUT_SUFFIX=-121 WXT_TEST_HOOKS=1 pnpm --filter @toolbar/extension exec wxt build` | `apps/extension/.output/chrome-mv3-test-121` | the test build in a folder of its own, for a run beside others (`E2E_EXT_BUILD=chrome-mv3-test-121`) |

Load it unpacked:

1. Build one of the above.
2. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked", pick the output folder.
3. The id is always `fmongfmimgdafigcahdpofnmmhljpnei` (the manifest `key` pins it, D-022). Pin the action from the puzzle menu.

Or start a private Chromium with it, on its own display (never `:99`):

```sh
Xvfb :101 -screen 0 1440x900x24 & DISPLAY=:101 openbox &
DISPLAY=:101 ~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome --user-data-dir=/tmp/nib-profile --no-first-run \
  --disable-extensions-except=$PWD/apps/extension/.output/chrome-mv3-dev \
  --load-extension=$PWD/apps/extension/.output/chrome-mv3-dev http://localhost:5173
```

`--no-first-run` matters: without it a fresh profile opens a modal terms-of-service dialog and Chromium loads nothing until someone clicks Accept. openbox takes its display from `DISPLAY` and rejects a `--display` flag.

WXT's own browser runner is off (`webExt.disabled`), because this VM has no display for it and the shared browser belongs to another agent.

How the pieces connect: the service worker registers `content-scripts/capture-main.js` (MAIN world) and `content-scripts/capture.js` (ISOLATED) for `<all_urls>` at `document_start`. The MAIN script installs the page hooks from `@toolbar/capture` and relays events over a private `MessageChannel`; the isolated script forwards them to the worker on the `capture` port and, in the top frame, mounts `<toolbar-root>` with the Svelte UI in a shadow root.

The signing key's private half is `.secrets/extension-key.pem` (git-ignored). Keep a copy outside this machine; a new key means a new extension id.

## E2E

```sh
docker compose up -d               # server on :3000
systemctl --user status toolbar-lab  # lab on :5173
pnpm e2e
```

`e2e/global-setup.ts` starts Xvfb `:101` (and openbox) when no X server owns it, and stops them at the end. Overrides: `E2E_DISPLAY`, `LAB_URL`, `SERVER_URL`, `E2E_EXT_BUILD` (output folder name under `apps/extension/.output`). Reports land in `e2e/playwright-report`.

## Where area work goes

| Area | Start here |
|---|---|
| Page capture hooks | `packages/capture/src/hooks/*.ts` (one installer per API), redaction in `packages/capture/src/isolated.ts` |
| Extension flows | `apps/extension/entrypoints/background.ts` (commands, capture modes), `offscreen/main.ts` (MediaRecorder), `capture.content/Toolbar.svelte` (in-page UI), `popup/App.svelte` |
| API | `apps/server/src/routes/api/v1/**`, helpers in `apps/server/src/lib/server/api.ts`, contracts in `packages/shared/src/api/` (route table `routes.ts`) |
| Jobs | register handlers with `registerJob()` in `apps/server/src/lib/server/jobs/worker.ts`, enqueue with `enqueue()` |
| Viewer, dashboard, settings | `apps/server/src/routes/(app)/**`, share page `apps/server/src/routes/s/[token]` |
| Transcription | `apps/server/src/lib/server/transcribe/index.ts` |
| Shared UI | `packages/ui/src/lib/*`, tokens in `packages/ui/src/tokens.ts` (then `pnpm --filter @toolbar/ui gen:tokens`) |
