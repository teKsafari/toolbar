#!/usr/bin/env bash
# Writes .env from .env.example with random values for the secrets marked "!".
# Usage: scripts/gen-secrets.sh [PUBLIC_URL]   (refuses to overwrite an existing .env)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -e .env ] && { echo ".env exists; remove it first" >&2; exit 1; }
hex() { openssl rand -hex "$1"; }
pg=$(hex 16)
sed -e "s#^PUBLIC_URL=.*#PUBLIC_URL=${1:-http://localhost:3000}#" \
    -e "s#^BETTER_AUTH_SECRET=.*#BETTER_AUTH_SECRET=$(hex 32)#" \
    -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$pg#" \
    -e "s#^DATABASE_URL=.*#DATABASE_URL=postgres://toolbar:$pg@localhost:5432/toolbar#" \
    -e "s#^S3_ACCESS_KEY_ID=.*#S3_ACCESS_KEY_ID=GK$(hex 12)#" \
    -e "s#^S3_SECRET_ACCESS_KEY=.*#S3_SECRET_ACCESS_KEY=$(hex 32)#" \
    -e "s#^GARAGE_RPC_SECRET=.*#GARAGE_RPC_SECRET=$(hex 32)#" \
    -e "s#^GARAGE_ADMIN_TOKEN=.*#GARAGE_ADMIN_TOKEN=$(hex 24)#" \
    .env.example > .env
chmod 600 .env
echo "wrote .env (new secrets apply to fresh volumes; existing Postgres and Garage volumes keep their old credentials)"
