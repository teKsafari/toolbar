#!/usr/bin/env bash
# Compose test of the injector (D-128): builds and starts the injector in front of the lab app,
# runs e2e/injector/injector.spec.ts in a browser without the extension, then stops it.
#
#   apps/injector/test/run.sh
#
# Needs: the lab on :5173 (user service toolbar-lab); an open-toolbar server on SERVER_URL
# (default http://localhost:3306) listening on all interfaces, signing in through the mock OIDC
# provider, with INJECTOR_SECRET set and INJECTOR_ORIGINS containing INJECTOR_URL. The repo
# root .env is read for INJECTOR_SECRET and SERVER_URL when present. KEEP=1 leaves it running.
set -euo pipefail
root=$(cd "$(dirname "$0")/../../.." && pwd)
if [[ -f "$root/.env" ]]; then set -a; . "$root/.env"; set +a; fi
: "${INJECTOR_SECRET:?set INJECTOR_SECRET (the server needs the same value)}"
export INJECTOR_PORT=${INJECTOR_PORT:-3506}
export INJECTOR_URL=${INJECTOR_URL:-http://localhost:$INJECTOR_PORT}
export SERVER_URL=${SERVER_URL:-http://localhost:3306}
export INJECTOR_SERVER_URL=${INJECTOR_SERVER_URL:-http://host.docker.internal:${SERVER_URL##*:}}
compose=(docker compose -f "$root/apps/injector/test/docker-compose.yml")

cleanup() { [[ "${KEEP:-}" == 1 ]] || "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

curl -sf "$SERVER_URL/api/health" >/dev/null || { echo "no server on $SERVER_URL" >&2; exit 1; }
"${compose[@]}" up --build -d --wait
for _ in $(seq 1 30); do curl -sf "$INJECTOR_URL/__toolbar/health" >/dev/null && break; sleep 1; done
cd "$root/e2e"
npx playwright test -c playwright.injector.config.ts "$@"
