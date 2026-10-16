#!/usr/bin/env bash
# Every e2e suite against a freshly seeded compose stack: the area suites (e2e/tests, test build
# of the extension, mock and real servers) and the user journeys (e2e/flows, release build).
#
#   scripts/e2e-all.sh              # wipe the volumes, rebuild, seed, build, run both suites
#   KEEP=1 scripts/e2e-all.sh       # keep the running stack and its data; seed again and run
#   RUNS=3 scripts/e2e-all.sh       # three full runs in a row, each from wiped volumes
#
# Needs Docker, the lab (user service toolbar-lab on :5173 and :5174), Xvfb, openbox, xdotool,
# xclip, ImageMagick and ffmpeg. Displays: AREA_DISPLAY (default :101) and FLOWS_DISPLAY
# (default :120); never :99. The stack runs with AUTH_RATE_LIMIT=off, because the suites sign in
# many test accounts from one address. Logs land in e2e/runs/.
#
# Sign-in goes through the mock OIDC provider of docker-compose.dev.yml (D-114, D-194), with an
# allowlist that admits the *.test addresses the suites use. AUTH_DEV_PASSWORD=1 stays on for the
# seeded accounts (dana@ and sam@toolbar.test), which have only a password. Paused features stay
# off, so their tests skip with "paused (docs/scope.md)". Transcription runs on the local whisper.cpp
# (docker-compose.whisper.yml, TRANSCRIBE_PROVIDER=local). MAIL=1 turns FEATURE_EMAIL on with
# Mailpit (the override docker-compose.mail.yml, D-171), and FEATURES="FEATURE_AI=1 FEATURE_TRACKERS=1 ..." sets others.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
AREA_DISPLAY=${AREA_DISPLAY:-:101}
FLOWS_DISPLAY=${FLOWS_DISPLAY:-:120}
RUNS=${RUNS:-1}
LOGS=$ROOT/e2e/runs
mkdir -p "$LOGS"
[ "$AREA_DISPLAY" = ":99" ] || [ "$FLOWS_DISPLAY" = ":99" ] && { echo "display :99 belongs to the shared browser" >&2; exit 2; }

step() { printf '\n== %s\n' "$*"; }

step "builds"
pnpm --filter @toolbar/extension build >/dev/null || exit 1
pnpm --filter @toolbar/extension build:test >/dev/null || exit 1
pnpm --filter @toolbar/cli build >/dev/null || exit 1

# A fresh stack and seed for every run: the suites leave captures, members and workspaces
# behind, and some area tests count what a workspace holds.
fresh() {
  step "stack"
  if [ "${KEEP:-0}" != 1 ]; then docker compose -f docker-compose.yml -f docker-compose.whisper.yml -f docker-compose.dev.yml -f docker-compose.mail.yml down -v || exit 1; fi
  local profiles=(-f docker-compose.yml -f docker-compose.whisper.yml -f docker-compose.dev.yml)
  if [ "${MAIL:-0}" = 1 ]; then profiles+=(-f docker-compose.mail.yml); fi
  # shellcheck disable=SC2086
  env ${FEATURES:-} \
    OIDC_ISSUER=http://oidc.localhost:3311/toolbar OIDC_CLIENT_ID=toolbar OIDC_CLIENT_SECRET=dev OIDC_PROVIDER_NAME="Dev SSO" \
    ALLOWED_EMAIL_DOMAINS=test AUTH_DEV_PASSWORD=1 AUTH_RATE_LIMIT=off TRANSCRIBE_PROVIDER=local \
    docker compose "${profiles[@]}" up --build -d || exit 1
  for _ in $(seq 1 120); do curl -sf localhost:3000/api/health >/dev/null && break; sleep 2; done
  curl -sf localhost:3000/api/health >/dev/null || { echo "server not healthy" >&2; exit 1; }
  curl -sf localhost:5173/ >/dev/null || { echo "lab not answering on :5173 (systemctl --user start toolbar-lab)" >&2; exit 1; }

  step "seed"
  pnpm --filter @toolbar/server db:seed | tee "$LOGS/seed.log" || exit 1
  TOOLBAR_E2E_TOKEN=$(sed -n 's/^ *token: *\(tb_pat_[A-Za-z0-9_-]*\).*/\1/p' "$LOGS/seed.log")
  export TOOLBAR_E2E_TOKEN
}

status=0
for run in $(seq 1 "$RUNS"); do
  fresh || exit 1
  step "run $run of $RUNS: area suites on $AREA_DISPLAY"
  (cd e2e && E2E_DISPLAY=$AREA_DISPLAY npx playwright test --reporter=list) >"$LOGS/area-$run.log" 2>&1
  a=$?
  tail -n 6 "$LOGS/area-$run.log"
  step "run $run of $RUNS: flows on $FLOWS_DISPLAY"
  (cd e2e && E2E_DISPLAY=$FLOWS_DISPLAY npx playwright test -c playwright.flows.config.ts --reporter=list) >"$LOGS/flows-$run.log" 2>&1
  f=$?
  tail -n 6 "$LOGS/flows-$run.log"
  grep -h "LIMITATION" "$LOGS/flows-$run.log" || true
  [ $a -eq 0 ] && [ $f -eq 0 ] || status=1
done
exit $status
