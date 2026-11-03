# open-toolbar

Self-hosted feedback capture for web apps. Reviewers record session replays, DOM screenshots, page annotations, voice notes, and the console and network traces underneath. Your coding agent reads all of it over MCP, an HTTP API or signed webhooks, one piece of feedback at a time or many at once to work out what the product is meant to be and write it down.

MIT licensed. No plans, seats, paid tiers or notifications.

![The reviewer toolbar on Nuru, with a highlighted line of output and a comment being typed](docs/demo/03-highlight-comment.png)

`DEMO.md` has screenshots and a 2:44 video: a reviewer traces a lesson on Nuru, then Claude Code fixes the bug from the feedback folder.

## Features

- **Annotations**: comment on an element, highlight text, draw, or screenshot one element and mark it up. Each note carries a locator: route, candidate route files (SvelteKit, Next.js), visible text, role, ids, classes, nearest heading and a crop.
- **Voice notes**, per comment or per trace, transcribed to WebVTT on the server.
- **Traces**: one tab recorded as interaction spans, each ending in `changed`, `error`, `dead`, `stuck` or `silent`, with keyframes on route changes, annotations and layout shifts. Stop keeps a trace instead of sending it: record several, write what the agent should notice in each (a nav bar that hides on scroll, a flow that feels wrong with no error behind it), add context for the whole session, then send them together. Comments outside a trace still carry the last 60 seconds of console errors and failed requests.
- **Recordings**: screenshot, tab or screen video, instant replay, and recording links for people without the extension.
- **Viewer**: replay, notes, console, network, actions and an Agent tab per capture. Share links expire after 14 days and can be revoked.
- **Agent hand-off**: one folder per piece of feedback, or a bulk export with an index.

## Quick start

Requires Docker Compose and an OIDC provider.

```sh
git clone <this repository> open-toolbar && cd open-toolbar
scripts/gen-secrets.sh https://feedback.example.com   # writes .env: PUBLIC_URL and random secrets
$EDITOR .env                                          # OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, ADMIN_EMAILS
docker compose up -d --build                          # server on :3000, Postgres, Garage S3
```

Required values: `PUBLIC_URL`, `BETTER_AUTH_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `ADMIN_EMAILS`. Register `<PUBLIC_URL>/api/auth/callback/oidc` with the provider and put a TLS proxy in front of port 3000. The server refuses to start on a public URL with dev secrets.

Allowed email domains, transcription, branding and limits live in Settings > Server after the first admin sign-in. Until a domain is added, only `ADMIN_EMAILS` can sign in. Local transcription: add `-f docker-compose.whisper.yml` to the compose command.

## Coolify

Deploy `docker-compose.coolify.yml` as a Docker Compose resource. Coolify generates every secret and asks for four values: `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `ADMIN_EMAILS`. Set the server's domain as `https://feedback.example.com:3000`; no service publishes a host port. `COMPOSE_PROFILES=whisper` adds local transcription.

## Extension

Chrome Web Store item `laobpjhffglefallhhojihfdbdkoendk` (unlisted). `scripts/release-extension.sh` builds the same id as an unpacked zip in `dist/`; set `WXT_SERVER_URL` at build time to preconfigure the server. Managed policy keys: `serverUrl` (string) and `lockServerUrl` (boolean). Release, force-install and Firefox: [docs/extension-release.md](docs/extension-release.md).

The extension holds all-sites access as a required permission but runs only on origins listed in projects (`SITE_ACCESS=projects`, the default). Click its icon on another site to add it to a project. `SITE_ACCESS=all` runs it everywhere, one project per captured origin. The toolbar's X hides it on a site until you click the icon there. Ctrl+Shift+. opens the toolbar; `c` comment, `t` comment on selection, `v` voice note, `x` start or stop a trace, `l` the traces and notes waiting to be sent.

## Agent access

Create a token under Settings > API tokens and export `TOOLBAR_SERVER` and `TOOLBAR_TOKEN`.

- **MCP**: `$TOOLBAR_SERVER/mcp`, OAuth or token. `claude mcp add --transport http open-toolbar $TOOLBAR_SERVER/mcp`. Tools: `get_feedback_folder`, `get_feedback_file`, `resolve_feedback`, `list_feedback`, `get_feedback_index`.
- **One capture**: `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "$TOOLBAR_SERVER/api/v1/recordings/<id>/folder" | tar xz` writes `.feedback/<id>/`, with `README.md` as the entry point. A share link fetched as Markdown starts with this command.
- **Bulk export**: `curl -fsSL -H "Authorization: Bearer $TOOLBAR_TOKEN" "$TOOLBAR_SERVER/api/v1/feedback/export" | tar xz` writes `.feedback/INDEX.md` and one folder per capture. Filters: `project`, `status`, `since`, `creator` and others.
- **Agent Skill**: `curl -fsSL --create-dirs "$TOOLBAR_SERVER/api/v1/skill" -o .claude/skills/open-toolbar-feedback/SKILL.md` (Claude Code, opencode) or `.agents/skills/open-toolbar-feedback/SKILL.md` (Codex, opencode). It pulls, fixes and resolves one capture, or turns the bulk export into a product brief.
- **Webhooks**: Settings > Webhooks sends signed `feedback.created` and `feedback.resolved` events.

Results from Claude Code, Codex and opencode on real bugs: `docs/agent-handoff-results.md`.

## Privacy

- The extension redacts before upload: auth, cookie and key-like headers, password and token fields, JWTs, email addresses and card numbers.
- Each project has a masking preset: **Staging, own team** (text unmasked, bodies for the app's own API) or **Production** (text and inputs masked, media blocked, bodies only for allowlisted URLs).
- Hosted transcription sends only microphone audio to the provider. `local` (whisper.cpp) sends nothing.
- Share links carry a 128-bit token, send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`, and expose a summary only. The full folder needs a workspace member's token.

## Configuration

[docs/configuration.md](docs/configuration.md) lists every variable with its default and where it lives. Instance settings set by variable lock the matching Settings > Server field. Other docs:

- `docs/branding.md`: name, logo, accent, branded extension builds
- `docs/extension-release.md`: zips, store item, managed policy, Firefox
- `docs/scope.md`: what is in scope and what is paused (trackers, Slack, CLI, mail, AI text)
- `docs/dev.md`: layout, ports, dev stack, tests
- `docs/architecture.md`, `docs/decisions.md`: design and decision log

## Development

```sh
pnpm install
pnpm stack        # Postgres, Garage, whisper, mock OIDC in Docker
pnpm dev          # server on :3000, extension watch build
pnpm -r test
```

## License

MIT. See `LICENSE`.
