# The injector on Coolify

Optional. The default deployment does not include the injector, and the extension needs none of this.

The injector (`apps/injector`, D-157, D-201) adds the toolbar's script tag to the HTML of any app behind Coolify's Traefik, for signed-in reviewers only. Apps need no change. Reviewers start from a review link (`<server>/go/<project id>`, shown under Settings, Projects for each project origin).

```
visitor   ── Traefik ──────────────────────────────────────────────▶ app
reviewer  ── Traefik ──▶ injector ──▶ Traefik again ──────────────▶ app
               (cookie or /__toolbar/)   (cookie removed)
```

One Traefik router, for any host on the `https` entry point, sends the injector requests under `/__toolbar/` and requests carrying the reviewer cookie. The injector forwards them back to `coolify-proxy` without the cookie, and Traefik routes that second pass to the app. When the injector's health check fails, the router's service falls back to the proxy itself, and reviewers get the app without the toolbar.

## Files

| File | What it is |
|---|---|
| `deploy/injector/docker-compose.injector.yml` | Compose resource. Joins the `coolify` network as `open-toolbar-injector`, loopback mode to `https://coolify-proxy:443`, no domain, no host port. |
| `deploy/injector/traefik-open-toolbar-injector.yml` | Dynamic configuration for Coolify's proxy (Servers, Proxy, Dynamic Configurations). Replace both `REPLACE_WITH_PASS_VALUE` with the pass value. Expects entry point `https`, container `coolify-proxy`, Traefik v3. |
| `deploy/lab/docker-compose.lab.yml` | The lab app, a test site with no required values. Domain `https://<host>:5173`. |

## Variables

| Where | Variable | Value |
|---|---|---|
| open-toolbar server | `INJECTOR_SECRET` | The shared secret. Enables review links. |
| open-toolbar server | `INJECTOR_ORIGINS` | Optional allowlist on top of project origins. |
| Injector resource | `INJECTOR_SECRET` | The same secret. |
| Injector resource | `TOOLBAR_SERVER_URL` | The server's URL, for example `https://toolbar.example.com`. |
| Injector resource | `INJECTOR_LOOPBACK_INSECURE` | Optional, default `0`. `1` skips the certificate check on the loopback hop, for a proxy without publicly trusted certificates. |

Full rows: [docs/configuration.md, "Injector"](configuration.md#injector).

Secret and pass value:

```sh
INJECTOR_SECRET=$(openssl rand -base64 48 | tr -d '\n')
printf %s 'open-toolbar pass v1' | openssl dgst -sha256 -hmac "$INJECTOR_SECRET" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='
```

`docker exec <injector container> /injector pass-value` prints the same pass value. Changing the secret signs every reviewer out and changes the pass value, so update the Traefik file with it.

Deploy the injector before saving the Traefik file. Check with:

```sh
curl -s https://<app host>/__toolbar/health      # {"ok":true,"service":"open-toolbar-injector"}
curl -sI https://<app host>/ | grep -i x-toolbar-injected   # empty for a visitor
```

## Traefik rule

The router in `traefik-open-toolbar-injector.yml`, priority 100000:

```
HostRegexp(`.+`) && (PathPrefix(`/__toolbar/`) || HeaderRegexp(`Cookie`, `(^|;\s*)(__Host-)?tb_review=`))
  && !Header(`X-Open-Toolbar-Pass`, `REPLACE_WITH_PASS_VALUE`)
```

Its middleware sets `X-Open-Toolbar-Pass` and compresses responses. The service is a failover: `http://open-toolbar-injector:8080` with a 3 s health check on `/__toolbar/health`, else `https://coolify-proxy:443`, where the pass header makes the request skip this router. The injector never forwards the header, and the secret value stops page scripts from sending it to push the reviewer cookie through to the app.

## Review link errors

| Message | Cause |
|---|---|
| "The toolbar is not set up on <host>" | `https://<host>/__toolbar/health` does not answer: injector down, Traefik file missing or wrong pass value, or the app is not on this proxy over https. |
| "<host> is not open for review" | Origin in no project of the reviewer's workspaces, or outside `INJECTOR_ORIGINS`. |
| "This review link does not work" | Project deleted, or the reviewer is not in its workspace. |
| "Review links are off" | The server has no `INJECTOR_SECRET`. |

The injector logs one line per request (`kind=loopback` or `kind=toolbar`) and warns about a missing or wrong `X-Open-Toolbar-Pass`.

## Optional: client addresses

Apps see the injector's container address as the client of reviewers' requests. To pass the real address, trust `X-Forwarded-For` from the `coolify` network in the proxy's command (the subnet comes from `docker network inspect coolify --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'`), then restart the proxy:

```yaml
- '--entrypoints.https.forwardedHeaders.trustedIPs=10.0.1.0/24'
```

## Limits

- While the injector is down, reviewers' requests reach the app with the reviewer cookie and the pass header. Before the health check notices (about three seconds), they get a 502.
- Only the `https` entry point routes to the injector.
- `/__toolbar/` on every domain of the Coolify server goes to the injector.

## Local test

`apps/injector/test/coolify-like/run.sh` runs `traefik:v3.7` with Coolify's command line and labels, a self-signed certificate, two apps and this Traefik file, then `e2e/injector/coolify.spec.ts` (docs/dev.md, "The injector").
