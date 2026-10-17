# Architecture

Status: design for Part 1, step 2 (Jam replica), written so Part 2 lands as additions. Versions were checked on 2026-10-13 against npm and the upstream docs linked in "Sources". Pin exact versions at scaffold time and record the pins in `docs/decisions.md`.

## 1. Stack and pinned versions

| Area | Choice | Version | Why |
|---|---|---|---|
| Language | TypeScript | 6.0.x | The lab already uses 6.0.3. TS 7.0 (the Go compiler) is out, but svelte-check and WXT still call the TS 6 API; move to 7 later. |
| Package manager | pnpm workspace | 11.27.0 (`packageManager` field) | The version installed on this VM; 12.x works too. |
| Runtime | Node.js | 24 LTS | Installed here; `node:24-bookworm-slim` in Docker. |
| Extension framework | WXT | 0.21.4 | MV3 build, HMR, `world: 'MAIN'`, `registration: 'runtime'`, `createShadowRootUi({ mode: 'closed' })`, vitest plugin. |
| Extension UI | Svelte 5 via `@wxt-dev/module-svelte` | svelte 5.57.x, module 2.0.5 | The same component code runs in the extension and in the server app. |
| DOM recording | rrweb | 2.1.7 (`@rrweb/record`, `@rrweb/replay`, `@rrweb/types`, `@rrweb/packer`) | MIT, 2.x is stable. `rrweb-player` is skipped because the viewer has its own controls. |
| Drawing | perfect-freehand | 1.2.3 | Outline polygons rendered as SVG `<path>`. |
| Server | SvelteKit + `@sveltejs/adapter-node` | kit 3.0.1, adapter 6.0.0, vite 8.3 | See section 3. |
| Auth | Better Auth | 1.7.7 + `@better-auth/drizzle-adapter` | One generic OAuth/OIDC provider (Google Workspace included), organization plugin, SvelteKit handler (D-114). |
| DB access | Drizzle ORM + drizzle-kit, `postgres` (postgres.js) driver | drizzle-orm 0.45.x, drizzle-kit 0.31.x, postgres 3.4.x | See section 6. Stay on 0.45 until Drizzle 1.0 leaves beta. |
| Database | Postgres | `postgres:18-alpine` | Built-in `uuidv7()` for primary keys. |
| Object storage | Garage | `dxflrs/garage:v2.4.1` | See section 7. |
| S3 client | `@aws-sdk/client-s3` | 3.11xx | `forcePathStyle: true`. |
| Transcription | whisper.cpp server, or a hosted OpenAI-compatible model (`gpt-transcribe`) | `ghcr.io/ggml-org/whisper.cpp:main` (whisper.cpp v1.9.5), pin by digest | See section 12. |
| Mail (paused, override `docker-compose.mail.yml`) | Mailpit | `axllent/mailpit:v1.31.5` | Catches the paused mail (FEATURE_EMAIL) in development and tests; the default compose file holds no mail service or settings (D-079, D-114, D-171). |
| Validation | zod | 4.x | Shared schema checks on the server. |
| Tests | vitest 5.0.x; `@playwright/test` **1.63.0** | | 1.63.0 matches the Chromium build already cached on this VM (`~/.cache/ms-playwright/chromium-1243`). |
| CLI build | tsdown | 0.23.x | Bundles `packages/cli` into one ESM file for `npx`. |

## 2. Repository layout

```
toolbar/
  package.json              private root; scripts: dev, build, test, e2e, lint
  pnpm-workspace.yaml       packages: apps/*, packages/*, lab, tests/e2e
  tsconfig.base.json
  compose.yaml              full stack (section 13)
  deploy/garage.toml
  apps/
    extension/              @toolbar/extension  (WXT, MV3)
    server/                 @toolbar/server     (SvelteKit, adapter-node)
  packages/
    shared/                 @toolbar/shared     event schema, serializers, redaction, ids, clock, HAR
    capture/                @toolbar/capture    page-side capture, transport-agnostic
    ui/                     @toolbar/ui         Svelte 5: toolbar, annotator, log panels, viewer
    cli/                    @toolbar/cli        `toolbar login|ls|pull` (pull lands in Part 2)
    trace/                  @toolbar/trace      Part 2: spans, .feedback export (stub in Part 1)
  tests/e2e/                Playwright, extension loaded, lab app as target
  lab/                      existing lab app (unchanged; joins the workspace)
```

Internal packages ship TypeScript source (`"exports": { ".": "./src/index.ts" }`). Vite and WXT compile them, so they need no build step. Only `packages/cli` is built for publishing.

`packages/capture` is the main hedge against a Part 2 rewrite. It holds the main-world hooks, the rrweb wrapper, the ring buffer and the user-event recorder. Its only exit is a `Transport` interface:

```ts
export interface Transport {
  send(batch: CaptureEvent[]): void;          // fire and forget, ordered
  onCommand(fn: (c: Command) => void): void;  // start/stop/snapshot from the host
}
```

The extension implements it with `chrome.runtime` ports. The Part 2 injector (`apps/injector`, D-157), which serves `/__toolbar/` on the app's own origin, implements it with `fetch` through its relay to the server (`apps/extension/page/session.ts`, section 11a). The Part 2 CLI review browser reuses the extension build.

## 3. Server: one SvelteKit app

`apps/server` is a single SvelteKit 3 app built with adapter-node. It serves the dashboard, the share pages, the REST API, the Better Auth routes and a background job runner in one Node process.

Justification:
- The team already writes SvelteKit (the lab app and Nuru), and `@toolbar/ui` components render in the extension and on the share page with no port to another framework.
- Better Auth ships a SvelteKit integration (`svelteKitHandler` in `hooks.server.ts`).
- SvelteKit content negotiation fits Part 2. A `+page.svelte` and a `+server.ts` can share `/s/[token]`: a GET that prefers `text/html` gets the page, and anything else (for example `Accept: text/markdown`) reaches `+server.ts`. Checked in `kit/src/runtime/server/endpoint.js`.
- adapter-node produces a plain `node build` server that runs in a small container, which suits Coolify.

Routes:

```
src/hooks.server.ts                 Better Auth handler, session -> locals, bearer tokens -> locals, security headers
src/routes/(app)/+layout.server.ts  require session
src/routes/(app)/+page.svelte       recordings list (search, filters)
src/routes/(app)/f/[folderId]/      folders
src/routes/(app)/r/[id]/            recording viewer (members)
src/routes/(app)/settings/...       profile, workspace, members, connected browsers, tokens
src/routes/login/                   provider buttons
src/routes/ext/connect/+server.ts   extension sign-in hand-off (section 9)
src/routes/s/[token]/+page.svelte   share viewer
src/routes/s/[token].md/+server.ts  markdown page (first line: the pull command); the tar.gz is /api/v1/recordings/:id/folder (section 17)
src/routes/s/[token]/media/[stream]/+server.ts   Range-capable media proxy
src/routes/api/v1/...               JSON API (section 5)
src/lib/server/{db,auth,s3,jobs,share,upload,transcribe,media}/
src/lib/server/db/schema/           Drizzle schema, one file per area (docs/parallel.md)
drizzle/                            generated SQL migrations
```

adapter-node settings: `ORIGIN`, `BODY_SIZE_LIMIT=16M` (default is 512K, too small for chunks), `PROTOCOL_HEADER`/`HOST_HEADER` behind Traefik on Coolify. On start the server runs Drizzle migrations (`migrate()` from `drizzle-orm/postgres-js/migrator`) and then starts the job runner if `WORKER=1` (default on).

