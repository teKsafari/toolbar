# The injector on Coolify

The injector puts the open-toolbar on any app your Coolify server runs, for reviewers only, with no browser extension and no change to the app (D-157, D-200). You set it up once per Coolify server. After that, opening an app for review takes two steps in the open-toolbar dashboard: add the app's origin to a project, then share the project's review link.

This page uses the owner's names: Coolify project **Lab**, the open-toolbar server at `https://toolbar.teksafari.com`, and the lab app at `https://lab-toolbar.teksafari.com` as the first site to review. Put your own names in their place.

## How it fits together

```
visitor   ── Traefik ──────────────────────────────────────────────▶ app
reviewer  ── Traefik ──▶ injector ──▶ Traefik again ──────────────▶ app
               (cookie or /__toolbar/)   (cookie removed)
```

- Traefik is Coolify's own proxy (`coolify-proxy`). One extra router, from a dynamic configuration file, sends it two kinds of request for any host: those under `/__toolbar/` and those carrying the reviewer cookie. Everything else takes the router Coolify made from the app's domain, as before, so a visitor never reaches the injector.
- The injector adds the toolbar's script tag to the reviewer's pages and sends each request back into Traefik with the cookie removed. Traefik routes that second pass to the app like any other request. The injector holds no list of apps.
- When the injector is down, Traefik notices within about three seconds and sends reviewers straight to the app: they lose the toolbar and keep the app.

## One-time setup

You need the Coolify web UI and a terminal with `openssl` (your laptop is fine). Nothing here calls Coolify's API.

### 1. Make the shared secret and the pass value

In a terminal:

```sh
INJECTOR_SECRET=$(openssl rand -base64 48 | tr -d '\n')
echo "$INJECTOR_SECRET"
printf %s 'open-toolbar pass v1' | openssl dgst -sha256 -hmac "$INJECTOR_SECRET" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '='; echo
```

The first line printed is `INJECTOR_SECRET`. The second, 43 characters, is the **pass value** for the Traefik file. Keep both in your password manager until step 4 is done. Anyone with the secret can sign reviewer cookies, so it never goes in the repository or a chat. Changing the secret later signs every reviewer out and changes the pass value, so the Traefik file must change with it.

(Once the injector runs, `docker exec <injector container> /injector pass-value` on the Coolify server prints the same pass value.)

### 2. Give the open-toolbar server the secret

1. Coolify, project **Lab**, the **open-toolbar** application (the one serving `https://toolbar.teksafari.com`).
2. **Environment Variables**, add `INJECTOR_SECRET` with the value from step 1. Leave "Is Build Variable?" off.
3. **Redeploy**.

The server now shows review links on Settings, Projects. Leave `INJECTOR_ORIGINS` unset: any origin of a project can then be reviewed. Set it only to fence the injector to a few apps (docs/configuration.md, "Injector").

### 3. Create the injector resource

1. Project **Lab**, **+ New**, **Private Repository (with GitHub App)**, the teksafari app, repository `teKsafari/toolbar`, branch `main`.
2. **Build Pack**: Docker Compose. **Base Directory**: `/`. **Docker Compose Location**: `/deploy/injector/docker-compose.injector.yml`. Continue.
3. Leave the service's **Domains** empty. Traefik reaches the injector through the file of step 4, never through a domain.
4. **Environment Variables**: Coolify lists the two the file requires.

   | Variable | Value |
   |---|---|
   | `INJECTOR_SECRET` | the same value as in step 2 |
   | `TOOLBAR_SERVER_URL` | `https://toolbar.teksafari.com` |

5. **Deploy**. The build takes a few minutes (it builds the page bundle and the Go binary). The container reports healthy when `/__toolbar/health` answers.

The file joins the container to the `coolify` network under the name `open-toolbar-injector` and points it at `https://coolify-proxy:443` (`INJECTOR_LOOPBACK`). The injector checks the certificate Traefik shows for each app against the system roots, which a Let's Encrypt certificate passes.

### 4. Add the Traefik file

1. **Servers**, your server, **Proxy**, **Dynamic Configurations**, **+ Add**.
2. File name: `open-toolbar-injector.yaml`.
3. Content: `deploy/injector/traefik-open-toolbar-injector.yml` from the repository, with both `REPLACE_WITH_PASS_VALUE` replaced by the pass value from step 1. From a checkout of the repository:

   ```sh
   sed "s/REPLACE_WITH_PASS_VALUE/<pass value>/g" deploy/injector/traefik-open-toolbar-injector.yml
   ```

4. **Save**. Traefik loads the file within a few seconds; no restart. Do this after step 3: until the injector exists, the file's health check fails and Traefik sends reviewers straight to the app.

The file expects Coolify's defaults: entry point `https`, proxy container `coolify-proxy`, Traefik v3. The test in `apps/injector/test/coolify-like/` runs it on `traefik:v3.7`, the image Coolify's current proxy configuration names. If **Proxy** shows an older Traefik, use Coolify's upgrade there first.

