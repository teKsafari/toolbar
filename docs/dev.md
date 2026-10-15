# Developing open-toolbar

How to run each part of the repo on this machine or a fresh one. The product is open-toolbar (D-083, formerly the working name Nib); the repo and package scope stay `toolbar`.

## Layout

| Path | Package | What it is |
|---|---|---|
| `apps/server` | `@toolbar/server` | SvelteKit 3 app (adapter-node): dashboard, share pages, `/api/v1`, Better Auth, job worker |
| `apps/extension` | `@toolbar/extension` | WXT + Svelte 5 MV3 extension |
| `packages/shared` | `@toolbar/shared` | Event envelope and kinds, zod schemas, constants, ids; `/api` endpoint contracts and route table; `/ext` extension messaging, session state machine, storage keys |
| `packages/capture` | `@toolbar/capture` | Page-side capture: `Transport`, MAIN/ISOLATED bridge, hook installers |
| `packages/ui` | `@toolbar/ui` | Design tokens, icons, Svelte primitives (Button, Icon, Popover, Toaster) |
| `packages/trace` | `@toolbar/trace` | Part 2 traces: the span engine (outcomes, `causedBy`), keyframe planner and dHash, SvelteKit and Next.js request names; runs in the extension worker and on the server (D-117 to D-122) |
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
| 3311 | Mock OIDC provider (compose profile `dev`), as `http://oidc.localhost:3311` |
| 8025 | Mailpit inbox UI (compose profile `mail`, only for the paused mail) |
| 1025 | Mailpit SMTP (profile `mail`) |
| 5173, 5174 | Lab app (user service `toolbar-lab`), second origin |
| `:101`, `:120` | Xvfb displays for the area suites and the flows (`E2E_DISPLAY`); `:99` is the shared browser, never use it |
| 9341, 9351 | CDP ports of the flows' browsers (the popup is reached over CDP) |

## Full stack in Docker

```sh
docker compose up --build          # or -d; first run builds the server image and downloads the whisper model
curl -s localhost:3000/api/health  # {"ok":true,"checks":{"db":{"ok":true},"s3":{"ok":true},"whisper":...}}
```

Open http://localhost:3000. Out of the box the server offers no sign-in method: sign-in is one OIDC provider that you configure (`docs/configuration.md`, "Sign-in"; D-114). For development, start the mock provider of the `dev` profile and point the server at it:

```sh
OIDC_ISSUER=http://oidc.localhost:3311/toolbar OIDC_CLIENT_ID=toolbar OIDC_CLIENT_SECRET=dev \
OIDC_PROVIDER_NAME="Dev SSO" docker compose --profile dev up -d
```

The login page then shows one "Sign in with Dev SSO" button. The mock's own page asks for a user name (it becomes the subject) and the ID token claims, for example `{"email": "you@example.test", "email_verified": true, "name": "You"}`; it signs whatever you give it, so it never belongs in a real deployment. Browsers resolve `*.localhost` to this machine and the server container reaches the same name through `host-gateway`, so both see one issuer (D-094). `ALLOWED_EMAIL_DOMAINS` limits who gets in; `test` admits every `*.test` address.

The dev-only password sign-in stays available with `AUTH_DEV_PASSWORD=1`: sign in with any email and a password of 8+ characters (the account is created on first sign-in, with a personal workspace). The seeded accounts (`dana@toolbar.test`, `sam@toolbar.test`, password `toolbar-dev-password`) need it.

Paused features (docs/scope.md) stay hidden unless their flag is set to 1: `FEATURE_EMAIL`, `FEATURE_TRACKERS`, `FEATURE_SLACK`, `FEATURE_CLI`, `FEATURE_AI`, `FEATURE_ADMIN_EXTRAS`. `/api/health` lists the ones that are on (`features`), and e2e tests of a paused feature read it and skip with "paused (docs/scope.md)" while the flag is off (`e2e/fixtures/features.ts`). Mail needs `FEATURE_EMAIL=1` and `SMTP_URL`; Mailpit comes with the `mail` profile: `FEATURE_EMAIL=1 SMTP_URL=smtp://mailpit:1025 docker compose --profile mail up -d`.

