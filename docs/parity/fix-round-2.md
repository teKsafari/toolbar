# Parity fix round 2 (2026-10-15)

Round 2 closes the P0 and P1 gaps that the reviewer's rerun of round 1 found (J-086, J-112, J-148, J-152, J-153, J-171, J-172, J-181, J-200, J-217, plus rig hygiene). Paused rows (docs/scope.md) were not touched and no paused check ran.

## Rerun setup

- Replica code on `main` from `0ad4a43` to `84f856d`. Release build of the extension copied to `apps/extension/.output/chrome-mv3-r2` (its `BUILD_COMMIT` file names the commit).
- Rig: `PARITY_DISPLAY=:131 PARITY_EXT_BUILD=chrome-mv3-r2`, Xvfb and openbox on `:131`, Playwright 1.63.0 Chromium. Display `:99` and the shared browser were not used.
- Rig server: the compose image rebuilt from this round's code, with the dev mock OIDC provider and the dev-only password sign-in that the parity accounts use:

  ```sh
  AUTH_DEV_PASSWORD=1 OIDC_1_ID=company OIDC_1_NAME="Company SSO" OIDC_1_CLIENT_ID=toolbar OIDC_1_CLIENT_SECRET=dev \
  OIDC_1_DISCOVERY_URL=http://oidc.localhost:3311/company/.well-known/openid-configuration \
  AUTH_ALLOWED_DOMAINS=example.com docker compose --profile dev up -d oidc-mock server
  ```

- Default-deployment servers for J-217, the same image on compose defaults (no `AUTH_DEV_PASSWORD`, no `FEATURE_*`), worker and migrations off, sharing the database:

  ```sh
  docker compose run -d --no-deps --name toolbar-default-bare -p 3010:3000 \
    -e PUBLIC_URL=http://localhost:3010 -e ORIGIN=http://localhost:3010 -e WORKER=0 -e MIGRATE_ON_START=0 server
  docker compose run -d --no-deps --name toolbar-default-oidc -p 3011:3000 \
    -e PUBLIC_URL=http://localhost:3011 -e ORIGIN=http://localhost:3011 -e WORKER=0 -e MIGRATE_ON_START=0 \
    -e OIDC_1_ID=company -e "OIDC_1_NAME=Company SSO" -e OIDC_1_CLIENT_ID=toolbar -e OIDC_1_CLIENT_SECRET=dev \
    -e OIDC_1_DISCOVERY_URL=http://oidc.localhost:3311/company/.well-known/openid-configuration \
    -e AUTH_ALLOWED_DOMAINS=example.com server
  ```

  G7 reads them through `PARITY_DEFAULT_SERVERS=http://localhost:3010,http://localhost:3011`.
- Logs: `e2e/runs/parity-r2-*.log`; shots: `e2e/parity-shots/G<n>/` (both git-ignored). The shots from before this round are kept in `e2e/runs/parity-shots-before-r2/`. Every timing carries the 1-minute load average; none was above 3.3.

## Rows

