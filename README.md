# Nib

A bug capture tool: a Chrome extension records a tab, the screen or a screenshot with the console, network and user actions, and a self-hosted server stores the capture behind a share link that a person or a coding agent can read.

Nib is the working product name; the repo and package scope are `toolbar`.

## Start

```sh
docker compose up --build -d       # server on :3000, Postgres, Garage S3, Mailpit, whisper.cpp
curl -s localhost:3000/api/health
pnpm install && pnpm --filter @toolbar/extension build   # then load apps/extension/.output/chrome-mv3 unpacked
```

Sign in at http://localhost:3000 with any email and a password of 8 or more characters. Mail lands in Mailpit at http://localhost:8025.

## Docs

- `docs/dev.md`: running each part, ports, builds, tests and the e2e suites
- `docs/status.md`: what is built and how each task was checked
- `PLAN.md` and `PROGRESS.md`: the plan and where work stands
