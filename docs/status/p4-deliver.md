# p4/deliver: deliverables and configuration

Work package "deliver" of Part 2, step 4 (docs/scope.md, "Deliverables" and "Configuration"). Branch `p4/deliver`. Decisions D-151 to D-155 (numbered D-117 to D-121 on the branch; renumbered at the merge, D-156).

## Built

| Deliverable | Where | Notes |
|---|---|---|
| Simple self-hosted stack | `docker-compose.yml` | Server, Postgres, Garage; whisper in the `whisper` profile (`.env.example` turns it on with `COMPOSE_PROFILES=whisper`); mock OIDC in `dev`, Mailpit in `mail`. Postgres, Garage, whisper and Mailpit publish on `127.0.0.1` only. `BETTER_AUTH_SECRET` falls back to `AUTH_SECRET`. `ORIGIN` removed (unused since adapter-node 6). |
| Required values only | `apps/server/src/lib/server/env.ts`, `hooks.server.ts` | A public deployment needs `PUBLIC_URL`, the auth secret, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAINS`. Dev S3 keys are refused only when `S3_PUBLIC_URL` exposes the bucket. The server warns when no sign-in method is set. |
| Coolify stack | `docker-compose.coolify.yml`, `deploy/garage.Dockerfile` | `SERVICE_URL_SERVER_3000`, generated `SERVICE_PASSWORD_64_*` and `SERVICE_HEX_64_*` secrets, `${VAR:?}` for the four values Coolify cannot generate, no host ports, no proxy labels, healthchecks, named volumes. Garage's config is baked into a small image, so nothing is bind-mounted from the repository. Checked against Coolify's docs (coollabsio/coolify-docs, both Docker Compose pages). |
| Configuration reference | `docs/configuration.md` | Every variable (91 rows) with default, example, purpose and when to change it, grouped by area; basic deployment, Google Workspace, Coolify steps. |
| Drift test | `apps/server/test/config-docs.test.ts` | Fails on an undocumented variable in the server or extension code, either compose file or `.env.example`; on a row nothing reads; on an empty cell; on a change of the required set or of the values the Coolify file asks for; on a `ports:` in the Coolify file. |
| `.env.example` | repo root | Required block, two recommended values, every other variable commented with its default. `scripts/gen-secrets.sh` fills `PUBLIC_URL` and random secrets, internal ones included. |
| Extension release | `scripts/release-extension.sh`, `docs/extension-release.md` | `dist/open-toolbar-extension-<v>-chrome.zip` (with key, for unpacked installs), `-chrome-webstore.zip` (key removed), `-firefox.zip`, `SHA256SUMS`. `WXT_MANIFEST_KEY` and `WXT_GECKO_ID` added to `wxt.config.ts`; the Chrome manifest is unchanged by default. |
| Release workflow | `.github/workflows/extension-release.yml` | On tag `v*` or `extension-v*`, matching `apps/extension/package.json`: check, test, build, upload artifact, attach to the GitHub release. Not pushed, not run. |

## Verified

- `docker compose config -q` passes for `docker-compose.yml`. `docker-compose.coolify.yml` passes once the required values are set, and without them fails naming each missing one (the behaviour Coolify relies on).
- Simple stack from empty volumes, project `tbdeliver`, an env file with only the required values plus alternate ports (server 3307, Postgres 15437, Garage 13907, mock OIDC 3387), `PUBLIC_URL=http://feedback.localhost:3307` (a non-localhost URL, so the secret check ran): build, migrations, `/api/health` ok (db, s3). A headless Chromium (Playwright) signed in through "Sign in with SSO" on the mock provider as `ada@acme.test` and landed on the dashboard with a session; `eve@gmail.com` was sent back to `/login?error=FORBIDDEN` with the allowlist message.
- Coolify file run with Coolify's generated variables simulated (`SERVICE_URL_SERVER_3000=https://feedback.example.com` and random `SERVICE_*` secrets), project `tbcoolify`: Garage built from `deploy/garage.Dockerfile`, all three containers healthy with no published ports, `/api/health` ok from inside the server container (S3 with the generated secret).
- `scripts/release-extension.sh` built all three zips for 0.0.1; the store zip has no `key`, the unpacked zip has it. The Firefox MV3 build passes `web-ext lint` with 0 errors and 8 warnings (bundled `Function` and `innerHTML`). The default Chrome manifest is byte-for-byte the same JSON as main's.
- The workflow passes `actionlint`.
- `pnpm -r --workspace-concurrency=2 build`, `test` (server tests against database `toolbar_p4_deliver`, S3 prefix `p4-deliver/`) and `check` pass.
- Both test stacks were taken down with their volumes and images.

## Not done or not verified

- No real Coolify instance was used: the Coolify file follows the docs and was run with simulated magic variables. Two points need a real deploy to confirm: whether Coolify writes `SERVICE_URL_SERVER_3000` with a trailing `/` (the server strips one) and how it treats the `build:` of the Garage service.
- The Chrome Web Store upload and the unlisted item were not created (needs the owner's developer account). Whether the store refuses a manifest `key` on a new item is not confirmed from Google's docs; the store zip leaves it out to be safe.
- The Firefox build installs and lints but does not work for reviewers: sign-in needs the server to accept Firefox's `extensions.allizom.org` redirect, recording needs Chrome-only APIs, the editor page is Chrome-only, and AMO signing needs an account (docs/extension-release.md, "Firefox").
- The e2e area suites and flows were not rerun here: the Chrome manifest is unchanged and the server's sign-in behaviour is covered by the unit tests, but `scripts/e2e-all.sh` now starts the `whisper` profile, which only a full run exercises.
- Other packages (p4/transcribe, p4/handoff) add variables (`TRANSCRIBE_*`, `OPENAI_API_KEY`, `SHARE_LINK_DAYS`, `OCR_*`); when they merge, the drift test will ask for their rows in the new table format.
