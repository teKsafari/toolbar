# Configuration

The server reads its settings from environment variables. `docker-compose.yml` passes each one through, and `.env.example` lists them all with their defaults. This page covers sign-in, mail and the paused features in depth. The other variables are described in `.env.example` until this page covers them too.

## Sign-in

open-toolbar signs people in through one OpenID Connect provider that you register it with (docs/scope.md, D-080, D-114). The server is the OIDC client: browsers and the extension never hold the client secret. The extension signs in through the server (`chrome.identity.launchWebAuthFlow` on `/ext/connect`), so it needs no settings of its own.

Required for a real deployment: `OIDC_ISSUER` (or `OIDC_DISCOVERY_URL`), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `ALLOWED_EMAIL_DOMAINS`.

| Variable | Default | Purpose |
|---|---|---|
| `OIDC_ISSUER` | empty | The provider's issuer URL. The server fetches `<issuer>/.well-known/openid-configuration`. Stored on every capture and comment as the author's issuer. |
| `OIDC_DISCOVERY_URL` | `<OIDC_ISSUER>/.well-known/openid-configuration` | The discovery document, when it lives somewhere else. Wins over `OIDC_ISSUER` for discovery. |
| `OIDC_CLIENT_ID` | empty | The client id from the provider. Without it the provider is off. |
| `OIDC_CLIENT_SECRET` | empty | The client secret. The server also sends PKCE. |
| `OIDC_SCOPES` | `openid email profile` | Space or comma separated. `email` is needed: the allowlist reads the address. |
| `OIDC_PROVIDER_NAME` | `Google` for `accounts.google.com`, else `SSO` | The login button reads "Sign in with <name>". |
| `OIDC_PROVIDER_ID` | `oidc` | The id in the callback path. Changing it after people signed in leaves their accounts unlinked. |
| `ALLOWED_EMAIL_DOMAINS` | empty (any address) | Comma separated domains that may sign in and submit feedback; subdomains count (`acme.com` admits `eu.acme.com`). |
| `AUTH_DEV_PASSWORD` | off | `1` adds email and password sign-in. For development and tests only. |
| `AUTH_RATE_LIMIT` | on in production | `off` for an e2e run, whose test accounts all sign in from one address. |
| `AUTH_MAGIC_LINK` | on with `FEATURE_EMAIL` | The emailed sign-in link exists only while mail is on; `0` keeps it off then. |

The redirect URI to register with the provider is `<PUBLIC_URL>/api/auth/callback/<OIDC_PROVIDER_ID>`, so `https://feedback.example.com/api/auth/callback/oidc` by default.

The older names still work: `OIDC_1_ID`, `OIDC_1_NAME`, `OIDC_1_DISCOVERY_URL`, `OIDC_1_CLIENT_ID`, `OIDC_1_CLIENT_SECRET` and `OIDC_1_SCOPES` when `OIDC_CLIENT_ID` is unset, and `AUTH_ALLOWED_DOMAINS` when `ALLOWED_EMAIL_DOMAINS` is unset.

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

The button reads "Sign in with Google". No Google-specific provider is involved: Google is a standard OpenID Connect provider.

### Other providers

Any provider with a discovery document works: Keycloak (`OIDC_ISSUER=https://kc.example.com/realms/<realm>`), Authentik, Okta, Microsoft Entra ID (`https://login.microsoftonline.com/<tenant>/v2.0`), GitLab and others. Set `OIDC_PROVIDER_NAME` to the name people know.

### Development

The `dev` compose profile runs a mock provider on `http://oidc.localhost:3311` that signs in anyone with any claims. See `docs/dev.md`.

```sh
OIDC_ISSUER=http://oidc.localhost:3311/toolbar OIDC_CLIENT_ID=toolbar OIDC_CLIENT_SECRET=dev \
OIDC_PROVIDER_NAME="Dev SSO" docker compose --profile dev up -d
```

## Mail

open-toolbar sends no mail by default (docs/scope.md, D-079). Invites work by link: the invite dialog copies a person's own invite link for you to send. Mentions show in the app.

| Variable | Default | Purpose |
|---|---|---|
| `FEATURE_EMAIL` | off | `1` turns the paused mail back on: invites, mentions, first views, recording-link uploads, domain joins, the magic link. |
| `SMTP_URL` | empty | Where mail goes, for example `smtps://user:pass@smtp.example.com:465`. Empty: nothing is sent, even with `FEATURE_EMAIL=1`. |
| `MAIL_FROM` | `"<app name>" <noreply@<PUBLIC_URL host>>` | The sender. |

For development, the `mail` compose profile runs Mailpit: `FEATURE_EMAIL=1 SMTP_URL=smtp://mailpit:1025 docker compose --profile mail up -d`, inbox at http://localhost:8025.

## Paused features

Paused features stay in the code behind flags that default to off (docs/scope.md, D-098). Off hides their UI, their pages and API routes answer 404 (or 503 for the AI and audit endpoints), and the API docs mark them paused. `/api/health` lists the flags that are on in `features`.

| Variable | What it brings back |
|---|---|
| `FEATURE_TRACKERS` | GitHub and GitLab issue integrations, the editor's destination picker, send to app, linked issues |
| `FEATURE_SLACK` | The Slack incoming webhook, in settings and as an editor destination |
| `FEATURE_CLI` | The `open-toolbar` command-line tool, its settings page and pointers |
| `FEATURE_EMAIL` | Every notification and invite mail (see Mail) |
| `FEATURE_AI` | AI titles and steps, chapters, the workspace AI switch |
| `FEATURE_ADMIN_EXTRAS` | Data retention (auto-delete) and the audit log |

## Injector

The injector (`apps/injector/README.md`, D-123) adds the toolbar to apps behind it for signed-in reviewers, with no extension and no change to the app. The server issues the reviewer cookies it accepts.

| Variable | Default | Purpose |
|---|---|---|
| `INJECTOR_SECRET` | empty | HMAC key shared with the injector container, at least 32 characters (`openssl rand -base64 48`). Empty or shorter: `/review/start` answers 404 and no cookie is issued. Set the same value on both. |
| `INJECTOR_ORIGINS` | empty | The app origins behind the injector, comma separated, for example `https://nuru.example.org`. The server signs cookies for these origins only. |
| `INJECTOR_COOKIE_DAYS` | `7` | How long a reviewer cookie and its device token last, 1 to 90 days. Each sign-in on a site makes a device token named "Review on <host>" under Settings, Connected browsers; revoking it ends the reviewer's uploads at once and the injection when the cookie expires. |

Reviewers start at `https://<app host>/__toolbar/login`. The injector's own variables (`INJECTOR_UPSTREAMS`, `TOOLBAR_SERVER_URL`, `TOOLBAR_PUBLIC_URL` and others) and the Coolify setup are in `apps/injector/README.md`.
