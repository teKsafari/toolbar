# Configuration

open-toolbar takes six values from the environment to boot. An instance admin sets everything else in the web app, under Settings > Server, while the server runs. With Docker Compose you put the six values in `.env` next to `docker-compose.yml`; on Coolify you fill them in under Environment Variables.

Every other variable on this page is optional. A variable that backs a Settings > Server field still works: when set, it wins over the stored value and locks the field in the admin page, as branding does ([docs/branding.md](branding.md)). A test (`apps/server/test/config-docs.test.ts`) compares this page with the server and extension code, the instance settings (`packages/shared/src/api/instance-settings.ts`), the injector's Go code and Coolify file, the Agent Skill, the compose files and `.env.example`. It fails when a variable has no row here, when a row names a variable nothing reads, when a variable is missing from the table in [Where each setting lives](#where-each-setting-lives), and when the quickstart files ask for more than the required values.

## The basic deployment

Six values make a working server.

| What | Variables |
|---|---|
| Where people reach the server | `PUBLIC_URL` |
| The secret that signs sessions and encrypts stored secrets | `BETTER_AUTH_SECRET` (or `AUTH_SECRET`) |
| Your sign-in provider | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` |
| Who administers the server | `ADMIN_EMAILS` |

```sh
cp .env.example .env                                 # or: scripts/gen-secrets.sh https://feedback.example.com
$EDITOR .env                                         # the required block at the top
docker compose up -d --build
curl -s https://feedback.example.com/api/health      # {"ok":true,...}
```

Then sign in with an address from `ADMIN_EMAILS`, open Settings > Server, add your email domains under Sign-in and pick a transcription provider. Until you add domains, only `ADMIN_EMAILS` addresses can sign in ([Who gets in](#who-gets-in)).

Put a TLS proxy (Caddy, Traefik, nginx) in front of the server's port and point `PUBLIC_URL` at the https address. The server refuses to start on a non-localhost `PUBLIC_URL` while the auth secret is the dev default. On Coolify, use `docker-compose.coolify.yml` instead ([Coolify](#coolify)).

Postgres and Garage keep working with their built-in credentials, because the compose file publishes their ports on `127.0.0.1` only and other machines cannot reach them. `scripts/gen-secrets.sh` still replaces those credentials with random ones, so use it on a fresh install.

### Compose files

| File | When you use it |
|---|---|
| `docker-compose.yml` | Always: the server, Postgres and Garage. It passes every line of `.env` to the server (`env_file`), so an optional variable needs no edit of the compose file. |
| `docker-compose.whisper.yml` | Local transcription with whisper.cpp: `docker compose -f docker-compose.yml -f docker-compose.whisper.yml up -d`, then pick "Local whisper.cpp" in Settings > Server. |
| `docker-compose.mail.yml` | The paused mail (`FEATURE_EMAIL`, D-171), with Mailpit. |
| `docker-compose.dev.yml` | Development and e2e only: the mock OIDC provider, password sign-in, rate limits off, paused feature flags. Never in a deployment. |
| `docker-compose.coolify.yml` | Coolify, in place of all of the above ([Coolify](#coolify)). |

## Where each setting lives

Each setting is in one of five places (D-194). **Required** values boot the server and stay in the environment. **Wiring** is what the compose files and Coolify fill in for the containers they run; you set it only outside them. **Settings > Server** fields belong to the instance admin, who changes them at runtime; the variable, when set, locks the field. **Workspace** settings belong to a workspace admin and have no variable. **Optional environment** covers deployment details that take effect at start, belong to another container, or depend on the image. **Dev and tests**, **Paused** and **Build** stay out of every compose file you deploy.

| Setting | Where | Why there |
|---|---|---|
| `PUBLIC_URL` | Required | Cookies, the OAuth redirect URI and CSRF checks are built from it before anyone can sign in. |
| `BETTER_AUTH_SECRET`, `AUTH_SECRET` | Required | Signs sessions and derives the keys of sealed values, the stored API key included, so it cannot live in the database it protects. |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Required | Nobody, the admin included, can sign in without the provider, and the client secret should not sit in a table an admin page edits. |
| `ADMIN_EMAILS` | Required | Someone must be able to reach Settings > Server on a fresh server, and on a public URL it is the only safe way to name that person ([Who gets in](#who-gets-in)). |
| `DATABASE_URL`, `POSTGRES_PASSWORD` | Wiring | The database holds the settings, so its address cannot be one of them. Compose builds the URL; Coolify generates the user and password. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Wiring | Storage credentials of the stack's own Garage, generated by `gen-secrets.sh` or Coolify. |
| `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN` | Wiring | Garage's own secrets; the server never reads them. |
| `WHISPER_URL` | Wiring, and Settings > Server | `docker-compose.whisper.yml` and the Coolify file point it at their whisper service; the admin page can point it elsewhere when the variable is unset. |
| `PORT` | Wiring | Compose publishes this host port and pins the server to 3000 inside the container. |
| `ALLOWED_EMAIL_DOMAINS` | Settings > Server, Sign-in | Changes as the organisation does, and takes effect at the next request of each session. |
| `OIDC_PROVIDER_NAME`, `OIDC_SCOPES` | Settings > Server, Sign-in | Read at each sign-in, so they need no restart; the provider itself stays in the environment. |
| `TRANSCRIBE_PROVIDER`, `TRANSCRIBE_API_KEY`, `OPENAI_API_KEY`, `TRANSCRIBE_MODEL`, `TRANSCRIBE_BASE_URL`, `TRANSCRIBE_LANGUAGE`, `TRANSCRIBE_TIMESTAMPS`, `TRANSCRIBE_CHUNK_SECONDS`, `TRANSCRIBE_CONCURRENCY` | Settings > Server, Transcription | Read per job, so an admin can switch provider, try it with Test connection and roll back without a deploy. The key is sealed at rest. |
| `TRANSCRIBE_MAX_MINUTES`, `TRANSCRIBE_MONTHLY_MINUTES` | Settings > Server, Limits | Cost caps an admin tunes as usage grows. |
| `MAX_RECORDING_MIN` | Settings > Server, Capture defaults | Read when the extension loads its bootstrap. |
| `SITE_ACCESS` | Settings > Server, Capture defaults | Where the extension captures (D-200). Read per request and sent in the extension's bootstrap, so a switch reaches each extension within 10 minutes, or at a popup open once its copy is a minute old. |
| (no variable) masking preset and trace step window for new projects | Settings > Server, Capture defaults, and Workspace | Instance defaults that each workspace admin can replace for their workspace. |
| `SHARE_LINK_DAYS`, `EXPORT_MAX_MB`, `SUPPORT_RECORDING_LINK` | Settings > Server, Sharing and export | Policies read per request. |
| (no variable) recording link uploads per address | Settings > Server, Limits | Abuse limit of the public recording links, read per request. |
| `APP_NAME`, `APP_LOGO_URL`, `APP_LOGO_DARK_URL`, `APP_ACCENT` | Settings > Server, Branding | Already admin settings (D-112). |
| `EXTENSION_IDS`, `EXTENSION_GECKO_IDS` | Optional environment | Read once at start; only a self-built extension needs them. |
| `OIDC_DISCOVERY_URL`, `OIDC_PROVIDER_ID` | Optional environment | Part of the provider set at start; changing the id unlinks every account. |
| `BODY_SIZE_LIMIT`, `WORKER`, `MIGRATE_ON_START`, `MIGRATIONS_DIR`, `NODE_ENV` | Optional environment | Process and image settings that apply when the server starts. |
| `S3_PUBLIC_URL`, `S3_KEY_PREFIX`, `POSTGRES_PORT`, `S3_PORT` | Optional environment | Storage layout and host ports, fixed per deployment. |
| `WHISPER_MODEL`, `WHISPER_PORT` | Optional environment | Settings of the whisper container, which downloads the model at its first start. |
| `OCR_BIN`, `OCR_LANGS`, `FFMPEG_PATH`, `FFPROBE_PATH` | Optional environment | Depend on what the image installs. |
| `INJECTOR_SECRET`, `INJECTOR_ORIGINS`, `INJECTOR_COOKIE_DAYS` | Optional environment | Deployed together with the injector container, whose secret must match. |
| `COMPOSE_PROFILES` | Optional environment | Docker Compose's own switch; on Coolify it starts the whisper service. |
| `AUTH_DEV_PASSWORD`, `AUTH_RATE_LIMIT`, `OIDC_MOCK_PORT`, `DEV_PORT`, `SERVER_URL`, `PROTOCOL_HEADER`, `HOST_HEADER` | Dev and tests | Password sign-in and rate limits off would weaken a real server; `docker-compose.dev.yml` and `pnpm dev` pass them. |
| `FEATURE_EMAIL`, `FEATURE_TRACKERS`, `FEATURE_SLACK`, `FEATURE_CLI`, `FEATURE_AI`, `FEATURE_ADMIN_EXTRAS`, `CLI_BUNDLE_PATH`, `AUTH_MAGIC_LINK` | Paused | Features paused by docs/scope.md; the flags stay in the code. |
| `SMTP_URL`, `MAIL_FROM`, `SMTP_PORT`, `MAILPIT_UI_PORT` | Paused | Mail, only through `docker-compose.mail.yml`. |
| `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_TIMEOUT_MS` | Paused | AI text, only with `FEATURE_AI`. |
| `INJECTOR_LOOPBACK`, `INJECTOR_LOOPBACK_INSECURE`, `INJECTOR_UPSTREAMS`, `INJECTOR_UPSTREAM`, `TOOLBAR_SERVER_URL`, `TOOLBAR_PUBLIC_URL`, `INJECTOR_TRUST_FORWARDED`, `INJECTOR_SCAN_LIMIT`, `INJECTOR_LISTEN`, `INJECTOR_ASSETS` | Injector container | Read by the injector, never by this server. |
| `TOOLBAR_SERVER`, `TOOLBAR_TOKEN` | Agent side | Read by the coding agent's shell. |
| `WXT_SERVER_URL`, `WXT_APP_NAME`, `WXT_APP_ICON`, `WXT_MANIFEST_KEY`, `WXT_GECKO_ID`, `RELEASE_TAG`, `FIREFOX`, `WXT_DEV_PORT`, `WXT_TEST_HOOKS`, `WXT_OUT_SUFFIX` | Build | Read when you build the extension. |

## Settings > Server

Instance admins (`ADMIN_EMAILS`, or the first account when it is empty) see Settings > Server; everyone else gets 404. Below Branding it has five sections. Each section has its own Save button and saves only the fields you changed; an emptied field goes back to its default.

| Section | Fields |
|---|---|
| Sign-in | The provider and its redirect URI, read-only from the environment, with Test discovery URL; allowed email domains, the button name, scopes |
| Transcription | Provider (off, local whisper.cpp, an OpenAI-compatible endpoint), API key, model, endpoint, whisper.cpp URL, languages, timestamps, chunk length, parallel requests, with Test connection |
| Capture defaults | Site access (all sites, or project origins only), masking preset and trace step window for new projects, longest recording |
| Sharing and export | Share link lifetime, export page size, the extension's "report a problem" link |
| Limits | Longest audio transcribed, hosted transcription minutes per month, recording link uploads per address in 10 minutes |

- **Precedence.** A variable that is set wins, and the field shows "Set by environment" with the variable's name and cannot be edited there. Otherwise the stored value applies, else the default. The admin API refuses a change to a locked field (`locked_by_env`).
- **Validation.** The page checks each value with the same rules as the server before it saves, and names the field when one is wrong.
- **No restart.** A save applies at once on the server that took it. Other replicas re-read the settings within 15 seconds.
- **The API key** is sealed with AES-256-GCM under a key derived from `BETTER_AUTH_SECRET` (as share tokens are) and never comes back in full: the page shows its last four characters. Changing `BETTER_AUTH_SECRET` makes it unreadable; the server log says so and you enter it again.
- **Test buttons.** Test connection calls `<endpoint>/models` with the key (or `<whisper.cpp URL>/` for local) and reports whether the key works and the model is offered. Test discovery URL reads the provider's discovery document and checks the scopes against its `scopes_supported`. Both use the values on the form, saved or not.
- **API.** `GET` and `PATCH /api/v1/admin/settings` and `POST /api/v1/admin/settings/test`, for a signed-in instance admin; personal API tokens are refused.

Settings are stored in the `instance_setting` table, row `instance`.

### Workspace settings

Settings, General has a New projects section for workspace admins: the masking preset and trace step window a new project starts with. Empty follows the instance's Capture defaults. Existing projects keep their own values; an API client that leaves them out of `POST /api/v1/workspaces/<id>/projects` gets these defaults.

### Site access

Settings > Server, Capture defaults, Site access picks where the extension captures (D-200). `SITE_ACCESS` sets it from the environment and locks the field.

| Mode | The extension | The server |
|---|---|---|
| All sites (`all`, the default) | The capture scripts run on every site except this server and the reviewer's blocked sites. The extension holds every site as a required host permission (D-202), so nothing is asked after sign-in. If the reviewer turns site access off in the browser, the popup and the options page ask for it again. | The first capture on an origin with no project makes one in the capture's workspace: named after the host, with that one origin, and the workspace's masking preset and trace step window (else the instance's). |
| Project origins only (`projects`) | The capture scripts are registered for the origins of the person's projects only, and the worker keeps no network metadata for a tab on any other page (D-126, D-202). The browser grants every site, but nothing runs elsewhere; the popup there says the site is in no project and that the server is in strict mode. | A capture from an origin outside the workspace's projects gets 403 `origin_not_allowed`. Nothing is made automatically. |

In both modes a project lists exact origins (`https://staging.nuru.sh`, `http://localhost:5173`) and domains (`*.nuru.sh` covers nuru.sh and every subdomain, over https only unless `http://*.nuru.sh` is listed too). An exact origin wins over a domain, and a longer domain over a shorter one. Admins edit the list in Settings > Projects or on the project's page, and merge two projects there: the second one's origins and captures move into the first, which keeps its own preset and step window. The sidebar lists the projects with their captures.

