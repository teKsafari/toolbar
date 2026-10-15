# Configuration

open-toolbar reads its settings from environment variables. With Docker Compose you put them in `.env` next to `docker-compose.yml`; on Coolify you set them under Environment Variables. This page lists every variable the server, the compose files and the extension build read, grouped by area. A test (`apps/server/test/config-docs.test.ts`) compares this page with the code, both compose files and `.env.example`, and fails when a variable is missing here or listed here without a reader.

## The basic deployment

Five values make a working server. Everything else has a default that works.

| What | Variables |
|---|---|
| Where people reach the server | `PUBLIC_URL` |
| The secret that signs sessions | `BETTER_AUTH_SECRET` (or `AUTH_SECRET`) |
| Your sign-in provider | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` |
| Who may sign in | `ALLOWED_EMAIL_DOMAINS` |

```sh
cp .env.example .env                                 # or: scripts/gen-secrets.sh https://feedback.example.com
$EDITOR .env                                         # the required block at the top
docker compose up -d --build
curl -s https://feedback.example.com/api/health      # {"ok":true,...}
```

Put a TLS proxy (Caddy, Traefik, nginx) in front of the server's port and point `PUBLIC_URL` at the https address. The server refuses to start on a non-localhost `PUBLIC_URL` while the auth secret is the dev default. On Coolify, use `docker-compose.coolify.yml` instead ([Coolify](#coolify)).

Postgres, Garage and whisper keep working with their built-in credentials, because the compose file publishes their ports on `127.0.0.1` only and other machines cannot reach them. `scripts/gen-secrets.sh` still replaces those credentials with random ones, so use it on a fresh install.

## How to read the tables

Each row gives the variable, its default, an example, and what it does with when you would change it. "Empty" means unset or set to an empty string; both mean the default. Flags take `1`, `true`, `yes` or `on` for on, anything else for off.

## Server

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `PUBLIC_URL` | `http://localhost:3000` | `https://feedback.example.com` | **Required.** The origin people and the extension use. Links, the OAuth redirect URI (`<PUBLIC_URL>/api/auth/callback/<OIDC_PROVIDER_ID>`), cookies and the CSRF origin come from it. Set it to the https address of your proxy; a path is not supported. |
| `BETTER_AUTH_SECRET` | a dev secret | output of `openssl rand -hex 32` | **Required.** Signs sessions and derives the key that encrypts share and recording-link tokens in the database. Use 32 or more random characters. Changing it signs everyone out and makes stored share links unreadable, so set it once. |
| `AUTH_SECRET` | empty | as above | A shorter name for `BETTER_AUTH_SECRET`, read when that one is empty. |
| `PORT` | `3000` | `8080` | Compose only: the host port the server container publishes. The server inside the container always listens on 3000. Change it when 3000 is taken on the host. |
| `EXTENSION_IDS` | `fmongfmimgdafigcahdpofnmmhljpnei` | `fmongfmimgdafigcahdpofnmmhljpnei,abcdefghijklmnopabcdefghijklmnop` | Comma separated ids of the browser extensions allowed to sign in through `/ext/connect` and to call the API from their pages. The default is the id the repository's manifest key pins. Add the Chrome Web Store item's id when you publish your own ([docs/extension-release.md](extension-release.md)). |
| `BODY_SIZE_LIMIT` | `210M` | `500M` | Largest request body the Node server accepts. Routes cap upload chunks at 8 MiB and attachments at 200 MiB on their own; raise this only together with those limits. |
| `WORKER` | `1` | `0` | Runs the background job worker (transcripts, thumbnails, webhooks) inside the server process. Set `0` on extra server replicas so one process runs jobs. |
| `MIGRATE_ON_START` | `1` | `0` | Applies database migrations at start. Set `0` when you run `pnpm --filter @toolbar/server db:migrate` yourself before a deploy. |
| `MIGRATIONS_DIR` | `./drizzle` next to the server | `/app/drizzle` | Where the migration files live. Only for a custom image layout. |
| `MAX_RECORDING_MIN` | empty (no cap) | `15` | Longest recording in minutes; the extension's timer stops there. Set it to keep recordings short on a small server. |
| `SUPPORT_RECORDING_LINK` | empty | `https://feedback.example.com/r/abc`, or `off` | Where the extension menu's "report a problem" goes. Empty: a "Problem reports" recording link owned by the server's first account, made on first use. `off` hides it. |
| `NODE_ENV` | `production` in the image, `development` in `pnpm dev` | `production` | Turns on production behaviour: sign-in rate limits, no response-shape checks in the share routes. Leave it to the image. |

