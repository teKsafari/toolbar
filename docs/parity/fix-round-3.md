# Parity fix round 3 (2026-10-15)

Round 3 closes the P0 and P1 items from the reviewer's rerun of round 2: J-086, J-182 (with J-037), J-006 (with J-027, J-181), J-118, J-088, and the G1 S1.6 rig problem behind J-013, J-014 and J-211. Paused rows (docs/scope.md) were not touched and no paused check ran.

## Rerun setup

- Replica code on `main` from `68ef3b5` to `100ddc0`. Release build of the extension copied to `apps/extension/.output/chrome-mv3-r3` (its `BUILD_COMMIT` file names the commit).
- Rig: `PARITY_DISPLAY=:131 PARITY_EXT_BUILD=chrome-mv3-r3`, Xvfb and openbox on `:131`, Playwright 1.63.0 Chromium. Display `:99` and the shared browser were not used.
- Rig server: the compose image rebuilt from this round's code, with the same sign-in values as round 2 (`AUTH_DEV_PASSWORD=1`, `OIDC_1_*`, `AUTH_ALLOWED_DOMAINS=example.com`), FEATURE_AI off.
- Logs: `e2e/runs/parity-r3-*.log`; shots: `e2e/parity-shots/G<n>/` (both git-ignored). The shots from before this round are kept in `e2e/runs/parity-shots-before-r3/`. Every timing carries the 1-minute load average; none was above 3.6.

## Rows

| Row | What changed | New evidence |
|---|---|---|
| J-086, J-197 | The editor frame no longer shows its own loading toast; it reports progress to the page at the keypress, before the flatten, and the page's toast turns into the done toast (D-103). At the first toast: 1 toast in the page, 0 in the editor frame, in 3 of 3 runs. Median of 3 (load 0.69 to 1.75): progress toast 0.11 s, link 0.56 s, tab 0.60 s, done toast 0.66 s. | S2.1 step 21: `parity-r3-G2-s21-{1,2,3}.log`, `S2.1-21-first-toast-nib-1440-light.png` |
| J-182, J-037 | The AI switch beside Create is hidden while FEATURE_AI is off (D-104): the bootstrap carries `features.ai`. Count 0 on the screenshot draft (S2.1 step 20), the video draft (S2.4 step 8) and the replay draft (S8.3 step 4, 3 runs). | `parity-r3-G2-s21-*.log`, `parity-r3-G2-s24.log`, `parity-r3-G8-s83.log` |
| J-006, J-027, J-181 | The recorder starts after the page says it painted without the veil (D-102). New scenario S3.6 reads the first frame of 12 chord recordings (half with two busy loops) and compares its brightness with a frame 0.6 s in. This build: 0 veil frames in 24 (two runs, load 1.3 to 3.6), plus clean first frames in S1.2, S3.1 and both S3.2 recordings. The round-2 build: 1 in 12 (run 1, the first recording after the browser started, as N1 was). Chord to live 3.6 s median (load 1.38 to 2.38); click to live 4.0 s (load 1.79). | `parity-r3-G3-s36.log`, `parity-r3-G3-s36-2.log`, `parity-r3-G3-s36-r2build.log`, `parity-r3-G3-s31.log`, `parity-r3-G3-s32.log`, `parity-r3-G1.log` |
| J-118 | The popover shows two tiles side by side and the General access select alone (D-105): 360x244 against Jam's 356x268 (round 2: 360x372). | S5.1 step 2: `parity-r3-G5-s51.log`, `S5.1-2-popover-nib-1440-light.png` |
| J-088 | The editor asks the page to remove it in the same turn as the discard request, without waiting for the worker. S2.3 step 4 now stamps the Escapes inside the editor and the frame's detach as it happens: gone 0.28 s after the first press, 26 ms after the second (median of 3, load 1.1 to 2.1), against Jam's 0.4 s. The round-2 build gives 0.28 s by the same timing: the 0.54 s of earlier runs came from the blocking xdotool call, which returns only after both key releases. | `parity-r3-G2-s23-{1,2,3}.log`, `parity-r3-G2-s23-r2build.log` |
| J-013, J-014, J-211 (rig) | G1's `compose()` restart in S1.6 now passes the rig sign-in values (dev password, mock OIDC, domain allowlist) under the caller's own variables, so a plain run keeps them. Full G1 with nothing exported: 6 passed in 9 minutes; J-014 tab closed after 558 ms, pill off; J-013 warn 30.3 s, danger 50.2 s, stopped 60.1 s with the draft open; J-211 menu with 3 devices, mic on after the switch, still recording. The server ran with `AUTH_DEV_PASSWORD=1` and `OIDC_1_ID=company` afterwards. | `parity-r3-G1.log` |

## Left for later

- The viewer's chapter pill (FEATURE_AI) was outside this round's rows and was not checked.
- The S3.6 check reads the draft video in the editor; the uploaded video is the same recording, and the four uploaded tab recordings checked through the API had clean first frames too.
