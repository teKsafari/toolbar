# Part 2, step 4: projects and zero integration

Branch `p4/zero-integration`. PLAN items: "Zero integration" (delivery 1, the extension) and "Privacy" (redaction and the two masking presets). Decisions D-123 to D-127.

## What is built

### Server

- Table `project` (migration `0006_projects.sql`): workspace, name, normalized origins, masking preset (`staging` or `production`), body allowlist. `recording` gains `project_id` and `masking_preset`.
- API, in `packages/shared/src/api/projects.ts`:

  | Route | Who |
  |---|---|
  | `GET /api/v1/workspaces/:workspaceId/projects` | any member |
  | `POST /api/v1/workspaces/:workspaceId/projects` | admin |
  | `PATCH /api/v1/projects/:id` | admin |
  | `DELETE /api/v1/projects/:id` | admin |

  Origins are normalized as they arrive. `App.Example.com/path` becomes `https://app.example.com`, and a default port is dropped. `*.` covers subdomains. Anything else gets a 422.
- The extension bootstrap (`GET /api/v1/ext/bootstrap`) lists the projects of every workspace the user belongs to.
- Allowlist check on submit (D-124). `POST /api/v1/recordings` answers 403 `origin_not_allowed` when the page is on no origin of the workspace's projects. It stores the project and the applied preset on the capture. Four cases are exempt: a workspace with no project yet, desktop recordings, the server's own pages, and pages that are not http(s).
- The capture detail returns `project` and `maskingPreset`. The viewer's Info tab shows them, and the markdown share page adds `project` and `masking_preset` to its front matter.
- Dashboard page Settings > Projects. Admins add, edit and remove projects; members see the list. Origins go one per line, with a check as you type. Each preset is a radio card with one line saying what it does, and the allowlist field shows only for production. The page works at 390 px. The Privacy page links to it.

### Extension

- Manifest (D-126). `host_permissions` holds only the build's server (`WXT_SERVER_URL`). The extension can ask for `http://*/*` and `https://*/*` later as `optional_host_permissions`. The server-page script `toolbar-web` matches only the server, so the install prompt names no other site.
- `lib/scope.ts` and `lib/bg/scope.ts`. The worker registers both capture scripts with `registerContentScripts` for the project origins that have host access, and for nothing else. It re-syncs on worker start, sign-in, sign-out, a new project list, and `permissions.onAdded` and `onRemoved`. A new grant also injects the scripts into open tabs on those origins. The project list refreshes every 10 minutes, at sign-in, and when the popup opens on a page the extension cannot capture.
- Popup. On a project page without access it shows "Allow on <project>". The click calls `chrome.permissions.request` for the origins of all your projects at once. On any other page it says the site is in no project and links to Settings > Projects. On a project page it names the project and its preset below the capture rows.
- A page capture outside the granted origins is refused with `permission_denied` and a message, from the popup and from the shortcuts alike. Desktop recordings still work anywhere.
- Drafts go to the workspace of the page's project, so the server's origin check passes.
- The options page asks for host access to a custom server when you save it.

### Redaction and presets (D-125)

- The existing isolated-world redaction (`@toolbar/shared/redact`) stays. It removes `Authorization`, `Cookie`, `Set-Cookie`, `X-Api-Key` and headers matching token, secret or key. It also covers password and token fields, and JWTs, emails and Luhn card numbers in bodies, URLs and logs.
- New `createRedactor(policy)`, which adds the project's body policy:
  - Staging keeps bodies for the page's own origin and the project's origins.
  - Production keeps bodies only for allowlisted URL prefixes.
  - A dropped body carries `bodyOmitted: 'masking'`. The redactor remembers each request's decision so the response follows it, and WebSocket and SSE frames follow the decision made at `open`.
- Production also masks text in rrweb: all text and inputs are masked, and img, picture, video, audio, canvas, object, embed, iframe and svg image are blocked. In action targets, text, names and attribute values are masked; tag, role, test id and classes stay.
- The isolated world holds events until the worker's first `config` names the preset (`awaitConfig`). Until then it describes clicks under the production rules. The applied preset goes into the capture's env and the `recording` row.

