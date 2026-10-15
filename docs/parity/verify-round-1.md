# Parity review fix round 1: independent verification (2026-10-15)

A verifier that did not write the fixes rechecked the four findings of the review on `0eeace1`, against the compose server on :3000 (image built from `313d1b5`, every FEATURE_ flag off). Own Xvfb display `:161`; display `:99` and the shared browser were not used. Result: all four findings fixed.

## Method

- `docs/parity/evidence/verify-1/verify.mjs`: plain Playwright, a new context per width and theme with `colorScheme` set before the first navigation and no `data-theme` written, so dark mode comes from the browser preference alone. Signs in as the parity account, opens the S3.1 lab capture, measures the network header and the first three rows per column, opens every console row with an object, array or date.
- `dark.mjs`: overflow and the lowest WCAG contrast of visible text for the capture page, share popover, screenshot lightbox, members page and the signed-out share page with its console and network tabs, at 1440 and 390 in both themes. It also opens /settings/audit, /settings/integrations and /settings/cli (404 each). It minted one extra share link on the S3.1 capture.
- `api.mjs`: rows of /settings/api, the GET /api/v1 index, GET audit and POST ai-draft.
- Area e2e on a second container of the same image on :3105 (no domain allowlist, rate limits off, worker off): devtools.spec.ts "J-058 J-105 network header cells" and "J-055 J-056", media.spec.ts J-092 and J-094. 4 passed. Unit tests: shared 80, ui 81, capture 35, server gates 6, all passed.
- Parity reruns with the `chrome-mv3-rr1` build: G3 and G4 once in full (`e2e/runs/parity-v1-G3.log`, `parity-v1-G4.log`). S3.1 failed at the modal Delete click because the verifier's own headed probe ran on `:161` at the same time and took the X click; S4.1 then failed at once, since it reads the capture S3.1 writes. Both reran alone and passed (`parity-v1-G3-s31.log`, `parity-v1-G4-s41.log`). Every other G3 and G4 scenario passed in the full run.

## Findings

| Finding | Result |
|---|---|
| J-058, J-105 network columns | Header x equals body x for all 10 columns (0 px) at 1440 and 390, light and dark; no clipped label ("Domain" 50 px cell, 42 px text). |
| J-055, J-056 opened console rows | Message once, then 2 frames `fn @ file:line:col` with short file links; no argument block, no `$t`; the Date prints as an ISO string. Matches the layout of Jam's opened row. |
| J-092 and paused routes | No chapter pill on a capture with 5 page loads. /settings/api: 82 routes, none for ai-draft, audit, integrations or send; folder share and invites say their mail is paused. Audit and ai-draft: 503 `unavailable`. |
| Dark shots | Real dark body rgb(18, 18, 17). G3 and G4: 36 dark and light pairs, 0 identical, each dark shot darker (the 1440 lightbox pair differs least, since the light screenshot fills the frame). Lowest dark contrast 3.07 (faint text token), none under 3:1, overflow 0 px everywhere probed. |

## Notes

- Route summaries still mention paused things in passing: captures.list names "linked-issue filters", search.query names "linked issues", ext.bootstrap returns "integrations". These are summaries of kept routes, not paused routes, and were left as they are.
