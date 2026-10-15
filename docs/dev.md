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

Node 24, pnpm 11.27 (`corepack enable` picks it up from `packageManager`; where Node lives in a read-only store, as on NixOS, `corepack enable` fails: use `corepack pnpm@11.27.0 ...`, `npm i -g pnpm@11.27.0`, or a pnpm already on `PATH`), Docker with compose. For e2e: Xvfb, and openbox if you want the screen picker (on this VM: `nix profile add nixpkgs#xorg.xvfb nixpkgs#openbox`).

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
| `:101`, `:120` | Xvfb displays for the area suites and the flows (`E2E_DISPLAY`); `:99` is the shared browser, never use it |
| 9341, 9351 | CDP ports of the flows' browsers (the popup is reached over CDP) |

## Full stack in Docker

```sh
docker compose up --build          # or -d; first run builds the server image and downloads the whisper model
curl -s localhost:3000/api/health  # {"ok":true,"checks":{"db":{"ok":true},"s3":{"ok":true},"whisper":...}}
```

Open http://localhost:3000, sign in with any email and a password of 8+ characters (the account is created on first sign-in, with a personal workspace). Mail goes to http://localhost:8025.

Compose works with no `.env`: every variable has a dev default. For anything beyond localhost, run `scripts/gen-secrets.sh https://your.host` to write `.env` with random secrets (`.env.example` lists every variable). The server refuses to start on a non-localhost `PUBLIC_URL` with dev secrets. Sign-in rate limits (3 tries per 10 s per address) are on in the image; `AUTH_RATE_LIMIT=off` turns them off for an e2e run.

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
pnpm e2e           # test build of the extension, then the area suites (needs compose server + lab)
scripts/e2e-all.sh # every e2e suite on a fresh, seeded compose stack (see E2E below)
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

Two Playwright suites in `e2e/`, both headed Chromium on a private Xvfb display with openbox (never `:99`):

| Suite | Specs | Extension build | Config | Default display |
|---|---|---|---|---|
| Area suites | `e2e/tests/**` (one folder per area, about 230 tests) | test build `chrome-mv3-test` (open shadow root, `globalThis.__tb`) | `playwright.config.ts` | `:101` |
| User journeys | `e2e/flows/*.spec.ts`, flows A to O of `docs/jam/flows.md` | release build `chrome-mv3` | `playwright.flows.config.ts` | `:120` |

### Everything, from a clean database

```sh
scripts/e2e-all.sh                         # down -v, up --build, seed, build, area suites, flows
AREA_DISPLAY=:121 RUNS=3 scripts/e2e-all.sh  # another display; three full runs, each from wiped volumes
KEEP=1 scripts/e2e-all.sh                  # keep the running stack and its data
```

The script does, in order:

1. `docker compose down -v`, then `AUTH_RATE_LIMIT=off docker compose up --build -d`, and waits for `/api/health`. Rate limits are off because the suites sign in many test accounts from one address, and Better Auth allows 3 sign-ins per 10 s per address in production.
2. `pnpm --filter @toolbar/server db:seed` against the compose database (the server's defaults point at it). The seed prints a personal token; the script passes it as `NIB_E2E_TOKEN`, so `agent/cli-create.spec.ts` runs instead of skipping.
3. Builds the release extension, the test extension and the CLI (`packages/cli/dist/nib.mjs`).
4. Runs the area suites, then the flows. With `RUNS=n` it repeats steps 1, 2 and 4 n times. Logs go to `e2e/runs/area-N.log` and `e2e/runs/flows-N.log`; HTML reports to `e2e/playwright-report` and `e2e/playwright-report-flows`; flow screenshots to `e2e/flows-shots/`.

It needs the lab (`systemctl --user status toolbar-lab`, on :5173 and :5174), Xvfb, openbox, xdotool, xclip, ImageMagick (`import`) and ffmpeg.

### One suite or one spec

```sh
cd e2e
E2E_DISPLAY=:121 npx playwright test tests/viewer             # an area folder (test build)
E2E_DISPLAY=:120 npx playwright test -c playwright.flows.config.ts d-desktop   # one flow (release build)
FLOWS_PICKER=fake npx playwright test -c playwright.flows.config.ts d-desktop e-recording  # the fallback path
```

`e2e/global-setup.ts` starts Xvfb (and openbox) on `E2E_DISPLAY` when no X server owns it, and stops them at the end. Overrides: `E2E_DISPLAY`, `LAB_URL`, `SERVER_URL`, `MAILPIT_URL`, `E2E_EXT_BUILD` (area suites), `FLOWS_EXT_BUILD` (flows), `DATABASE_URL` (defaults to the compose one), `E2E_CALLBACK_HOST`. The flows write to `test-results-flows/`, so both suites can run side by side on different displays.

Points that keep the runs deterministic:

- Listeners the server must call (webhooks, the GitHub and Slack stand-ins) bind `0.0.0.0`. `e2e/fixtures/net.ts` gives the server `host.docker.internal` when a container publishes the server's port (compose maps it to the host gateway), else `127.0.0.1`; the browser keeps using `127.0.0.1`.
- Chrome's share picker crashes Chromium on Xvfb now and then (`docs/spikes.md` S2). Tests that go through it (flows D and E, the capture suite's J-201) run in a browser of their own on a private Xvfb display (`e2e/fixtures/xvfb.ts`, the suite's display number plus 40). A crash, and only a crash, gets another try in a fresh browser: D and E fall back to Chromium's fake media flags after three crashes and say `LIMITATION` in the log and a `limitation` annotation in the report; J-201 has four tries and no fallback, since a fake picker cannot be cancelled.
- The flows close the app's pages each flow leaves open. Playwright reports every page as visible, so left-over capture tabs would each hold a comments stream (a real browser drops it for background tabs) and use up Chromium's six connections to the server.

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