## Sign-in

open-toolbar signs people in through one OpenID Connect provider that you register it with (docs/scope.md, D-080, D-114). The server is the OIDC client: browsers and the extension never hold the client secret. The extension signs in through the server (`chrome.identity.launchWebAuthFlow` on `/ext/connect`), so it needs no settings of its own.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `OIDC_ISSUER` | empty | `https://accounts.google.com` | **Required.** The provider's issuer URL. The server fetches `<issuer>/.well-known/openid-configuration`. Stored on every capture and comment as the author's issuer. |
| `OIDC_DISCOVERY_URL` | `<OIDC_ISSUER>/.well-known/openid-configuration` | `https://id.example.com/custom/openid-configuration` | The discovery document, when it lives somewhere else. Wins over `OIDC_ISSUER` for discovery; the issuer is derived from it when `OIDC_ISSUER` is empty. |
| `OIDC_CLIENT_ID` | empty | `1234567890-abc.apps.googleusercontent.com` | **Required.** The client id from the provider. Without it the provider is off and nobody can sign in. |
| `OIDC_CLIENT_SECRET` | empty | `GOCSPX-...` | **Required.** The client secret. The server also sends PKCE. |
| `OIDC_SCOPES` | `openid email profile` | `openid email profile groups` | Space or comma separated. Keep `email`: the allowlist reads the address. |
| `OIDC_PROVIDER_NAME` | `Google` for `accounts.google.com`, else `SSO` | `Acme SSO` | The login button reads "Sign in with <name>". Set it to the name your people know. |
| `OIDC_PROVIDER_ID` | `oidc` | `keycloak` | The id in the callback path. Changing it after people signed in leaves their accounts unlinked, so pick it once. |
| `ALLOWED_EMAIL_DOMAINS` | empty (any address) | `acme.com,acme.co.uk` | **Required for a private server.** Comma separated domains that may sign in and submit feedback; subdomains count (`acme.com` admits `eu.acme.com`). Google's `hd` claim must match too when the token carries it. |
| `AUTH_RATE_LIMIT` | on in production | `off` | Better Auth's per-address limits (3 sign-ins per 10 s). Set `off` only for an e2e run, whose test accounts all sign in from one address. |
| `AUTH_DEV_PASSWORD` | off | `1` | Adds email and password sign-in. For development and tests only (docs/scope.md). |
| `AUTH_MAGIC_LINK` | on with `FEATURE_EMAIL` | `0` | The emailed sign-in link exists only while mail is on; `0` keeps it off then. |

The redirect URI to register with the provider is `<PUBLIC_URL>/api/auth/callback/<OIDC_PROVIDER_ID>`, so `https://feedback.example.com/api/auth/callback/oidc` by default.

### Who gets in

With `ALLOWED_EMAIL_DOMAINS` set, the server checks the provider's claims at every sign-in:

- the address must be verified (`email_verified` must not be false);
- its domain must be on the list;
- Google's `hd` claim (the Workspace domain), when the ID token carries it, must be on the list too. A personal Gmail account carries no `hd` and fails the domain check.

Someone who fails a check returns to the login page with "This server only lets in addresses of its allowed email domains." The list also applies after sign-in: when you remove a domain, its people's sessions, API tokens, extension tokens and MCP agents stop working at their next request. Their existing captures stay.

Group-based allowlists are out of scope: Google does not put groups in the ID token.

Every capture and comment made by a signed-in person stores their issuer, subject (`sub`), email and name as they were when it was made. Anonymous comments on public share links and uploads through recording links (both Jam features kept from Part 1) carry no account.

### Google Workspace

