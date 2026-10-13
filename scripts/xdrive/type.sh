#!/usr/bin/env bash
set -e; . "$(dirname "$0")/env.sh"
front; xdotool type --delay 30 -- "$*"
