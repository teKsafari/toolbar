# Branding: rename Nib to toolbar, and let admins set the name and logo

Status: built on 2026-10-15 (D-111 to D-113, user docs in `docs/branding.md`); the name is open-toolbar (D-083), so read "toolbar" below as open-toolbar for display text and slugs. Research for D-074 (owner decision, 2026-10-14). Written 2026-10-14 against commit `42b3f05`.

Owner request: the product is called "toolbar". The default logo is a plain filled rectangle. People who self-host, and the admins of an instance, set the app name and the logo themselves.

## 1. Recommendation in short

1. One **instance brand** per server: `name`, `logo` (light and optional dark), `accent`. Workspaces keep their own name and avatar (J-172) for the workspace switcher only; they do not rebrand the product.
2. Precedence per field: **env var** (and then the field is locked in the UI) > **database** value set in the admin UI > **built-in default** ("toolbar", the rectangle, ink-600 `#3446cf`). This is the Mattermost and Discourse model.
3. Env vars: `APP_NAME`, `APP_LOGO_URL`, `APP_LOGO_DARK_URL`, `APP_ACCENT`, `ADMIN_EMAILS`.
4. Storage: one row in a new `instance_setting` table (`key = 'branding'`, `value jsonb`). Logo files go to Garage under `brand/<sha256>/...`, with PNG renditions made by sharp at upload time.
5. Who can change it: the **instance admin**. That is a verified user whose email is in `ADMIN_EMAILS`, or, when `ADMIN_EMAILS` is empty, the first account on the server (the rule J-177 already uses). No Better Auth admin plugin for now.
6. Admin UI: a new page `Settings > Server` (`/settings/server`), shown only to the instance admin.
7. Logo formats: SVG (sanitized with DOMPurify, served with a sandbox CSP) and PNG. Max 512 KB, PNG max 2048 px a side. Favicons, apple-touch, extension icons and the email logo are PNGs rendered from the upload.
8. SSR: `hooks.server.ts` puts the cached brand on `event.locals`; the root `+layout.server.ts` returns it; `transformPageChunk` writes the favicon links and an accent `<style>` into `app.html`, so the first paint is right.
9. Extension: the build-time name and icon come from `WXT_APP_NAME` and `WXT_APP_ICON` (default "toolbar" and the rectangle). After sign-in it fetches `/api/v1/branding` and applies the server's name and icon with `action.setTitle` and `action.setIcon({ imageData })`; the popup, options, editor and in-page UI show the server's name and logo. The manifest name cannot change at runtime.
10. CLI binary `toolbar`, MCP server name `toolbar`, user agents `toolbar-*`: fixed, never branded, because agent configs, skills and tool names key on them.
11. Rename: `PRODUCT_NAME = 'toolbar'`, `PRODUCT_SLUG = 'toolbar'`, `x-nib-*` headers become `x-toolbar-*`, extension storage keys move from `nib:` to `tb:` with a one-time migration. HKDF info strings and the IndexedDB name stay as they are (changing them would lose data).

## 2. Inventory: where the name and logo appear today

`PRODUCT_NAME = 'Nib'` and `PRODUCT_SLUG = 'nib'` live in `packages/shared/src/constants.ts`. Most surfaces import them; the rest hard-code the string.

### 2.1 Build time (baked into a bundle or a package; a running server cannot change them)