`SITE_ACCESS` has a row in the tables on this page like every Settings > Server variable, and `apps/server/test/config-docs.test.ts` fails if it loses it.

## How to read the tables

Each row gives the variable, its default, an example, and what it does with when you would change it. "Empty" means unset or set to an empty string; both mean the default. Flags take `1`, `true`, `yes` or `on` for on, anything else for off. "Settings > Server" in a row means an admin can set the value in the web app instead; the variable, when set, locks that field.

## Server

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `PUBLIC_URL` | `http://localhost:3000` | `https://feedback.example.com` | **Required.** The origin people and the extension use. Links, the OAuth redirect URI (`<PUBLIC_URL>/api/auth/callback/<OIDC_PROVIDER_ID>`), cookies and the CSRF origin come from it. Set it to the https address of your proxy; a path is not supported. |
| `BETTER_AUTH_SECRET` | a dev secret | output of `openssl rand -hex 32` | **Required.** Signs sessions and derives the key that encrypts share and recording-link tokens and the transcription API key in the database. Use 32 or more random characters. Changing it signs everyone out and makes stored share links and the stored API key unreadable, so set it once. |
| `AUTH_SECRET` | empty | as above | A shorter name for `BETTER_AUTH_SECRET`, read when that one is empty. |
| `PORT` | `3000` | `8080` | Compose: the host port the server container publishes. Compose pins the server to 3000 inside the container. Change it when 3000 is taken on the host. |
| `EXTENSION_IDS` | `laobpjhffglefallhhojihfdbdkoendk` | `laobpjhffglefallhhojihfdbdkoendk,abcdefghijklmnopabcdefghijklmnop` | Comma separated ids of the browser extensions allowed to sign in through `/ext/connect` and to call the API from their pages. The default is the Chrome Web Store item's id, which the repository's manifest key pins. Set your own item's id when you publish a fork ([docs/extension-release.md](extension-release.md)). |
| `EXTENSION_GECKO_IDS` | `open-toolbar@self-hosted` | `open-toolbar@self-hosted,review@acme.example` | Comma separated Firefox add-on ids allowed to sign in through `/ext/connect`. Firefox redirects to `https://<SHA-1 of the add-on id>.extensions.allizom.org/cb`, and the server accepts that form for these ids only. Add the id you build with `WXT_GECKO_ID`. |
| `BODY_SIZE_LIMIT` | `210M` (set in the image) | `500M` | Largest request body the Node server accepts. Routes cap upload chunks at 8 MiB and attachments at 200 MiB on their own; raise this only together with those limits. |
| `WORKER` | `1` | `0` | Runs the background job worker (transcripts, thumbnails, webhooks) inside the server process. Set `0` on extra server replicas so one process runs jobs. |
| `MIGRATE_ON_START` | `1` | `0` | Applies database migrations at start. Set `0` when you run `pnpm --filter @toolbar/server db:migrate` yourself before a deploy. |
| `MIGRATIONS_DIR` | `./drizzle` next to the server | `/app/drizzle` | Where the migration files live. Only for a custom image layout. |
| `MAX_RECORDING_MIN` | empty (no cap) | `15` | Settings > Server, Capture defaults. Longest recording in minutes; the extension's timer stops there. Set it to keep recordings short on a small server. |
| `SITE_ACCESS` | `all` | `projects` | Settings > Server, Capture defaults (D-200). `all`: after sign-in the extension asks Chrome once for every site and captures anywhere but this server and the reviewer's blocked sites; the first capture on an origin makes a project for it, which an admin can merge with others. `projects`: the strict mode, where the extension captures only on origins listed in projects, each approved in Chrome, and the server refuses captures from other origins (`origin_not_allowed`) and makes no project by itself. Set `projects` when reviewers must not record outside the apps an admin named. See [Site access](#site-access). |
| `SUPPORT_RECORDING_LINK` | empty | `https://feedback.example.com/r/abc`, or `off` | Settings > Server, Sharing and export. Where the extension menu's "report a problem" goes. Empty: a "Problem reports" recording link owned by the server's first account, made on first use. `off` hides it. |
| `NODE_ENV` | `production` in the image, `development` in `pnpm dev` | `production` | Turns on production behaviour: sign-in rate limits, no response-shape checks in the share routes. Leave it to the image. |

