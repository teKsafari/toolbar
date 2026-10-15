# Branding an instance

open-toolbar shows its own name and a filled rectangle as its logo. On your server you can replace both and pick the accent colour. People see your brand on the sign-in page, share pages, recording links, the dashboard, browser tabs (favicon), mail, and in the browser extension once it is signed in to your server.

## Two ways to set it

1. **Environment variables**, read when the server starts. A value set here wins and is shown read-only in the admin page.
2. **Settings > Server**, in the dashboard. Only the instance admin sees this page; it saves at once.

When neither sets a field, the default applies: `open-toolbar`, the rectangle, accent `#3446cf`.

| Variable | Example | What it does |
|---|---|---|
| `APP_NAME` | `Acme Review` | Product name in titles, headers, mail, the MCP server title and the extension. 1 to 40 letters, digits, spaces or `. , ' & ( ) + _ -`. |
| `APP_LOGO_URL` | `https://acme.example/logo.svg` or `file:///brand/logo.svg` | Logo, SVG or PNG, at most 512 KB. The server fetches it once at start (5 s timeout, redirects only on the same host) and keeps a copy in object storage. A `file:` path is inside the server container, so mount it as a volume. If the fetch fails, the server logs a warning and shows the default. |
| `APP_LOGO_DARK_URL` | | Logo for dark pages. Optional. |
| `APP_ACCENT` | `#0b7a5c` | Accent colour for buttons, links and the default logo. The server picks white or near-black text on it and refuses a colour where neither reads well. Dark pages get a lighter shade of it. |
| `ADMIN_EMAILS` | `ops@acme.example,lee@acme.example` | Who may open Settings > Server. Each address must be verified by your sign-in provider. |

Without `ADMIN_EMAILS`, the first account created on the server is the instance admin. On a server reachable from the internet someone else could sign up first, so set `ADMIN_EMAILS`; the server logs a warning at start when it is empty on a public URL.

## Logos

- Formats: SVG or PNG, at most 512 KB; a PNG at most 2048 by 2048 pixels; an SVG needs a `viewBox` or a width and height.
- SVG files are cleaned on upload. A file with scripts, event handlers, embedded HTML, `<image>` or `<use>` elements, links to other files or a DOCTYPE is refused with the reason, so export a plain vector file. Editor metadata (Inkscape, Figma) is dropped.
- From the logo the server renders square PNG icons at 16, 32, 48, 128, 180 and 512 pixels (favicons, the iOS home-screen icon, the extension's toolbar icon) and a 64 px high PNG for mail, since most mail clients show no SVG. A wide logo sits centred in the square icons, so a compact mark works best there.
- Files are served from `/brand/`: `logo.svg` or `logo.png`, `logo-dark.*`, `icon-<size>.png`, `email.png`. `/favicon.ico` redirects to the 32 px icon. With the current `?v=` they are cached for a year, so a change shows at once with new URLs.
- `GET /api/v1/branding` returns the name, accent and absolute file URLs, without sign-in.

## The browser extension

The extension's name in `chrome://extensions`, the store and permission prompts comes from its manifest, which no server can change. After sign-in the extension fetches your server's brand and uses it for the toolbar icon and its tooltip, the popup, the options page, the draft editor and the accent of the in-page recording bar. Signing out puts back the extension's own icon and name.

To ship an extension with your name and icon everywhere, build it yourself:

```sh
WXT_APP_NAME="Acme Review" WXT_APP_ICON=/path/to/icon.svg WXT_SERVER_URL=https://review.acme.example \
  pnpm --filter @toolbar/extension build
```

`WXT_APP_ICON` takes an SVG or PNG; the build renders the 16, 32, 48 and 128 px icons from it. A build of your own needs a signing key of your own (the manifest `key`), which gives it a different extension id; add that id to the server's `EXTENSION_IDS`.

## Fixed names

Some names identify the software, not the instance, and stay the same on every server: the MCP server name `open-toolbar` (tools appear as `mcp__open-toolbar__...` in agents), the paused command-line tool `open-toolbar`, the `x-toolbar-*` headers and the `toolbar-*` user agents of webhooks. Agent configurations, skills and webhook receivers depend on them.
