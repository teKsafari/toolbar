# Developing open-toolbar

The product is open-toolbar (D-083); the repo and package scope are `toolbar`.

## Layout

| Path | Package | What it is |
|---|---|---|
| `apps/server` | `@toolbar/server` | SvelteKit 3 app (adapter-node): dashboard, share pages, `/api/v1`, Better Auth, job worker |
| `apps/extension` | `@toolbar/extension` | WXT + Svelte 5 MV3 extension |
| `packages/shared` | `@toolbar/shared` | Event envelope and kinds, zod schemas, constants, ids; `/api` endpoint contracts and route table; `/ext` extension messaging, session state machine, storage keys |
| `packages/capture` | `@toolbar/capture` | Page-side capture: `Transport`, MAIN/ISOLATED bridge, hook installers |
| `packages/ui` | `@toolbar/ui` | Design tokens (`tokens.ts`, generated `tokens.css`, and `tokens.shadow.css` with `:host`-only `!important` values for the extension's in-page shadow roots), the accent derivation (`accent.ts`), bundled fonts (`fonts/`, `fonts.css`, `fonts.ts`; SIL OFL 1.1), icons, Svelte primitives (Button, Icon, Popover, Segmented, Switch, Toaster) |
| `packages/review` | `@toolbar/review` | The Part 2 reviewer toolbar (pill, composer, pins, drawing, highlight, notes list) behind a `ReviewPlatform` adapter; the extension and the embed each supply one (D-212) |
| `packages/embed` | `@open-toolbar/embed` | The embed (D-211): the reviewer toolbar on a site through a script tag (`dist/embed.js`) or an npm package (`dist/index.js`, `dist/react.js`, `dist/open-toolbar-embed.tgz`), with the project's public key |
| `packages/trace` | `@toolbar/trace` | Part 2 traces: the span engine (outcomes, `causedBy`), keyframe planner and dHash, SvelteKit and Next.js request names; runs in the extension worker and on the server (D-117 to D-122) |
| `e2e` | `@toolbar/e2e` | Playwright 1.63.0 suite that loads the unpacked extension |
| `lab` | (own project) | The capture test target; not in the workspace, own lockfile |

Internal packages ship TypeScript source (`exports` point at `src/*.ts`); Vite and WXT compile them. Their `build` script is a type check.

## Requirements

- Node 24, pnpm 11.27 (`corepack enable`; on a read-only Node such as NixOS, `npm i -g pnpm@11.27.0`), Docker with compose.
- e2e: Xvfb, openbox for the screen picker (`nix profile add nixpkgs#xorg.xvfb nixpkgs#openbox`).
- OCR outside Docker: tesseract with English data; without it the folder has no `text/`.

## Ports

| Port | Service |
|---|---|
| 3000 | Server (compose `server`, or `pnpm dev:server`; not both) |
| 3001 | WXT dev server (extension HMR) |
| 3100 to 3107, 3200 to 3207 | Area worktree servers and WXT dev servers (`docs/parallel.md`) |
| 5432 | Postgres 18 |
| 3900 | Garage S3 API |
| 8080 | whisper.cpp server (`docker-compose.whisper.yml`) |
| 3311 | Mock OIDC provider (`docker-compose.dev.yml`), as `http://oidc.localhost:3311` |
| 8025 | Mailpit inbox UI (override `docker-compose.mail.yml`, only for the paused mail) |
| 1025 | Mailpit SMTP (`docker-compose.mail.yml`) |
| 5173, 5174 | Lab app (user service `toolbar-lab`), second origin |
| `:101`, `:120` | Xvfb displays for the area suites and the flows (`E2E_DISPLAY`); `:99` is the shared browser, never use it |
| 9341, 9351 | CDP ports of the flows' browsers (the popup is reached over CDP) |

## Full stack in Docker

`docker-compose.yml` holds the server, Postgres and Garage. Three files add to it with `-f` (D-194):

| File | Adds |
|---|---|
| `docker-compose.dev.yml` | The mock OIDC provider and the switches tests set from the shell (`AUTH_DEV_PASSWORD`, `AUTH_RATE_LIMIT`, `ALLOWED_EMAIL_DOMAINS`, `TRANSCRIBE_PROVIDER`, the paused feature flags). Development and e2e only. |
| `docker-compose.whisper.yml` | Local transcription: the whisper.cpp container, and `WHISPER_URL` on the server. |
| `docker-compose.mail.yml` | The paused mail, with Mailpit. |

The development stack, with the mock provider:

```sh
env -u OPENAI_API_KEY \
  OIDC_ISSUER=http://oidc.localhost:3311/toolbar OIDC_CLIENT_ID=toolbar OIDC_CLIENT_SECRET=dev OIDC_PROVIDER_NAME="Dev SSO" \
  ALLOWED_EMAIL_DOMAINS=test AUTH_DEV_PASSWORD=1 AUTH_RATE_LIMIT=off \
  docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
curl -s localhost:3000/api/health  # {"ok":true,"checks":{"db":{"ok":true},"s3":{"ok":true},...}}
```

- Whisper: add `-f docker-compose.whisper.yml` and `TRANSCRIBE_PROVIDER=local`. Use the same `-f` list for every later command on the stack (`ps`, `logs`, `down`).
- Dev SSO: the mock at `http://oidc.localhost:3311` signs any user name (the subject) with any claims, for example `{"email": "you@example.test", "email_verified": true, "name": "You"}`. `*.localhost` resolves to this machine for the browser and, through `host-gateway`, for the server container (D-094). Never deploy it.
- `ALLOWED_EMAIL_DOMAINS=test` admits `*.test` and locks that field. On localhost without `ADMIN_EMAILS`, the first account is the instance admin.
- `AUTH_DEV_PASSWORD=1`: any email with an 8+ character password; seeded accounts `dana@toolbar.test`, `sam@toolbar.test`, password `toolbar-dev-password`.
- Paused features (docs/scope.md): `FEATURE_EMAIL`, `FEATURE_TRACKERS`, `FEATURE_SLACK`, `FEATURE_CLI`, `FEATURE_AI`, `FEATURE_ADMIN_EXTRAS`. `/api/health` lists the ones on; their e2e tests skip with "paused (docs/scope.md)" (`e2e/fixtures/features.ts`). Mail: `-f docker-compose.mail.yml` (D-171).
- Compose runs with no `.env`; every variable has a dev default. Postgres, Garage, whisper and Mailpit bind `127.0.0.1`; the mock OIDC provider binds all interfaces for the host gateway. Off localhost, `scripts/gen-secrets.sh https://your.host` writes `.env` with random secrets.
- `AUTH_RATE_LIMIT=off` disables the 3-per-10-s sign-in limit for e2e.
- `OPENAI_API_KEY` reaches the server only from `.env` (`env_file`). Keep `env -u OPENAI_API_KEY` in front of `docker compose`, and never save `docker compose config` output where others can read it: it prints `.env` values (D-193).
- Coolify variant: `docker-compose.coolify.yml` (`docs/configuration.md`, "Coolify"), whisper via `COMPOSE_PROFILES=whisper`.

Wipe the database, bucket and whisper model: `docker compose -f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.whisper.yml down -v`.

## Dev mode

```sh
pnpm install
pnpm stack                      # docker compose -f docker-compose.yml -f docker-compose.whisper.yml -f docker-compose.dev.yml up -d postgres garage whisper oidc-mock
docker compose stop server      # only if the compose server holds port 3000
pnpm dev                        # server on :3000 (vite dev) and the extension watch build, in parallel
pnpm dev:server                 # or one at a time
pnpm dev:extension
```

The server reads the repo root `.env`, else the compose defaults (`postgres://toolbar:toolbar@localhost:5432/toolbar`, Garage on `localhost:3900`). Migrations and the job worker run in-process (`MIGRATE_ON_START=1`, `WORKER=1`). Schema: `apps/server/src/lib/server/db/schema/<area>.ts`, re-exported by `schema/index.ts`.

```sh
pnpm --filter @toolbar/server db:migrate      # apply drizzle/ to DATABASE_URL
pnpm --filter @toolbar/server db:push         # area worktrees: push schema changes to your own database
pnpm --filter @toolbar/server db:generate     # main branch only (merge step): writes drizzle/NNNN_*.sql
pnpm --filter @toolbar/server db:seed         # two users, a workspace, three captures with media
```

Area worktrees: `scripts/area-setup.sh <area> --seed` (`docs/parallel.md`). Production-style server without Docker: `pnpm --filter @toolbar/server build && cd apps/server && node server.js`, never `node build` (D-023).

## Build, test, check

```sh
pnpm -r build      # every package: type checks, the server build, the release extension build
pnpm -r test       # unit tests (vitest); the server's DB tests run when Postgres on :5432 answers, its mail tests when Mailpit does (`docker-compose.mail.yml`), else skip
pnpm -r check      # svelte-check / tsc
pnpm e2e           # test build of the extension, then the area suites (needs compose server + lab)
scripts/e2e-all.sh # every e2e suite on a fresh, seeded compose stack (see E2E below)
```

Transcription tests use recorded API answers; the chunker and integration tests need ffmpeg and the FLEURS clips in `apps/server/fixtures/transcribe/` (CC BY 4.0). The live test calls `gpt-transcribe` (about $0.002 a run):

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

Release zips: `scripts/release-extension.sh` (`docs/extension-release.md`). Branded builds: `WXT_APP_NAME=... WXT_APP_ICON=<svg or png>` (`docs/branding.md`). `node apps/extension/scripts/icons.ts` re-renders the packaged icons from `apps/extension/assets/icon.svg`.

Every build has the id `laobpjhffglefallhhojihfdbdkoendk` (the manifest `key` is the store item's public key, D-196). Load an output folder unpacked in `chrome://extensions`, or start a private Chromium on its own display (never `:99`; `--no-first-run` skips a blocking terms dialog):

```sh
Xvfb :101 -screen 0 1440x900x24 & DISPLAY=:101 openbox &
DISPLAY=:101 ~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome --user-data-dir=/tmp/tb-profile --no-first-run \
  --disable-extensions-except=$PWD/apps/extension/.output/chrome-mv3-dev \
  --load-extension=$PWD/apps/extension/.output/chrome-mv3-dev http://localhost:5173
```

WXT's browser runner is off (`webExt.disabled`).

Site access (D-123, D-126, D-200, D-202, D-203, D-205): release builds hold the server and `<all_urls>` as required host permissions. `SITE_ACCESS` decides where the capture scripts run: `projects` (default: only project origins; the worker keeps no webRequest metadata for other tabs; the popup's add row puts a site in a project and injects the scripts, `lib/bg/sites.ts`) or `all` (everywhere but the server and blocked sites; the first capture on an origin makes its project). The pill's X stores the origin in `tb:toolbar-closed` until the popup opens there. Test builds hold `<all_urls>` and ignore the mode unless storage key `tb:test-scope` is `release` or `projects`.

The worker registers `content-scripts/capture-main.js` (MAIN) and `content-scripts/capture.js` (ISOLATED) at `document_start` for the allowed origins. The MAIN script installs the `@toolbar/capture` hooks and relays events over a private `MessageChannel`; the isolated script forwards them to the worker on the `capture` port and, in the top frame, mounts `<toolbar-root>` in a shadow root.

## The embed

```sh
pnpm --filter @open-toolbar/embed build   # dist/embed.js (IIFE, one file), the fonts, dist/index.js and dist/react.js, dist/open-toolbar-embed.tgz
pnpm --filter @open-toolbar/embed test    # session, client routes, boot, the page platform's send order, reviewer id
```

`embed.js` runs the `@toolbar/capture` hooks and recorder in the page's realm with `PageSession` as the Transport, fetches `GET /api/v1/embed/:key/config` and mounts the shared reviewer toolbar (`@toolbar/review`) in an open shadow root. Svelte compiles with `css: 'injected'` and its `append_styles` is swapped for constructed style sheets (`src/svelte-client.ts`), so a CSP without `'unsafe-inline'` styles still renders it; the shared contracts' `zod` import gets a stand-in (`src/zod-stub.ts`), since the page never validates. The server serves `dist/` at `/embed.js` and `/embed/<file>`.

## E2E

Three Playwright suites in `e2e/`. The area suites and the flows run headed Chromium on a private Xvfb display with openbox (never `:99`); the embed suite runs headless:

| Suite | Specs | Extension build | Config | Default display |
|---|---|---|---|---|
| Area suites | `e2e/tests/**` (one folder per area, about 230 tests) | test build `chrome-mv3-test` (open shadow root, `globalThis.__tb`) | `playwright.config.ts` | `:101` |
| User journeys | `e2e/flows/*.spec.ts`, flows A to O of `docs/jam/flows.md`, P (branding), Q (zero integration in the project sites mode, D-126, D-202), S (site access: add a site from the icon, the toolbar without a reload, close and reopen, a second origin stays clean; S2 the all sites mode with merge; D-202, D-203, D-205), R (reviewer keys, the title row and the toast's Open in the release build, D-206) and P2 (the owner's Part 2 scenario, D-163) | release build `chrome-mv3` | `playwright.flows.config.ts` | `:120` |
| Embed (D-211, D-212) | `e2e/embed/*.spec.ts`: on a project origin a comment, an element screenshot, a text highlight and a voice note sent as one embed capture (author, assets, workspace access), a trace, the second origin's 403, rotated and turned-off keys, close and `?open-toolbar`, a strict CSP, the Embed panel of Settings, Projects | none (plain Chromium, fake microphone) | `playwright.embed.config.ts` | headless |

### Everything, from a clean database

```sh
scripts/e2e-all.sh                         # down -v, up --build, seed, build, area suites, flows
AREA_DISPLAY=:121 RUNS=3 scripts/e2e-all.sh  # another display; three full runs, each from wiped volumes
KEEP=1 scripts/e2e-all.sh                  # keep the running stack and its data
```

Steps: `down -v`; `up --build` with the dev and whisper files, the mock OIDC provider, `ALLOWED_EMAIL_DOMAINS=test`, `AUTH_DEV_PASSWORD=1`, `AUTH_RATE_LIMIT=off`, `TRANSCRIBE_PROVIDER=local`; `db:seed` (its token becomes `TOOLBAR_E2E_TOKEN`); build the release and test extensions and the CLI; area suites, then flows, then the embed suite. `MAIL=1` adds `docker-compose.mail.yml`; `FEATURES="FEATURE_AI=1 ..."` turns on paused features. Logs: `e2e/runs/area-N.log`, `e2e/runs/flows-N.log`, `e2e/runs/embed-N.log`; reports: `e2e/playwright-report`, `e2e/playwright-report-flows`; flow screenshots: `e2e/flows-shots/`.

Needs the lab (`toolbar-lab` user service, :5173 and :5174), Xvfb, openbox, xdotool, xclip, ImageMagick and ffmpeg.

### One suite or one spec

```sh
cd e2e
E2E_DISPLAY=:121 npx playwright test tests/viewer             # an area folder (test build)
E2E_DISPLAY=:120 npx playwright test -c playwright.flows.config.ts d-desktop   # one flow (release build)
FLOWS_PICKER=fake npx playwright test -c playwright.flows.config.ts d-desktop e-recording  # the fallback path
```

The embed suite (`cd e2e && npx playwright test -c playwright.embed.config.ts`, or `pnpm --filter @toolbar/e2e embed`) needs no display. It signs in a new site owner through the mock OIDC provider, gives the lab's origin a project with an embed key, and opens the lab's opt-in embed pages (`lab/server.js`): `?tb-embed=<key>` on any HTML page of :5173 or :5174 puts `<script src="http://localhost:3000/embed.js" data-key="<key>">` first in `<head>` (`&tb-name=` adds `data-name`), and `/__embed/csp?tb-embed=<key>` is a plain page behind a strict CSP. Without the parameter the lab answers as before. `EMBED_SERVER` on the `toolbar-lab` unit points the tag at another server. The voice note test needs the whisper file and `TRANSCRIBE_PROVIDER=local`.

`e2e/global-setup.ts` starts Xvfb (and openbox) on `E2E_DISPLAY` when no X server owns it, and stops them at the end. Overrides: `E2E_DISPLAY`, `E2E_VIEWPORT` (area suites: `390x844` gives each new page that viewport, to run a suite at phone width; tests that set their own size keep it), `LAB_URL`, `SERVER_URL`, `OIDC_MOCK_URL`, `MAILPIT_URL`, `E2E_EXT_BUILD` (area suites), `FLOWS_EXT_BUILD` (flows), `DATABASE_URL` (defaults to the compose one), `E2E_CALLBACK_HOST`. The flows write to `test-results-flows/`, so both suites can run side by side on different displays.

The Part 2 scenario (`e2e/flows/p2-scenario.spec.ts`, D-163) runs in a browser of its own on a private display (E2E_DISPLAY plus 59, :179 by default) with a fake microphone that plays a FLEURS clip; it needs ffmpeg and `docker-compose.whisper.yml` with `TRANSCRIBE_PROVIDER=local`. `P2_CLAUDE=1` adds a real Claude Code run that reads the folder over MCP and resolves it (it calls a model); `FLOWS_EXT_BUILD=release-zip` runs it on the unpacked release zip (unzip `dist/open-toolbar-extension-<v>-chrome.zip` into `apps/extension/.output/release-zip`).

The locator suite (`e2e/tests/locator`, D-128) also uses two more builds of the lab, each skipped with a reason when absent: `LAB_DEV_URL` (default `http://localhost:5184`, `cd lab && npx vite dev --port 5184`) for `__svelte_meta`, and `LAB_MAPS_URL` (default `http://localhost:5186`, `cd lab && npx vite build --sourcemap && PORT=5186 node server.js`) for source-mapped stacks. Run that build in a worktree's `lab/`: it writes `lab/build`, and in the main checkout it would replace the build the `toolbar-lab` unit serves on :5173, where the first locator test expects no maps.

Points that keep the runs deterministic:

- Listeners the server must call (webhooks, the GitHub and Slack stand-ins) bind `0.0.0.0`. `e2e/fixtures/net.ts` gives the server `host.docker.internal` when a container publishes the server's port (compose maps it to the host gateway), else `127.0.0.1`; the browser keeps using `127.0.0.1`.
- Chrome's share picker crashes Chromium on Xvfb now and then (`docs/spikes.md` S2). Tests that go through it (flows D and E, the capture suite's J-201) run in a browser of their own on a private Xvfb display (`e2e/fixtures/xvfb.ts`, the suite's display number plus 40). A crash, and only a crash, gets another try in a fresh browser: D and E fall back to Chromium's fake media flags after three crashes and say `LIMITATION` in the log and a `limitation` annotation in the report; J-201 has four tries and no fallback, since a fake picker cannot be cancelled.
- `connectExtension` (flows) adds a project for the lab to the new account's workspace and waits until the popup allows it. Release builds hold every site from install (D-202), so no prompt shows; if one does (site access turned off), it clicks Allow and accepts Chrome's prompt with Tab and Return through xdotool. Flows Q and S switch the site access mode through the admin API (the account's own session when it is the instance admin, else the seeded dana@toolbar.test with `AUTH_DEV_PASSWORD=1`), skip with a reason when they cannot, and reset it at the end; Q does the strict mode's steps by hand and checks that a second origin gets nothing and that the registered scripts match the project origin only. The area suites' test build holds `<all_urls>`; `e2e/tests/zero-integration` switches it to the release scope with `tb:test-scope` (D-127).
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
| Reviewer toolbar (Part 2) | page UI `packages/review/src/` (platforms: `apps/extension/lib/review-platform.ts`, `packages/embed/src/platform.ts`), worker `apps/extension/lib/bg/review.ts`, contracts `packages/shared/src/areas/reviewer.ts`, `api/areas/reviewer.ts`, `ext/areas/reviewer.ts`, server `apps/server/src/lib/server/feedback/`, viewer list `apps/server/src/lib/components/feedback/`; e2e `e2e/tests/reviewer/` and flow R `e2e/flows/r-reviewer-release.spec.ts` (D-134 to D-141) |
| Agent hand-off (feedback folder, share markdown, skill, resolve) | `apps/server/src/lib/server/handoff/*`, text and README in `packages/shared/src/areas/handoff.ts`, skill `skills/open-toolbar-feedback/SKILL.md` (regenerate with `node scripts/gen-skill.ts`), e2e `e2e/tests/handoff` (`handoff.spec.ts` needs `TOOLBAR_E2E_TOKEN`) |
| Bulk export (INDEX.md, `/api/v1/feedback/*`, `list_feedback`, `get_feedback_index`) | digests and INDEX.md in `packages/shared/src/areas/feedback-index.ts`, page selection, digests and the streamed archive in `apps/server/src/lib/server/handoff/export.ts`, MCP tools in `mcp/handoff-tools.ts`; e2e `e2e/tests/handoff/export.spec.ts` (signs in through the mock OIDC provider, seeds six captures) |
| Card images (thumbnails) | server chain and the placeholder card in `apps/server/src/lib/server/jobs/handlers.ts` (`makeThumbnail`, `backfill-thumbs`) and `media/placeholder.ts`; the extension's masked stills in `apps/extension/lib/capture/card-still.ts`; e2e `e2e/tests/handoff/thumbs.spec.ts` (real server, test build) |
| Shared UI | `packages/ui/src/lib/*`, tokens in `packages/ui/src/tokens.ts` (then `pnpm --filter @toolbar/ui gen:tokens`) |