1. In the Google Cloud console, open APIs and Services, then Credentials, and create an OAuth client ID of type "Web application".
2. Add the redirect URI `https://<your host>/api/auth/callback/oidc`.
3. On the consent screen, choose "Internal" so only your Workspace can use it.
4. Set:

```sh
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
OIDC_CLIENT_SECRET=GOCSPX-...
ALLOWED_EMAIL_DOMAINS=yourcompany.com
```

The button reads "Sign in with Google". Google is a standard OpenID Connect provider, so no Google-specific code is involved.

### Other providers

Any provider with a discovery document works: Keycloak (`OIDC_ISSUER=https://kc.example.com/realms/<realm>`), Authentik, Okta, Microsoft Entra ID (`https://login.microsoftonline.com/<tenant>/v2.0`), GitLab and others. Set `OIDC_PROVIDER_NAME` to the name people know.

### Development

The `dev` compose profile runs a mock provider on `http://oidc.localhost:3311` that signs in anyone with any claims. See `docs/dev.md`.

```sh
OIDC_ISSUER=http://oidc.localhost:3311/toolbar OIDC_CLIENT_ID=toolbar OIDC_CLIENT_SECRET=dev \
OIDC_PROVIDER_NAME="Dev SSO" docker compose --profile dev up -d
```

## Branding

Each set value wins over Settings > Server and locks that field there; empty means the value an instance admin stored, else the default (open-toolbar, a filled rectangle, `#3446cf`). Details in [docs/branding.md](branding.md).

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `APP_NAME` | `open-toolbar` | `Acme Review` | Product name in titles, headers, the MCP server title and the signed-in extension. 1 to 40 letters, digits, spaces or `. , ' & ( ) + _ -`. |
| `APP_LOGO_URL` | the rectangle | `https://acme.example/logo.svg` or `file:///brand/logo.svg` | Logo, SVG or PNG, at most 512 KB, fetched once at start. A `file:` path is inside the server container, so mount it as a volume. |
| `APP_LOGO_DARK_URL` | `APP_LOGO_URL` | `https://acme.example/logo-dark.svg` | Logo for dark pages, when the main one does not read on dark. |
| `APP_ACCENT` | `#3446cf` | `#0b7a5c` | Accent colour `#rrggbb` for buttons, links and the default logo. The server refuses a colour where neither white nor near-black text reads on it. |
| `ADMIN_EMAILS` | empty (the first account) | `ops@acme.example,lee@acme.example` | Instance admins, by verified email: they may change branding in Settings > Server. Set it on any server reachable from the internet, or the first person to sign in becomes admin. |

## Database

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `DATABASE_URL` | `postgres://toolbar:toolbar@localhost:5432/toolbar` | `postgres://toolbar:s3cret@db.internal:5432/toolbar` | The Postgres connection string. Compose builds it from `POSTGRES_PASSWORD` for the server container, so set it only for `pnpm dev`, the migration and seed scripts, or a Postgres outside compose. |
| `POSTGRES_PASSWORD` | `toolbar` | output of `openssl rand -hex 16` | Compose only: the password of the compose Postgres and of the server's connection to it. It applies when the volume is first created; changing it later needs `ALTER USER` inside Postgres. |
| `POSTGRES_PORT` | `5432` | `15432` | Compose only: the host port, on `127.0.0.1`, where Postgres is published for backups and `pnpm dev`. Change it when 5432 is taken. |

## Object storage

