# Injector

A small Go reverse proxy that adds the open-toolbar to an app's pages without any change to the app (PLAN "Zero integration", delivery 2; D-157, D-200). It sits beside Traefik: Traefik sends it only reviewers' requests, for any host, and the injector sends them back into Traefik, which routes them to the app. For a signed-in reviewer it adds one script tag to the `<head>` of each HTML page. Everyone else never reaches it.

Setting it up on Coolify, and opening an app for review: [docs/injector-on-coolify.md](../../docs/injector-on-coolify.md).

## Two modes

- **Loopback** (`INJECTOR_LOOPBACK`, D-200), for Coolify and any Traefik in front of many apps. The injector forwards each request back to the proxy with the original `Host`, that host as the TLS server name (so the proxy's certificate for the app is checked against the system roots; `INJECTOR_LOOPBACK_INSECURE=1` for a self-signed proxy), HTTP/1.1 (WebSocket upgrades pass), the `X-Forwarded-*` headers kept and this hop added, no reviewer cookie and `Via: 1.1 open-toolbar-injector`. Without the cookie the second pass misses the injector router and takes the app's own router. A request that comes back with the injector's `Via` token is answered 508, so a request passes the injector at most once. The injector needs no list of apps.
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

Sign-in, step by step (D-200):

1. The reviewer opens a review link, `https://feedback.example/go/<project id>` (Settings, Projects, "Copy review link"; `?site=<origin>` when the project has several origins). `https://app.example/__toolbar/login` leads to the same page as `/go?site=https://app.example`. The server asks them to sign in when they are not.
2. The server checks the origin: it must be in a project of the person's workspaces (`reviewOriginAllowed` in `apps/server/src/lib/server/projects/`) and, when `INJECTOR_ORIGINS` is set, in that list too. The page names the site and the account, and reads `https://app.example/__toolbar/health` to make sure the injector answers there.
3. "Open app.example with the toolbar" mints the token and signs the cookie for that origin only. "Open with toolbar" on the project page does this step at once.
4. The page posts the value to `https://app.example/__toolbar/session`; the injector sets the cookie and sends the browser to `next`.

The page has an error state for each failure: the site is in no project of the person (or not in `INJECTOR_ORIGINS`), the project is gone or not theirs, the injector does not answer on the site, the server has no `INJECTOR_SECRET`.

## The page bundle (D-158)

`apps/extension/page/` (`pnpm --filter @toolbar/extension build:page`, output `apps/extension/.output/page/toolbar.js`, about 73 KB gzipped, with the bundled OFL fonts and their licences beside it, which it registers on the page from `/__toolbar/`). It runs the same capture code as the extension: the MAIN-world hooks and the isolated-world recorder of `@toolbar/capture`, both in the page's realm and joined by their usual bridge, with `PageSession` as the `Transport`. It keeps the last 60 seconds of console, errors, network, user events and DOM replay in memory. The UI is a small bar at the bottom of the page:

- **Comment**: pick an element, write, send. Without a trace it creates an instant-replay capture of the last minute with the comment as an annotation on that element's locator. During a trace it joins the trace.
- **Start trace / Stop trace**: a capture that streams events and DOM replay to the server every two seconds and follows the reviewer across pages of the tab (its id and chunk counters live in `sessionStorage`). Stop asks for an optional note.
- **Menu**: who is signed in, hide the bar, "Stop reviewing on this site" (removes the cookie and revokes its device token).

The page's project (the first project in the reviewer's workspaces with an origin that matches the page, from the bootstrap) sets the masking preset and body policy (D-125) and the workspace each capture goes to; events wait in the page until the preset is known. With no matching project the bundle uses the staging preset with bodies of the page's own origin, and the reviewer's active workspace. Captures it makes carry `source: injector` ("Toolbar on the site" in the dashboard filter).

## Configuration

