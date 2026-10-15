#!/usr/bin/env bash
# Writes .env from .env.example with PUBLIC_URL set and random secrets: BETTER_AUTH_SECRET, and
# the internal Postgres and Garage credentials (uncommented, so they replace the dev defaults).
# Usage: scripts/gen-secrets.sh [PUBLIC_URL]   (refuses to overwrite an existing .env)
# Then fill in OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and ALLOWED_EMAIL_DOMAINS.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -e .env ] && { echo ".env exists; remove it first" >&2; exit 1; }
hex() { openssl rand -hex "$1"; }
pg=$(hex 16)
sed -e "s#^PUBLIC_URL=.*#PUBLIC_URL=${1:-http://localhost:3000}#" \
    -e "s#^BETTER_AUTH_SECRET=.*#BETTER_AUTH_SECRET=$(hex 32)#" \
    -e "s#^\# POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$pg#" \
    -e "s#^\# DATABASE_URL=.*#DATABASE_URL=postgres://toolbar:$pg@localhost:5432/toolbar#" \
    -e "s#^\# S3_ACCESS_KEY_ID=.*#S3_ACCESS_KEY_ID=GK$(hex 12)#" \
    -e "s#^\# S3_SECRET_ACCESS_KEY=.*#S3_SECRET_ACCESS_KEY=$(hex 32)#" \
    -e "s#^\# GARAGE_RPC_SECRET=.*#GARAGE_RPC_SECRET=$(hex 32)#" \
    -e "s#^\# GARAGE_ADMIN_TOKEN=.*#GARAGE_ADMIN_TOKEN=$(hex 24)#" \
    .env.example > .env
chmod 600 .env
echo "wrote .env; now set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and ALLOWED_EMAIL_DOMAINS"
echo "(new secrets apply to fresh volumes; existing Postgres and Garage volumes keep their old credentials)"