Jobs use a `job` table polled with `SELECT ... FOR UPDATE SKIP LOCKED`. No Redis. Job types: `finalize-recording`, `remux-video`, `transcribe`, `thumbnail`, `purge-recording`, `expire-shares`; Part 2 adds `derive-spans` and `build-export`. The server image installs `ffmpeg` (Debian package) for remuxing and thumbnails.

## 4. Capture event schema (`packages/shared/src/events.ts`)

One envelope for every source. NDJSON on the wire, gzip per chunk.

```ts
export type Ms = number; // epoch ms with sub-ms precision: performance.timeOrigin + performance.now()

export interface Envelope<K extends string, D> {
  v: 1;
  id: string;        // `${ctx}:${seq}`; unique within a recording
  ctx: string;       // capture context: frame id ("top", "f3"), "sw" (service worker), "off" (offscreen)
  seq: number;       // monotonic per ctx; detects gaps
  t: Ms;
  kind: K;
  data: D;
}

export type CaptureEvent =
  | Envelope<'env', EnvInfo>                   // UA, platform, viewport, dpr, locale, tz, ext version, masking preset
  | Envelope<'nav', Nav>                       // load | pushState | replaceState | popstate | hashchange | bfcache
  | Envelope<'console', ConsoleEntry>          // level, args: Serialized[], stack?, count?
  | Envelope<'error', PageError>               // type: 'error'|'unhandledrejection'|'resource'|'csp', message, stack, src, line, col
  | Envelope<'net.req', NetRequest>            // rid, method, url, headers, body?, initiator, source: 'page'|'webRequest'
  | Envelope<'net.res', NetResponse>           // rid, status, headers, body?, truncated, encodedSize, timing
  | Envelope<'net.fail', NetFailure>           // rid, error ('net::ERR_*', 'abort', 'timeout')
  | Envelope<'ws', WsEvent>                    // sid, op: open|send|recv|close|error, data? (capped)
  | Envelope<'sse', SseEvent>                  // sid, op: open|message|error|close, event?, data?
  | Envelope<'worker', WorkerMessage>          // wid, op: send|recv; timing only, holds a span (D-189)
  | Envelope<'user', UserEvent>                // click|dblclick|contextmenu|input (committed)|key|scroll|focus|blur|select|resize|visibility
  | Envelope<'dom', DomSummary>                // every 100 ms with changes: added, removed, attrs, text, rects[] (<=5)
  | Envelope<'rrweb', RrwebRef>                // pointer only: { chunk, first, last } into the rrweb stream
  | Envelope<'media', MediaEvent>              // stream: video|mic|cam|screen, op: start|pause|resume|stop|segment
  | Envelope<'shot', Shot>                     // assetId, rect, reason: user|keyframe
  | Envelope<'annotation', AnnotationRef>      // annotationId, op: create|update|delete
  | Envelope<'marker', Marker>;                // user "mark this moment", voice segment start/end

export interface TargetRef {                   // attached to user, annotation and shot events
  selector: string; xpath?: string; rrwebId?: number;
  tag: string; role?: string; name?: string;   // accessible role and name
  text?: string;                               // visible text, 120 chars, masked per preset
  testId?: string; elId?: string; classes?: string[];
  rect: { x: number; y: number; w: number; h: number }; // CSS px, page coordinates
  landmarks?: string[]; heading?: string;      // Part 2 locator packet fields, cheap to fill now
}
```

Rules:
- **Clock.** Every producer stamps `t` as `performance.timeOrigin + performance.now()` in its own context. rrweb event timestamps (`Date.now()`) are kept as-is; both are epoch ms. The `media` start event is stamped inside the offscreen document's `MediaRecorder` `start` handler, and the viewer computes `videoOffset = mediaStart.t - recording.startedAt`.
- **Requests have ids.** `rid` pairs `net.req` with `net.res`/`net.fail`, so "in flight at time t" is a scan. Page hooks and `webRequest` both report. The service worker merges them on `(method, url, |dt| < 50 ms)`, and `source` records who saw it.
- **Console args** go through `serialize()` (depth 4, 100 keys, 10 KB per string, cycles marked, `Error` keeps name/message/stack, DOM nodes become a `TargetRef`, Map/Set/TypedArray summarized).
- **Bodies.** Text-like content types only, at most 256 KB each, with a `truncated` flag. Redaction runs in the isolated world before an event leaves the page (section 10).
- **rrweb** goes to its own stream (it is 10 to 100 times larger than everything else). The main event stream holds only `rrweb` pointer events, so the log timeline loads without the DOM recording.
- **`dom` summaries** come from the capture script's own `MutationObserver` (counts plus up to five changed-region rects). This is the cheap signal for Part 2 span outcomes, keyframe bursts and `outline/`.

How Part 2 derives its outputs from this schema with no capture change (`packages/trace`):

| Part 2 output | Derived from |
|---|---|
| span start (action) | `user` click/input/key(Enter, Ctrl+Enter), `nav`, `annotation`, `marker` (voice) |
| span effects | `net.*` by `rid`, `console`, `error`, `dom`, `user` scroll/focus/select, `shot` |
| close rules (500 ms quiet, 2.5 s, 10 s) | `t` plus the set of open `rid`s; a pending request no span owns joins a click on its link (`TargetRef.link`, 2 s) or any action within 300 ms (D-188); a `worker` `send` holds the span open until its `recv` (D-189) |
| one action, several events | Enter or Space and the click it fires; a checkbox click and its value; Enter in a form field and the click on its submit button (D-188) |
| outcome `dead` vs `silent` on canvas | Part 2 adds one kind, `canvas.sample` (rect, hash before and after, changed-pixel share), which is additive (D-120) |
| `caused_by` | overlapping open windows; confidence from timing and `ctx` |
| `console.jsonl`, `network.jsonl`, `raw/network.har` | filter and map (`packages/shared/src/har.ts`) |
| `keyframes/`, `outline/` | `shot` (reason keyframe) and `dom.rects` |
| `annotations/a01.*` | `annotation` table plus assets plus `TargetRef`; `a01.locator.json` is the annotation's `locator` packet (D-128, `locatorFiles()`), or for a reviewer toolbar note `feedback_item.locator` (D-164) |
| mapped error stacks in `console.jsonl` | `stackmap` events (D-129), joined to their `error` or `console` event by `ref` |
| `voice/` | `voice` stream plus `transcript` row |
| `raw/rrweb-000.json.gz` | the rrweb stream chunks |

## 5. Upload protocol (extension to server)

Every capture uploads while it records, so the share link works within a second of "Stop", as it does in Jam. The protocol is append-only per stream: chunks are numbered and idempotent, and resume is a list call.

Streams per recording: `events` (NDJSON.gz), `rrweb` (NDJSON.gz), `video` (WebM, VP9 + Opus, tab audio and mic mixed), `voice` (WebM/Opus, mic only, used for transcription), `screenshot` (PNG), plus annotation assets.

```
POST /api/v1/recordings
  { clientId (uuidv7 from the extension), kind: 'screenshot'|'video'|'replay'|'screen',
    workspaceId, folderId?, page: {url,title}, startedAt, env }
  -> 201 { id, shareUrl }            idempotent on clientId

PUT  /api/v1/recordings/:id/streams/:stream/chunks/:seq
  headers: Content-Type, Content-Encoding (gzip for NDJSON), X-Sha256, X-T0, X-T1
  body: <= 8 MiB
  -> 201 stored | 200 same hash already stored | 409 different hash for this seq

GET  /api/v1/recordings/:id/streams/:stream/chunks
  -> [{ seq, bytes, sha256 }]       client re-sends what is missing

POST /api/v1/recordings/:id/streams/:stream/complete  { lastSeq, totalBytes }
POST /api/v1/recordings/:id/finalize  { title, description, annotations[], folderId }
  -> 200 { shareUrl, status: 'processing' }   enqueues finalize-recording
POST /api/v1/assets  (multipart: screenshot PNG, annotation crop)  -> { assetId }
```

