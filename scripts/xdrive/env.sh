export DISPLAY=:99
command -v xdotool >/dev/null || { echo "install with: nix profile add nixpkgs#xdotool nixpkgs#imagemagick" >&2; exit 1; }
front() { local w; w=$(xdotool search --onlyvisible --class chromium | tail -1); [ -n "$w" ] && xdotool windowactivate --sync "$w" 2>/dev/null; true; }