### 5. Deploy the lab as a first site to review

The lab app (`lab/`) is the project's capture test target: buttons that fail on purpose, a form, a WebSocket and server-sent events. It is a safe first site.

1. Project **Lab**, **+ New**, the same repository and branch, **Build Pack** Docker Compose, **Docker Compose Location** `/deploy/lab/docker-compose.lab.yml`.
2. The `lab` service's **Domains**: `https://lab-toolbar.teksafari.com:5173`. The `:5173` tells Coolify the container port; the public address has no port.
3. **Deploy**. Point the DNS name at the server (an A record, as for `toolbar.teksafari.com`) if it does not resolve yet.

### 6. Check it

```sh
curl -s https://lab-toolbar.teksafari.com/__toolbar/health
# {"ok":true,"service":"open-toolbar-injector"}
curl -sI https://lab-toolbar.teksafari.com/ | grep -i x-toolbar-injected
# (nothing: a visitor gets the app untouched)
```

Then do the onboarding below for the lab and open its review link.

## Onboarding an app

For each app you want reviewed, in the open-toolbar dashboard (`https://toolbar.teksafari.com`):

1. **Settings**, **Projects**. Add a project, or edit one, and put the app's origin in **Origins**, for example `https://lab-toolbar.teksafari.com`. With the extension's automatic projects (D-198) the origin may already be in a project; then there is nothing to add.
2. Under each origin of the project: **Copy review link** copies `https://toolbar.teksafari.com/go/<project id>` (with `?site=` when the project has several origins). **Open with toolbar** opens the app with the toolbar for you, right away.
3. Send the link to the reviewer. They click it, sign in with Google if they are not signed in yet, press **Open <host> with the toolbar**, and land on the app with the toolbar at the bottom of the page.

The reviewer needs an account on the server and membership of the workspace that holds the project (Settings, Members, invite link). The toolbar's menu shows who is signed in and has **Stop reviewing on this site**, which removes the cookie and revokes its device token. Reviewers also find their review sessions under Settings, Connected browsers, as "Review on <host>".

The app needs no change. Its own Content-Security-Policy is respected: the injector reuses the page's script nonce, and the bundle loads from the app's own origin.

## When a review link shows an error

| The page says | Cause | Fix |
|---|---|---|
| "The toolbar is not set up on <host>" | The browser could not read `https://<host>/__toolbar/health` from the injector. | Check the injector resource is running and healthy, the Traefik file is saved with the pass value, and the app is served over https by this Coolify server. |
| "<host> is not open for review" | The origin is in no project of the reviewer's workspaces, or `INJECTOR_ORIGINS` is set and leaves it out. | Add the origin to a project, or invite the reviewer to that workspace. |
| "This review link does not work" | The project was deleted, or the reviewer is not in its workspace. | Copy a fresh link, or invite the reviewer. |
| "Review links are off" | The server has no `INJECTOR_SECRET`. | Step 2. |

The injector logs one line per request it handles (`kind=loopback` for app pages, `kind=toolbar` for its own routes). A visitor's request should never appear there. A warning about `X-Open-Toolbar-Pass` means the Traefik file still holds the placeholder or an old pass value.

## Optional: the visitor's address for reviewers' requests

Without further setup, an app sees the injector's container address as the client address of a reviewer's requests (visitors are unaffected). To pass the real address through, let Traefik trust the `X-Forwarded-For` header from the containers on the `coolify` network:

1. On the server: `docker network inspect coolify --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'` prints the subnet, for example `10.0.1.0/24`.
2. **Servers**, your server, **Proxy**, the proxy configuration: add a line under `command:`

   ```yaml
   - '--entrypoints.https.forwardedHeaders.trustedIPs=10.0.1.0/24'
   ```

3. **Restart Proxy**. Every site on the server is unreachable for a few seconds while it restarts.

The app then gets the visitor's address first in `X-Forwarded-For` and in `X-Real-Ip`, as for any other request.

## Limits

- While the injector is down (a redeploy, a crash), reviewers' requests reach the app with the reviewer cookie and the `X-Open-Toolbar-Pass` header still on them. The app ignores both, but an app that logs request headers keeps them. Revoke the reviews under Settings, Connected browsers and change `INJECTOR_SECRET` (steps 1 to 4) if that matters.
- The first seconds after the injector stops, before Traefik's health check notices, reviewers get a 502 instead of the app.
- Only the `https` entry point routes to the injector. An app Coolify serves on plain http only gets no toolbar.
- `/__toolbar/` on every domain of the Coolify server goes to the injector, Coolify's own dashboard and the open-toolbar server included. Nothing there uses that path.

## Test it locally

`apps/injector/test/coolify-like/run.sh` starts the same setup on one machine: `traefik:v3.7` with Coolify's command line and labels, a self-signed certificate, the lab and a strict-CSP page as two apps, the injector in loopback mode behind this Traefik file, and a dev server. It then runs `e2e/injector/coolify.spec.ts` in a browser without the extension (docs/dev.md, "The injector").