Server side: each chunk is written to S3 as `rec/<id>/<stream>/<seq:06d>` and recorded in `recording_chunk`. `finalize-recording` then:
1. `video`/`screen`: streams the chunks in order into `ffmpeg -i pipe:0 -c copy -f webm` and writes `rec/<id>/video.webm` with cues and duration, so it seeks. For instant-replay video, where each segment is a standalone WebM, it uses the concat demuxer with `-c copy`.
2. `events`: merges chunks, sorts by `t`, writes `rec/<id>/events.json.gz` (the viewer loads this one file).
3. Writes a poster frame `thumb.webp` and sets `status = 'ready'`. The viewer listens on `GET /api/v1/recordings/:id/status` (SSE) and swaps from "processing" to the player.
4. Enqueues `transcribe` when a `voice` stream exists.

Client side (extension):
- Each producer writes a chunk to extension IndexedDB (`uploads` store, key `[recordingId, stream, seq]`) **before** uploading, and deletes it after a 2xx response.
- Video and voice chunks come from `MediaRecorder` with `timeslice = 1000` in the offscreen document, which also uploads them with `fetch`. The offscreen document lives as long as the recording.
- Events and rrweb batches flow from the content scripts over a `chrome.runtime` port to the service worker, which gzips them (`CompressionStream`) and flushes every 2 s or 1 MiB.
- Retries use exponential backoff (1 s up to 60 s). A `chrome.alarms` alarm (every 30 s) and `runtime.onStartup` both wake an uploader that drains IndexedDB, so a killed service worker or a browser restart loses nothing that reached IndexedDB.
- Auth: `Authorization: Bearer <device token>` (section 9).

tus was considered (`@tus/server` 2.4 with `@tus/s3-store`). It models one file per upload, and its browser client is built around XHR, which a service worker lacks. This tool needs four to six parallel append-only streams per recording, written by two different extension contexts. Numbered idempotent PUTs cover that in about 150 lines on each side.

## 6. Data model (Postgres, Drizzle)

Drizzle over Kysely: Better Auth's CLI (`npx auth@latest generate`) emits a Drizzle schema for its own tables, so one schema file and one migration history (`drizzle-kit generate` then `migrate`) cover auth and app tables. Kysely would need hand-written migrations next to Better Auth's. All ids are `uuid` with `default uuidv7()`. Times are `timestamptz`.

Better Auth tables (generated): `user`, `session`, `account` (holds `providerId` and `accountId`, which is the OIDC subject), `verification`, plus the organization plugin's `organization`, `member`, `invitation`. A workspace is an organization.

App tables:

```
folder            id, organization_id, parent_id?, name, created_by, created_at
recording         id, client_id UNIQUE, organization_id, folder_id?, kind, status (uploading|processing|ready|failed),
                  title, description, page_url, page_title, started_at, duration_ms, env jsonb,
                  author_user_id, author_issuer, author_subject, author_email, author_name,   -- snapshot at creation (Part 2 asks for it)
                  thumb_key?, created_at, updated_at, deleted_at?
                  -- Part 2 adds: project_id, masking_preset, trace boolean
recording_stream  recording_id, name, content_type, last_seq, total_bytes, completed_at?, final_key?   PK(recording_id, name)
recording_chunk   recording_id, stream, seq, s3_key, bytes, sha256, t0, t1                           PK(recording_id, stream, seq)
asset             id, recording_id, kind (screenshot|crop|annotation|keyframe|thumb), s3_key, content_type, width, height, bytes
annotation        id, recording_id, asset_id?, t, shapes jsonb, target jsonb (TargetRef), comment, author_user_id, created_at
comment           id, recording_id, parent_id?, author_user_id, body, t_ms?, created_at, edited_at?, deleted_at?
transcript        recording_id, stream (voice | voice:<assetId>), provider, model, language, vtt text, status (pending | running | done | failed | skipped), error?, updated_at
share_link        id, recording_id, token_hash bytea UNIQUE, token_enc bytea, access (anyone|workspace),
                  created_by, created_at, expires_at?, revoked_at?, last_used_at?
api_token         id, user_id, kind (device|personal), name, token_hash bytea UNIQUE, last_used_at, created_at, revoked_at?
ext_auth_code     code_hash PK, user_id, code_challenge, redirect_uri, expires_at                   -- 60 s, single use
job               id, type, payload jsonb, run_at, attempts, locked_until?, last_error?, created_at
integration       id, organization_id, type, config jsonb (secrets encrypted), created_by          -- per catalogue rows
notification      id, user_id, type, recording_id?, payload jsonb, read_at?
instance_setting  key PK, value jsonb, updated_at, updated_by?                                   -- 'branding' (D-112, docs/branding.md)
feedback_item     id, recording_id, client_id (UNIQUE per recording), n, kind, comment, quote?, target jsonb, anchor jsonb,
                  shapes jsonb, crop_asset_id?, crop_rect, voice_asset_id?, voice_duration_ms, transcript_status|vtt|text|language,
                  context jsonb (60 s of errors and failed requests), page jsonb, intent, severity, status, t,
                  author_user_id, author_name, author_email, author_issuer, author_subject, created_at   -- reviewer toolbar (D-137)
```

Part 2 tables, additive: `project` (organization_id, name, origins text[], masking_preset, body_allowlist text[], created_by; built, D-123; `span_timeouts jsonb` still to come), `recording.project_id` and `recording.masking_preset` (D-124, D-125), `reviewer_rule` (project_id, type: email_domain|idp_group, value), `feedback_resolution` (recording_id, resolved_by, at).

## 7. Object storage: Garage

Garage v2.4.1 over SeaweedFS:
- **One-line bootstrap.** `garage server --single-node --default-bucket` with `GARAGE_DEFAULT_ACCESS_KEY`, `GARAGE_DEFAULT_SECRET_KEY` and `GARAGE_DEFAULT_BUCKET` creates the layout, key and bucket at boot. Without these flags Garage needs five CLI steps, and that was its main drawback for `docker compose up`.
- **Small.** One Rust binary, low memory, built for self-hosting on modest machines.
- **API coverage.** Multipart, presigned URLs, Range GET, CORS and expiration lifecycle are implemented. That covers this use.
- SeaweedFS (`weed server -s3` or `weed mini`) also works and accepts keys by env. Its single-process mode still runs a master, a volume server and a filer, which is more machinery than this blob store needs.
- Garage is AGPL-3.0. It runs as a separate, unmodified container and nothing links to it, so the MIT license of this repo is unaffected.

The S3 endpoint stays on the internal compose network. The server proxies media with Range support (`/s/[token]/media/[stream]`, `/api/v1/recordings/:id/media/:stream`), so a self-hoster exposes one origin. Optional `S3_PUBLIC_URL` switches the proxy to 302s to presigned URLs for large installs.

`deploy/garage.toml`:

```toml
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"
replication_factor = 1
rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"
# rpc_secret comes from GARAGE_RPC_SECRET

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
root_domain = ".s3.garage.localhost"

[admin]
api_bind_addr = "[::]:3903"
# admin_token comes from GARAGE_ADMIN_TOKEN
```

