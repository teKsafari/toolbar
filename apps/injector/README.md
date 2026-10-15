# Injector

A small Go reverse proxy that adds the open-toolbar to an app's pages without any change to the app (PLAN "Zero integration", delivery 2; D-130). It sits between Traefik and the apps you choose. For a signed-in reviewer it adds one script tag to the `<head>` of each HTML page. Everyone else gets the app's response untouched.

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
| `login?next=/path` | Sends the reviewer to the server's `/review/start?origin=<this origin>&next=/path`. |
| `session` (POST) | The server's hand-off page posts the signed cookie value here. The injector checks it (signature, expiry, origin), sets it as an HttpOnly, SameSite=Lax cookie and redirects to `next` (same-origin paths only). |
| `logout` | Removes the cookie. |
| `status` | `{"reviewer":true|false}`. |
| `api/v1/...` | Relay to the server for the bundle's uploads: only the bootstrap, branding, create, chunk, complete, finalize and asset routes, only with the `X-Toolbar-Page: 1` header (a cross-origin page cannot send it without a preflight, which the injector never answers), only from the same origin, only with a valid cookie. The injector adds `Authorization: Bearer <device token>` and removes the app's cookies, origin and referrer. |
| `health` | `ok`, for health checks. |

## The reviewer cookie

```
tbr1.<base64url(JSON {"v":1,"o":"<origin>","u":"<user id>","x":<expiry, unix s>,"k":"<device token>"})>.<base64url(HMAC-SHA256(INJECTOR_SECRET, "tbr1." + payload part))>
```

The server signs it (`apps/server/src/lib/server/review/cookie.ts`); the injector checks it offline (`cookie.go`). Both sides pin the format to `testdata/review-cookie.json`. The device token inside is a normal open-toolbar device token named "Review on <host>": it shows under Settings, Connected browsers, expires with the cookie and can be revoked there. The cookie's name is `__Host-tb_review` on https and `tb_review` on http.

Sign-in, step by step:

1. The reviewer opens `https://app.example/__toolbar/login` (a bookmark, or a link you share).
2. The injector sends them to `https://feedback.example/review/start?origin=https://app.example&next=/`. The server asks them to sign in when they are not.
3. The server page names the site and the account; "Open app.example with the toolbar" mints the token and signs the cookie for that origin only. The origin must be in the server's `INJECTOR_ORIGINS`, or, while that list is empty, an origin of a project (Settings, Projects) in one of the person's workspaces.
4. The page posts the value to `https://app.example/__toolbar/session`; the injector sets the cookie and sends the browser to `next`.

## The page bundle (D-131)

`apps/extension/page/` (`pnpm --filter @toolbar/extension build:page`, output `apps/extension/.output/page/toolbar.js`, about 63 KB gzipped). It runs the same capture code as the extension: the MAIN-world hooks and the isolated-world recorder of `@toolbar/capture`, both in the page's realm and joined by their usual bridge, with `PageSession` as the `Transport`. It keeps the last 60 seconds of console, errors, network, user events and DOM replay in memory. The UI is a small bar at the bottom of the page:

- **Comment**: pick an element, write, send. Without a trace it creates an instant-replay capture of the last minute with the comment as an annotation on that element's locator. During a trace it joins the trace.
- **Start trace / Stop trace**: a capture that streams events and DOM replay to the server every two seconds and follows the reviewer across pages of the tab (its id and chunk counters live in `sessionStorage`). Stop asks for an optional note.
- **Menu**: hide the bar, turn review off on this site.

The page's project (the first project in the reviewer's workspaces with an origin that matches the page, from the bootstrap) sets the masking preset and body policy (D-125) and the workspace each capture goes to; events wait in the page until the preset is known. With no matching project the bundle uses the staging preset with bodies of the page's own origin, and the reviewer's active workspace. Captures it makes carry `source: injector` ("Toolbar on the site" in the dashboard filter).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `INJECTOR_UPSTREAM` | empty | The app, for hosts not in `INJECTOR_UPSTREAMS`. |
| `INJECTOR_UPSTREAMS` | empty | `host=url` pairs, comma separated: `nuru.example.org=http://nuru-app:3000`. One injector can front several apps. |
| `TOOLBAR_SERVER_URL` | empty | The open-toolbar server as the injector reaches it, for the upload relay. |
| `TOOLBAR_PUBLIC_URL` | `TOOLBAR_SERVER_URL` | The server as browsers reach it, for `/__toolbar/login`. |
| `INJECTOR_SECRET` | empty | HMAC key shared with the server, at least 32 characters. Empty: no cookie is ever valid, so the injector only passes traffic through. |
| `INJECTOR_TRUST_FORWARDED` | `1` | Read the scheme and host from `X-Forwarded-Proto` and `X-Forwarded-Host` (Traefik sets them). `0` when browsers talk to the injector directly. |
| `INJECTOR_SCAN_LIMIT` | `262144` | Bytes scanned for a head before giving up. |
| `INJECTOR_LISTEN` | `:8080` | Listen address. |
| `INJECTOR_ASSETS` | `/srv/toolbar` | Folder with `toolbar.js`. |

On the open-toolbar server: `INJECTOR_SECRET` (the same value), `INJECTOR_ORIGINS` (the app origins, comma separated; empty means the origins of each person's projects) and `INJECTOR_COOKIE_DAYS` (default 7). See `docs/configuration.md`.

## Coolify

`deploy/injector/` has both files:

- `docker-compose.injector.yml`: the injector as a Compose resource, on the `coolify` network, with no domains of its own.
- `traefik-open-toolbar-injector.yml`: copy it to `/data/coolify/proxy/dynamic/`. It adds a high-priority router for the hosts you name, matching only `/__toolbar/` and requests that carry the reviewer cookie. All other traffic of those hosts keeps going straight to the app through the router Coolify made, so visitors never pass through the injector, and if the injector is down only reviewers notice. No Traefik plugin and no extra domain.

## Develop and test

```sh
cd apps/injector && go test -race ./...     # streaming, chunk boundaries, nonce, gzip pass-through, errors, cookie, relay
apps/injector/test/run.sh                    # compose test: the injector in front of the lab, a browser without the extension
```

`run.sh` needs the lab on :5173, a server on `SERVER_URL` (default http://localhost:3306) that signs in through the mock OIDC provider, and `INJECTOR_SECRET` and `INJECTOR_ORIGINS=http://localhost:3506` on that server; it reads the repo root `.env`. It builds the image, starts it on :3506 and runs `e2e/injector/injector.spec.ts`.

## Known limits

- The bundle shares the page's JavaScript realm. The app's own scripts could call the `/__toolbar/api/` relay as the reviewer while the reviewer has the page open; the relay only allows the capture upload routes, and the cookie and token never reach page scripts or the app's server. The extension's isolated world does not have this exposure.
- Page console calls show `toolbar.js` as their source in the browser's own devtools, because the hook wraps `console`.
- No screenshots: a page cannot capture its own pixels without a permission prompt. The DOM replay covers what the page showed.
- Iframes are not captured; only the top document gets the bundle.
- A trace loses at most the last two seconds before a navigation when the final chunk is larger than the 64 KB `keepalive` budget.
- HTML in UTF-16 or UTF-32 is passed through without the toolbar.
