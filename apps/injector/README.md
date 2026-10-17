# Injector

Go reverse proxy that adds one script tag to the `<head>` of an app's HTML pages for signed-in reviewers (D-157, D-201). Optional: the default deployment does not run it. Traefik sends it only reviewers' requests; it sends them back into Traefik, which routes them to the app.

Coolify setup: [docs/injector-on-coolify.md](../../docs/injector-on-coolify.md).

## Two modes

- **Loopback** (`INJECTOR_LOOPBACK`, D-201), for Coolify and any Traefik in front of many apps. The injector forwards each request back to the proxy with the original `Host`, that host as the TLS server name (so the proxy's certificate for the app is checked against the system roots; `INJECTOR_LOOPBACK_INSECURE=1` for a self-signed proxy), HTTP/1.1 (WebSocket upgrades pass), the `X-Forwarded-*` headers kept and this hop added, no reviewer cookie and `Via: 1.1 open-toolbar-injector`. Without the cookie the second pass misses the injector router and takes the app's own router. A request that comes back with the injector's `Via` token is answered 508, so a request passes the injector at most once. The injector needs no list of apps.
- **Explicit** (`INJECTOR_UPSTREAMS`, `INJECTOR_UPSTREAM`): the injector forwards to app containers you list by host. A host listed there skips the loopback. The plain compose test (`test/run.sh`) uses it.

## What it does

| Request | What the injector does |
|---|---|
| A page load (`GET`, `Sec-Fetch-Dest: document` or none) with a valid reviewer cookie | Asks the app for an uncompressed body (`Accept-Encoding: identity`) and the full page (drops `If-None-Match` and `If-Modified-Since`), then streams the HTML through `golang.org/x/net/html`'s tokenizer and adds `<script src="/__toolbar/toolbar.js?v=<hash>" nonce="...">` right after `<head>`, or before the first element of an implied head. Every other byte goes out as the app sent it. |
| The same, but the response is not plain HTML | Passes it through: other content types, `Content-Encoding` other than identity (an app that ignores `Accept-Encoding`), `Content-Disposition: attachment`, 1xx, 204, 206 and 304. |
| `X-Review-Skip` header with any value | No injection. For automated tests. |
| Fetches, iframes, prefetches (`Sec-Fetch-Dest` other than `document`, `Sec-Purpose: prefetch`) | No injection. |
| Anything else | Plain reverse proxy, WebSockets and server-sent events included. The reviewer cookie is removed before the request reaches the app, always. |
| `/__toolbar/*` | Answered by the injector itself, see below. |

On an injected response the injector removes `Content-Length`, `ETag` and `Last-Modified`, sets `Cache-Control: private, no-cache`, adds `Vary: Cookie` and `X-Toolbar-Injected: 1`. The app's `Content-Security-Policy` header is left as it is.

On any error it leaves the response alone: an injector panic is recovered and the body passes unchanged; a head that does not show up in the first 256 KB, a single token over 64 KB before the head, or an end tag before any head stop the scan and the rest is copied through; an upstream read error after some bytes went out is passed on to the browser like any proxy would.

### The CSP nonce

When the app's enforced `Content-Security-Policy` (one header or several, one policy or several per header) puts a `'nonce-...'` source in `script-src-elem`, else `script-src`, else `default-src` (the effective directive for a script element), the injector puts that nonce on its tag. Report-only policies are ignored. The bundle loads from the app's own origin, so a policy with `'self'` lets it in without a nonce. Its UI styles live in a constructed stylesheet in a shadow root and its positions are set through the CSSOM, so a policy without `'unsafe-inline'` styles does not break it. A policy whose `connect-src` leaves out `'self'` blocks the uploads.

### `/__toolbar/`

| Path | Purpose |
|---|---|
| `toolbar.js` (`.map`) | The page bundle, built from the extension's capture packages (below). Immutable cache with the `?v=` hash. |
| `login?next=/path` | Sends the reviewer to the server's review page, `/go?site=<this origin>&next=/path`. |
| `session` (POST) | The server's hand-off page posts the signed cookie value here. The injector checks it (signature, expiry, origin), sets it as an HttpOnly, SameSite=Lax cookie and redirects to `next` (same-origin paths only). |
| `logout` | Revokes the cookie's device token on the server (best effort) and removes the cookie. The bundle's "Stop reviewing on this site" calls it. |
| `status` | `{"reviewer":true|false}`. |
| `api/v1/...` | Relay to the server for the bundle's uploads: only the bootstrap, branding, create, chunk, complete, finalize and asset routes, only with the `X-Toolbar-Page: 1` header (a cross-origin page cannot send it without a preflight, which the injector never answers), only from the same origin, only with a valid cookie. The injector adds `Authorization: Bearer <device token>` and removes the app's cookies, origin and referrer. |
| `health` | `{"ok":true,"service":"open-toolbar-injector"}` with `Access-Control-Allow-Origin: *`: Traefik's and Docker's health checks, and the server's review page, which checks the site answers before it sends the reviewer there. Not logged. |

## The reviewer cookie

```
tbr1.<base64url(JSON {"v":1,"o":"<origin>","u":"<user id>","x":<expiry, unix s>,"k":"<device token>"})>.<base64url(HMAC-SHA256(INJECTOR_SECRET, "tbr1." + payload part))>
```

The server signs it (`apps/server/src/lib/server/review/cookie.ts`); the injector checks it offline (`cookie.go`). Both sides pin the format to `testdata/review-cookie.json`. The device token inside is a normal open-toolbar device token named "Review on <host>": it shows under Settings, Connected browsers, expires with the cookie and can be revoked there. The cookie's name is `__Host-tb_review` on https and `tb_review` on http.

Sign-in (D-201):

1. Review link `<server>/go/<project id>` (`?site=<origin>` for a project with several origins). `https://app.example/__toolbar/login` leads to `/go?site=https://app.example`.
2. The server checks the origin against the reviewer's projects (`reviewOriginAllowed` in `apps/server/src/lib/server/projects/`) and `INJECTOR_ORIGINS`, and probes `https://app.example/__toolbar/health`.
3. The server mints the device token and signs the cookie for that origin only.
4. The page posts the value to `https://app.example/__toolbar/session`; the injector sets the cookie and redirects to `next`.

## The page bundle (D-158)

`apps/extension/page/`, built with `pnpm --filter @toolbar/extension build:page` to `apps/extension/.output/page/toolbar.js` (about 73 KB gzipped, plus the OFL fonts served from `/__toolbar/`). It runs the MAIN-world hooks and the isolated-world recorder of `@toolbar/capture` in the page's realm, with `PageSession` as the `Transport`, and keeps the last 60 seconds of console, errors, network, user events and DOM replay in memory.

- **Comment**: outside a trace, an instant-replay capture of the last minute with the comment on the element's locator; inside a trace, joins the trace.
- **Start trace / Stop trace**: streams events and DOM replay every two seconds, across pages of the tab (state in `sessionStorage`).
- **Menu**: account, hide, "Stop reviewing on this site" (removes the cookie, revokes the token).

The first project in the reviewer's workspaces whose origin matches the page sets the masking preset, body policy (D-125) and workspace. Without one: staging preset, bodies of the page's origin, the active workspace. Captures carry `source: injector`.

## Configuration

Container variables: [docs/configuration.md, "Injector container"](../../docs/configuration.md#injector-container) (`INJECTOR_LOOPBACK`, `INJECTOR_LOOPBACK_INSECURE`, `INJECTOR_UPSTREAMS`, `INJECTOR_UPSTREAM`, `TOOLBAR_SERVER_URL`, `TOOLBAR_PUBLIC_URL`, `INJECTOR_SECRET`, `INJECTOR_TRUST_FORWARDED`, `INJECTOR_SCAN_LIMIT`, `INJECTOR_LISTEN`, `INJECTOR_ASSETS`). Server variables: `INJECTOR_SECRET`, `INJECTOR_ORIGINS`, `INJECTOR_COOKIE_DAYS` (default 7), in the "Injector" section of the same page.

`/injector pass-value` prints the `X-Open-Toolbar-Pass` value for the Traefik file, `base64url(HMAC-SHA256(INJECTOR_SECRET, "open-toolbar pass v1"))`. `/injector healthcheck` is the container health check.

The injector logs one line per request it handles (`kind=loopback`, `app`, `toolbar` or `loop`, host, path without the query, status, whether it injected), and warns once when requests arrive without the pass header or with a wrong one.

## Coolify

`deploy/injector/docker-compose.injector.yml` (Compose resource) and `deploy/injector/traefik-open-toolbar-injector.yml` (Traefik dynamic configuration); files, rule and variables in [docs/injector-on-coolify.md](../../docs/injector-on-coolify.md). `deploy/lab/docker-compose.lab.yml` deploys the lab app as a test site.

## Develop and test

```sh
cd apps/injector && go test -race ./...     # streaming, chunk boundaries, nonce, gzip pass-through, errors, cookie, relay
apps/injector/test/run.sh                    # compose test: the injector in front of the lab, a browser without the extension
apps/injector/test/coolify-like/run.sh       # traefik:v3.7 set up like Coolify's, loopback mode, the whole reviewer journey
```

`run.sh` needs the lab on :5173 and a server on `SERVER_URL` (default http://localhost:3306) with the mock OIDC provider and `INJECTOR_SECRET`; it reads the repo root `.env`, starts the injector on :3506 in explicit mode and runs `e2e/injector/injector.spec.ts`. `coolify-like/run.sh`: docs/dev.md, "The injector".

## Known limits

- In loopback mode an app sees the injector's address as the client of a reviewer's requests, unless the proxy trusts `X-Forwarded-For` from the `coolify` network (docs/injector-on-coolify.md, "Optional: client addresses").
- While the injector is down, reviewers' requests reach the app through the fallback with the reviewer cookie and the pass header on them. In the first seconds, before Traefik's health check notices, they get a 502.
- The bundle shares the page's JavaScript realm. The app's own scripts could call the `/__toolbar/api/` relay as the reviewer while the reviewer has the page open; the relay only allows the capture upload routes, and the cookie and token never reach page scripts or the app's server. The extension's isolated world does not have this exposure.
- Page console calls show `toolbar.js` as their source in the browser's own devtools, because the hook wraps `console`.
- No screenshots: a page cannot capture its own pixels without a permission prompt. The DOM replay covers what the page showed.
- Iframes are not captured; only the top document gets the bundle.
- A trace loses at most the last two seconds before a navigation when the final chunk is larger than the 64 KB `keepalive` budget.
- HTML in UTF-16 or UTF-32 is passed through without the toolbar.