## Sign-in

open-toolbar signs people in through one OpenID Connect provider that you register it with (docs/scope.md, D-080, D-114). The server is the OIDC client: browsers and the extension never hold the client secret. The extension signs in through the server (`chrome.identity.launchWebAuthFlow` on `/ext/connect`), so it needs no settings of its own. The provider stays in the environment; the allowed domains, the button name and the scopes are in Settings > Server, Sign-in.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `OIDC_ISSUER` | empty | `https://accounts.google.com` | **Required.** The provider's issuer URL. The server fetches `<issuer>/.well-known/openid-configuration`. Stored on every capture and comment as the author's issuer. |
| `OIDC_DISCOVERY_URL` | `<OIDC_ISSUER>/.well-known/openid-configuration` | `https://id.example.com/custom/openid-configuration` | The discovery document, when it lives somewhere else. Wins over `OIDC_ISSUER` for discovery; the issuer is derived from it when `OIDC_ISSUER` is empty. |
| `OIDC_CLIENT_ID` | empty | `1234567890-abc.apps.googleusercontent.com` | **Required.** The client id from the provider. Without it the provider is off and nobody can sign in. |
| `OIDC_CLIENT_SECRET` | empty | `GOCSPX-...` | **Required.** The client secret. The server also sends PKCE. |
| `ADMIN_EMAILS` | empty (the first account, see [Who gets in](#who-gets-in)) | `ops@acme.example,lee@acme.example` | **Required.** Instance admins, by verified email, comma separated: they open Settings > Server (branding and every instance setting). On a public URL with no allowed email domains, only these addresses can sign in until one of them has. |
| `OIDC_SCOPES` | `openid email profile` | `openid email profile groups` | Settings > Server, Sign-in. Space or comma separated. Keep `openid` and `email`: the allowlist reads the address. |
| `OIDC_PROVIDER_NAME` | `Google` for `accounts.google.com`, else `SSO` | `Acme SSO` | Settings > Server, Sign-in. The login button reads "Sign in with <name>". Set it to the name your people know. |
| `OIDC_PROVIDER_ID` | `oidc` | `keycloak` | The id in the callback path. Changing it after people signed in leaves their accounts unlinked, so pick it once. |
| `ALLOWED_EMAIL_DOMAINS` | empty (any address, after the bootstrap rule) | `acme.com,acme.co.uk` | Settings > Server, Sign-in. Comma separated domains that may sign in and submit feedback; subdomains count (`acme.com` admits `eu.acme.com`). Google's `hd` claim must match too when the token carries it. |
| `AUTH_RATE_LIMIT` | on in production | `off` | Dev and tests. Better Auth's per-address limits (3 sign-ins per 10 s). `off` only for an e2e run, whose test accounts all sign in from one address; `docker-compose.dev.yml` passes it. |
| `AUTH_DEV_PASSWORD` | off | `1` | Dev and tests. Adds email and password sign-in (docs/scope.md); `docker-compose.dev.yml` passes it. |
| `AUTH_MAGIC_LINK` | on with `FEATURE_EMAIL` | `0` | Paused with mail. The emailed sign-in link exists only while mail is on; `0` keeps it off then. |

The redirect URI to register with the provider is `<PUBLIC_URL>/api/auth/callback/<OIDC_PROVIDER_ID>`, so `https://feedback.example.com/api/auth/callback/oidc` by default. Settings > Server shows it with a copy button.

### Who gets in

**Bootstrap rule (D-194).** On a public `PUBLIC_URL` (anything but localhost) with no allowed email domains, the first account would otherwise belong to whoever your provider signs in first, and a Google provider signs in any Gmail address. So until an instance admin exists, the server lets in only a verified address listed in `ADMIN_EMAILS`. Everyone else returns to the login page with "This server has no admin yet. Until one signs in, only the addresses in ADMIN_EMAILS can sign in." With `ADMIN_EMAILS` empty there, nobody can sign in, and the server log says so at start. Once an admin has signed in, the allowed domains the admin sets in Settings > Server decide; leaving them empty admits anyone the provider signs in, and the admin page warns about that. On localhost, and on a server with allowed domains, the rule does not apply, and without `ADMIN_EMAILS` the first account is the instance admin.

With allowed email domains set, the server checks the provider's claims at every sign-in:

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
ADMIN_EMAILS=you@yourcompany.com
```

5. Sign in as that address and add `yourcompany.com` under Settings > Server, Sign-in, Allowed email domains.

The button reads "Sign in with Google". Google is a standard OpenID Connect provider, so no Google-specific code is involved.

### Other providers

Any provider with a discovery document works: Keycloak (`OIDC_ISSUER=https://kc.example.com/realms/<realm>`), Authentik, Okta, Microsoft Entra ID (`https://login.microsoftonline.com/<tenant>/v2.0`), GitLab and others. Set the button name under Settings > Server to the name people know, and use Test discovery URL there to check the provider answers.

### Development

`docker-compose.dev.yml` runs a mock provider on `http://oidc.localhost:3311` that signs in anyone with any claims. See `docs/dev.md`.

```sh
OIDC_ISSUER=http://oidc.localhost:3311/toolbar OIDC_CLIENT_ID=toolbar OIDC_CLIENT_SECRET=dev \
OIDC_PROVIDER_NAME="Dev SSO" docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Branding

Settings > Server, Branding. Each set value wins over the stored one and locks that field there; empty means the value an instance admin stored, else the default (open-toolbar, a filled rectangle, black). Details in [docs/branding.md](branding.md).

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `APP_NAME` | `open-toolbar` | `Acme Review` | Product name in titles, headers, the MCP server title and the signed-in extension. 1 to 40 letters, digits, spaces or `. , ' & ( ) + _ -`. |
| `APP_LOGO_URL` | the rectangle | `https://acme.example/logo.svg` or `file:///brand/logo.svg` | Logo, SVG or PNG, at most 512 KB, fetched once at start. A `file:` path is inside the server container, so mount it as a volume. |
| `APP_LOGO_DARK_URL` | `APP_LOGO_URL` | `https://acme.example/logo-dark.svg` | Logo for dark pages, when the main one does not read on dark. |
| `APP_ACCENT` | `#000000` | `#0b7a5c` | Accent colour `#rrggbb` for buttons, links and the default logo. The server refuses a colour where neither white nor near-black text reads on it. |

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

Voice audio becomes a WebVTT transcript on the server: the microphone track of a recording or a trace, and each voice note attached to a comment (D-087). Viewers see it as captions and under the comment, and agents read it over MCP and the HTTP API.

Transcription is off until an instance admin picks a provider under Settings > Server, Transcription (D-194):

- **Local whisper.cpp**: the `whisper` service of `docker-compose.whisper.yml` (on Coolify, `COMPOSE_PROFILES=whisper`). No key, no cost, and no audio leaves your server. Good for English; Swahili comes out unusable.
- **OpenAI-compatible endpoint**: by default OpenAI's `gpt-transcribe`. Needs a key. Much better on Swahili and mixed Swahili and English, and faster than whisper.cpp on a CPU. It costs money and sends the voice audio to the provider.
- **Off**: no transcripts.

To use OpenAI: pick the endpoint provider, paste the key, click Test connection, then Save. The next transcript uses it; no restart. Every field below can instead be pinned by its variable, which locks it in the admin page:

```sh
TRANSCRIBE_PROVIDER=openai
OPENAI_API_KEY=sk-...            # or TRANSCRIBE_API_KEY, which wins when both are set
```

Setting a key alone changes nothing: the provider switches only when an admin picks it or `TRANSCRIBE_PROVIDER` is set. With the endpoint provider and no key for `api.openai.com`, transcription is off and the server log says why.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `TRANSCRIBE_PROVIDER` | `none` | `openai`, `local` | Settings > Server, Transcription. `none`, `local` or `openai`. `local` needs the whisper.cpp container (`docker-compose.whisper.yml`). |
| `TRANSCRIBE_MODEL` | `gpt-transcribe` | `whisper-1` | Settings > Server, Transcription. Model id for `openai`. `whisper-1` also works on OpenAI; Groq takes `whisper-large-v3-turbo`. |
| `TRANSCRIBE_API_KEY` | `OPENAI_API_KEY` | `sk-...` | Settings > Server, Transcription, where it is stored sealed and shown as its last four characters. Bearer token for `openai`. A self-hosted endpoint such as speaches may need none. |
| `OPENAI_API_KEY` | empty | `sk-...` | Read when `TRANSCRIBE_API_KEY` is empty; locks the API key field like it. Setting it alone does not switch the provider. |
| `TRANSCRIBE_BASE_URL` | `https://api.openai.com/v1` | `https://api.groq.com/openai/v1` | Settings > Server, Transcription. The endpoint, `/v1` included; the server posts to `<base>/audio/transcriptions`. |
| `TRANSCRIBE_LANGUAGE` | empty (detect) | `sw,en` | Settings > Server, Transcription. ISO 639-1 codes, comma separated. Leave empty for mixed-language narration: the Swahili hint gave no measurable gain. |
| `TRANSCRIBE_TIMESTAMPS` | `auto` | `chunked` | Settings > Server, Transcription. `chunked` cuts the audio at pauses and times the text on the server; `native` asks the endpoint for WebVTT; `auto` uses `chunked` for `gpt-*` models, else tries `native` and switches to `chunked` when the endpoint refuses WebVTT. |
| `TRANSCRIBE_CHUNK_SECONDS` | `30` | `12` | Settings > Server, Transcription. Longest chunk sent in one request. `12` gives cues about half a second closer to the speech for about 4% more billed audio and slightly worse text. |
| `TRANSCRIBE_MAX_MINUTES` | `60` | `120` | Settings > Server, Limits. Longer audio is not transcribed; its transcript says "skipped" with the reason. Applies to every provider. |
| `TRANSCRIBE_MONTHLY_MINUTES` | empty (no cap) | `6000` | Settings > Server, Limits. Hosted audio per calendar month (UTC). Past it, transcripts are skipped with "monthly limit" until the month turns. `local` does not count. |
| `TRANSCRIBE_CONCURRENCY` | `4` | `2` | Settings > Server, Transcription. Chunk requests in flight per recording. Lower it when the provider rate-limits you. |
| `WHISPER_URL` | `http://localhost:8080`; `docker-compose.whisper.yml` and the Coolify file set `http://whisper:8080` | `http://gpu-box:8080` | Settings > Server, Transcription, when the variable is unset. Where the server reaches whisper.cpp. Change it to use one that runs elsewhere, for example on a GPU. |
| `WHISPER_MODEL` | `base` | `small` | `docker-compose.whisper.yml`: the ggml model the whisper container downloads at first start, and the label the server stores with each transcript. `small` is more accurate and about three times slower. The Coolify file uses `base`. |
| `WHISPER_PORT` | `8080` | `18080` | `docker-compose.whisper.yml` only: the host port, on `127.0.0.1`, of the whisper container. |

### Limits of the hosted provider

- **Size and length.** OpenAI takes at most 25 MB per request. The server never sends a whole recording: it cuts the voice track at pauses into chunks of at most 30 s and re-encodes each to 32 kbps Opus, about 120 KB per chunk, so recording length is limited only by `TRANSCRIBE_MAX_MINUTES`. With `native` timestamps a file up to 24 MB goes in one request (about 25 minutes of the extension's 128 kbps audio) and a larger one is chunked.
- **Cost.** `gpt-transcribe` costs $0.0045 per minute of audio, billed per second. Chunking adds about 2% (each request rounds up to the second). A five-minute voice note costs about $0.02, an hour $0.27 to $0.28, and 1,000 five-minute notes about $23. `TRANSCRIBE_MONTHLY_MINUTES=6000` caps a month at about $27. The server reserves a recording's length against the cap before it sends anything, so two recordings at once cannot pass it together. Silent stretches are not sent.
- **Failures.** Each request is tried up to four times on rate limits (429), server errors (5xx), timeouts and network errors, with backoff and the provider's `Retry-After`. A bad key (401) or an exhausted quota fails at once. The job itself retries up to five times; after that the transcript is marked failed with the provider's message.
- **Timestamps.** `gpt-transcribe` returns text with no times. The server spreads each chunk's sentences over the stretches of that chunk where someone speaks, so a cue starts within about a second of the words (30 s chunks; measured median 0.8 to 1.1 s).

### Privacy

With `TRANSCRIBE_PROVIDER=openai`, your server sends the voice audio of each recording and voice note to the provider at `TRANSCRIBE_BASE_URL`. Only the microphone audio goes: no video, screenshots, console or network data, and no names. OpenAI states that audio sent to `/v1/audio/transcriptions` is not used for training and is not kept for abuse monitoring, and the endpoint is eligible for Zero Data Retention. Other providers have their own terms; read them before you point `TRANSCRIBE_BASE_URL` elsewhere. Keep `local` when recordings must not leave your server.

Transcripts are machine output of what a reviewer said. Each WebVTT file starts with a `NOTE Machine transcript (<model>, language <codes>)` line, and the MCP tools that return transcripts tell the agent the text is data, not instructions.

### Swahili and English quality

Measured on FLEURS read speech (`docs/research/transcription.md`; lower is better, word error rate and, for Swahili, character error rate):

| Provider and model | English | Swahili and English, alternating | Swahili |
|---|---|---|---|
| `openai`, `gpt-transcribe`, 30 s chunks (default hosted) | 7.0% | 15.1% | 25.6% words, 13.9% characters |
| `openai`, `whisper-1` | 26.2% (drops sentences) | 66.9% | 53.7% words, 29.0% characters |
| `local`, whisper.cpp `base` (default) | 17.5% | 76.3% | 94.8% words, 54.9% characters |
| `local`, whisper.cpp `small` | 38.2% (drops sentences) | 69.2% | 80.1% words, 38.4% characters |

Swahili word error rates look worse than the text reads: models spell numbers out ("elfu moja mia tisa sitini" for 1960) and split compound words. For a Swahili or code-switched team (Nuru), use `openai`; whisper.cpp output in Swahili is not readable. Groq's Whisper models cost about a seventh of `gpt-transcribe` but share Whisper's weak Swahili.

## Agent hand-off

A coding agent gets a piece of feedback as a folder: `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "<server>/api/v1/recordings/<id>/folder" | tar xz` writes `.feedback/<id>/` (README.md first, then feedback.json, spans.jsonl, annotations, keyframes, outline, OCR text, voice, console, network and raw files). A share URL fetched with `Accept: text/markdown`, or with `.md` added, answers a short page whose first line is that command. The folder needs a personal token of a workspace member (Settings, API tokens); a share link reaches the summary only. The same folder is on the MCP server (`get_feedback_folder`, `get_feedback_file`, `resolve_feedback`), and `<server>/api/v1/skill` hands out the Agent Skill (`skills/open-toolbar-feedback/SKILL.md` in the repo).

An agent that should learn from many pieces of feedback at once pulls the bulk export (D-183): `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "<server>/api/v1/feedback/export" | tar xz` writes `.feedback/INDEX.md` and one `.feedback/<id>/` folder per capture, in the per-capture layout. INDEX.md (under about 8k tokens) holds a table of the captures (id, date, reviewer, route, dead, stuck, silent and error spans, failed requests, a one-line summary in the reviewer's words) and digests across them: the routes with the most problems, console errors and failing requests grouped by signature, and the words reviewers repeat, each with pointers into the folders. Query parameters filter it: `workspace` (default the token owner's active workspace), `project`, `folder` (`none` for unfiled), `status` (`unresolved` by default, `resolved`, `all`), `since` and `until` (ISO dates), `kind` (comma separated), `creator` (user id, email or `me`), `limit` (default 50, at most 200). The archive streams: the server builds one folder at a time and never holds the whole archive. A page ends at `limit` captures or at `EXPORT_MAX_MB` of stored media, whichever comes first (always one capture at least); then the `x-next-cursor` response header and the end of INDEX.md carry the cursor of the next page (`&cursor=...`), whose index is written as `INDEX-2.md`, `INDEX-3.md` and so on beside the first. `GET /api/v1/feedback` answers the same page as JSON (each capture's folder URL and pull command), `GET /api/v1/feedback/index` its INDEX.md alone, and the MCP tools `list_feedback` and `get_feedback_index` take the same filters.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `SHARE_LINK_DAYS` | `14` | `30` | Settings > Server, Sharing and export. Days a new share link stays live. A link can be revoked at any time from the share dialog. `0` makes new links never expire (Part 1 behaviour). Links made before a change keep their expiry. Change it when reviewers need links that outlive two weeks. |
| `OCR_BIN` | `tesseract` | `off` | The OCR program that reads canvas regions (terminals, editors and charts drawn on a `<canvas>`) into the folder's `text/`, labeled as OCR. The server image installs tesseract. `off` skips OCR, for example on a small machine where the CPU cost matters. |
| `OCR_LANGS` | `eng` | `eng+swa` | tesseract languages, `+` separated. The image ships English and Swahili: `OCR_LANGS=eng+swa` reads both, at about twice the CPU time. |
| `EXPORT_MAX_MB` | `200` | `50` | Settings > Server, Sharing and export. Size cap of one page of the bulk export (`/api/v1/feedback/export`), in MB of stored media its folders carry (screenshots, keyframes, element crops, the DOM recording, events, voice). A page ends before the capture that would pass it and hands out a cursor for the next page. Lower it when agents pull over slow links or the server is small; the archive is gzipped, so the download is usually smaller. |

Webhooks (Settings, Webhooks) gain two events: `feedback.created` fires with `capture.created` and carries `data.feedback` (`folderUrl`, `pullCommand`, `skillUrl`); `feedback.resolved` fires when someone, or an agent through the API or MCP, marks the feedback resolved, with the note, the commit and who did it in `data.feedback.resolution`.

## Paused features

Paused features stay in the code behind flags that default to off (docs/scope.md, D-098). Off hides their UI, their pages and API routes answer 404 (or 503 for the AI and audit endpoints), and the API docs mark them paused. `/api/health` lists the flags that are on in `features`. None of the deployed compose files passes them: put one in `.env` or use `docker-compose.dev.yml`.

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
| `SMTP_URL` | empty (`smtp://mailpit:1025` in `docker-compose.mail.yml`) | `smtps://user:pass@smtp.example.com:465` | Where mail goes, used only with `FEATURE_EMAIL=1`. Empty: nothing is sent. Read only through `docker-compose.mail.yml`; the default compose file does not pass it. |
| `MAIL_FROM` | `"<app name>" <noreply@<PUBLIC_URL host>>` | `"Acme Review" <review@acme.example>` | The sender. Set it to an address your mail provider lets you send from. |
| `SMTP_PORT` | `1025` | `11025` | `docker-compose.mail.yml` only: host port of Mailpit's SMTP, on `127.0.0.1`. |
| `MAILPIT_UI_PORT` | `8025` | `18025` | `docker-compose.mail.yml` only: host port of Mailpit's inbox, on `127.0.0.1`. |

The default `docker-compose.yml` holds no mail service and no mail settings (docs/scope.md). Mail comes back only with the override file `docker-compose.mail.yml`, which adds Mailpit and sets `FEATURE_EMAIL=1` and `SMTP_URL=smtp://mailpit:1025` on the server: `docker compose -f docker-compose.yml -f docker-compose.mail.yml up -d`, inbox at http://localhost:8025. For a real provider, set `SMTP_URL` and `MAIL_FROM` in `.env` and use the same override (D-171).

## AI text

Paused with `FEATURE_AI` (D-084). With the flag on, any OpenAI-compatible chat endpoint writes chapters, titles and steps; a local Ollama or llama.cpp server works.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `AI_PROVIDER` | `none` | `openai-compatible` | `none` writes nothing and shows the editor's AI switch disabled with a reason. |
| `AI_BASE_URL` | empty | `http://localhost:11434` | The endpoint, with or without `/v1`. |
| `AI_MODEL` | `llama3.2` | `qwen2.5:7b` | The chat model. |
| `AI_API_KEY` | empty | `sk-...` | Bearer token, when the endpoint needs one. |
| `AI_TIMEOUT_MS` | `20000` | `60000` | How long one request may take. Raise it for a slow local model. |

## Injector

The injector (`apps/injector/README.md`, D-157, D-201) adds the toolbar to apps behind it for signed-in reviewers, with no extension and no change to the app. It is a container of its own (`apps/injector/Dockerfile`, Coolify files in `deploy/injector/`, steps in [docs/injector-on-coolify.md](injector-on-coolify.md)). The server issues the reviewer cookies it accepts. Reviewers start from a review link, `<server>/go/<project id>`, which Settings, Projects shows for each origin of a project ("Copy review link", "Open with toolbar"); `https://<app host>/__toolbar/login` leads to the same page.

You set variables in two places: the open-toolbar server (this table) and the injector container (the next table). `INJECTOR_SECRET` goes in both, with the same value.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `INJECTOR_SECRET` | empty | output of `openssl rand -base64 48` | Server and injector container, the same value on both: the HMAC key that signs reviewer cookies, at least 32 characters. It also derives the `X-Open-Toolbar-Pass` value of the Traefik file (`/injector pass-value` prints it). Empty on the server: review links say they are off and no cookie is issued; on a public URL the server refuses a shorter value. Empty on the injector: it logs a warning and passes every request through without the toolbar; shorter than 32 characters: it exits at start. Set it when you deploy the injector; changing it signs every reviewer out of every site and changes the pass value in the Traefik file. |
| `INJECTOR_ORIGINS` | empty | `https://nuru.example.org` | An optional hard allowlist on top of the projects, comma separated: with it set, the server signs a reviewer cookie only for an origin that is both in this list and in a project of the reviewer's workspaces, and review links for other origins say the server does not review that site. Empty: every project origin can be reviewed. Set it to fence the injector to a few apps whatever workspace admins add. |
| `INJECTOR_COOKIE_DAYS` | `7` | `30` | How long a reviewer cookie and its device token last, 1 to 90 days. Each sign-in on a site makes a device token named "Review on <host>" under Settings, Connected browsers; revoking it ends the reviewer's uploads at once and the injection when the cookie expires. |

### Injector container

Read by `apps/injector` (Go), never by the server. Values are trimmed; an empty value means the default. The injector exits at start with a message when a URL is not `http(s)://host` or when none of `INJECTOR_LOOPBACK`, `INJECTOR_UPSTREAMS` and `INJECTOR_UPSTREAM` is set. A request goes to its host's `INJECTOR_UPSTREAMS` entry first, else back into the proxy (`INJECTOR_LOOPBACK`), else to `INJECTOR_UPSTREAM`.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `INJECTOR_LOOPBACK` | empty | `https://coolify-proxy:443` | Loopback mode (D-201): the proxy in front of the injector, as scheme, host and port. The injector sends each reviewer request back there with the original `Host`, the app's host as the TLS server name and no reviewer cookie, and the proxy routes it to the app as it routes everyone else, so the injector needs no list of apps. Use https: Coolify's routers redirect http to https. Coolify's file sets it; change it only when your proxy container has another name or port. |
| `INJECTOR_LOOPBACK_INSECURE` | `0` | `1` | `1` skips the certificate check on the loopback hop. Leave it at `0` when the proxy serves the apps with real certificates (Let's Encrypt on Coolify): the injector checks them against the system roots for each app host. Set `1` only for a proxy with a self-signed certificate, as in the local test (`apps/injector/test/coolify-like/`). |
| `INJECTOR_UPSTREAMS` | empty | `nuru.example.org=http://nuru-app:3000,admin.nuru.example.org=http://nuru-admin:3000` | Explicit mode: `host=url` pairs, comma, space or newline separated, for each public host the app container the injector forwards to. Hosts compare in lower case without the port. A listed host skips the loopback. Use it without a proxy that can route the second pass, or to pin one host to a container. |
| `INJECTOR_UPSTREAM` | empty | `http://nuru-app:3000` | Explicit mode: the app for hosts not listed in `INJECTOR_UPSTREAMS` when `INJECTOR_LOOPBACK` is empty. Enough on its own when the injector fronts one app, as in `apps/injector/test/run.sh`. |
| `TOOLBAR_SERVER_URL` | empty | `https://toolbar.example.org` | The open-toolbar server as the injector container reaches it: its public address works anywhere, an internal one (`http://server-<uuid>:3000`) saves a hop. The injector relays the toolbar's uploads (`/__toolbar/api/...`) there and revokes a reviewer's device token there on "Stop reviewing". Empty: those uploads answer 503, so comments and traces from the page fail. Required in the Coolify file. |
| `TOOLBAR_PUBLIC_URL` | `TOOLBAR_SERVER_URL` | `https://feedback.example.org` | The open-toolbar server as reviewers' browsers reach it (the server's `PUBLIC_URL`). `/__toolbar/login` sends reviewers to its review page. Empty and no `TOOLBAR_SERVER_URL`: the login page answers 503. Set it whenever `TOOLBAR_SERVER_URL` is an internal address. |
| `INJECTOR_TRUST_FORWARDED` | `1` | `0` | `1` reads the scheme and host of each request from `X-Forwarded-Proto` and `X-Forwarded-Host`, which Traefik and most proxies set; the cookie name (`__Host-` on https), the origin check and the upstream choice depend on them. Set `0` when browsers talk to the injector directly, so a client cannot claim another host. |
| `INJECTOR_SCAN_LIMIT` | `262144` (256 KB) | `524288` | Bytes of an HTML page the injector reads looking for `<head>` before it gives up and sends the page unchanged. Raise it for apps that stream a very long preamble before the head; lower values save memory per request. |
| `INJECTOR_LISTEN` | `:8080` | `127.0.0.1:9090` | Address and port the injector listens on, and the container healthcheck calls. Change it when 8080 clashes with something else in the container's network namespace, and update the Traefik file (`deploy/injector/traefik-open-toolbar-injector.yml`) to match. |
| `INJECTOR_ASSETS` | `/srv/toolbar` | `/opt/toolbar` | Folder that holds the page bundle `toolbar.js`, served at `/__toolbar/toolbar.js`. The Dockerfile copies the bundle there; change it only when you build your own image with the bundle somewhere else. |

## Agent side

Read by the coding agent's shell, not by any service: the Agent Skill (`skills/open-toolbar-feedback/SKILL.md`, also served at `<server>/api/v1/skill`) and the pull command on share pages use them. Set them in the environment the agent runs in.

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `TOOLBAR_SERVER` | the server that served the skill (`<server>/api/v1/skill`); empty for the repo copy | `https://feedback.example.com` | Base URL of the open-toolbar server the agent pulls feedback folders from and resolves feedback on. Set it once per agent machine; change it when the server moves. |
| `TOOLBAR_TOKEN` | empty | a personal API token from Settings, API tokens | Bearer token for the folder download and the resolve call. Read access pulls; write access also resolves. Make one per agent and revoke it when the agent no longer needs access. Never commit or print it. |

## Media tools

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `FFMPEG_PATH` | `ffmpeg` on `PATH` (the image installs it) | `/usr/local/bin/ffmpeg` | ffmpeg remuxes recordings and makes thumbnails. Set it when running the server outside the image with ffmpeg elsewhere. |
| `FFPROBE_PATH` | `ffprobe` on `PATH` | `/usr/local/bin/ffprobe` | As above, for ffprobe. |

## Compose

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `COMPOSE_PROFILES` | empty | `whisper` | Docker Compose's own variable: which optional services start. Only the Coolify file has a profile, `whisper`, the local transcriber; with plain compose you add `docker-compose.whisper.yml` instead. |
| `OIDC_MOCK_PORT` | `3311` | `13311` | `docker-compose.dev.yml` only: host port of the mock OIDC provider. The issuer the server and browser share is `http://oidc.localhost:<port>/<any name>`. |

## Coolify

`docker-compose.coolify.yml` is the quickstart for Coolify (docs/scope.md, "Deliverables"). A person types four values; Coolify generates the rest.

| Value | Who sets it |
|---|---|
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `ADMIN_EMAILS` | You. Marked required (`${VAR:?}`), so Coolify asks for them before the first deploy. |
| `SERVICE_URL_SERVER_3000` | Coolify: the server's domain, routed by its proxy to port 3000; `PUBLIC_URL` reads `SERVICE_URL_SERVER` (Coolify fills the name without the port; `${SERVICE_URL_SERVER_3000}` comes through empty). Set your own domain in the server's Domains field as `https://feedback.example.com:3000`. |
| `SERVICE_PASSWORD_64_AUTH` | Coolify: the auth secret (`BETTER_AUTH_SECRET`). |
| `SERVICE_USER_POSTGRES`, `SERVICE_PASSWORD_64_POSTGRES` | Coolify: the Postgres user and password, used by Postgres and in `DATABASE_URL`. |
| `SERVICE_HEX_64_S3SECRET`, `SERVICE_HEX_64_GARAGERPC`, `SERVICE_PASSWORD_64_GARAGEADMIN` | Coolify: Garage's S3 secret key, cluster secret and admin token. |

- No service publishes a host port, and no Traefik labels are set: Coolify's proxy routes the domain.
- Garage is built from `deploy/garage.Dockerfile`, which bakes in `deploy/garage.toml`, so no file has to be bind-mounted from the repository.
- The file passes no optional variable. Set allowed domains, transcription and the rest in Settings > Server. To pin one by environment, add its line to the server's environment in the file (for example `TRANSCRIBE_MONTHLY_MINUTES: ${TRANSCRIBE_MONTHLY_MINUTES}`) and the variable under Environment Variables.
- Local transcription: add `COMPOSE_PROFILES=whisper` under Environment Variables and redeploy, then pick "Local whisper.cpp" in Settings > Server. The server already points `WHISPER_URL` at the service. The whisper service downloads its model on first start and takes a few minutes before Test connection succeeds.

Steps: in Coolify, + New, pick this Git repository, Build strategy "Compose", Docker Compose Location `/docker-compose.coolify.yml`; fill in the four values; Deploy. Register `https://<the server's domain>/api/auth/callback/oidc` with your provider. Sign in with an `ADMIN_EMAILS` address and add your email domains under Settings > Server, Sign-in: until then only `ADMIN_EMAILS` can sign in.

To check the file before a deploy, with only the four values set: `OIDC_ISSUER=https://accounts.google.com OIDC_CLIENT_ID=x OIDC_CLIENT_SECRET=y ADMIN_EMAILS=you@example.com docker compose -f docker-compose.coolify.yml config -q` (it warns about the `SERVICE_*` values, which only Coolify fills in).

## Extension build

These are read when you build the extension, never by a running server ([docs/extension-release.md](extension-release.md)).

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `WXT_SERVER_URL` | `http://localhost:3000` | `https://feedback.example.com` | The server a fresh install points at. Set it for a release your testers install, so they only click Sign in. |
| `WXT_APP_NAME` | `open-toolbar` | `Acme Review` | The extension's name in the manifest, toolbar tooltip and page titles (docs/branding.md). |
| `WXT_APP_ICON` | the packaged rectangle | `brand/logo.svg` | An SVG or PNG the build renders into the packaged icons. |
| `WXT_MANIFEST_KEY` | the open-toolbar Web Store item's public key (id `laobpjhffglefallhhojihfdbdkoendk`) | a fork's Web Store item public key | The public key that pins the extension id of every Chrome build. A fork that publishes its own store item sets it to that item's key, so its builds share that item's id. |
| `WXT_GECKO_ID` | `open-toolbar@self-hosted` | `review@acme.example` | The Firefox add-on id. Use your own when you sign the add-on on AMO, and add it to the server's `EXTENSION_GECKO_IDS`. |
| `RELEASE_TAG` | empty | `v0.2.0` | `scripts/release-extension.sh` refuses to build when this tag's version differs from `apps/extension/package.json`. The release workflow sets it. |
| `FIREFOX` | `1` | `0` | `scripts/release-extension.sh` builds the Firefox zip too unless this is `0`. |
| `WXT_DEV_PORT` | `3001` | `3207` | Port of the extension's dev server (HMR). Area worktrees use their own. |
| `WXT_TEST_HOOKS` | off | `1` | The test build for the e2e suites: open shadow root and `globalThis.__tb`. Never ship it. |
| `WXT_OUT_SUFFIX` | empty | `-121` | With `WXT_TEST_HOOKS`, a suffix for the output folder so several test builds sit side by side. |

An installed extension finds its server in this order (D-202): the admin's managed policy (`serverUrl` in the Admin console's "Policy for extensions", read from `chrome.storage.managed`), then the address typed on the options page, then `WXT_SERVER_URL` from the build, then `http://localhost:3000`. The policy's `lockServerUrl: true` hides "Use another server" and makes the options page read-only. `docs/extension-release.md`, "Force-install for your organisation (Google Workspace)", has the policy JSON.

## Development and internal

| Variable | Default | Example | Purpose and when to change |
|---|---|---|---|
| `DEV_PORT` | `3000` | `3107` | Port of `pnpm dev:server` (Vite). Area worktrees use their own (`docs/parallel.md`). |
| `SERVER_URL` | `PUBLIC_URL` | `http://localhost:3107` | The server `apps/server/scripts/check-server-core.ts` and the e2e suites talk to. |
| `PROTOCOL_HEADER` | set by `server.js` | `x-toolbar-origin-proto` | Internal: `server.js` sets it so adapter-node takes the protocol from `PUBLIC_URL`. Do not set it. |
| `HOST_HEADER` | set by `server.js` | `x-toolbar-origin-host` | Internal: as above, for the host. Do not set it. |