| Row | What changed | New evidence |
|---|---|---|
| J-200 | With the mic off, the offscreen recorder reads the extension's microphone permission; never granted or blocked gives the `denied` state: struck-through mic, aria-disabled, "Microphone permission is missing" on hover (D-100). | S1.2 step 2: `{state: denied, tip: Microphone permission is missing, ariaDisabled: true}` (load 1.9) |
| J-217 | Email and password sign-in is off unless `AUTH_DEV_PASSWORD=1` (compose and env defaults off); `.env.example` and `docs/dev.md` say so; `scripts/e2e-all.sh` turns it on for the suites. Default server with OIDC: one Company SSO button, no email field, sign-in lands on the dashboard in 0.7 s (load 1.78), password API 400. Default server without OIDC: "No sign-in method is configured", naming `OIDC_1_*`. | S7.1 step 7 and step 7 default-deployment |
| J-153 | HEAD with `Accept: text/markdown` answers `text/markdown` with GET's headers. The More detail section names the MCP server and the HTTP API routes (`/api/v1/recordings/<id>/console`, network, actions, frames); the CLI line appears only with `FEATURE_CLI` on. | S8.1 step 7: `mentionsCli: false`, `headRequestWithAcceptMd: text/markdown`; `docs/parity/evidence/G8/N1-share-head-accept-md.txt` |
| J-152 | The Agent tab's CLI hint shows only when the brief names a CLI (`FEATURE_CLI` on). | S8.1 step 6 tab text |
| J-112 | Send to app is hidden unless `FEATURE_TRACKERS` or `FEATURE_SLACK` is on; its connect items follow the same flags; the viewer data leaves out integrations of paused types. | S4.1 step 19: `sendSplit: not shown` (load 0.89) |
| J-171 | Settings nav lists Audit log (`FEATURE_ADMIN_EXTRAS`), Integrations (`FEATURE_TRACKERS` or `FEATURE_SLACK`), CLI (`FEATURE_CLI`) and Notifications (`FEATURE_EMAIL`) only with their flags; the pages answer 404 otherwise. Nav now: General, Members, Privacy and data; SDK, MCP, Webhooks, API; Profile, API tokens, Connected browsers. | S7.1 step 1 (load 0.76) |
| J-172 | General settings drop the data section (AI switch, auto-delete, audit link) while `FEATURE_AI` and `FEATURE_ADMIN_EXTRAS` are off; privacy drops its retention select; the hourly auto-delete job deletes nothing while retention is paused. | S7.1 step 2: sections Workspace and Access |
| J-148 | The dialog's rows are MCP and HTTP API, both read only by default (Jam: CLI and MCP, both read only). The API row keeps the `cli:*` scope values, which gate REST; labels read "HTTP API, read only". A default token reads over MCP (200) and REST (200), and writes are refused (MCP tool error, REST 403) (D-099). | S8.1 step 9 |
| J-086, J-197 | A progress toast with a spinner shows over the editor at Ctrl+Enter and turns into the done toast in place (D-101). Median of 3 (load 0.6 to 1.4): progress toast 0.36 s, link 0.58 s, tab 0.61 s, done toast 0.64 s. Jam: spinner 0.4 s, link 2.8 s. The toast time is polled through the DevTools protocol, so it carries about 0.1 s of slack. | S2.1 step 21: `e2e/runs/parity-r2-G2-s21-{1,2,3}.log`, `S2.1-21-first-toast-nib-1440-light.png` |
| J-181 | Cell updated from the rerun: chord to live 3.8 s (load 1.02), 3.5 s (1.63), 3.7 s (0.7), median 3.7 s against Jam 4.1 s; stop chord to editor 0.6 s (1.06, 0.83). | S3.1 steps 3 and 19, S3.2 |
| J-001 (rig hygiene) | G1 now turns instant replay off on the server and in the extension before S1.1, so the popup shows the three rows of a new account: 400x223. | S1.1 step 2 (load 2.27) |

## Rig hygiene

- G1 resets instant replay (server and extension) after sign-in, and S1.5 deletes earlier "parity link" rows before it makes three new ones.
- G7 S7.1 deletes the `sso-*` accounts that earlier step 7 runs signed in (4 removed in this run), and solo workspaces they own.
- The default-deployment check runs against its own servers, so the rig server can keep `AUTH_DEV_PASSWORD=1` for the parity accounts without hiding what a default deployment ships.
- The G8 spec still writes `docs/parity/evidence/G8/*.md`; this round's run is the committed copy.

## Left for later

- Area e2e tests that cover paused features (integrations, CLI, audit log, notification mail) need their flag on the server. `scripts/e2e-all.sh` does not set them, and the area suites were not run this round; those tests should skip by flag.
- The editor's AI switch beside Create and the viewer's chapter pill (FEATURE_AI) were outside this round's rows and still show (S2.1 shots, S4.1 step 3 controls).
- J-189 still rests on G7 S7.4 from round 1; with instant replay now reset at G1's start, the next full run gives it clean numbers.