## 8. Share links

- Token: 16 bytes from `crypto.getRandomValues`, base64url (22 chars). URL `/s/<token>`.
- Storage: `token_hash = sha256(token)` for lookup with a constant-time compare. `token_enc` holds the token under AES-256-GCM with a key derived by HKDF from `BETTER_AUTH_SECRET`, so the dashboard can show the link again (Jam lets you copy the link at any time).
- Access: `anyone` (link holders, no sign-in) or `workspace` (signed-in members). Part 1 defaults to what the catalogue records for Jam. Part 2 defaults to `expires_at = now() + 14 days`, adds "summary only" for link holders, and requires a personal token for the full folder.
- Headers on every `/s/*` response: `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cache-Control: private, no-store` on HTML, and a strict CSP that allows media from self only.
- Revoke sets `revoked_at`. The `expire-shares` job runs hourly. Deleting a recording revokes all of its links and enqueues `purge-recording`, which deletes the `rec/<id>/` prefix.

## 9. Auth

Better Auth 1.7.7 in `src/lib/server/auth.ts`:

```ts
export const auth = betterAuth({
  baseURL: env.PUBLIC_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: { enabled: env.auth.emailPassword },   // AUTH_DEV_PASSWORD=1: development and tests only
  plugins: [
    // the one provider (D-114): OIDC_ISSUER or OIDC_DISCOVERY_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET,
    // OIDC_SCOPES, OIDC_PROVIDER_NAME; mapProfileToUser refuses claims outside ALLOWED_EMAIL_DOMAINS
    genericOAuth({ config: env.auth.oidc ? [oidcConfig] : [] }),
    organization(),
    magicLink({ sendMagicLink }),                          // sign-up only with FEATURE_EMAIL (paused mail)
    sveltekitCookies(getRequestEvent),
  ],
});
```