Compose works with no `.env`: every variable has a dev default. For anything beyond localhost, run `scripts/gen-secrets.sh https://your.host` to write `.env` with random secrets (`.env.example` lists every variable). The server refuses to start on a non-localhost `PUBLIC_URL` with dev secrets. Sign-in rate limits (3 tries per 10 s per address) are on in the image; `AUTH_RATE_LIMIT=off` turns them off for an e2e run.

`docker compose down -v` wipes the database, the bucket and the whisper model.

## Dev mode

```sh
pnpm install
pnpm stack                      # docker compose --profile dev up -d postgres garage whisper oidc-mock
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
pnpm -r test       # unit tests (vitest); the server's DB tests run when Postgres on :5432 answers, its mail tests when Mailpit does (profile `mail`), else skip
pnpm -r check      # svelte-check / tsc
pnpm e2e           # test build of the extension, then the area suites (needs compose server + lab)
scripts/e2e-all.sh # every e2e suite on a fresh, seeded compose stack (see E2E below)
```

Transcription tests (`apps/server/test/transcribe*.test.ts`): the unit tests use recorded API answers and synthetic audio; the chunker and integration tests need ffmpeg and use the FLEURS clips in `apps/server/fixtures/transcribe/` (CC BY 4.0, `ATTRIBUTION.md`). One live test calls OpenAI's `gpt-transcribe` on both clips, about $0.002 a run, and runs only when asked:

```sh
TRANSCRIBE_LIVE_TEST=1 pnpm --filter @toolbar/server exec vitest run test/transcribe.live.test.ts   # needs OPENAI_API_KEY or TRANSCRIBE_API_KEY
```

## The extension

Builds:

| Command | Output | Notes |
|---|---|---|
| `pnpm --filter @toolbar/extension dev` | `apps/extension/.output/chrome-mv3-dev` | watch + HMR via :3001 |
| `pnpm --filter @toolbar/extension build` | `apps/extension/.output/chrome-mv3` | release: closed shadow root |
| `pnpm --filter @toolbar/extension build:test` | `apps/extension/.output/chrome-mv3-test` | open shadow root, `globalThis.__tb` in the worker |
| `WXT_OUT_SUFFIX=-121 WXT_TEST_HOOKS=1 pnpm --filter @toolbar/extension exec wxt build` | `apps/extension/.output/chrome-mv3-test-121` | the test build in a folder of its own, for a run beside others (`E2E_EXT_BUILD=chrome-mv3-test-121`) |

A build with your own name and icon: `WXT_APP_NAME=... WXT_APP_ICON=<svg or png>` in front of any of these (`docs/branding.md`). `node apps/extension/scripts/icons.ts` re-renders the packaged icons from `apps/extension/assets/icon.svg`.

Load it unpacked:

1. Build one of the above.
2. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked", pick the output folder.
3. The id is always `fmongfmimgdafigcahdpofnmmhljpnei` (the manifest `key` pins it, D-022). Pin the action from the puzzle menu.

Or start a private Chromium with it, on its own display (never `:99`):

```sh
Xvfb :101 -screen 0 1440x900x24 & DISPLAY=:101 openbox &
DISPLAY=:101 ~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome --user-data-dir=/tmp/tb-profile --no-first-run \
  --disable-extensions-except=$PWD/apps/extension/.output/chrome-mv3-dev \
  --load-extension=$PWD/apps/extension/.output/chrome-mv3-dev http://localhost:5173
```

`--no-first-run` matters: without it a fresh profile opens a modal terms-of-service dialog and Chromium loads nothing until someone clicks Accept. openbox takes its display from `DISPLAY` and rejects a `--display` flag.

Site access (D-123, D-126): a release build can talk to its server and nothing else. To capture on an app, a workspace admin adds it under Settings, Projects (name, origins, masking preset). After sign-in, open the popup on that app and click Allow; Chrome asks once for the origins of all your projects. On any other site the popup says the site is in no project and nothing is injected. A build pointed at another server through the options page asks for that server's origin when you save it.

WXT's own browser runner is off (`webExt.disabled`), because this VM has no display for it and the shared browser belongs to another agent.

