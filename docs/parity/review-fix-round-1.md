# Parity review fix round 1 (2026-10-15)

This round answers the independent parity review: J-058 and J-105 (network columns), J-055 and J-056 (opened console rows), J-092 and the API page (paused features), and the evidence harness that produced 33 "dark" shots identical to their light twins. Rows whose claims rested on those shots were rechecked in real dark mode: J-090, J-099, J-118, J-121, J-124, J-173.

## Rerun setup

- Replica code on `main` at `313d1b5`. Release build of the extension copied to `apps/extension/.output/chrome-mv3-rr1` (its `BUILD_COMMIT` file names the commit).
- Rig: `PARITY_DISPLAY=:151 PARITY_EXT_BUILD=chrome-mv3-rr1`, Xvfb and openbox on `:151`, Playwright 1.63.0 Chromium. Display `:99` and the shared browser were not used.
- Rig server: the compose image rebuilt from `313d1b5` with the round-3 sign-in values (`AUTH_DEV_PASSWORD=1`, `OIDC_1_*`, `AUTH_ALLOWED_DOMAINS=example.com`), every FEATURE_ flag off.
- Reruns: G1 S1.3, G2 S2.1, G3 S3.1 and S3.2, all of G4, G5 S5.1 and S5.3, G7 S7.1. All passed. Load average 1.0 to 3.2.
- Logs: `e2e/runs/parity-rr1-*.log`. Shots: `e2e/parity-shots/G<n>/` (both git-ignored); the shots from before this round are in `e2e/runs/parity-shots-before-rr1/`. Small JSON extracts that stay in git: `docs/parity/evidence/review-1/`.

## Rows

| Row | What changed | New evidence |
|---|---|---|
| J-058, J-105 | The header row and the request rows read one column template (`--cols`) and share the same box: no column gap, 4 px left padding, 3 px left border (D-106). Before, each row carried the shared row style's 6 px column gap, so header labels slid further from their columns at each step, and "Domain" ran into "Type". Column widths were retuned so every label fits: Waterfall needed 53 px and had 33. Header cell x against first-row cell x: largest gap 0 px over 10 columns at 1440 and at 390, in light and dark, and no clipped label. The area e2e (`devtools.spec.ts`, "J-058 J-105 network header cells start at their body columns") asserts the gap within 1 px at 1440, with the desktop recording's Tab column, beside the detail pane and at 390. | `review-1/network-alignment.json`; `parity-rr1-G3-s31s32.log`, `parity-rr1-G4.log`; `S3.1-tabs-network-nib-*`, `S4.1-13-network-nib-*` |
| J-055, J-056 | The viewer prints console values through the shared formatter in `@toolbar/shared/derive`; its own copy, which knew neither `date` nor `regexp` tags, is gone (D-107). The formatter now reads every tag the capture serializer writes, at any depth. An opened row shows the message in full, then its frames as `fn @ file:line:col` with a short file link, and no argument block. S3.1's opened object, array and nested rows: 0 argument blocks, no `$t`, no repeated message, 2 frames each; 19 of 19 console and error rows open to linked frames. | `review-1/console-opened.json`; `parity-rr1-G3-s31s32.log`; `S3.1-console-expanded-nib-1440-light.png` |
| J-092 | The chapters pill, its menu and the seek-bar splits show only with FEATURE_AI on (`chapters` in the viewer page data, D-108). The S4.1 step 3 control list lost `chapter-pill` and kept the rest. | `review-1/player-controls.json`; `parity-rr1-G4.log` |
| Scope (API) | Routes carry `paused: [flags]` in the contract. /settings/api and the GET /api/v1 index leave out ai-draft, the audit log and the seven integration and send routes while their flags are off (82 rows on the page, none of them paused). With FEATURE_AI off, `POST /api/v1/recordings/:id/ai-draft` answers 503 `unavailable`; with FEATURE_ADMIN_EXTRAS off, `GET /api/v1/workspaces/:id/audit` answers 503 `unavailable` too. Route summaries for folder share, invites, comments, views and recording links no longer promise mail. | `apps/server/test/gates.int.test.ts`, `packages/shared/test/api.test.ts`; a curl against :3000 returned both 503s |
| Harness | Theme shots go through `Evidence.shot` (D-109). It pins the theme on the page: the emulated colour scheme plus `data-theme` on `<html>`, since a navigation in the extension's persistent context can drop the emulated scheme. It then checks the page background (dark under 80 luminance, light over 180) and fails when a shot is byte-identical to its twin of the other theme. Every theme shot in this round: background luminance 18 in dark, 246 in light. Identical dark and light pairs: 33 of 108 before, 0 of 108 after. | `review-1/identical-before.txt`, `review-1/dark-light-pairs.txt`; `theme-checks` in each scenario's JSON |
| J-090, J-099, J-118, J-121, J-124, J-173 | Rechecked in real dark mode. Sideways overflow is 0 px for every state at 1440 and 390 in both themes: capture page, network, console, lightbox, share popover, signed-out share page and its dev tools, members page. No text measures under 3:1 contrast in either theme. | `review-1/dark-probe.json` (`e2e/parity/dark-probe.ts`); `parity-rr1-G4.log`, `parity-rr1-G5-s51s53.log`, `parity-rr1-G7-s71.log` |

## Contrast in dark mode

`e2e/parity/dark-probe.ts` measures the WCAG contrast of every visible text run against the background it sits on. The lowest ratios come from the faint text token (`rgb(125, 120, 110)` in dark): row numbers, console and network times, and the settings nav's group labels. In dark they measure 3.07 to 3.32 on tinted rows and 3.62 to 4.27 on plain surfaces. In light the same token measures 3.83 to 4.06. Both themes fall under the 4.5:1 AA mark for small text in these places, and no row's claim depends on it. Jam has no dark mode to compare against. This is a design-token question for the cosmetic stage (D-086) and was not changed here.

## Other fixes found on the way

- `e2e/tests/viewer/devtools.spec.ts` J-062 looked for the word "sent" in a socket frame row. The list shows an arrow, and the direction is in its label, so the test now reads the label.
- `e2e/tests/viewer/media.spec.ts`: J-096 is skipped unless `E2E_FEATURE_AI=1` (paused tests are skipped by default). J-092 and J-094 check that the pill and the chapter title are absent while the flag is off.
- New viewer fixture d5 (`e2e/tests/viewer/fixtures/extra.ts`): console rows with object, array, Date and Map arguments and call-site stacks, as the serializer writes them.
