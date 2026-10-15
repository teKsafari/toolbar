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

The extension installs with access to your server only and adds nothing to the apps you review. A workspace admin lists each app under Settings > Projects with its origins and a masking preset (staging or production). After sign-in, open the extension's popup on one of those apps and click Allow: the extension records there and on your other project origins, and nowhere else.

## Hand feedback to your agent

Create a personal token under Settings > API tokens and give your agent two variables, `TOOLBAR_SERVER` and `TOOLBAR_TOKEN`. One command pulls a piece of feedback into the repo as a folder of files the agent can read:

```sh
curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "$TOOLBAR_SERVER/api/v1/recordings/<id>/folder" | tar xz
```

You get `.feedback/<id>/`. The agent reads `README.md` first: who reported what, the reviewer's words, the actions that had no effect, and a timeline that names the screenshot for each moment. A share link answers the same command as its first line when an agent fetches it as markdown. Install the Agent Skill from `skills/open-toolbar-feedback/SKILL.md` (or `$TOOLBAR_SERVER/api/v1/skill`) so Claude Code, Codex or opencode follow that path and mark the feedback resolved when the fix is in. The MCP server at `/mcp` serves the same folder.

## Docs

- `docs/dev.md`: running each part, ports, builds, tests and the e2e suites
- `docs/branding.md`: instance name, logo, accent colour and the branded extension build
- `docs/configuration.md`: every setting, sign-in and the agent hand-off
- `docs/status.md`: what is built and how each task was checked
- `PLAN.md` and `PROGRESS.md`: the plan and where work stands
