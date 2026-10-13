#!/usr/bin/env bash
# Private X server for the spikes: ./xvfb.sh start | stop. Never use :99 (the shared browser).
# openbox is required: without a window manager Chromium dies with an X BadAtom error
# as soon as the screen-share picker enumerates windows.
# Needs: nix profile add nixpkgs#xorg.xvfb nixpkgs#openbox nixpkgs#ffmpeg-headless
set -e
pids=/tmp/spike-xvfb100.pids
case "${1:-start}" in
  start)
    [ -s "$pids" ] && kill -0 $(head -1 "$pids") 2>/dev/null && { echo "already running"; exit 0; }
    Xvfb :100 -screen 0 1440x900x24 >/dev/null 2>&1 & echo $! > "$pids"; sleep 1
    DISPLAY=:100 openbox >/dev/null 2>&1 & echo $! >> "$pids"; sleep 1
    DISPLAY=:100 xdotool getdisplaygeometry ;;
  stop)
    [ -s "$pids" ] && kill $(cat "$pids") 2>/dev/null; rm -f "$pids" ;;
esac
