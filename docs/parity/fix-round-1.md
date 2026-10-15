# Parity fix round 1 (2026-10-15)

Round 1 closed the P0 and P1 gaps that G1 to G8 left in `docs/parity.md`. This file lists what changed per row and the reruns that back the new verdicts. Paused rows (docs/scope.md) were not touched.

## Rerun setup

- Replica code on `main` from commit `1fcb157` on. Release build of the extension, copied to `apps/extension/.output/chrome-mv3-r1` so other builds could not change it mid-run.
- Rig: `PARITY_DISPLAY=:131 PARITY_EXT_BUILD=chrome-mv3-r1`, Xvfb and openbox on `:131`, Playwright 1.63.0 Chromium. Display `:99` and the shared browser were not used.
- Server: the compose image rebuilt from this round's code, started with the `dev` profile's mock OIDC provider and the scope's sign-in settings:

  ```sh
  OIDC_1_ID=company OIDC_1_NAME="Company SSO" OIDC_1_CLIENT_ID=toolbar OIDC_1_CLIENT_SECRET=dev \
  OIDC_1_DISCOVERY_URL=http://oidc.localhost:3311/company/.well-known/openid-configuration \
  AUTH_ALLOWED_DOMAINS=example.com docker compose --profile dev up -d --build oidc-mock server
  ```

- Logs: `e2e/runs/parity-r1-G<n>*.log`; evidence: `e2e/parity-shots/G<n>/` (both git-ignored, as before). Every timing below carries the 1-minute load average; none was taken above 6.
- Mail stays paused (`FEATURE_EMAIL` off); no Mailpit step ran.

## Rows

