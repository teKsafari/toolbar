#!/usr/bin/env bash
set -e; . "$(dirname "$0")/env.sh"
front; xdotool mousemove "$1" "$2" click "${3:-1}"