`hooks.server.ts` calls `svelteKitHandler({ event, resolve, auth, building })` (imports from `better-auth/svelte-kit` and `$app/env`), puts `session` and `user` on `event.locals`, and resolves `Authorization: Bearer tb_…` against `api_token` for API routes. Provider callbacks live at `/api/auth/callback/<providerId>`. Every record stores issuer, subject, email and name: `lib/server/auth/author.ts` reads them from the user and its `account` row (the OIDC account's issuer URL and `sub`) when a capture or comment is made, and snapshots them on `recording` and `comment` (D-114). The allowlist (`lib/server/auth/allowlist.ts`) applies to sign-up, every new session, API and device tokens and MCP access tokens.

Extension sign-in with `chrome.identity.launchWebAuthFlow`. The server is the only OAuth client and the extension holds no client secret.

1. The extension builds a PKCE pair and calls `launchWebAuthFlow({ url: `${server}/ext/connect?redirect_uri=${chrome.identity.getRedirectURL('cb')}&state=…&code_challenge=…`, interactive: true })`.
2. `/ext/connect` checks that `redirect_uri` is `https://<id>.chromiumapp.org/cb` with `<id>` in `EXTENSION_IDS`. With no session it redirects to `/login?next=<this url>`. The auth window shares the browser profile's cookies, so a user already signed in to the dashboard passes straight through.
3. With a session, the server stores an `ext_auth_code` (60 s, single use, bound to the challenge) and redirects to `redirect_uri?code=…&state=…`.
4. The extension posts `{ code, code_verifier }` to `POST /api/v1/ext/token` and gets a device token (`tb_dev_…`, a row in `api_token` with kind `device`), stored in `chrome.storage.local`. Settings lists it under "Connected browsers" with a revoke button.

The extension ID is pinned by a manifest `key`: the Chrome Web Store item's public key, in `apps/extension/wxt.config.ts` (D-196). Google holds the private half. Store installs and dev, test and unpacked builds therefore share one ID, `laobpjhffglefallhhojihfdbdkoendk`, the default of `EXTENSION_IDS`.

Better Auth's own `bearer` and `one-time-token` plugins were considered. The custom code+PKCE exchange keeps the extension token separate from browser sessions, makes it revocable per device, and serves as the same `api_token` mechanism the CLI's personal tokens use in Part 2.

## 10. The extension (apps/extension)

```
wxt.config.ts                  manifest, key, permissions, svelte module, webExt.disabled = true
entrypoints/
  background.ts                SW: registration, routing, webRequest, screenshots, uploader, ring index
  capture-main.content.ts      world MAIN, runAt document_start, allFrames, registration 'runtime'
  capture.content.ts           ISOLATED, document_start, allFrames, registration 'runtime': bridge, rrweb, redaction, ring buffer
  ui.content/index.ts          ISOLATED, injected on demand: toolbar + annotator in createShadowRootUi({ mode: 'closed' })
  offscreen/index.html, main.ts    MediaRecorder for tab/screen video, mic, instant-replay video ring
  popup/                       Svelte: capture mode picker, recent captures, sign-in state
  options/                     server URL, instant replay, shortcuts, masking
  permissions/                 one-time mic permission prompt (offscreen documents cannot show it)
lib/                           messaging types, uploader, idb, crop, upload queue
```

Manifest: `permissions: [activeTab, scripting, tabCapture, offscreen, storage, unlimitedStorage, identity, webRequest, alarms, desktopCapture]`, `commands` for the capture shortcuts in the catalogue, `key`. No `debugger`. Host access (D-202, replacing the optional permissions of D-126): `host_permissions` holds the build's server origin (`WXT_SERVER_URL`) and `<all_urls>`, both required, so a policy force-install needs no prompt; `lib/scope.ts` decides where the capture scripts are registered (the project origins in the default `projects` mode, D-203; every site in `all` mode). `lib/bg/sites.ts` adds the current site to a project from the popup and injects the scripts without a reload (D-205). Test builds hold `<all_urls>` only (D-127). `storage.managed_schema` (`managed-schema.json`) lets an admin policy set `serverUrl` and `lockServerUrl`. The server-page script `toolbar-web` matches the server origin only.

**Script registration path that survives Part 2.** Both capture scripts use WXT `registration: 'runtime'`. WXT emits the files and the service worker registers them with `chrome.scripting.registerContentScripts([{ id, js, matches, runAt: 'document_start', world: 'MAIN' | 'ISOLATED', allFrames: true, persistAcrossSessions: true }])`. Part 1 passed `matches: ['<all_urls>']`. Part 2 (D-126): the bootstrap lists the user's projects, the popup calls `chrome.permissions.request({ origins })` from a click, and `lib/registration.ts` `syncRegistration()` registers the scripts for the project origins that are granted, on worker start, sign-in, sign-out, project changes and `permissions.onAdded`/`onRemoved` (`lib/scope.ts`, `lib/bg/scope.ts`). With no granted project origin no capture script is registered. The worker sends each page its project's masking preset and body policy in the port's `config` command; the isolated world holds events until it arrives (D-125).

**Main-world script** (`@toolbar/capture/main`). It wraps `console.*`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, `history.pushState/replaceState`, and listens to `error`, `unhandledrejection` and `securitypolicyviolation`. Wrappers keep `toString` and property shapes so page code cannot easily tell them apart. Response bodies are read from `response.clone()` asynchronously and never block the page. Bridge: the script creates a `MessageChannel` and posts `port2` with `window.postMessage({ __tb: 'hello' }, '*', [port2])`. MAIN and ISOLATED script order is not guaranteed, so the isolated script also posts `{ __tb: 'ready' }` when it starts, and the main script answers a `ready` with a fresh channel (a transferred port cannot be sent twice). The isolated listener calls `stopImmediatePropagation`. After the handshake all traffic uses the private port. Events are buffered in the main world until the port is up.

**Isolated script.** It runs rrweb `record()` with `checkoutEveryNms: 30_000`, `blockSelector: 'toolbar-root'` (the UI host; the closed shadow root is invisible to rrweb anyway), mask options from the preset, and `sampling: { mousemove: 50, scroll: 150, input: 'last' }`. It also records `user` events with `TargetRef`, emits `dom` summaries, applies redaction (`@toolbar/shared/redact`: headers `authorization|cookie|set-cookie|x-api-key|.*(token|secret|key).*`, password and token inputs, JWTs, emails, card numbers by Luhn), and keeps the ring buffer. Known limit: rrweb in the isolated world cannot patch page prototypes, so `recordCanvas` and attachShadow tracking for page shadow roots do not work there. Canvas content reaches the record through screenshots and video; Part 2's canvas pixel check uses `captureVisibleTab` crops, so it is unaffected.

**Screenshots.** The service worker calls `chrome.tabs.captureVisibleTab({ format: 'png' })`, crops with `createImageBitmap` + `OffscreenCanvas` (both available in a service worker) to the element rect times `devicePixelRatio`, and downsamples to 1x CSS pixels for Part 2 folders.

**Reviewer toolbar (Part 2, D-134 to D-140).** `entrypoints/capture.content/review/` mounts in the same shadow root as the Jam-style UI: `Review.svelte` (keys, the guard while picking or drawing, the SVG layer with drawings and text highlights, pins, the text chip), `track.ts` (keeps drawings, highlights and pins on their elements through document and container scroll, resizes and layout shifts, D-204), `Pill.svelte`, `Composer.svelte`, `ItemList.svelte`, `state.svelte.ts` (all actions) and `page.ts` (element under the pointer, locator, anchors, selection). The worker side is `lib/bg/review.ts`: it keeps each tab's unsent notes in `chrome.storage.session` (`tb:review`) with their blobs in IndexedDB `blobs`, reads the 60 s context from the ring, crops `captureVisibleTab`, drives the offscreen voice recorder (`note-start`, `note-stop`) and submits. Start and Stop trace call the trace work package's `trace.start`, `trace.stop` and `trace.get`; a build without them shows the trace button disabled. While a trace runs each note is also appended to the tab's ring as an `annotation` event, so the span engine makes it an action. Each note asks the worker for its locator packet (`locator.capture`, no crop) when it is made and carries it to `feedback_item.locator` (D-164); the injector's page bundle builds the same packet in the page with `@toolbar/shared/locator-complete`. The span window for open requests is the project's `traceOpenMs` (D-166), read by the worker's live engine from the bootstrap and by the server through `traceConfigOf()`.

**Tab video.** On a user gesture (action click, popup button or command): `chrome.tabCapture.getMediaStreamId({ targetTabId })` in the service worker, `chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'], justification })`, then `getUserMedia({ video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId } }, audio: … })` in the offscreen document (Chrome 116+). Tab audio is routed back through an `AudioContext` so the user still hears the tab. Mic audio comes from `getUserMedia({ audio: true })` in the same document after the one-time grant on `permissions.html`, is mixed into the video track set, and is also recorded alone as `voice`. Screen video uses `getDisplayMedia` in the offscreen document (reason `DISPLAY_MEDIA`); spike S2 checks that the picker opens there, with a small extension window as the fallback. Offscreen documents have no lifetime limit except for `AUDIO_PLAYBACK`, and only one exists per extension, so `offscreen/main.ts` multiplexes recorders by recording id.

**State across service worker restarts.** Active recording state lives in `chrome.storage.session`. Content-script ports reconnect on `onDisconnect`. Port traffic and extension events reset the 30 s idle timer, so the worker stays up while a page is sending. Anything durable sits in IndexedDB before the worker acknowledges it.

## 11. Instant replay in MV3

The goal: on "Instant replay", produce the last N minutes (setting, default 2, max 5) of rrweb, logs and network, plus video if the user enabled it, with no recording started beforehand.

- **Where the buffer lives.** Per document, the isolated capture script keeps an in-memory ring of events and rrweb. Each second it streams new items over its port to the service worker, which appends them to IndexedDB store `ring` keyed `[tabId, t, id]`. The IndexedDB copy is what survives navigations, reloads and service worker restarts. In-page memory alone dies on every navigation.
- **Pruning.** Every 10 s the service worker deletes `ring` rows older than `now - N min`. It keeps rrweb from the newest full snapshot at or before the cut, because rrweb needs a full snapshot to replay from (hence `checkoutEveryNms: 30_000`). Caps: 64 MB per tab, then bodies are dropped first, then rrweb before the cut point is trimmed more aggressively. Closed tabs are purged on `tabs.onRemoved`.
- **Video (opt-in).** The user turns on "Instant replay with video" for a tab with a gesture, which starts a tab capture in the offscreen document. The Chrome capture indicator stays on while it runs. The recorder restarts every 10 s so each segment is a standalone WebM, and the offscreen document keeps the last `ceil(N*60/10)+1` segments as Blobs. The gap at each restart is a few milliseconds, accepted and recorded as a `media` `segment` event.
- **On trigger.** The service worker creates a recording (`kind: 'replay'`), reads the ring for that tab, slices from the cut point, and uploads it as normal `events` and `rrweb` chunks. The offscreen document uploads the retained segments, and the server concats them with ffmpeg. The ring keeps running.
- **Part 2 reuse.** "Comment without a trace" reads the last 60 s of `console` errors, `error` and failed `net.*` from the same ring, so this needs no extra capture code.
- **Cost control.** The ring only runs where instant replay is enabled (Part 1: the setting, with Jam's default as observed; Part 2: project origins only). Experiment 1 in Part 2 measures the rrweb rate per minute.

## 11a. The injector (`apps/injector`, D-157, D-158)

Delivery 2 of PLAN "Zero integration": a Go reverse proxy beside Traefik. One router for any host sends it only `/__toolbar/` and requests that carry the reviewer cookie (`deploy/injector/traefik-open-toolbar-injector.yml`); everyone else reaches the app directly. The injector forwards a reviewer's request back into Traefik (`INJECTOR_LOOPBACK`) without the cookie, and Traefik routes that second pass to the app through the router Coolify made, so the injector keeps no list of apps (D-201). A Traefik failover service sends reviewers straight to the app while the injector is down.

- **Reviewer cookie.** A review link, `/go/<project id>[?site=<origin>]` on the server, checks that the origin is in a project of the person's workspaces (`reviewOriginAllowed`, and `INJECTOR_ORIGINS` when set), mints a device token for that origin and signs `tbr1.<payload>.<HMAC-SHA256>` with `INJECTOR_SECRET`; a form post hands it to `<origin>/__toolbar/session`, which sets it HttpOnly and SameSite=Lax. The injector checks it offline and strips it from every request to the app.
- **Injection.** For a reviewer's page load the injector asks for `Accept-Encoding: identity` and no conditional headers, streams the body through the `x/net/html` tokenizer and writes each token's raw bytes, adding `<script src="/__toolbar/toolbar.js?v=..." nonce=...>` after `<head>` (the nonce from the enforced CSP's script directive). Anything that is not plain HTML, or any error, passes through unchanged.
- **Page bundle.** `apps/extension/page/` builds one classic script from `@toolbar/capture`: MAIN hooks and the isolated recorder in the page's realm, joined by the usual bridge, with `PageSession` as the Transport. It keeps a 60 s ring for comments and streams traces (kind `trace`) through `/__toolbar/api/v1/*`, which the injector relays to the server with the device token as bearer. The UI is a shadow-root bar styled by a constructed stylesheet.

## 12. Viewer and synced replay (`@toolbar/ui/viewer`)

Loads `events.json.gz` (one fetch, decompressed with `DecompressionStream`), video by Range from the media proxy, and rrweb lazily.

- **One clock.** `now()` returns recording-relative ms. With video, the `<video>` element is the master: `now = video.currentTime * 1000 + videoOffset`, sampled with `requestVideoFrameCallback` (fallback: `requestAnimationFrame`). Without video (instant replay without video, or a DOM-only capture), `@rrweb/replay` `Replayer` is the master via `getCurrentTime()`, rendered in the main pane. With both, the Replayer is paused and seeked (`replayer.pause(t)`) only when the DOM tab is open.
- **Panels.** Console, network (waterfall from `net.req`/`net.res` timing), user actions, info (`env`), and comments. Each panel binary-searches its sorted array for the index at `now()`, steps the text of future rows down one token (no opacity, D-180) and auto-scrolls unless the user scrolled away. Clicking a row seeks the clock (`video.currentTime = (t - videoOffset)/1000`). Timeline markers show errors, failed requests, navigations and comments.
- **Sync check.** The lab app gets a "flash" button that paints the page red and logs `FLASH` in the same frame. An e2e test asserts that, in the viewer, the console row highlights within 100 ms of the first red frame.
- **Transcript.** The WebVTT text renders as a `<track>` on the video and as a searchable list.

Transcription (`src/lib/server/transcribe/`, D-087, D-130 to D-133):

```ts
export interface Transcriber {
  id: 'local' | 'openai';
  model: string;
  hosted: boolean; // audio leaves the server and costs money: the monthly cap applies
  transcribe(input: { audio: Uint8Array; mime: string; durationMs?: number | null; pcm?: Int16Array }): Promise<{
    vtt: string; language?: string; model: string; billedSeconds: number; requests: number; mode: 'local' | 'native' | 'chunked';
  }>;
}
// TRANSCRIBE_PROVIDER = none (default, D-194) | local | openai; settings in config.ts, docs/configuration.md
```

- `local`: whisper.cpp (the default until D-194 made `none` the default), `POST ${WHISPER_URL}/inference` multipart with `file`, `response_format=vtt`, `language=auto`. The server runs with `--convert` so ffmpeg in its image accepts WebM/Opus. Default model `base`; `WHISPER_MODEL=small` trades CPU for accuracy. whisper-server handles one request at a time, so the `transcribe` job runs one at a time with this provider. Good timestamps and usable English, unusable Swahili (word error rate 80 to 95%, `docs/research/transcription.md`).
- `openai`: any OpenAI-compatible endpoint, `POST ${TRANSCRIBE_BASE_URL}/audio/transcriptions`, default model `gpt-transcribe`. The gpt-* models answer text only, so the server times the text itself (chunked mode):
  1. `audio.ts` decodes the voice track once to 16 kHz mono PCM with ffmpeg.
  2. `chunk.ts` finds pauses with an adaptive energy detector (30 ms frames, threshold at the local 10th percentile plus 0.35 of the spread to the 95th over a 10 s window, pauses of 0.3 s or more) and cuts chunks of at most `TRANSCRIBE_CHUNK_SECONDS` (30) at the centre of the longest pause in the second half of the window; with no pause it cuts hard and overlaps the next chunk by one second. Chunks with no voiced frame are not sent.
  3. Each chunk is cut from the PCM (exact offsets) and encoded to 32 kbps WebM/Opus, about 120 KB per 30 s, then sent as `response_format=json`, `TRANSCRIBE_CONCURRENCY` (4) at a time, with retries on 408, 409, 429 (not an exhausted quota), 5xx and network errors: four attempts, exponential backoff from 1 s, `Retry-After` honoured.
  4. `vtt.ts` splits each chunk's text into sentences and spreads them over the chunk's voiced time by their share of the characters; sentences that would last over 7 s split at commas (pieces of 30 characters or more). Words a hard cut repeats are dropped from the next chunk. Detected languages are ranked by voiced time (`sw,en`).
  Whisper-style models (`whisper-1`, Groq, speaches) return `vtt` (native mode); a file over 24 MB is chunked the same way and each chunk's cues are shifted by its offset. `TRANSCRIBE_TIMESTAMPS=auto` picks chunked for `gpt-*` ids, else tries `vtt` and switches to chunked on the 400 "not compatible" answer, remembered per model.
- Guards (`run.ts`): audio longer than `TRANSCRIBE_MAX_MINUTES` is skipped. For a hosted provider, `TRANSCRIBE_MONTHLY_MINUTES` caps the audio sent per calendar month (UTC): the job reserves the recording's length in the `instance_setting` row `transcribe.usage.YYYY-MM` in one conditional upsert before sending, settles it to the billed seconds afterwards and gives it back on failure. A skipped transcript has status `skipped` and the reason in `error`.
- Streams: `voice` is the capture's microphone track (recordings and traces); `voice:<assetId>` is a voice note on a comment (an asset of kind `voice`, one per comment). Each transcript's VTT starts with a `NOTE Machine transcript (<model>, language <codes>)` line. The viewer, captions, chapters, ai-draft and MCP `get_transcript` read `voice` only; comment voice notes reach the comment DTO (`voice.transcript`), MCP `list_comments` (`voiceNote.transcript`), `GET /api/v1/recordings/:id/transcript?asset=<id>` and `media/transcript-<assetId>`. Search covers both.
- Why whisper.cpp: an official multi-arch image with ffmpeg inside, active releases (v1.9.5, October 2026), native VTT output, no Python stack, and good CPU speed.

## 13. docker compose

The sketch below is the design from before the build. The files on main differ (D-021, D-171, D-194): `docker-compose.yml` holds only the server, Postgres and Garage, and takes six values (`PUBLIC_URL`, `BETTER_AUTH_SECRET`, `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `ADMIN_EMAILS`); whisper sits in `docker-compose.whisper.yml`, the mock OIDC provider and test switches in `docker-compose.dev.yml`, Mailpit in `docker-compose.mail.yml`; allowed email domains and transcription are set in Settings > Server, and transcription is off by default. `docs/configuration.md` describes the current files.

`compose.yaml` at the repo root. `docker compose up` on a clean machine builds the server image and starts everything with dev defaults. For a real deploy (Coolify), set the variables marked `!`. The server refuses to start when `PUBLIC_URL` is not localhost and a secret still has its dev default.

```yaml
name: toolbar
services:
  server:
    build: { context: ., dockerfile: apps/server/Dockerfile }
    ports: ["${PORT:-3000}:3000"]
    environment:
      PUBLIC_URL: ${PUBLIC_URL:-http://localhost:3000}            # !
      ORIGIN: ${PUBLIC_URL:-http://localhost:3000}
      BODY_SIZE_LIMIT: 16M
      DATABASE_URL: postgres://toolbar:${POSTGRES_PASSWORD:-toolbar}@postgres:5432/toolbar
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-dev-only-change-me-0000000000000000}   # !
      S3_ENDPOINT: http://garage:3900
      S3_REGION: garage
      S3_BUCKET: toolbar
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID:-GK00000000000000000000000000000000}       # !
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY:-0000000000000000000000000000000000000000000000000000000000000000} # !
      TRANSCRIBE_PROVIDER: ${TRANSCRIBE_PROVIDER:-whispercpp}
      WHISPER_URL: http://whisper:8080
      EXTENSION_IDS: ${EXTENSION_IDS:-<dev id from the manifest key>}
      OIDC_ISSUER: ${OIDC_ISSUER:-}                       # ! sign-in (docs/configuration.md, D-114)
      OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:-}                 # !
      OIDC_CLIENT_SECRET: ${OIDC_CLIENT_SECRET:-}         # !
      ALLOWED_EMAIL_DOMAINS: ${ALLOWED_EMAIL_DOMAINS:-}   # !
    depends_on:
      postgres: { condition: service_healthy }
      garage: { condition: service_healthy }
    restart: unless-stopped

  postgres:
    image: postgres:18-alpine
    environment: { POSTGRES_USER: toolbar, POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:-toolbar}", POSTGRES_DB: toolbar }
    volumes: [pg:/var/lib/postgresql]           # Postgres 18 images keep data under /var/lib/postgresql/18/docker
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U toolbar"], interval: 2s, retries: 30 }
    restart: unless-stopped

  garage:
    image: dxflrs/garage:v2.4.1
    command: ["/garage", "server", "--single-node", "--default-bucket"]
    environment:
      GARAGE_CONFIG_FILE: /etc/garage.toml
      GARAGE_RPC_SECRET: ${GARAGE_RPC_SECRET:-0000000000000000000000000000000000000000000000000000000000000000}  # !
      GARAGE_ADMIN_TOKEN: ${GARAGE_ADMIN_TOKEN:-dev-admin-token}                                              # !
      GARAGE_DEFAULT_ACCESS_KEY: ${S3_ACCESS_KEY_ID:-GK00000000000000000000000000000000}
      GARAGE_DEFAULT_SECRET_KEY: ${S3_SECRET_ACCESS_KEY:-0000000000000000000000000000000000000000000000000000000000000000}
      GARAGE_DEFAULT_BUCKET: toolbar
    volumes:
      - ./deploy/garage.toml:/etc/garage.toml:ro
      - garage-meta:/var/lib/garage/meta
      - garage-data:/var/lib/garage/data
    healthcheck: { test: ["CMD", "/garage", "status"], interval: 3s, retries: 30 }
    restart: unless-stopped

  whisper:
    image: ghcr.io/ggml-org/whisper.cpp:main     # pin @sha256 at scaffold
    entrypoint: ["bash", "-c"]
    command: ["[ -f /models/ggml-${WHISPER_MODEL:-base}.bin ] || download-ggml-model.sh ${WHISPER_MODEL:-base} /models; exec whisper-server --host 0.0.0.0 --port 8080 --convert -m /models/ggml-${WHISPER_MODEL:-base}.bin"]
    volumes: [whisper-models:/models]
    restart: unless-stopped

  oidc-mock:                                     # development and e2e sign-in: --profile dev
    image: ghcr.io/navikt/mock-oauth2-server:2.1.10
    profiles: [dev]
    ports: ["3311:8080"]

volumes: { pg: {}, garage-meta: {}, garage-data: {}, whisper-models: {} }
```

The paused mail is not in this file: `docker-compose.mail.yml` is an override that adds Mailpit and sets `FEATURE_EMAIL=1` and `SMTP_URL=smtp://mailpit:1025` on the server (`docker compose -f docker-compose.yml -f docker-compose.mail.yml up -d`, D-171).

Placeholder keys must match Garage's format (`GK` plus hex for the key id, hex for the secret); generate real ones with `scripts/gen-secrets.sh`, which writes `.env` with `openssl rand -hex`. The `apps/server/Dockerfile` is multi-stage: `node:24-bookworm-slim`, `corepack enable`, `pnpm install --frozen-lockfile`, `pnpm --filter @toolbar/server build`, `pnpm deploy --prod`. The runtime stage installs `ffmpeg` and runs `node build`.

## 14. Dev workflow on this VM

```bash
pnpm install
docker compose -f docker-compose.yml -f docker-compose.whisper.yml -f docker-compose.dev.yml up -d postgres garage whisper oidc-mock
pnpm --filter @toolbar/server db:migrate        # drizzle-kit migrate
pnpm --filter @toolbar/server dev               # vite dev on http://localhost:3000
pnpm --filter @toolbar/extension dev            # WXT watch build -> apps/extension/.output/chrome-mv3-dev
pnpm --filter @toolbar/extension build          # release build -> apps/extension/.output/chrome-mv3
```

- The lab app is already running as the `toolbar-lab` user unit on :5173 and :5174 (`systemctl --user status toolbar-lab`).
- WXT's own browser runner is off (`webExt: { disabled: true }`) because the VM has no display for it, and the shared browser belongs to another agent. Do not load the extension into the shared browser from scripts; the agent driving it does that with `scripts/xdrive/`.
- To look at the extension by hand, start a private headed Chromium on its own display: `Xvfb :100 & DISPLAY=:100 ~/.cache/ms-playwright/chromium-1243/chrome-linux/chrome --user-data-dir=/tmp/tb-profile --disable-extensions-except=$PWD/apps/extension/.output/chrome-mv3-dev --load-extension=$PWD/apps/extension/.output/chrome-mv3-dev http://localhost:5173`. Do not use ports 9224 to 9226, which the shared browser owns.
- Build-time config: `WXT_SERVER_URL` (default `http://localhost:3000`), `WXT_TEST_HOOKS=1` for e2e builds.

## 15. Test strategy

**Unit (vitest 5, `vitest.workspace.ts` at the root).**
- `packages/shared`: schema round-trips against zod, `serialize()` edge cases (cycles, DOM nodes, huge strings), redaction table tests, HAR conversion, the clock offset math.
- `packages/capture`: hooks in `happy-dom` (fetch/XHR/WebSocket/EventSource wrappers keep page behavior: same return values, same exceptions, `instanceof` holds), the ring pruning rules, `dom` summaries.
- `apps/extension`: `WxtVitest()` from `wxt/testing/vitest-plugin` with `fakeBrowser` for the uploader (IndexedDB via `fake-indexeddb`), registration and message routing.
- `apps/server`: token hashing, share access rules, the chunk state machine (201/200/409), the Transcriber adapters against recorded HTTP fixtures, the chunker on the FLEURS fixtures (`fixtures/transcribe/`), and one live hosted transcription gated on `TRANSCRIBE_LIVE_TEST=1`.
- `packages/trace` (Part 2): span close rules and outcomes on hand-written event fixtures, including the 30 hand-labeled actions from experiment 2.

**Integration (`pnpm test:int`).** The server's API runs against real Postgres and Garage from `docker compose up -d postgres garage`, with a fresh database per run (`CREATE DATABASE toolbar_test_<pid>`). Covered: chunked upload with gaps and retries, finalize + ffmpeg remux, Range proxying, share link expiry and revocation.

**End to end (`tests/e2e`, `@playwright/test` 1.63.0).** A fixture launches Playwright's bundled Chromium with the extension, per the Playwright extension guide:

```ts
const ext = path.resolve('apps/extension/.output/chrome-mv3');
const context = await chromium.launchPersistentContext(userDataDir, {
  channel: 'chromium',          // new headless supports extensions
  args: [
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`,
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    '--use-file-for-fake-audio-capture=tests/e2e/fixtures/voice.wav',
    '--auto-accept-this-tab-capture',
  ],
});
const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
const extensionId = new URL(sw.url()).host;
```

- `playwright.config.ts` `webServer` starts the server (`pnpm --filter @toolbar/server preview --port 3000`) and checks `http://localhost:5173` for the lab (it starts `pnpm --dir lab lab` if the unit is down).
- Sign-in: the test seeds a user and a device token through a test-only API (enabled when `TEST_MODE=1`) and writes it with `sw.evaluate(() => chrome.storage.local.set(...))`. One separate test runs the full `launchWebAuthFlow` path against `oidc-mock` (`--profile test`).
- Driving the UI: the toolbar lives in a closed shadow root that Playwright cannot pierce. Builds with `WXT_TEST_HOOKS=1` expose `globalThis.__tb` in the service worker (start, stop, screenshot, instant replay) and render the shadow root `open` so selectors work. One smoke test runs the release build and asserts `document.querySelector('toolbar-root').shadowRoot === null`.
- Gesture-gated APIs: `tabCapture` needs the extension invoked on the tab, and Playwright cannot click the browser action. Spike S1 (first day of the capture area) checks whether a click inside the extension popup page opened as a tab satisfies it. If it does not, video tests run headed on `Xvfb :100` and click the action icon with xdotool via `scripts/xdrive/` using `DISPLAY=:100`, never the shared display `:99`.
- Scenarios, one per lab behavior: working button, dead button, hanging request (shows pending), hidden 500, uncaught exception, every console level, form inputs masked per preset, route change, modal, long list, iframe, cross-origin image, canvas, WebSocket, SSE, streamed HTML. Each test asserts on the uploaded `events.json.gz` through the API and on the share viewer. The step 3 parity harness reuses these scenarios.
- CI command: `pnpm e2e` = `pnpm --filter @toolbar/extension build && playwright test`.

