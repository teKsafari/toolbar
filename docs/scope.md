# Scope (owner, 2026-10-14)

## This is not a product

open-toolbar is open-source software (MIT) that you self-host. Nobody sells it, and nothing in it exists to sell, retain or manage customers. Leave out anything that only makes sense for a commercial product: plans, quotas, upsells, engagement mail, AI features, data-retention policies, audit logs. When a Jam feature exists to run a business rather than to record feedback or hand it to an agent, pause it.

## Name and pitch

- Name: **open-toolbar** (inspired by the Vercel Toolbar). Default logo: a filled rectangle. Admins can set their own name and logo (D-074, `docs/research/branding.md`).
- Pitch, for the README (to be polished in our own words): evolve rough software by giving it detailed feedback: session recordings, DOM screenshots, annotations, voice notes, console and network traces. All of it is reachable over MCP, an HTTP API and webhooks. Let your agent learn from many pieces of feedback to distil what the product is meant to be, and document it. Open source, MIT, self-hosted.

Read this before building, testing or comparing anything. It overrides the Jam catalogue where they conflict (D-078 to D-082).

## What the product is

A place to record feedback on a web app, and a way for a coding agent to get that feedback. The team already lives in Linear, GitHub and its chat tool. The product does not try to keep people inside it, so it sends no notifications and connects to nothing beyond the three channels below.

## Agent and system access: exactly three channels

1. MCP server (remote, OAuth or token).
2. HTTP API (documented, token auth), including the feedback-folder download (`curl ... | tar xz`).
3. Outgoing webhooks (signed).

## Paused (hidden, kept in the code, not a priority)

Paused features stay in the repository behind feature flags that default to off. Their UI is hidden, their docs say "paused", tests that cover them are skipped by default, and parity treats their rows as "paused" rather than as gaps. Do not delete their code and do not spend time on them.

| Feature | Rows | Flag |
|---|---|---|
| GitHub and GitLab issue integrations, tracker destination picker, send to app, linked-issue fields | J-079, J-137, J-138, J-139, J-140, J-241, J-242, J-251 | `FEATURE_TRACKERS` |
| Slack incoming webhook | part of J-137, J-139 | `FEATURE_SLACK` |
| Command-line tool (`nib`/`toolbar` CLI) and its settings page | J-155, J-244, J-245, J-246, J-247 | `FEATURE_CLI` |
| Every notification email: first view, shared with me, recording link used, same-domain join, mention, invite mails | J-136, mail parts of J-122, J-123, J-125, J-135 | `FEATURE_EMAIL` |
| AI features: AI title and repro steps, ghost title, AI chapters and the chapters menu, workspace AI switch and quotas | J-075, J-083, J-096, J-156, J-230 | `FEATURE_AI` |
| Data-retention settings and audit logs | parts of J-172 | `FEATURE_ADMIN_EXTRAS` |
| Sign-in with Google or GitHub social buttons, magic link, email and password | J-217 (provider list) | `AUTH_DEV_PASSWORD` (dev and tests only) |

Kept: in-app @mentions (no mail), invites by link, joining by allowed email domain, webhooks (J-142).

## Transcription

Voice notes are transcribed on the server behind the `Transcriber` interface. Two providers:

- Local whisper.cpp (default, CPU, no key, no data leaves the server).
- A hosted, economical OpenAI-compatible speech-to-text model, chosen for quality per cost (not the most expensive model), enabled by setting an API key. It is better at multilingual audio (Swahili for Nuru) and faster than CPU whisper, but it has limits on file size, length and cost that the docs must state; long audio is split into chunks. Research: `docs/research/transcription.md`.

## Sign-in

- One generic OIDC provider, configured by the admin through environment variables (issuer or discovery URL, client ID, client secret). Google Workspace works through it: Google is a standard OpenID Connect provider (discovery at `https://accounts.google.com/.well-known/openid-configuration`). No Google-specific provider is needed.
- Access is limited by an allowlist of email domains (and Google's `hd` hosted-domain claim when present). Group-based allowlists are out of scope: Google does not put groups in the ID token.
- Development and e2e tests sign in through a mock OIDC server in a `dev` compose profile, which exercises the real OIDC path. Email and password login exists only behind `AUTH_DEV_PASSWORD=1`, off by default.
- No SMTP. Mailpit and mail settings leave the default compose file; the mail code stays behind `FEATURE_EMAIL`.

## Deliverables at the end

1. A release of the browser extension (versioned zip ready for the Chrome Web Store unlisted item, plus the unpacked build).
2. `docker-compose.yml`: the simplest self-hosted deployment, working with defaults plus the few required values.
3. `docker-compose.coolify.yml`: the same stack shaped for Coolify (its magic environment variables, no host port bindings, Traefik labels left to Coolify).

## Configuration

- The basic deployment needs only the required values: public URL, auth secret, OIDC issuer, client ID and secret, allowed email domains. Everything else has a working default.
- `docs/configuration.md` documents every variable in depth: purpose, default, example, when to change it.

## Site access (owner, 2026-10-17)

- The extension runs only on sites listed in projects. Clicking its icon on another site offers one line to add that host to a project.
- The toolbar has a close button; it stays closed on that site until the extension icon is clicked.
- The all-sites mode with automatic projects stays available as an admin setting, off by default.