How the pieces connect: the service worker registers `content-scripts/capture-main.js` (MAIN world) and `content-scripts/capture.js` (ISOLATED) at `document_start` for the origins of the signed-in user's projects that the person allowed (D-126; test builds: every site unless storage key `tb:test-scope` is `projects`). The MAIN script installs the page hooks from `@toolbar/capture` and relays events over a private `MessageChannel`; the isolated script forwards them to the worker on the `capture` port and, in the top frame, mounts `<toolbar-root>` with the Svelte UI in a shadow root.

The signing key's private half is `.secrets/extension-key.pem` (git-ignored). Keep a copy outside this machine; a new key means a new extension id.

## E2E

Two Playwright suites in `e2e/`, both headed Chromium on a private Xvfb display with openbox (never `:99`):

| Suite | Specs | Extension build | Config | Default display |
|---|---|---|---|---|
| Area suites | `e2e/tests/**` (one folder per area, about 230 tests) | test build `chrome-mv3-test` (open shadow root, `globalThis.__tb`) | `playwright.config.ts` | `:101` |
| User journeys | `e2e/flows/*.spec.ts`, flows A to O of `docs/jam/flows.md`, P (branding) and Q (zero integration, D-126) | release build `chrome-mv3` | `playwright.flows.config.ts` | `:120` |

### Everything, from a clean database

```sh
scripts/e2e-all.sh                         # down -v, up --build, seed, build, area suites, flows
AREA_DISPLAY=:121 RUNS=3 scripts/e2e-all.sh  # another display; three full runs, each from wiped volumes
KEEP=1 scripts/e2e-all.sh                  # keep the running stack and its data
```

The script does, in order:

