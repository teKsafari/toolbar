# Configuration

The server reads its settings from environment variables. `docker-compose.yml` passes each one through, and `.env.example` lists them all with their defaults. This page covers sign-in, mail, transcription and the paused features in depth. The other variables are described in `.env.example` until this page covers them too.

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

## Transcription

Voice audio becomes a WebVTT transcript on the server: the microphone track of a recording or a trace, and each voice note attached to a comment (D-087). Viewers see it as captions and under the comment, and agents read it over MCP and the HTTP API.

You choose one of three providers with `TRANSCRIBE_PROVIDER`:

- `local` (default): whisper.cpp in the `whisper` compose service. No key, no cost, and no audio leaves your server. Good for English; Swahili comes out unusable.
- `openai`: an OpenAI-compatible endpoint, by default OpenAI's `gpt-transcribe`. Needs a key. Much better on Swahili and mixed Swahili and English, and faster than whisper.cpp on a CPU. It costs money and sends the voice audio to the provider.
- `none`: no transcripts.

To use OpenAI, set two variables and restart the server:

```sh
TRANSCRIBE_PROVIDER=openai
OPENAI_API_KEY=sk-...            # or TRANSCRIBE_API_KEY, which wins when both are set
```

Setting a key alone changes nothing: the provider switches only when you set `TRANSCRIBE_PROVIDER=openai`. With `openai` and no key for `api.openai.com`, transcription is off and the server log says why. The `whisper` service keeps running with the hosted provider; nothing calls it.

| Variable | Default | Purpose |
|---|---|---|
| `TRANSCRIBE_PROVIDER` | `local` | `local`, `openai` or `none`. The older `whispercpp` and `openai-compatible` mean `local` and `openai`. |
| `TRANSCRIBE_MODEL` | `gpt-transcribe` | Model id for `openai`. `whisper-1` also works on OpenAI; Groq takes `whisper-large-v3-turbo`. |
| `TRANSCRIBE_API_KEY` | `OPENAI_API_KEY` | Bearer token for `openai`. A self-hosted endpoint such as speaches may need none. |
| `TRANSCRIBE_BASE_URL` | `https://api.openai.com/v1` | The endpoint, `/v1` included; the server posts to `<base>/audio/transcriptions`. Groq: `https://api.groq.com/openai/v1`. |
| `TRANSCRIBE_LANGUAGE` | empty (detect) | ISO 639-1 codes, comma separated (`sw,en`). Leave empty for mixed-language narration: the Swahili hint gave no measurable gain. |
| `TRANSCRIBE_TIMESTAMPS` | `auto` | `chunked` cuts the audio at pauses and times the text on the server; `native` asks the endpoint for WebVTT; `auto` uses `chunked` for `gpt-*` models, else tries `native` and switches to `chunked` when the endpoint refuses WebVTT. |
| `TRANSCRIBE_CHUNK_SECONDS` | `30` | Longest chunk sent in one request. `12` gives cues about half a second closer to the speech for about 4% more billed audio and slightly worse text. |
| `TRANSCRIBE_MAX_MINUTES` | `60` | Longer audio is not transcribed; its transcript says "skipped" with the reason. Applies to every provider. |
| `TRANSCRIBE_MONTHLY_MINUTES` | empty (no cap) | Hosted audio per calendar month (UTC). Past it, transcripts are skipped with "monthly limit" until the month turns. `local` does not count. |
| `TRANSCRIBE_CONCURRENCY` | `4` | Chunk requests in flight per recording. |
| `WHISPER_MODEL` | `base` | The whisper.cpp model for `local`. `small` is more accurate and about three times slower. |
| `WHISPER_URL` | `http://whisper:8080` in compose | Where the server reaches whisper.cpp. |

The older `STT_URL` (a base without `/v1`), `STT_API_KEY` and `STT_MODEL` still work when the new names are unset.

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

The injector (`apps/injector/README.md`, D-134) adds the toolbar to apps behind it for signed-in reviewers, with no extension and no change to the app. The server issues the reviewer cookies it accepts.

| Variable | Default | Purpose |
|---|---|---|
| `INJECTOR_SECRET` | empty | HMAC key shared with the injector container, at least 32 characters (`openssl rand -base64 48`). Empty or shorter: `/review/start` answers 404 and no cookie is issued. Set the same value on both. |
| `INJECTOR_ORIGINS` | empty | The app origins behind the injector, comma separated, for example `https://nuru.example.org`. The server signs cookies for these origins only. Empty: the origins of the projects (Settings, Projects) in the reviewer's own workspaces. |
| `INJECTOR_COOKIE_DAYS` | `7` | How long a reviewer cookie and its device token last, 1 to 90 days. Each sign-in on a site makes a device token named "Review on <host>" under Settings, Connected browsers; revoking it ends the reviewer's uploads at once and the injection when the cookie expires. |

Reviewers start at `https://<app host>/__toolbar/login`. The injector's own variables (`INJECTOR_UPSTREAMS`, `TOOLBAR_SERVER_URL`, `TOOLBAR_PUBLIC_URL` and others) and the Coolify setup are in `apps/injector/README.md`.