| Surface | File | What |
|---|---|---|
| Extension manifest `name`, `action.default_title` | `apps/extension/wxt.config.ts` | `PRODUCT_NAME`, `"(test)"` suffix for test builds |
| Extension manifest `description` | same | product-neutral text, keep |
| Extension toolbar icons | `apps/extension/public/icon/{16,32,48,128}.png`, source `apps/extension/assets/icon.svg` | pen-nib mark on an ink tile |
| Extension page titles | `entrypoints/popup/index.html` ("Nib"), `options/index.html` ("Nib options"), `editor/index.html` ("Nib draft"), `offscreen/index.html` ("Nib recorder"), `permissions/index.html` (title and body text) | hard-coded |
| Extension icon restore after recording | `apps/extension/lib/bg/ui.ts:314-315` | resets to `/icon/*.png` and the manifest name |
| Extension content script name | `apps/extension/entrypoints/nib-web.content.ts` | entrypoint file name becomes the output path |
| Extension storage keys | `packages/shared/src/ext/storage.ts` (`nib:*`), `lib/capture/store.ts` (`nib:cap:*`), `lib/bg/ui.ts` (`nib:popup-screen`, `nib:reopen-popup`), `entrypoints/capture.content/Toolbar.svelte` (`nib:settings`), `packages/shared/src/areas/editor.ts` (`nib:editor-prefs`) | persisted in users' browsers |
| Extension IndexedDB name | `packages/shared/src/ext/storage.ts:149` (`name: 'nib'`) | persisted drafts and chunks |
| Extension alarm, WXT module, DOM attrs | `lib/capture/service.ts` (`nib-upload-drain`), `modules/editor.ts` (`nib-editor`), `capture.content/ui/blur.ts` (`data-nib-blurred`), `packages/shared/src/ext/messages.ts` (`__nib_editor`), `areas/dashboard-ext.ts` (`nib:new-capture`, `data-nib-extension`) | internal |
| Log prefixes | `entrypoints/background.ts`, `lib/bg/ui.ts`, `lib/bg/drafts.ts` (`[nib]`) | internal |
| Page SDK alias | `packages/capture/src/metadata.ts` (`window.nib`, beside `window.toolbar.setMetadata`), `packages/capture/src/rrweb.ts` (`nib-block` class) | page-facing API |
| UI logo icon | `packages/ui/src/icons.ts` (`logo`: the pen nib), header comment | used by every `<Icon name="logo">` |
| Design tokens comment, palette | `packages/ui/src/tokens.ts`, generated `tokens.css`; `--nb-*` prefix in 111 files (1454 uses) | accent `ink[600]` |
| Server favicon | `apps/server/static/favicon.svg`, linked from `apps/server/src/app.html` | pen nib, stroke `#3446cf` |
| CLI binary and package | `packages/cli/package.json` (`bin.nib`, description), `tsdown.config.ts` (`entry: { nib }`), `src/main.ts` (help text, `nib-captures` skill dir), `src/config.ts` (`~/.config/nib`, `NIB_CONFIG`, `NIB_SERVER`, `NIB_TOKEN`), `src/client.ts` (`x-nib-client`, messages), `src/login.ts` (OAuth `client_name`, page title), `src/create.ts` (`ua: 'nib CLI'`, temp names), `src/record.ts` (`NIB_CDP_PROXY`, messages), `src/draw.ts` (comment) | |
| CLI install scripts and bundle path | `apps/server/src/lib/server/mcp/cli-bundle.ts` (`/cli/nib.mjs`, `NIB_INSTALL_DIR`, `nib.cmd`), `apps/server/src/routes/cli/[file]/+server.ts` | |
| MCP and CLI names | `packages/shared/src/areas/agent.ts` (`MCP_SERVER_NAME = CLI_BIN = PRODUCT_SLUG`; skill text uses `PRODUCT_NAME`), `apps/server/src/lib/server/mcp/data.ts` (`CLI_NAME = 'nib'`) | |
| Protocol headers | `packages/shared/src/api/common.ts` (`x-nib-share`), `api/integrations.ts` (`x-nib-signature`, `x-nib-event`, `x-nib-delivery`), `apps/server/server.js` (`x-nib-origin-proto/host`), `routes/api/v1/recordings/[id]/frames/+server.ts` (`x-nib-frame-*`), `lib/server/mcp/protocol.ts` (`x-nib-client`) | |
| User agents | `lib/server/webhooks/index.ts` (`nib-webhooks/1`), `lib/server/integrations/providers.ts` (`nib-server`) | |
| Crypto domain separators | `lib/server/crypto.ts` (`nib-seal-v1`), `lib/server/upload/token.ts` (`nib-upload-v1`) | **freeze**: sealed tokens in the DB depend on them |
| Cookie and local storage | `lib/server/viewer/access.ts` (`nib_anon`), dashboard and viewer `localStorage` keys `nib.*`, `invalidate('nib:shell')`, `DRAG_MIME` | |
| Defaults in config | `.env.example:72`, `docker-compose.yml:30`, `lib/server/env.ts:65` (`MAIL_FROM=Nib <nib@localhost>`) | |
| Dev scaffolding | `apps/server/vite.config.ts` (plugin name), `scripts/seed.ts` (`@nib.test`, password), `scripts/check-server-core.ts`, `lib/server/media/ffmpeg.ts`, `lib/server/mcp/frames.ts` (temp dirs), `packages/ui/src/viewer/markdown.ts` (`embed_host=nib`), settings pages' sample text (`$NIB_TOKEN`, `nib-webhook`, `window.nib`) | |
| Better Auth `appName` | `apps/server/src/lib/server/auth.ts:69` | read once at startup |

### 2.2 Runtime (rendered per request by the server; can follow an admin setting)

| Surface | File |
|---|---|
| Page titles | `routes/login/+page.svelte`, `invite/[id]/+page.svelte`, `mcp/authorize/+page.svelte`, `s/[token]/+error.svelte`, `(app)/c/[id]/+error.svelte`, `lib/components/viewer/CaptureView.svelte`, `viewer/TitleDescription.svelte` (`document.title`) |
| Brand mark plus name in a header | `login/+page.svelte:25`, `mcp/authorize/+page.svelte:21`, `rl/[token]/+page.svelte:153` (recording link page, public), `lib/components/viewer/Header.svelte:155` (share page and viewer) |
| Body copy | `login/+page.svelte:41`, `invite/[id]/+page.svelte:18`, `(app)/settings/browsers/+page.svelte:12`, `lib/components/dashboard/NewCapture.svelte:29,34` |
| Emails | `lib/server/auth.ts:46-48` (magic link), `auth/invites.ts:90-93`, `auth/workspaces.ts:207`, `viewer/comments.ts:194`, `dashboard/folders.ts:168`, `dashboard/notices.ts:53,75`, `dashboard/workspace.ts:279`; HTML shell in `lib/server/mail-templates/index.ts` (button color `#3446cf` hard-coded); sender `MAIL_FROM` |
| API self-description | `routes/api/v1/+server.ts` (`{ name: PRODUCT_NAME }`), `lib/server/mcp/oauth.ts:45` (`resource_name: 'Nib captures'`) |
| MCP display text | `lib/server/mcp/protocol.ts` (`serverInfo.title`, `INSTRUCTIONS`), `lib/server/mcp/tools.ts:146` (tool description) |
| Share markdown and agent prompts | `packages/shared/src/derive/summary.ts:188-191` (via `lib/server/mcp/markdown.ts`), `AgentTab.svelte:92` |
| Favicon link | `apps/server/src/app.html` (static `favicon.svg`) |
| OG and meta tags | none today besides `robots` on `/s/` and `/rl/` |
| Extension UI text from `PRODUCT_NAME` | `popup/App.svelte:39`, `popup/screens/SignedOut.svelte:23,25`, `options/App.svelte:41,44`, `lib/auth/AccountCard.svelte:41` (bundled today, runtime after this change) |

