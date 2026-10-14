# Skip list

Catalogue features that the replica does not build, with the reason. IDs refer to `docs/jam/catalogue.md`; the build plan for every other row is in `docs/tasks.md`.

No P0 or P1 row is skipped whole. Where a cheap generic equivalent exists, the replica builds it and the row below names it.

## Whole rows

| ID | Pri | Feature | Reason | What we build instead |
|---|---|---|---|---|
| J-023 | P2 | Mac app recorder | Owner decision D-016: browser extension and web app only. | Desktop recording in the extension (J-007). |
| J-024 | P2 | iOS app recorder | Owner decision D-016. | Nothing. |
| J-076 | P2 | Sentry, FullStory and LogRocket session links | Each needs an account with that vendor and its SDK on the page, and the link format belongs to their hosted products. We have no such accounts to build or test against. | Console errors and stacks from our own capture cover the same ground. |
| J-141 | P2 | Slack unfurls and Linear or Notion embeds | Slack unfurls need a Slack app with a public HTTPS events URL; Linear and Notion embeds need their partner unfurl programs. A self-hosted server on localhost has neither. | Posting to Slack at create through an incoming webhook URL (J-137). |
| J-143 | P2 | Connect your domain for recording links | Works only when the site loads the vendor's page scripts, and PLAN.md Part 2 forbids any script tag or package in the app (zero integration). Part 2's injector covers this need. | Recording links stay video only, matching Jam's default-domain state (J-206, J-232 red dot). |
| J-144 | P2 | Help-desk flows (Intercom Fin, Zendesk, Freshdesk, HubSpot) | Each needs a paid help-desk account and a listed app in that vendor's marketplace. | Recording links (J-015, J-017) and webhooks (J-142) let any help desk request and receive recordings. |
| J-157 | P2 | Listing in Claude's connector directory and ChatGPT's app directory | Directory listings are approved by Anthropic and OpenAI for public services; a self-hosted instance cannot be listed. | The MCP server URL works as a custom connector in both (J-145, J-146). |
| J-174 | P2 | Billing and usage | Owner: no paid tiers and no seat limits (PLAN.md Part 2). | Nothing. |
| J-192 | P2 | Auto-blur and sanitizers on connected domains | Depends on J-143's page scripts, skipped above for the zero-integration rule. | Redaction in the isolated world (J-185 to J-187) and manual blur (J-031, J-044). Part 2 adds masking presets. |
| J-208 | P2 | Plan limit states | Owner: no paid tiers, so there are no limits to show. | Nothing. |

## Parts of rows

The row is built; only the part named here is left out.

| ID | Pri | Part skipped | Reason | What we build instead |
|---|---|---|---|---|
| J-079, J-137, J-139, J-140 | P0, P1, P1, P1 | Jira, Linear, ClickUp, Notion, Azure DevOps and Asana as destinations and integrations | Each needs a registered OAuth app and a workspace on that vendor (several paid for API use or admin consent), plus a public redirect URL. We cannot get or test them. The destination menu and the send-to-app flow are P0/P1 and stay. | GitHub and GitLab issues through a personal access token (repo, labels, assignee, milestone), Slack through an incoming webhook URL, and signed outgoing webhooks for anything else. |
| J-139 | P1 | Sentry and Fin tiles | Same as J-076 and J-144. | - |
| J-013 | P1 | Upgrade card near the recording cap; 5-minute free cap | Owner: no paid tiers. | An optional server setting `MAX_RECORDING_MIN` (off by default) drives the same orange and red timer states and the stop. |
| J-136 | P1 | Plan-limit-reached email toggle | No plans, so no limit. | The other four email toggles. |
| J-156 | P2 | AI quota per plan | No plans. | The workspace AI switch. AI runs behind an `openai-compatible` provider, which a local Ollama server satisfies, so it needs no paid account. |
| J-160 | P1 | Fin, iOS and Mac values in the source filter | Those sources are skipped (J-144, D-016). | Sources extension, recording link, upload and CLI. |
| J-170 | P2 | Chat launcher on every page; pricing link | The launcher is a third-party support chat (a paid account); there is no pricing. | Help menu with docs, source repository, issue tracker and install links. |
| J-178 | P2 | SCIM directory sync; forced install through Google Admin | SCIM needs an enterprise identity provider tenant; forced install needs a paid Google Workspace admin and a store listing. | SSO through Better Auth generic OIDC (J-217), audit log and auto-delete schedule. |
| J-217 | P0 | Sign in with Apple | Needs an Apple Developer Program membership (paid, yearly) to create the Services ID and key. Sign-in itself is P0 and stays. | GitHub, Google, any generic OIDC provider and email magic link (Mailpit in dev). |
| J-232 | P2 | Green dot for a connected recorder domain | Follows from J-143. | The red default-domain dot and its menu. |
| all mobile and desktop app rows | - | Jam's mobile apps and desktop app, and features that exist only in them | Owner decision D-016: browser extension and web app only. | - |
