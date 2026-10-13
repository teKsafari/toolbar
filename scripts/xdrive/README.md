# xdrive

Helpers that drive the shared Chromium on the VNC display `:99` with real input, for browser UI that page automation cannot reach (extension toolbar buttons, popups, the screen picker, browser-level shortcuts).

- `shot.sh [file]`: screenshot of the whole display (1584x952) to `file` (default `/tmp/xdrive/shot.png`). Prints the path.
- `click.sh X Y [button]`: click at display coordinates.
- `key.sh KEYS...`: send keys, xdotool syntax (`ctrl+shift+e`, `Escape`, `Return`).
- `type.sh TEXT`: type text.
- `front.sh`: raise and focus the Chromium window.

Coordinates come from `shot.sh` images at 1:1 scale.