Media (recordings, screenshots, voice notes, attachments) goes to an S3-compatible bucket. Compose runs Garage for it.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `S3_ENDPOINT` | `http://localhost:3900`; compose sets `http://garage:3900` | `https://s3.eu-central-1.amazonaws.com` | The S3 API the server talks to. Change it to use another S3 service instead of the compose Garage. |
| `S3_REGION` | `garage` | `eu-central-1` | The region the requests are signed for. Match your S3 service. |
| `S3_BUCKET` | `toolbar` | `acme-feedback` | The bucket. Compose's Garage creates it at first start. |
| `S3_ACCESS_KEY_ID` | `GK000000000000000000000000` | `GK3f9a...` (Garage: `GK` and 24 hex characters) | The access key. Garage takes it at first start; change it on a fresh volume, or when you use another S3 service. |
| `S3_SECRET_ACCESS_KEY` | 64 zeros | output of `openssl rand -hex 32` (Garage: 64 hex characters) | The secret key. With `S3_PUBLIC_URL` set the server refuses the dev value on a public `PUBLIC_URL`. |
| `S3_PUBLIC_URL` | empty | `https://s3.feedback.example.com` | A URL where browsers reach the bucket. When set, media downloads are presigned redirects there; when empty, the server proxies media itself. Set it to take media traffic off the server. |
| `S3_KEY_PREFIX` | empty | `p4-deliver/` | A prefix for every object key, so several servers can share one bucket (area worktrees use it, `docs/parallel.md`). |
| `S3_PORT` | `3900` | `13900` | Compose only: the host port, on `127.0.0.1`, where Garage's S3 API is published. |
| `GARAGE_RPC_SECRET` | 64 zeros | output of `openssl rand -hex 32` | Compose only: Garage's cluster secret (64 hex characters). A single-node Garage never exposes its RPC port, so the default is safe there; `gen-secrets.sh` replaces it anyway. |
| `GARAGE_ADMIN_TOKEN` | `dev-admin-token` | output of `openssl rand -hex 24` | Compose only: token of Garage's admin API, which compose does not publish. |

## Transcription

Voice notes and the voice track of recordings are transcribed on the server into WebVTT (docs/scope.md, "Transcription").

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `TRANSCRIBE_PROVIDER` | `whispercpp` | `openai-compatible`, `none` | Which transcriber runs. `whispercpp` uses the local whisper.cpp container (the `whisper` compose profile, on by default in `.env.example`); `openai-compatible` sends the audio to `STT_URL`; `none` makes no transcripts. |
| `WHISPER_URL` | `http://localhost:8080`; compose sets `http://whisper:8080` | `http://gpu-box:8080` | The whisper.cpp server. Change it to use one that runs elsewhere, for example on a GPU. |
| `WHISPER_MODEL` | `base` | `small` | The ggml model the whisper container downloads at first start and the label stored with each transcript. `small` and larger read better, Swahili included, and need more CPU and memory. |
| `WHISPER_PORT` | `8080` | `18080` | Compose only: the host port, on `127.0.0.1`, of the whisper container. |
| `STT_URL` | empty | `https://api.openai.com` | Base URL of an OpenAI-compatible speech-to-text API (`/v1/audio/transcriptions` is appended). |
| `STT_API_KEY` | empty | `sk-...` | Bearer token for `STT_URL`. Audio leaves your server when this provider is on. |
| `STT_MODEL` | `whisper-1` | `gpt-4o-mini-transcribe` | The model `STT_URL` runs. |

## Paused features

Paused features stay in the code behind flags that default to off (docs/scope.md, D-098). Off hides their UI, their pages and API routes answer 404 (or 503 for the AI and audit endpoints), and the API docs mark them paused. `/api/health` lists the flags that are on in `features`.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `FEATURE_TRACKERS` | off | `1` | GitHub and GitLab issue integrations, the editor's destination picker, send to app, linked issues. |
| `FEATURE_SLACK` | off | `1` | The Slack incoming webhook, in settings and as an editor destination. |
| `FEATURE_CLI` | off | `1` | The `open-toolbar` command-line tool, its settings page and pointers. |
| `FEATURE_EMAIL` | off | `1` | Every notification and invite mail and the magic link (see Mail). |
| `FEATURE_AI` | off | `1` | AI titles and steps, chapters, the workspace AI switch (see AI text). |
| `FEATURE_ADMIN_EXTRAS` | off | `1` | Data retention (auto-delete) and the audit log. |
| `CLI_BUNDLE_PATH` | the repo's `packages/cli/dist/open-toolbar.mjs`, else `./cli/open-toolbar.mjs` | `/opt/open-toolbar.mjs` | With `FEATURE_CLI`: the CLI bundle the server hands out at `/cli/open-toolbar.mjs`. |

## Mail