## 16. Spikes to run first

| ID | Question | Fallback |
|---|---|---|
| S1 | Can Playwright satisfy `tabCapture`'s invocation rule without clicking the action icon? | xdotool on private `Xvfb :100` |
| S2 | Does `getDisplayMedia` show the picker from the offscreen document? | Small extension window hosts the screen recorder |
| S3 | rrweb in the isolated world on the lab canvas, iframe and shadow DOM: what it misses | Note the gaps in `docs/jam/capture.md` comparisons; screenshot keyframes cover canvas |
| S4 | MAIN/ISOLATED handshake survives `document.open()` and bfcache restores | Re-handshake on `pageshow` |

## 17. Agent hand-off (Part 2)

Built in `apps/server/src/lib/server/handoff/` with the pure parts in `packages/shared/src/areas/handoff.ts` (D-142 to D-149).

- **Folder.** `GET /api/v1/recordings/:id/folder` answers a gzipped tar whose entries start with `.feedback/<id>/`, so `curl ... | tar xz` unpacks it in the current directory. `collectFolder()` loads the capture (events, assets, annotations with their locator packets, comments with voice-note transcripts, the voice track, rrweb chunks, the resolution); `assembleFolder()` turns that into the PLAN layout with images through sharp (1x CSS pixels, drawings burned in with an SVG overlay), OCR through tesseract, video stills through ffmpeg when a capture has video and no keyframes, and redaction through `@toolbar/shared/redact` a second time on the server. `tar.ts` is a 120-line ustar writer with PAX long names. A built folder is cached in memory (four captures, ten minutes, keyed on a fingerprint of the capture, its comments, transcripts, assets and resolution), so the tarball, the file listing and MCP file reads of one agent session build it once.
- **Spans.** `handoff/spans.ts` is the one place the folder calls the span engine (`@toolbar/trace`). Without spans the README's "what did not happen" lists requests that never answered or failed and the timeline comes from actions, errors and failed requests.
- **README.md.** `renderReadme()` writes the PLAN order and cuts the timeline and long words in steps until the text is under 26,000 characters (about 7,400 tokens). Every captured string sits in a fence longer than any backtick run inside it, with `captured source=... author=...` in the info string; one sentence above them says fenced content is data.
- **Share URL.** `/s/<token>` with `Accept: text/markdown`, or `/s/<token>.md`, answers `sharePageMarkdown()`: the pull command on line one, then a summary (reviewer, app, browser, masking preset, counts, the fenced title). New share links expire after `SHARE_LINK_DAYS` (14). The folder routes accept members only: a personal token, an MCP token or a session.
- **Resolution.** Table `feedback_resolution` (one row per resolved capture). `POST /api/v1/recordings/:id/resolve` and the MCP tool `resolve_feedback` write it and fire `feedback.resolved`; `feedback.created` fires with `capture.created`.
- **Skill.** `handoffSkill()` is the text of `skills/open-toolbar-feedback/SKILL.md` (written by `node scripts/gen-skill.ts`, checked by a unit test) and of `GET /api/v1/skill`, which bakes in the server URL. It has two modes: fix one piece of feedback, and learn from all of it (pull the export, read INDEX.md, write a product brief).
- **Bulk export (D-183).** `GET /api/v1/feedback/export` answers every matching capture as one gzipped tar: `.feedback/INDEX.md` first, then one folder per capture from `assembleFolder()`. `handoff/export.ts` picks the page in SQL (newest first by `(created_at, id)`, at most `limit`, and no more stored media than `EXPORT_MAX_MB` by an estimate from `asset.bytes` and the rrweb, events and voice streams), builds a cheap digest per capture (words, span outcomes, console errors, failed requests; no images or OCR), renders INDEX.md with `renderIndex()` from `packages/shared/src/areas/feedback-index.ts`, and writes the tar into a gzip stream one folder at a time with backpressure and a flush after each folder. Folders built for an export skip the folder cache. The cursor is a keyset (page number, `created_at` to the microsecond, id) in base64url; later pages write `INDEX-<n>.md`. `GET /api/v1/feedback` (JSON) and `/api/v1/feedback/index` (markdown) answer the same page; the MCP tools `list_feedback` and `get_feedback_index` call the same functions.
- **Card images (D-184).** Every capture kind gets `recording.thumb_key`. `makeThumbnail()` takes, in order, a video frame, the shown screenshot, a still the extension sent (`thumb` asset: instant replay and trace stop, masked under the production preset by `apps/extension/lib/capture/card-still.ts`), a trace keyframe or element crop, and else draws the placeholder card (`media/placeholder.ts`: SVG through sharp, page title, host, kind). Finalize ends with the placeholder when nothing else gave an image; the `backfill-thumbs` job, enqueued at start while ready captures lack one, fills older captures 25 at a time.

## Sources

- WXT content scripts and API reference: https://wxt.dev/guide/essentials/content-scripts.html, https://wxt.dev/api/reference/wxt/interfaces/BaseContentScriptEntrypointOptions.html (and `wxt@0.21.4` type definitions for `createShadowRootUi` `mode`)
- Chrome `tabCapture` and `offscreen`: https://developer.chrome.com/docs/extensions/reference/api/tabCapture, https://developer.chrome.com/docs/extensions/reference/api/offscreen
- Playwright extensions: https://playwright.dev/docs/chrome-extensions
- Better Auth: https://www.better-auth.com/docs/integrations/svelte-kit, https://www.better-auth.com/docs/plugins/generic-oauth, https://www.better-auth.com/docs/adapters/drizzle, https://www.better-auth.com/docs/plugins/organization
- Garage: https://garagehq.deuxfleurs.fr/documentation/quick-start/, https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/
- whisper.cpp: https://github.com/ggml-org/whisper.cpp (README "Docker", `examples/server`)
- speaches: https://speaches.ai/installation/
- Versions: `npm view` on 2026-10-13
