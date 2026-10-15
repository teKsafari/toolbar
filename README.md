# open-toolbar

Give rough software detailed feedback and let your coding agent turn it into fixes. A browser extension records what you saw and did on a web page: session recordings, DOM screenshots, annotations, voice notes, and the console and network traces behind them. Your agent reads all of it over MCP, an HTTP API or signed webhooks, and can learn from many pieces of feedback what the product is meant to be.

Open source (MIT) and self-hosted. Admins set the instance's name, logo and accent colour (`APP_NAME`, `APP_LOGO_URL`, `APP_ACCENT`, or Settings > Server); see `docs/branding.md`.

## Start

```sh
docker compose up --build -d       # server on :3000, Postgres, Garage S3, whisper.cpp
curl -s localhost:3000/api/health
pnpm install && pnpm --filter @toolbar/extension build   # then load apps/extension/.output/chrome-mv3 unpacked
```

Sign-in goes through one OIDC provider that you configure (`docs/dev.md` explains the mock provider and the dev-only password sign-in).

## Docs

- `docs/dev.md`: running each part, ports, builds, tests and the e2e suites
- `docs/branding.md`: instance name, logo, accent colour and the branded extension build
- `docs/status.md`: what is built and how each task was checked
- `PLAN.md` and `PROGRESS.md`: the plan and where work stands