| Row | What changed | New evidence |
|---|---|---|
| J-009 | The editor host read the draft's events with the rrweb parser, which drops capture events; it now reads them as capture events, and the trim track shows 500 and err badges. Row to editor 0.5 s median (load 1.3 to 1.6). | S1.4 step 3 |
| J-014 | The worker turns the mic on after the first grant, since Chrome closes the popup when the grant tab takes focus. No second click. | S1.6 step 2 |
| J-017 | Tile click starts; picker opens on Entire Screen; note focused on review; pop-out with pause and mic; title after the link. 6 recorder clicks, as Jam. | S6.3 steps 2 to 5 |
| J-025 | Pill 5 px right and 5 px below the pointer, 189x36 (Jam 201x36). | S1.1 step 4 |
| J-026 | Screenshot mode keeps the link row and the exit row's chevron. | S1.1 step 8 |
| J-027, J-195 | Countdown starts at the click with the preparation under it; warm microphone; one repaint before recording. Click to live 3.8 s (load 1.7) vs Jam 4.4 s; chord 3.3 to 3.6 s (load 1.0 to 1.8) vs Jam 4.1 s. Veil blurs the page; card about 340x120. | S1.2 step 1, S3.1 step 3, S3.2 |
| J-028 | Bar 295x46 (Jam 293x46). | S1.2 step 2 |
| J-030 | Strokes fade together 1.8 s after the last one, over 0.4 s. | S1.2 step 7 |
| J-054 | Quality menu lists Original, 720p to 240p and Auto from the first view; unready renditions show as preparing. | S4.1 step 3 |
| J-055, J-056 | Console time on the left, chips on one line, Date as ISO, no repeat badge on console.count; opened rows show short frame lines and scroll to the top. | S3.1 steps 8 and 10 |
| J-058, J-105 | Ten columns fit the default panel with 20 px rows. | S3.1, S4.1 step 13 |
| J-059, J-060 | Collapsible sorted header groups with word-edge wrapping; bodies with line numbers, folds, colours, pretty or raw and copy. | S3.1 steps 7 and 14 |
| J-062 | One row per socket or stream (webRequest sightings of it merge), one open frame, the whole frame shown, arrows for direction. | S3.2 |
| J-064, J-072, J-102, J-105 | GraphQL errors at HTTP 200 fail: red row named GetCart, console row, 200 marker; errors only and the network-errors chip both give 4 rows, as Jam. Crowded markers merge at 390. | S3.1, S4.1 steps 5, 10, 13 |
| J-067, J-068, J-069, J-187, J-190 | Event ids unique per document (D-088): every click, typing row and load after a navigation survives (31 action rows on N1); loads name their cause; no tab-hidden rows from frames or unloads; actions rows are one line; key rows show the chord (J-108). | S3.1, S3.2, S4.1 step 17, S7.2 |
| J-070, J-101 | Info tab Location row from the capture's country. | S3.1, S4.1 step 9 |
| J-071 | Screenshot captures end with a Screenshot taken row. | S3.3 |
| J-073 | The detail returns the stored metadata; the setup snippet has a copy button. | S3.4 |
| J-081 | A fresh draft opens on the workspace and folder picked last. | S2.1 step 24, S2.2 |
| J-085 | Markers above the video trim bar; the grip takes the focus, so Ctrl+Z and Ctrl+Shift+Z undo and redo trims. | S2.4 step 8 |
| J-119 | General access select in the share popover; members only set through it. | S5.1 step 3 |
| J-122 | Folder guests view the folder and its captures; invites tied at sign-in; one row per person; general access adds Anyone with the link (signed in). | S5.3 steps 1 and 3 |
| J-123 | With mail paused the invite dialog copies the person's invite link; Invite stays an icon under 520 px. | S5.3 step 2 |
| J-124, J-173, J-172 | Members page fits 390 without Last active; switches stay right on phones; Add members beside the members heading. | S5.3 step 3, S7.1 steps 2 and 3 |
| J-128 | Hover card stays inside the player. | S5.2 step 2 |
| J-142 | Split out of the paused S7.3 and run on Nib: signed capture.created about 2 s after finalize (load 1.8); a 500 is retried after its backoff and logged. Jam side: public docs only. | S7.3 step 7 |
| J-146 | Consent card centred. | S8.1 step 2 |
| J-151 | MCP comments show "via Claude Code". | S8.1 step 5 |
| J-158 | Replay drafts keep a still of the page; it becomes the card image. | S4.3, S6.1 step 1 |
| J-160 | Filter menus close on a pick. | S6.1 step 3 |
| J-163 | Fields opened from a button take the focus (focus action instead of autofocus). | S6.2 step 1 |
| J-167 | Share on the links page copies in one click. | S6.3 step 2 |
| J-168, J-221 | Rebuilt image carries 899c25c (menu fits the sidebar); the new-workspace form is a page of its own with a close button, the tile beside the name and a full-width Next. | S6.3 step 6, S7.1 step 5 |
| J-209 | Full viewport image shows the crop box. | S4.2 step 2 |
| J-211 | Microphone picker on the bar; switching keeps the recording going. | S1.6 step 2 |
| J-217 | One OIDC button against the dev mock provider, domain allowlist; refused domains land on /login with the reason; readable disabled Continue in dark. Provider click to dashboard 0.9 s (load 2.6). | S7.1 step 7 |
| J-218 | Restart closes open editors (100 ms); an orphaned script removes its UI; reopening a draft injects a live script first. | S1.2 step 15 |
| J-222 | Role menu opens outside the table, all three options visible. | S7.1 step 4 |

## Spec changes

The parity specs changed where the product's flow changed: S1.6 drives the microphone picker, S3.1 reads collapsible header groups, S5.1 sets access through the select, S5.3 finds the invite button by test id and checks Anyone with the link with a throwaway account, S6.2 accepts N5 in either workspace (the remembered workspace now applies), S6.3 copies with one Share click, counts the picker's own pane and the focused note, S6.1 presses Escape only when a menu stays open, S7.1 signs in through the OIDC button, and a new G7 test covers S7.3 step 7 (webhooks).

## Left for later

- Instant-replay captures made before this round keep the video icon on the grid; new ones get a still.
- Jam's recipient note becomes the first comment; Nib keeps it as the description.
- The password and work-email paths still show on /login while the rig runs with `AUTH_EMAIL_PASSWORD=true`; hiding them by default is part of step 4.