Every variable of the injector container, with its default, an example and when to change it, is in [docs/configuration.md, "Injector container"](../../docs/configuration.md#injector-container): `INJECTOR_LOOPBACK` and `INJECTOR_LOOPBACK_INSECURE`, or `INJECTOR_UPSTREAMS` and `INJECTOR_UPSTREAM`, `TOOLBAR_SERVER_URL`, `TOOLBAR_PUBLIC_URL`, `INJECTOR_SECRET`, `INJECTOR_TRUST_FORWARDED`, `INJECTOR_SCAN_LIMIT`, `INJECTOR_LISTEN` and `INJECTOR_ASSETS`. A test there fails when the Go code reads a variable the page does not list.

On the open-toolbar server: `INJECTOR_SECRET` (the same value), `INJECTOR_ORIGINS` (an optional hard allowlist on top of the projects) and `INJECTOR_COOKIE_DAYS` (default 7), in the same page's "Injector" section.

`/injector pass-value` prints the `X-Open-Toolbar-Pass` value for the Traefik file, `base64url(HMAC-SHA256(INJECTOR_SECRET, "open-toolbar pass v1"))`. `/injector healthcheck` is the container health check.

The injector logs one line per request it handles (`kind=loopback`, `app`, `toolbar` or `loop`, host, path without the query, status, whether it injected), and warns once when requests arrive without the pass header or with a wrong one.

## Coolify

`deploy/injector/` has both files; [docs/injector-on-coolify.md](../../docs/injector-on-coolify.md) has the steps.

- `docker-compose.injector.yml`: the injector as a Compose resource, on the `coolify` network under the alias `open-toolbar-injector`, in loopback mode to `https://coolify-proxy:443`, with no domains of its own. Coolify asks for `INJECTOR_SECRET` and `TOOLBAR_SERVER_URL`.
- `traefik-open-toolbar-injector.yml`: a dynamic configuration for Coolify's proxy. One router on the `https` entry point for any host (`HostRegexp(`.+`)`), priority 100000, matching only `/__toolbar/` and requests that carry the reviewer cookie, and leaving out requests with the right `X-Open-Toolbar-Pass` header. Its middleware adds that header and compresses responses. Its service is a failover: the injector while its health check passes, else the proxy itself (`https://coolify-proxy:443`), where the header makes the request skip this router and reach the app. So visitors never pass through the injector, and while it is down reviewers get the plain app. No Traefik plugin and no extra domain. The pass value keeps page scripts from sending the header themselves to get the reviewer cookie to the app; the injector never forwards it, so apps do not learn it while the injector runs.

`deploy/lab/docker-compose.lab.yml` deploys the lab app (`lab/Dockerfile`) as a first site to review.

## Develop and test

```sh
cd apps/injector && go test -race ./...     # streaming, chunk boundaries, nonce, gzip pass-through, errors, cookie, relay
apps/injector/test/run.sh                    # compose test: the injector in front of the lab, a browser without the extension
apps/injector/test/coolify-like/run.sh       # traefik:v3.7 set up like Coolify's, loopback mode, the whole reviewer journey
```

`run.sh` needs the lab on :5173, a server on `SERVER_URL` (default http://localhost:3306) that signs in through the mock OIDC provider, and `INJECTOR_SECRET` on that server; it reads the repo root `.env`. It builds the image, starts it on :3506 in explicit mode and runs `e2e/injector/injector.spec.ts`.

`coolify-like/run.sh` (docs/dev.md, "The injector") runs `traefik:v3.7` with the command line and labels Coolify generates, the lab and a strict-CSP page as two apps, `traefik/whoami` to see what an app receives, and the injector behind the rendered Traefik file, then `e2e/injector/coolify.spec.ts` headed on display `:350`.

## Known limits

- In loopback mode an app sees the injector's address as the client of a reviewer's requests, unless the proxy trusts `X-Forwarded-For` from the `coolify` network (docs/injector-on-coolify.md, "Optional").
- While the injector is down, reviewers' requests reach the app through the fallback with the reviewer cookie and the pass header on them. In the first seconds, before Traefik's health check notices, they get a 502.

- The bundle shares the page's JavaScript realm. The app's own scripts could call the `/__toolbar/api/` relay as the reviewer while the reviewer has the page open; the relay only allows the capture upload routes, and the cookie and token never reach page scripts or the app's server. The extension's isolated world does not have this exposure.
- Page console calls show `toolbar.js` as their source in the browser's own devtools, because the hook wraps `console`.
- No screenshots: a page cannot capture its own pixels without a permission prompt. The DOM replay covers what the page showed.
- Iframes are not captured; only the top document gets the bundle.
- A trace loses at most the last two seconds before a navigation when the final chunk is larger than the 64 KB `keepalive` budget.
- HTML in UTF-16 or UTF-32 is passed through without the toolbar.
