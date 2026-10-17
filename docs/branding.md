# Branding an instance

Name, logo and accent colour apply to the sign-in page, share pages, recording links, the dashboard, favicons, mail, and the extension once signed in. Set them in Settings > Server, Branding, or by variable; a set variable wins and locks the field. Defaults: `open-toolbar`, a filled rectangle, accent `#000000` (near-white `#fafafa` on dark pages).

| Variable | Example | Effect |
|---|---|---|
| `APP_NAME` | `Acme Review` | Name in titles, headers, mail, the MCP server title and the extension. 1 to 40 letters, digits, spaces or `. , ' & ( ) + _ -`. |
| `APP_LOGO_URL` | `https://acme.example/logo.svg` or `file:///brand/logo.svg` | SVG or PNG, at most 512 KB, fetched once at start (5 s timeout, same-host redirects only) and copied to object storage. `file:` paths are inside the container. On failure the server logs a warning and uses the default. |
| `APP_LOGO_DARK_URL` | | Logo for dark pages. Optional. |
| `APP_ACCENT` | `#0b7a5c` | Buttons, links, focus rings, the toolbar's main button and the default logo. The server picks white or near-black text and refuses a colour where neither reads. Hover, pressed, link and focus shades are derived at WCAG AA contrast; dark pages get a lighter shade (black and greys become near-white). Background, surfaces, text and status colours stay neutral. |

`ADMIN_EMAILS` names who may open Settings > Server; see `docs/configuration.md`, "Who gets in".

## Logos

- SVG or PNG, at most 512 KB; PNG at most 2048 by 2048; SVG needs a `viewBox` or width and height.
- SVGs with scripts, event handlers, embedded HTML, `<image>` or `<use>`, external references or a DOCTYPE are refused with the reason. Editor metadata is dropped.
- The server renders square PNG icons at 16, 32, 48, 128, 180 and 512 px and a 64 px high `email.png`. Wide logos sit centred in the squares, so a compact mark works best. The default rectangle's PNG icons get a thin edge in the accent's text colour so they read on dark browser toolbars.
- Served from `/brand/`: `logo.svg` or `logo.png`, `logo-dark.*`, `icon-<size>.png`, `email.png`. `/favicon.ico` redirects to the 32 px icon. URLs carry `?v=` and are cached for a year.
- `GET /api/v1/branding` returns the name, accent and absolute file URLs without sign-in.

## The browser extension

The manifest name (shown in `chrome://extensions`, the store and permission prompts) is fixed at build time. After sign-in the extension uses the server's brand for its toolbar icon, tooltip, popup, options page, draft editor and recording bar; sign-out restores its own.

A fully branded build:

```sh
WXT_APP_NAME="Acme Review" WXT_APP_ICON=/path/to/icon.svg WXT_SERVER_URL=https://review.acme.example \
  pnpm --filter @toolbar/extension build
```

`WXT_APP_ICON` takes SVG or PNG and renders the 16, 32, 48 and 128 px icons. Publishing your own build needs your own manifest key, which changes the extension id; add it to `EXTENSION_IDS`.

## Fixed names

These identify the software and do not change per instance: the MCP server name `open-toolbar` (`mcp__open-toolbar__...` tools), the paused CLI `open-toolbar`, the `x-toolbar-*` headers and the `toolbar-*` webhook user agents.