open-toolbar sends no mail by default (docs/scope.md, D-079). Invites work by link: the invite dialog copies a person's own invite link for you to send. Mentions show in the app.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `SMTP_URL` | empty | `smtps://user:pass@smtp.example.com:465` | Where mail goes, used only with `FEATURE_EMAIL=1`. Empty: nothing is sent. |
| `MAIL_FROM` | `"<app name>" <noreply@<PUBLIC_URL host>>` | `"Acme Review" <review@acme.example>` | The sender. Set it to an address your mail provider lets you send from. |
| `SMTP_PORT` | `1025` | `11025` | Compose `mail` profile only: host port of Mailpit's SMTP, on `127.0.0.1`. |
| `MAILPIT_UI_PORT` | `8025` | `18025` | Compose `mail` profile only: host port of Mailpit's inbox, on `127.0.0.1`. |

For development: `FEATURE_EMAIL=1 SMTP_URL=smtp://mailpit:1025 docker compose --profile mail up -d`, inbox at http://localhost:8025.

## AI text

Paused with `FEATURE_AI` (D-084). With the flag on, any OpenAI-compatible chat endpoint writes chapters, titles and steps; a local Ollama or llama.cpp server works.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `AI_PROVIDER` | `none` | `openai-compatible` | `none` writes nothing and shows the editor's AI switch disabled with a reason. |
| `AI_BASE_URL` | empty | `http://localhost:11434` | The endpoint, with or without `/v1`. |
| `AI_MODEL` | `llama3.2` | `qwen2.5:7b` | The chat model. |
| `AI_API_KEY` | empty | `sk-...` | Bearer token, when the endpoint needs one. |
| `AI_TIMEOUT_MS` | `20000` | `60000` | How long one request may take. Raise it for a slow local model. |

## Media tools

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `FFMPEG_PATH` | `ffmpeg` on `PATH` (the image installs it) | `/usr/local/bin/ffmpeg` | ffmpeg remuxes recordings and makes thumbnails. Set it when running the server outside the image with ffmpeg elsewhere. |
| `FFPROBE_PATH` | `ffprobe` on `PATH` | `/usr/local/bin/ffprobe` | As above, for ffprobe. |

## Compose

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `COMPOSE_PROFILES` | empty; `.env.example` sets `whisper` | `whisper`, `whisper,dev` | Docker Compose's own variable: which optional services start. `whisper` is the local transcriber, `dev` the mock OIDC provider, `mail` Mailpit. Drop `whisper` when `TRANSCRIBE_PROVIDER` is `openai-compatible` or `none`. |
| `OIDC_MOCK_PORT` | `3311` | `13311` | `dev` profile only: host port of the mock OIDC provider. The issuer the server and browser share is `http://oidc.localhost:<port>/<any name>`. |

## Coolify

`docker-compose.coolify.yml` is the same stack shaped for Coolify (docs/scope.md, "Deliverables"):

- Coolify generates the secrets: `SERVICE_PASSWORD_64_AUTH` (the auth secret), `SERVICE_PASSWORD_64_POSTGRES`, `SERVICE_HEX_64_S3SECRET`, `SERVICE_HEX_64_GARAGERPC` and `SERVICE_PASSWORD_64_GARAGEADMIN`. You never type them.
- `SERVICE_URL_SERVER_3000` gives the server its domain and routes it to port 3000; `PUBLIC_URL` follows it. Set your own domain in the server's Domains field as `https://feedback.example.com:3000`.
- `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `ALLOWED_EMAIL_DOMAINS` are marked required (`${VAR:?}`), so Coolify asks for them before the first deploy.
- No service publishes a host port, and no Traefik labels are set: Coolify's proxy routes the domain.
- Garage is built from `deploy/garage.Dockerfile`, which bakes in `deploy/garage.toml`, so no file has to be bind-mounted from the repository.
- Every other variable on this page can be added under Environment Variables once the compose file passes it to the server; the file passes the common ones.

Steps: in Coolify, + New, pick this Git repository, Build strategy "Compose", Docker Compose Location `/docker-compose.coolify.yml`; fill in the four required values; Deploy. Register `https://<the server's domain>/api/auth/callback/oidc` with your provider. The whisper service downloads its model on first start and takes a few minutes before transcripts work.

