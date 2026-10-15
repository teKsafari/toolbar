# open-toolbar

Give rough software detailed feedback and let your coding agent turn it into fixes. A browser extension records what you saw and did on a web page: session recordings, DOM screenshots, annotations, voice notes, and the console and network traces behind them. Your agent reads all of it over MCP, an HTTP API or signed webhooks, and can learn from many pieces of feedback what the product is meant to be.

Open source (MIT) and self-hosted. Admins set the instance's name, logo and accent colour (`APP_NAME`, `APP_LOGO_URL`, `APP_ACCENT`, or Settings > Server); see `docs/branding.md`.

## Self-host

```sh
scripts/gen-secrets.sh https://feedback.example.com   # writes .env with PUBLIC_URL and random secrets
$EDITOR .env                                          # OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, ALLOWED_EMAIL_DOMAINS
docker compose up -d --build                          # server on :3000, Postgres, Garage S3, whisper.cpp
curl -s localhost:3000/api/health
```

Put a TLS proxy in front of port 3000. On Coolify, deploy `docker-compose.coolify.yml` from this repository; Coolify generates the secrets and asks for the four sign-in values. `docs/configuration.md` documents every variable.

The extension: `scripts/release-extension.sh` writes versioned zips to `dist/` (load the `-chrome.zip` unpacked, or upload the `-chrome-webstore.zip` as an unlisted Chrome Web Store item); see `docs/extension-release.md`. For development, `docs/dev.md` explains the mock OIDC provider and the dev-only password sign-in.

## Docs

- `docs/configuration.md`: every environment variable, the basic deployment and Coolify
- `docs/extension-release.md`: extension zips, the Chrome Web Store item and its id, Firefox
- `docs/dev.md`: running each part, ports, builds, tests and the e2e suites
- `docs/branding.md`: instance name, logo, accent colour and the branded extension build
- `docs/status.md`: what is built and how each task was checked
- `PLAN.md` and `PROGRESS.md`: the plan and where work stands