Existing related pieces: workspaces already have a name and a logo (`organization.logo`, `routes/(app)/settings/workspace`, `PUT` with `logoAssetId`), served by `/api/v1/assets/[id]` with `public, max-age=86400`. Asset uploads already refuse SVG (`BLOCKED_TYPES` in `lib/server/upload/service.ts:373`). The server sets no CSP today; `docs/architecture.md` section 8 plans one for `/s/*`.

## 3. Prior art

| Product | Name | Logo | Where stored | Who |
|---|---|---|---|---|
| Mattermost | `TeamSettings.SiteName`, env `MM_TEAMSETTINGS_SITENAME` | custom brand image (login page), upload only, no config key | `config.json` or DB config; uploaded file in file store | system admin; an env var locks the field: "This setting has been set through an environment variable. It cannot be changed through the System Console." |
| Discourse | `title` site setting | `logo`, `logo_dark`, `logo_small`, `mobile_logo`, `favicon`, `large_icon`, `digest_logo` (email, "Don't use an SVG image") | site settings in DB, uploads | staff admin at `/admin/config/logo`; settings marked `shadowed_by_global` can come from `DISCOURSE_*` env, and env wins |
| Gitea / Forgejo | `APP_NAME` in `app.ini`, env `GITEA____APP_NAME` | replace `custom/public/assets/img/{logo,favicon}.{svg,png}`, `apple-touch-icon.png`; `make generate-images` renders the PNGs from the SVG | files on disk | whoever runs the server; no UI |
| Grafana | `[white_labeling] app_title`, env `GF_WHITE_LABELING_APP_TITLE` | `login_logo`, `menu_logo`, `fav_icon`, `apple_touch_icon` as URLs to images hosted elsewhere | `grafana.ini` / env | operator; Enterprise only |
| Cal.com | `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_COMPANY_NAME` | build-time assets | baked at image build (`NEXT_PUBLIC_*`); setting them on a prebuilt image does nothing | operator, rebuild required; per-team brand colors in DB |
| Outline | product name fixed | workspace name, avatar and accent color (custom theme) per workspace | DB | workspace admin |
| Coolify | "Instance name" in Settings > Configuration (dashboard label only) | none | DB | instance admin |
| Sentry self-hosted, Plausible CE | fixed | fixed (fork or proxy tricks only) | n/a | n/a |

What to take from this:

- **Env for operators, UI for admins, env wins and locks the field** (Mattermost, Discourse). A Coolify user can set everything in the compose env and never open the UI; someone without shell access can still change it.
- **Runtime, not build time** for the server (Cal.com's `NEXT_PUBLIC_*` trap). SvelteKit `$env/static/*` would bake values in; read `process.env` on the server only.
- **Render PNGs from one source** (Gitea's `generate-images`), at upload time instead of at build.
- **Separate email logo as PNG** (Discourse `digest_logo`).
- **Hosted by the app** (Discourse, Mattermost) beats Grafana's external URLs: no third-party request from viewers' browsers, no `img-src` hole, and the server can make PNG sizes.

## 4. Who can change it

The server has one instance and many workspaces. Workspace roles (`owner`, `admin`, `creator`, `viewer`) live on Better Auth's `member` table. Product branding belongs to the instance: the login page, share pages, emails and the extension are seen before or outside any workspace. So:

- **Instance admin** edits branding. A workspace admin does not.
- **Workspace admin** keeps the workspace name and avatar (J-172). The avatar shows in the workspace switcher and members list. Later, if wanted, emails about one workspace could add its avatar; not in this change.

Choosing the instance admin:

- `ADMIN_EMAILS` (comma separated). A user counts as admin when their email is in the list **and** `emailVerified` is true. The check on `emailVerified` matters: Part 1 allows email and password sign-up with autoSignIn and no verification, so anyone could register `admin@yourco.com`.
- When `ADMIN_EMAILS` is empty: the first account by `createdAt` (the "server admin" of J-177 in `lib/server/dashboard/links.ts:236`). Mattermost and Discourse make the first registered user the admin too. Risk: on a public instance someone else can sign up first. The server should log a warning at start when `PUBLIC_URL` is not localhost and `ADMIN_EMAILS` is empty, and `.env.example` should mark it "!".
- Put both rules in one helper, `isInstanceAdmin(db, user)` in `apps/server/src/lib/server/auth/instance.ts`, and move `supportLinkUrl()` onto it.

Better Auth admin plugin (`better-auth/plugins/admin`): adds `user.role`, `banned`, `banReason`, `banExpires`, `session.impersonatedBy`, options `adminRoles`, `adminUserIds`, `defaultRole`, and bootstraps the first admin with `npx auth create-admin`. It also exposes `/admin/*` endpoints (create user, set role, ban, impersonate). We need one boolean, not user management, and a CLI bootstrap step does not fit "set env in Coolify and deploy". Skip it now. If user management lands later, adopt it then and feed `adminUserIds` from the same helper; add its paths to `disabledPaths` the way `ORG_PATHS` are handled.

## 5. Config and data model

### 5.1 Env vars (Coolify: Environment Variables of the compose service)

| Var | Example | Meaning |
|---|---|---|
| `APP_NAME` | `Acme Review` | product name; 1 to 40 chars, no control characters |
| `APP_LOGO_URL` | `https://acme.com/logo.svg` or `file:///data/brand/logo.svg` | light logo, fetched once at start (see 8.2) |
| `APP_LOGO_DARK_URL` | | dark-theme logo, optional |
| `APP_ACCENT` | `#0b7a5c` | accent hex; drives the default logo color too |
| `ADMIN_EMAILS` | `ops@acme.com,lee@acme.com` | instance admins (section 4) |
| `MAIL_FROM` | exists | default changes to `${name} <noreply@<PUBLIC_URL host>>` when unset |

Names follow the repo's unprefixed style (`PUBLIC_URL`, `MAIL_FROM`). Coolify injects only `COOLIFY_*` and `SERVICE_*` vars into a compose service, so `APP_*` does not collide. Add all of them to `docker-compose.yml` (`${APP_NAME:-}` and so on), `.env.example` and `lib/server/env.ts`.

### 5.2 Table

```ts
// apps/server/src/lib/server/db/schema/core.ts
export const instanceSetting = pgTable('instance_setting', {
  key: text('key').primaryKey(),             // 'branding'
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => user.id, { onDelete: 'set null' }),
});
```

`value` for `branding` (zod schema `brandingStoredSchema` in `packages/shared/src/api/branding.ts`):

```ts
{ name?: string; accent?: string;
  logo?: { light?: LogoRef; dark?: LogoRef } }
type LogoRef = { hash: string; type: 'image/svg+xml' | 'image/png'; width: number; height: number };
```

A key-value table instead of a `branding` table: the next instance-wide setting (support link, sign-up policy) needs no migration. One row, no history; the audit log (J-178) records changes.

### 5.3 Resolution

```ts
// apps/server/src/lib/server/branding/index.ts
export interface Brand {
  name: string; accent: string; onAccent: '#ffffff' | '#121211';
  logo: { light: string; dark: string | null; png: Record<16|32|48|128|180|512, string>; email: string };
  version: string;                      // short hash of everything above; used as ?v=
  locked: { name: boolean; logo: boolean; logoDark: boolean; accent: boolean };
}
```

Per field: env set → env value, locked; else DB value; else default. `getBrand()` keeps the result in a module variable; `PUT`/upload/delete call `invalidateBrand()`. The server is one Node process (architecture section 3); still re-read the row when older than 60 s, so a second replica or a `psql` edit shows up within a minute.

Accent: derive `accent-hover`, `accent-text`, `accent-tint` and the dark-theme pair with `color-mix(in oklch, ...)` in CSS, and pick `on-accent` (white or `paper-950`) by WCAG contrast, needing at least 4.5:1. Reject an accent that meets neither. Accent is optional for the owner's request; it is cheap, and the default logo needs a color.

## 6. Logo handling

### 6.1 Default logo

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" fill="#3446cf"/></svg>
```

`fill` is the resolved accent. At 16 px it is a 13 by 7 px bar, still legible. In `packages/ui/src/icons.ts` the `logo` icon becomes `['<rect x="2" y="7" width="20" height="10" fill="currentColor" stroke="none"/>']`, so `<Icon name="logo">` follows the text color as today. The extension's build-time icon (`assets/icon.svg`) becomes the same rect on a transparent 128 canvas, scaled (`x=8 y=40 width=112 height=48`); generate `public/icon/*.png` from it with a small script (`apps/extension/scripts/icons.ts`, sharp) instead of keeping hand-made PNGs.

The default needs no stored file: `/brand/*` routes render it from the accent on the fly (and cache it by version).

### 6.2 Upload rules

- Types: `image/svg+xml` and `image/png`. JPEG/WebP add little for a logo; leave them out.
- Size: 512 KB max. PNG at most 2048 by 2048. SVG must have a `viewBox` or width and height.
- SVG sanitizing: `isomorphic-dompurify` 4.5.x (DOMPurify 3.4.x on jsdom) with `USE_PROFILES: { svg: true, svgFilters: true }`, `FORBID_TAGS: ['foreignObject', 'script', 'style', 'a', 'image', 'use']`, `FORBID_ATTR` for every `on*` (default) plus `href`/`xlink:href` except `#fragment` references. Reject the file when the sanitized output differs in element count from the input, so the admin sees "this SVG has scripts or external references" instead of a silently broken logo. Strip `<!DOCTYPE>`/entities before parsing (billion laughs).
- Serving SVG: `Content-Type: image/svg+xml`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, `Content-Disposition: inline; filename="logo.svg"`. Pages embed it only with `<img>`, where scripts never run; the headers cover someone opening the URL directly.
- Rasterize with sharp 0.35.x (it reads SVG through librsvg and has prebuilt linux-x64 glibc binaries that run in `node:24-bookworm-slim`). Feed it the **sanitized** SVG. Outputs, stored next to the original in Garage at `brand/<sha256>/`: `16.png 32.png 48.png 128.png 180.png 512.png` (logo centered on a transparent square, `fit: contain`) and `email.png` (height 64, width up to 320, 2x for a 32 px display height).
- The asset table's existing SVG ban stays for every other asset kind.

### 6.3 Serving and cache busting

| Route | Body |
|---|---|
| `/brand/logo.svg` or `/brand/logo.png` | light logo, original type |
| `/brand/logo-dark.{svg,png}` | dark logo, 404 when none |
| `/brand/icon-{16,32,48,128,180,512}.png` | square PNGs |
| `/brand/email.png` | email logo |
| `/favicon.ico` | 302 to `/brand/icon-32.png?v=` (old browsers and bots ask for it) |

All take `?v=<version>`. With `v` matching the current version: `Cache-Control: public, max-age=31536000, immutable`. Without it or stale: `public, max-age=300`. Files come through the existing `proxyObject()` S3 proxy. `app.html` gets `%brand.head%`, replaced in `transformPageChunk`:

```html
<link rel="icon" href="/brand/logo.svg?v=ab12" type="image/svg+xml">   <!-- or icon-32.png for a PNG logo -->
<link rel="icon" href="/brand/icon-32.png?v=ab12" sizes="32x32">
<link rel="apple-touch-icon" href="/brand/icon-180.png?v=ab12">
<meta property="og:site_name" content="Acme Review">
<style>:root{--nb-accent:#0b7a5c;--nb-on-accent:#fff}</style>
```

Delete `apps/server/static/favicon.svg`.

### 6.4 Light and dark

`<picture><source srcset="/brand/logo-dark.svg?v=" media="(prefers-color-scheme: dark)"><img src="/brand/logo.svg?v=" alt="Acme Review"></picture>` in a `BrandMark.svelte`. The dashboard also has a manual theme (`nib.theme` in localStorage, `HelpMenu.svelte`), so `BrandMark` reads the resolved theme from the root's `data-theme` and switches `src` instead of relying only on the media query. The default rectangle needs no dark variant: the dark accent token (`ink[400]`) is applied.

### 6.5 Emails

Gmail, Outlook and most webmail clients do not render SVG, and many block images until the reader allows them. So the email header is `<img src="${PUBLIC_URL}/brand/email.png?v=..." height="32" alt="${name}">` followed by the name in text, and the plain-text part names the product. The button color in `mail-templates/index.ts` uses the brand accent and on-accent. All mail code calls `getBrand()` for the name instead of importing `PRODUCT_NAME`.

## 7. API and admin UI

Contracts in `packages/shared/src/api/branding.ts`, registered in the route table:

| Route | Auth | Body / response |
|---|---|---|
| `GET /api/v1/branding` | public | `{ name, accent, onAccent, version, logo: { light, dark, icons: { '16': url, ... }, email } }` with absolute URLs. `Cache-Control: public, max-age=60`. Used by the extension, the CLI (`toolbar login` can print the server's name) and the login page. |
| `GET /api/v1/admin/branding` | instance admin | stored values plus `locked` flags and `defaults` |
| `PUT /api/v1/admin/branding` | instance admin | `{ name?: string \| null, accent?: string \| null }`; `null` resets to default; a locked field returns 409 `locked_by_env` |
| `PUT /api/v1/admin/branding/logo?variant=light\|dark` | instance admin | multipart `file`; 415 for other types, 413 over 512 KB, 422 for a rejected SVG |
| `DELETE /api/v1/admin/branding/logo?variant=light\|dark` | instance admin | back to the default (light) or none (dark) |

Also add `branding` to `extBootstrapSchema` (`packages/shared/src/api/account.ts`) so the extension gets it in the call it already makes, and `isInstanceAdmin` to the shell data so the settings nav can show the page.

Admin UI: `apps/server/src/routes/(app)/settings/server/+page.svelte` (+ `+page.server.ts` that 404s for non-admins), nav label "Server". Fields: Name; Logo (light), Logo (dark); Accent (color input plus hex); a live preview of the login header, a favicon at 16 px and the extension icon at 16 and 32 px on light and dark toolbars. A field set by env shows the value, disabled, with "Set by APP_NAME on the server". Writes go to the audit log as `instance.branding.updated`.

## 8. Security

1. **SVG XSS**: sanitize on upload (6.2), serve with `sandbox` CSP and `nosniff`, embed only through `<img>`, never inline uploaded SVG markup into a server page. The in-page extension UI also uses PNG (section 9).
2. **SSRF**: the admin UI takes uploads only, no URL field, so no user can make the server fetch an address. `APP_LOGO_URL` comes from the operator's environment, which is already trusted; still fetch it with a 5 s timeout, the 512 KB cap, `https:` or `file:` only, no redirects to other hosts, and run the result through the same sanitizer. Fetch once at start and on `getBrand()` cache refresh when the URL changed; store the bytes in Garage like an upload. A failed fetch logs a warning and falls back to the default logo; the server still starts.
3. **CSP**: because logos are served from the app's own origin, `img-src 'self' data: blob:` covers them when the planned CSP lands (architecture section 8). No third-party image host gets added.
4. **Name injection**: the name is user text. Svelte escapes it in pages; the mail templates already `esc()` HTML; the markdown share page and MCP instructions must fence it like other captured strings (PLAN "Privacy and prompt injection") or, simpler, restrict the name to `^[\p{L}\p{N} .,'&()-]{1,40}$`.
5. **Admin takeover**: verified email for `ADMIN_EMAILS`, start-up warning without it (section 4).
6. **Look-alike icon in the extension**: a server could set an icon that imitates another extension. The user chose the server and signed in to it, so accept; the extension never applies branding before sign-in.

## 9. Browser extension

### 9.1 What is fixed at build time

- `manifest.name`, `short_name`, `description`: there is no API to change them while the extension runs; `runtime.getManifest()` is read-only. `__MSG_name__` with `_locales/*/messages.json` only picks a string by browser locale, from files inside the package. Max 75 chars.
- `chrome://extensions`, the puzzle menu's extension list, the permission prompts and the Chrome Web Store listing all show the manifest name. Web Store name changes need a new package upload and review.
- The manifest `icons` (48 and 128 show on `chrome://extensions` and the store) are packaged files.

So the store build is called "toolbar" with the rectangle icon, and a self-hoster who wants their own name in those places builds their own extension.

### 9.2 Build-time env (self-hosters who build their own)

`apps/extension/wxt.config.ts` already reads `WXT_TEST_HOOKS`, `WXT_DEV_PORT`, and the code reads `WXT_SERVER_URL`. Add:

| Var | Default | Effect |
|---|---|---|
| `WXT_APP_NAME` | `toolbar` | `manifest.name`, `action.default_title`, page titles (`index.html` titles move into the Svelte apps or use `%WXT_APP_NAME%`) |
| `WXT_APP_ICON` | `assets/icon.svg` | source for `public/icon/*.png`, rendered by a `build:before` hook with sharp |
| `WXT_SERVER_URL` | `http://localhost:3000` | exists; the server the build talks to first |
| `EXTENSION_KEY_PEM` / manifest `key` | repo key | their own key gives their own id, which goes in the server's `EXTENSION_IDS` |

Document it in `docs/dev.md` under "The extension" as "Build your own branded extension".

### 9.3 Runtime branding from the server

1. On sign-in and on each bootstrap refresh, the worker reads `bootstrap.branding`. When `version` changed it fetches `icons['16'|'32'|'48'|'128']` (PNG; the worker cannot decode SVG, since `createImageBitmap` needs a raster in a worker) and stores `{ version, name, accent, icons: { 16: dataUrl, ... }, logoPng: dataUrl }` in `chrome.storage.local` under `tb:branding`.
2. Apply: `createImageBitmap(blob)` then draw into `new OffscreenCanvas(n, n)` and `getImageData`, then `chrome.action.setIcon({ imageData: { 16, 32 } })` and `chrome.action.setTitle({ title: name })`. `setIcon` is global when no `tabId` is passed. It is not persisted across browser restarts, so re-apply from storage at worker start (top level of `background.ts`) and in `runtime.onStartup`.
3. `lib/bg/ui.ts:314-315` restores the branded icon and name after recording, not `/icon/*.png` and the manifest name. Factor out `applyBrandIcon()`.
4. Sign-out (`ext.logout`) and a server URL change remove `tb:branding` and restore the packaged icon and manifest name.
5. Popup, options, editor and `AccountCard`: read `tb:branding` through a small `brand.svelte.ts` store; show the server's logo (`<img src=dataUrl>`, allowed by the default MV3 extension-page CSP) and name; fall back to the build name and the rectangle icon. Signed out, they show the build name.
6. In-page UI (`capture.content`, closed shadow root in the host page): draw the logo from the PNG bytes onto a `<canvas>` with `createImageBitmap`, or use the rectangle icon. An `<img>` with a server URL or a `data:` URL would be subject to the page's CSP `img-src`, and a network request from the page would show in the page's own network and in our own capture hooks.
7. Accent in extension pages and the in-page UI: set `--nb-accent` and `--nb-on-accent` on the host element from `tb:branding`.

Firefox (`browser.action.setIcon`, `setTitle`) takes the same `imageData` dictionary, so the plan carries over when the AMO build comes.

## 10. CLI, MCP, user agents

Keep these fixed as `toolbar`. Do not brand them.

- **CLI binary `toolbar`**: install scripts, `npx` usage, agent skills (`toolbar-captures`), shell history and docs all name the command. If each instance renamed it, one person's skill file would break on another server, and a user with two servers would have two names for one program.
- **MCP server name `toolbar`** (`MCP_SERVER_NAME`): agents expose tools as `mcp__toolbar__get_capture`; skills, permission allowlists (`.claude/settings.json`) and prompts reference that prefix. The setup snippets on `settings/mcp` let a user pick another name anyway. `serverInfo.title` is display text: set it to the brand name. `INSTRUCTIONS` and tool descriptions say "toolbar" (stable for agents), plus "on <brand name>" in the instructions only.
- **User agents and headers**: `toolbar-cli/<version>`, `toolbar-webhooks/1`, `toolbar-server`, `x-toolbar-*`. Webhook receivers and proxies match on them; they identify software, not the instance.
- **OAuth client names** the CLI registers: `toolbar CLI on <host>`; the consent page (`mcp/authorize`) shows the brand name around it.
- `resource_name` in OAuth protected resource metadata (`mcp/oauth.ts:45`): brand name plus " captures", runtime.

## 11. The rename, file by file

Do it as one commit on main after gate 2, before the branding feature, so the diff is mechanical. Then build branding on top.

**Constants**: `packages/shared/src/constants.ts`: `PRODUCT_NAME = 'toolbar'` (doc comment: build-time default; runtime surfaces use the instance brand), `PRODUCT_SLUG = 'toolbar'`. Most of 2.1 follows from this.

**Server, runtime text** (switch to `getBrand().name` or `page.data.brand.name` in the branding commit; the rename commit only needs the constant): files listed in 2.2.

**Hard-coded strings to edit**:
- `apps/extension/entrypoints/{popup,options,editor,offscreen,permissions}/index.html`
- `apps/extension/entrypoints/nib-web.content.ts` → rename file to `toolbar-web.content.ts`; update comments in `packages/shared/src/areas/dashboard-ext.ts`
- `apps/extension/assets/icon.svg`, `public/icon/*.png` (rectangle), `apps/server/static/favicon.svg` (rectangle until 6.3 replaces it)
- `packages/ui/src/icons.ts` (`logo`), comments in `packages/ui/src/tokens.ts`, `packages/cli/src/draw.ts`
- `packages/cli/package.json` (`bin.toolbar`, description), `packages/cli/tsdown.config.ts` (`entry: { toolbar }`), `packages/cli/src/{main,config,client,login,create,record,upload,wsserver}.ts` (`TOOLBAR_CONFIG`, `TOOLBAR_SERVER`, `TOOLBAR_TOKEN`, `TOOLBAR_LOGIN_TOKEN`, `TOOLBAR_CDP_PROXY`, `TOOLBAR_CDP_URL`, `~/.config/toolbar`, skill dir `toolbar-captures`, `ua`, messages), `packages/cli/test/cli.test.ts`
- `apps/server/src/lib/server/mcp/cli-bundle.ts` (`/cli/toolbar.mjs`, `TOOLBAR_INSTALL_DIR`, `toolbar.cmd`), `routes/cli/[file]/+server.ts`, `lib/server/mcp/data.ts` (`CLI_NAME`), `routes/(app)/settings/{cli,api,sdk,webhooks}/+page.svelte` sample text, `lib/components/agent/AgentTab.svelte`
- Headers: `packages/shared/src/api/common.ts`, `api/integrations.ts`, `apps/server/server.js`, `routes/api/v1/recordings/[id]/frames/+server.ts`, `lib/server/mcp/{access,protocol}.ts`, `lib/server/{share,viewer}/access.ts` comments, `lib/components/viewer/api.ts`
- User agents: `lib/server/webhooks/index.ts`, `lib/server/integrations/providers.ts`
- `lib/server/mcp/oauth.ts:45`, `lib/server/mcp/tools.ts:2`, `lib/server/dashboard/links.ts:232` comment
- Cookie `nib_anon` → `tb_anon` (`lib/server/viewer/access.ts:59`); dashboard `localStorage` keys `nib.*` → `tb.*` and `invalidate('nib:shell')` → `'tb:shell'` (`(app)/+layout.server.ts`, `FolderList`, `FolderPicker`, `SelectionBar`, `CaptureGrid`, `Onboarding`, `links/+page.svelte`, `f/[folderId]/+page.svelte`, `HelpMenu`, `GlobalPalette`, `CaptureView`, `Header`, `viewer/prefs.ts`, `viewer.svelte.ts`, `shell.svelte.ts`)
- Extension storage keys `nib:*` → `tb:*` (`packages/shared/src/ext/storage.ts`, `lib/capture/store.ts`, `lib/bg/ui.ts`, `capture.content/Toolbar.svelte`, `areas/editor.ts`, `popup/lib/store.svelte.ts`) with a migration in `runtime.onInstalled` (`reason === 'update'`): copy each `nib:*` value to its `tb:*` key, then remove the old key. Without it every tester is signed out and loses settings and draft metadata.
- Other internals: `__nib_editor`, `data-nib-blurred`, `data-nib-extension`, `nib:new-capture`, `nib-upload-drain`, `nib-editor`, `nib-block` (also document in SDK page), `[nib]` log prefixes, temp dir prefixes, `vite.config.ts` plugin name, `markdown.ts` `embed_host`
- `packages/capture/src/metadata.ts`: drop the `window.nib` alias; `window.toolbar.setMetadata` (on the built-in `BarProp`) stays the documented API
- Config defaults: `.env.example`, `docker-compose.yml`, `lib/server/env.ts` (`MAIL_FROM`)
- Seed and checks: `apps/server/scripts/seed.ts` (`@toolbar.test`), `scripts/check-server-core.ts`, `scripts/e2e-all.sh` (`TOOLBAR_E2E_TOKEN`)
- Tests: `apps/extension/test/{auth-client,ui-controller}.test.ts`, `apps/server/test/{agent.int,auth.unit,dashboard.int,env}.test.ts`, `packages/shared/test/derive.test.ts`, and the e2e files that match `nib` (`e2e/fixtures/extension.ts`, `e2e/flows/*.spec.ts`, `e2e/flows/{fixture,journeys}.ts`, `e2e/tests/**`, `e2e/dbg.mjs`). Several e2e files are uncommitted work of another workflow right now; rename after that lands.
- Docs: `docs/dev.md` intro and profile paths, `docs/decisions.md` (D-018 superseded by D-074; keep history), `docs/parallel.md`, `docs/status.md`, `PROGRESS.md`

**Do not change**:
- `lib/server/crypto.ts` `'nib-seal-v1'` and `lib/server/upload/token.ts` `'nib-upload-v1'`: HKDF info strings; changing them makes every sealed share token and recording-link token in the database unreadable. Add a comment saying they are frozen.
- IndexedDB name `'nib'` in `packages/shared/src/ext/storage.ts`: renaming drops queued chunks and drafts. Invisible to users; comment it as frozen.
- `UI_HOST_TAG = 'toolbar-root'`, `BRIDGE_TAG = '__tb'`, the `@toolbar/*` scope, the `--nb-*` CSS prefix (1454 uses, invisible; renaming is churn with no user value).

Guard: a unit test in `packages/shared/test` that runs `rg -w -i nib` over `apps packages` (excluding the frozen strings above) and fails on a hit.

## 12. Test plan

Unit (vitest):
- `branding/resolve.test.ts`: env beats DB beats default per field; `locked` flags; invalid `APP_ACCENT` falls back with a warning; `version` changes when any input changes.
- `branding/svg.test.ts`: a corpus of hostile SVGs (`<script>`, `onload=`, `<foreignObject>`, `xlink:href="javascript:"`, external `<image href="http://...">`, `<use href="http://...">`, `<style>@import</style>`, DOCTYPE entity expansion) is rejected; a clean Inkscape and Figma export passes unchanged.
- `branding/raster.test.ts`: sharp renders the default rectangle and an uploaded PNG to every size; output dimensions and transparency.
- Accent contrast: on-accent choice and rejection.
- `packages/ui`: `logo` icon is the rect; tokens test still passes.
- Extension: `applyBrandIcon()` calls `setIcon` with ImageData for 16 and 32 and `setTitle` with the name; recording end restores the brand, not the manifest; logout restores the manifest; storage migration moves `nib:*` to `tb:*` once.
- Rename guard (section 11).

Integration (`pnpm test:int`, real Postgres and Garage):
- `PUT /api/v1/admin/branding` as a non-admin is 403; as admin 200; with `APP_NAME` set is 409.
- `ADMIN_EMAILS` with an unverified matching account is not admin.
- Logo upload: 415 for JPEG, 413 over 512 KB, 422 for a hostile SVG, 200 for a clean SVG; renditions exist in Garage.
- `/brand/logo.svg` headers: `nosniff`, `sandbox` CSP, `immutable` with matching `v`, short cache without.
- `GET /api/v1/branding` works signed out and reflects an update at once (cache invalidation).
- Magic-link mail in Mailpit: subject and body use the new name, HTML has `email.png`, no SVG.

E2E (Playwright, private display, never `:99`):
- Admin sets name "Acme Review" and uploads a logo in Settings > Server; login page title, header, favicon `href`, share page header and the recording link page show it on first paint (check the server HTML, before hydration).
- Second user (not admin) gets 404 on `/settings/server`.
- Extension test build signs in: `globalThis.__tb` reports the action title "Acme Review" and the icon source `branded`; popup shows the name and logo; start and stop a recording, the branded icon comes back; sign out, the title returns to the build name.
- Build check: `WXT_APP_NAME="Acme Review" wxt build`, then assert `manifest.json` `name` and that `icon/16.png` is the rendered file.
- `z-visual.spec.ts` baselines: regenerate once for the rectangle logo.

## Sources

- Chrome `action` API (setIcon `imageData`, `tabId` scope, "SVG isn't supported"): https://developer.chrome.com/docs/extensions/reference/api/action
- Manifest `name` (75 chars, locale strings): https://developer.chrome.com/docs/extensions/reference/manifest/name
- Better Auth admin plugin: https://www.better-auth.com/docs/plugins/admin
- Mattermost environment variables and locked settings: https://docs.mattermost.com/administration-guide/configure/environment-variables.html, site settings: https://docs.mattermost.com/administration-guide/configure/site-configuration-settings.html
- Discourse branding: https://meta.discourse.org/t/customize-your-site-branding/258307, env vs DB: https://meta.discourse.org/t/settings-order-of-precedence-with-env-vs-db/248965
- Gitea customizing: https://docs.gitea.com/administration/customizing-gitea, environment-to-ini (`GITEA__SECTION__KEY`)
- Grafana custom branding: https://grafana.com/docs/grafana/latest/setup-grafana/configure-grafana/configure-custom-branding/
- Cal.com white label for self-hosted: https://docs.cal.com/docs/how-to-guides/whitelabel/self-hosted-instance
- Outline custom theming: https://getoutline.com/changelog/theming
- Coolify instance settings: https://coolify.io/docs/core/instance-management/instance-settings
- Sentry forum on logos: https://forum.sentry.io/t/add-our-company-logo-to-sentry-dashboard/1181
- npm versions checked 2026-10-14: sharp 0.35.5, isomorphic-dompurify 4.5.0, dompurify 3.4.17