## Extension build

These are read when you build the extension, never by a running server ([docs/extension-release.md](extension-release.md)).

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `WXT_SERVER_URL` | `http://localhost:3000` | `https://feedback.example.com` | The server a fresh install points at. Set it for a release your testers install, so they only click Sign in. |
| `WXT_APP_NAME` | `open-toolbar` | `Acme Review` | The extension's name in the manifest, toolbar tooltip and page titles (docs/branding.md). |
| `WXT_APP_ICON` | the packaged rectangle | `brand/logo.svg` | An SVG or PNG the build renders into the packaged icons. |
| `WXT_MANIFEST_KEY` | the repository's key (id `fmongfmimgdafigcahdpofnmmhljpnei`) | the Web Store item's public key | The public key that pins the extension id of unpacked builds. Set it to the Chrome Web Store item's key so local builds share the store id. |
| `WXT_GECKO_ID` | `open-toolbar@self-hosted` | `review@acme.example` | The Firefox add-on id. Use your own when you sign the add-on on AMO. |
| `RELEASE_TAG` | empty | `v0.2.0` | `scripts/release-extension.sh` refuses to build when this tag's version differs from `apps/extension/package.json`. The release workflow sets it. |
| `FIREFOX` | `1` | `0` | `scripts/release-extension.sh` builds the Firefox zip too unless this is `0`. |
| `WXT_DEV_PORT` | `3001` | `3207` | Port of the extension's dev server (HMR). Area worktrees use their own. |
| `WXT_TEST_HOOKS` | off | `1` | The test build for the e2e suites: open shadow root and `globalThis.__tb`. Never ship it. |
| `WXT_OUT_SUFFIX` | empty | `-121` | With `WXT_TEST_HOOKS`, a suffix for the output folder so several test builds sit side by side. |

## Development and internal

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `DEV_PORT` | `3000` | `3107` | Port of `pnpm dev:server` (Vite). Area worktrees use their own (`docs/parallel.md`). |
| `SERVER_URL` | `PUBLIC_URL` | `http://localhost:3107` | The server `apps/server/scripts/check-server-core.ts` and the e2e suites talk to. |
| `PROTOCOL_HEADER` | set by `server.js` | `x-toolbar-origin-proto` | Internal: `server.js` sets it so adapter-node takes the protocol from `PUBLIC_URL`. Do not set it. |
| `HOST_HEADER` | set by `server.js` | `x-toolbar-origin-host` | Internal: as above, for the host. Do not set it. |

## Older names

These still work so existing `.env` files keep running; prefer the new names.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `OIDC_1_CLIENT_ID` | empty | as `OIDC_CLIENT_ID` | Read, with the other `OIDC_1_*` names, only while `OIDC_CLIENT_ID` is empty. |
| `OIDC_1_CLIENT_SECRET` | empty | as `OIDC_CLIENT_SECRET` | Older `OIDC_CLIENT_SECRET`. |
| `OIDC_1_DISCOVERY_URL` | empty | as `OIDC_DISCOVERY_URL` | Older `OIDC_DISCOVERY_URL`. |
| `OIDC_1_SCOPES` | `openid email profile` | as `OIDC_SCOPES` | Older `OIDC_SCOPES`. |
| `OIDC_1_NAME` | `SSO` | as `OIDC_PROVIDER_NAME` | Older `OIDC_PROVIDER_NAME`. |
| `OIDC_1_ID` | `oidc` | as `OIDC_PROVIDER_ID` | Older `OIDC_PROVIDER_ID`. |
| `AUTH_ALLOWED_DOMAINS` | empty | as `ALLOWED_EMAIL_DOMAINS` | Older `ALLOWED_EMAIL_DOMAINS`, read when that one is empty. |
| `AUTH_EMAIL_PASSWORD` | off | as `AUTH_DEV_PASSWORD` | Older `AUTH_DEV_PASSWORD`. |
| `AI_URL` | empty | as `AI_BASE_URL` | Older `AI_BASE_URL`, read when that one is empty. |