## How it was verified

- Unit tests:
  - `packages/shared/test/projects.test.ts` (29): origin normalization and matching, `projectForUrl`, the body policies and `createRedactor`.
  - `packages/capture/test/privacy.test.ts` (3): production targets, events held until config.
  - `apps/extension/test/ui-controller.test.ts`: a capture outside the projects is refused, and the popup context reports access.
- Server integration test `apps/server/test/projects.int.test.ts` (5), run against a throwaway database. It covers the roles, normalization and 422s, the submit check with its exemptions, the bootstrap list across workspaces, preset and allowlist edits, and that removing a project keeps its captures.
- e2e, test build, `e2e/tests/zero-integration/scope.spec.ts` (3, passing):
  - With one project on `http://localhost:5173`, the capture scripts are registered for that origin only.
  - The lab page boots the MAIN-world hooks. The same lab page on `http://127.0.0.1:5173` gets no script, sends no event to the worker, shows "not in a project" in the popup, and a screenshot there is refused.
  - Production drops the body of an unlisted request, keeps the allowlisted one, masks click text and writes `production` into the env.
  - Staging keeps same-origin bodies. Signing out unregisters every capture script.
- e2e, release build, new flow Q (`e2e/flows/q-zero-integration.spec.ts`, passing). A fresh browser starts with only the server granted. The new user signs in, the popup says the lab is in no project, and the admin adds the lab in Settings > Projects. The popup's Allow raises Chrome's real prompt, which the test accepts with xdotool. After that, only the server and the lab are granted. The open lab tab boots the capture scripts and `127.0.0.1:5173` does not. A screenshot made with the shortcut carries project "Lab" and preset "staging", and the API refuses a capture from the other origin with `origin_not_allowed`.
- Flows that run on the lab keep working: `connectExtension` now adds the lab as a project and allows it from the popup. Every flow passed on display :180 against this branch's server on :3300 (`vite dev`, database `toolbar_p4_zero_integration`): O, A, B, F and J in one run; C, D, E, G, H, I, K (pull and delete), L, M, N and P in a second (13 passed). Q timed out once in that second run, on a click in a background tab. With `bringToFront` added it passed 3 runs of 3. Paused-feature tests skip as before.
- Area suites, test build, Part 1 scope:
  - smoke, ext-ui, auth/extension and editor: 84 of 87 passed. The 3 failures check styles and positions (veil alpha 0.45 against 0.5, cursor pill y 315 against 330, recording bar) and are not touched here. They match the three area failures reported on main.
  - capture: 32 of 36 passed and 2 were skipped. "navigation rows name the cause" fails on main's own test build too (checked with a build of `94ad5ac`). The microphone no-device test passed on a rerun.
- `pnpm -r --workspace-concurrency=2 build`, `test` and `check` all pass. `auth.int.test.ts` passes once `ALLOWED_EMAIL_DOMAINS` is empty; with this worktree's `.env` it reads `test`.

## What is not built or not verified

- Screenshots need `activeTab` or `<all_urls>` (D-127). They work after an extension invocation in the tab (the popup or a shortcut), and every current capture flow starts with one. A later in-page toolbar that captures pixels from its own button needs that invocation first, or a DOM-rendered fallback.
- Presets do not change screenshots or video. Those are pixels the reviewer chose to take.
- The parity rig (`e2e/parity/rig.ts`) now adds the lab project and allows it after sign-in, the same way the flows fixture does. It type-checks, but no parity scenario was run: they need the compose stack and the Jam side.
- `scripts/e2e-all.sh` was not run end to end on a fresh compose stack. The compose server image on :3000 is built from main and has no projects table until this branch is merged and rebuilt.
- Still to come from architecture section 6: `project.span_timeouts`, `reviewer_rule` (identity-provider groups are out of scope anyway) and `feedback_resolution`.
- The injector (delivery 2) and the review browser (delivery 3) are not part of this package.
- If another branch adds migration `0006`, rename one of the two and run `drizzle-kit generate` again at merge.
