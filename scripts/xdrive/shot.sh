#!/usr/bin/env bash
set -e; . "$(dirname "$0")/env.sh"
out=${1:-/tmp/xdrive/shot.png}; mkdir -p "$(dirname "$out")"
import -window root "$out"; echo "$out"
