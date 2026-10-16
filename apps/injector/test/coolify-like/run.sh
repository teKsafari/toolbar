#!/usr/bin/env bash
# The injector behind a Traefik set up like Coolify's (D-201), end to end:
#
#   apps/injector/test/coolify-like/run.sh [playwright args]
#
# 1. Renders deploy/injector/traefik-open-toolbar-injector.yml into ./dynamic/ with the pass value
#    derived from INJECTOR_SECRET, and writes a self-signed certificate for *.localhost.
# 2. Builds and starts the proxy, the lab, the strict-CSP app and the injector (docker-compose.yml).
# 3. Runs e2e/injector/coolify.spec.ts in a headed Chromium without the extension on display
#    E2E_DISPLAY (default :350; started here when no X server owns it).
#
# Needs an open-toolbar server on SERVER_URL (default http://localhost:3650) listening on all
# interfaces, signing in through the mock OIDC provider, with the same INJECTOR_SECRET. The
# repo root .env is read. KEEP=1 leaves the stack running.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../../../.." && pwd)
if [[ -f "$root/.env" ]]; then set -a; . "$root/.env"; set +a; fi
: "${INJECTOR_SECRET:?set INJECTOR_SECRET (the server needs the same value)}"
export SERVER_URL=${SERVER_URL:-http://localhost:3650}
export INJECTOR_SERVER_URL=${INJECTOR_SERVER_URL:-http://host.docker.internal:${SERVER_URL##*:}}
export PROXY_HTTPS_PORT=${PROXY_HTTPS_PORT:-3651} PROXY_HTTP_PORT=${PROXY_HTTP_PORT:-3652}
export E2E_DISPLAY=${E2E_DISPLAY:-:350}
compose=(docker compose -f "$here/docker-compose.yml")

cleanup() {
  [[ "${KEEP:-}" == 1 ]] || "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
  [[ -n "${xvfb:-}" ]] && kill "$xvfb" 2>/dev/null || true
}
trap cleanup EXIT

curl -sf "$SERVER_URL/api/health" >/dev/null || { echo "no server on $SERVER_URL" >&2; exit 1; }

# 1. the Traefik file as the owner would paste it, and the certificate
mkdir -p "$here/dynamic/certs"
pass=$(printf %s 'open-toolbar pass v1' | openssl dgst -sha256 -hmac "$INJECTOR_SECRET" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
sed "s/REPLACE_WITH_PASS_VALUE/$pass/g" "$root/deploy/injector/traefik-open-toolbar-injector.yml" > "$here/dynamic/open-toolbar-injector.yml"
if [[ ! -f "$here/dynamic/certs/local.crt" ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj '/CN=coolify-like.localhost' \
    -addext 'subjectAltName=DNS:localhost,DNS:*.localhost,DNS:coolify-proxy' \
    -keyout "$here/dynamic/certs/local.key" -out "$here/dynamic/certs/local.crt" 2>/dev/null
fi
cat > "$here/dynamic/certs.yml" <<'YML'
# test only: Coolify's routers get Let's Encrypt certificates instead
tls:
  stores:
    default:
      defaultCertificate:
        certFile: /traefik/dynamic/certs/local.crt
        keyFile: /traefik/dynamic/certs/local.key
YML

# 2. the stack
"${compose[@]}" up --build -d --wait
for _ in $(seq 1 30); do
  curl -sfk "https://lab.localhost:$PROXY_HTTPS_PORT/__toolbar/health" | grep -q open-toolbar-injector && break
  sleep 1
done

# 3. the browser on its own display
if ! xdpyinfo -display "$E2E_DISPLAY" >/dev/null 2>&1; then
  Xvfb "$E2E_DISPLAY" -screen 0 1440x900x24 -nolisten tcp >/dev/null 2>&1 &
  xvfb=$!
  sleep 1
fi
export DISPLAY=$E2E_DISPLAY
export LAB_ORIGIN="https://lab.localhost:$PROXY_HTTPS_PORT" CSP_ORIGIN="https://csp.localhost:$PROXY_HTTPS_PORT"
export COMPOSE_FILE="$here/docker-compose.yml"
cd "$root/e2e"
npx playwright test -c playwright.injector-coolify.config.ts "$@"