1. `docker compose down -v`, then `docker compose --profile dev up --build -d` with the mock OIDC provider configured (`OIDC_ISSUER=http://oidc.localhost:3311/toolbar`, `OIDC_CLIENT_ID=toolbar`, `OIDC_CLIENT_SECRET=dev`), `ALLOWED_EMAIL_DOMAINS=test`, `AUTH_DEV_PASSWORD=1` (for the seeded accounts) and `AUTH_RATE_LIMIT=off`, and waits for `/api/health`. Rate limits are off because the suites sign in many test accounts from one address, and Better Auth allows 3 sign-ins per 10 s per address in production. `MAIL=1` adds the `mail` profile with `FEATURE_EMAIL=1`; `FEATURES="FEATURE_AI=1 ..."` turns on other paused features, whose tests otherwise skip.
2. `pnpm --filter @toolbar/server db:seed` against the compose database (the server's defaults point at it). The seed prints a personal token; the script passes it as `TOOLBAR_E2E_TOKEN`, so `agent/cli-create.spec.ts` runs instead of skipping.
3. Builds the release extension, the test extension and the CLI (`packages/cli/dist/open-toolbar.mjs`).
4. Runs the area suites, then the flows. With `RUNS=n` it repeats steps 1, 2 and 4 n times. Logs go to `e2e/runs/area-N.log` and `e2e/runs/flows-N.log`; HTML reports to `e2e/playwright-report` and `e2e/playwright-report-flows`; flow screenshots to `e2e/flows-shots/`.

It needs the lab (`systemctl --user status toolbar-lab`, on :5173 and :5174), Xvfb, openbox, xdotool, xclip, ImageMagick (`import`) and ffmpeg.

### One suite or one spec

```sh
cd e2e
E2E_DISPLAY=:121 npx playwright test tests/viewer             # an area folder (test build)
E2E_DISPLAY=:120 npx playwright test -c playwright.flows.config.ts d-desktop   # one flow (release build)
FLOWS_PICKER=fake npx playwright test -c playwright.flows.config.ts d-desktop e-recording  # the fallback path
```

`e2e/global-setup.ts` starts Xvfb (and openbox) on `E2E_DISPLAY` when no X server owns it, and stops them at the end. Overrides: `E2E_DISPLAY`, `LAB_URL`, `SERVER_URL`, `OIDC_MOCK_URL`, `MAILPIT_URL`, `E2E_EXT_BUILD` (area suites), `FLOWS_EXT_BUILD` (flows), `DATABASE_URL` (defaults to the compose one), `E2E_CALLBACK_HOST`. The flows write to `test-results-flows/`, so both suites can run side by side on different displays.

The locator suite (`e2e/tests/locator`, D-128) also uses two more builds of the lab, each skipped with a reason when absent: `LAB_DEV_URL` (default `http://localhost:5184`, `cd lab && npx vite dev --port 5184`) for `__svelte_meta`, and `LAB_MAPS_URL` (default `http://localhost:5186`, `cd lab && npx vite build --sourcemap && PORT=5186 node server.js`) for source-mapped stacks. Run that build in a worktree's `lab/`: it writes `lab/build`, and in the main checkout it would replace the build the `toolbar-lab` unit serves on :5173, where the first locator test expects no maps.

Points that keep the runs deterministic:

- Listeners the server must call (webhooks, the GitHub and Slack stand-ins) bind `0.0.0.0`. `e2e/fixtures/net.ts` gives the server `host.docker.internal` when a container publishes the server's port (compose maps it to the host gateway), else `127.0.0.1`; the browser keeps using `127.0.0.1`.
- Chrome's share picker crashes Chromium on Xvfb now and then (`docs/spikes.md` S2). Tests that go through it (flows D and E, the capture suite's J-201) run in a browser of their own on a private Xvfb display (`e2e/fixtures/xvfb.ts`, the suite's display number plus 40). A crash, and only a crash, gets another try in a fresh browser: D and E fall back to Chromium's fake media flags after three crashes and say `LIMITATION` in the log and a `limitation` annotation in the report; J-201 has four tries and no fallback, since a fake picker cannot be cancelled.
- `connectExtension` (flows) adds a project for the lab to the new account's workspace and allows it from the popup, accepting Chrome's permission prompt with Tab and Return through xdotool; flow Q does the same steps by hand and checks that a second origin gets nothing. The area suites' test build holds `<all_urls>`; `e2e/tests/zero-integration` switches it to the release scope with `tb:test-scope` (D-127).
- The flows close the app's pages each flow leaves open. Playwright reports every page as visible, so left-over capture tabs would each hold a comments stream (a real browser drops it for background tabs) and use up Chromium's six connections to the server.

## Where area work goes

| Area | Start here |
|---|---|
| Page capture hooks | `packages/capture/src/hooks/*.ts` (one installer per API), redaction in `packages/capture/src/isolated.ts` |
| Extension flows | `apps/extension/entrypoints/background.ts` (commands, capture modes), `offscreen/main.ts` (MediaRecorder), `capture.content/Toolbar.svelte` (in-page UI), `popup/App.svelte` |
| API | `apps/server/src/routes/api/v1/**`, helpers in `apps/server/src/lib/server/api.ts`, contracts in `packages/shared/src/api/` (route table `routes.ts`) |
| Jobs | register handlers with `registerJob()` in `apps/server/src/lib/server/jobs/worker.ts`, enqueue with `enqueue()` |
| Viewer, dashboard, settings | `apps/server/src/routes/(app)/**`, share page `apps/server/src/routes/s/[token]` |
| Transcription | `apps/server/src/lib/server/transcribe/` (providers in `index.ts`, settings `config.ts`, chunker `chunk.ts`, cues `vtt.ts`, guards `run.ts`, comment voice notes `notes.ts`) |
| Reviewer toolbar (Part 2) | page UI `apps/extension/entrypoints/capture.content/review/`, worker `apps/extension/lib/bg/review.ts`, contracts `packages/shared/src/areas/reviewer.ts`, `api/areas/reviewer.ts`, `ext/areas/reviewer.ts`, server `apps/server/src/lib/server/feedback/`, viewer list `apps/server/src/lib/components/feedback/`; e2e `e2e/tests/reviewer/` and flow R `e2e/flows/r-reviewer-release.spec.ts` (D-134 to D-141) |
| Shared UI | `packages/ui/src/lib/*`, tokens in `packages/ui/src/tokens.ts` (then `pnpm --filter @toolbar/ui gen:tokens`) |
